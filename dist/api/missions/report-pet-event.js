"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _progress_js_1 = require("./_progress.js");
const _profession_mastery_js_1 = require("../_profession-mastery.js");
// Server-side Tamer XP for completed expeditions. Matches the client-side
// formula (5 XP/min base, +50% for >=1h, +100% for >=4h, x2 daily First
// Expedition, x1.2 if petEscortBonusReady is consumed).
const MIN_EXPEDITION_MINUTES = 10;
// Longest legitimate expedition is 4 hours. Anything claimed beyond that is
// either a bot or a buggy client — clip at 240 min so XP / Ryo formulas
// can't be inflated by a forged body.
const MAX_EXPEDITION_MINUTES = 240;
// Hard daily ceiling on claims, even with PET_CAP = 5 pets each running
// back-to-back short expeditions. Stops a 30s-spam attack from accumulating
// thousands of claims/day.
const MAX_EXPEDITIONS_PER_DAY = 12;
function utcDateKey() {
    return new Date().toISOString().slice(0, 10);
}
function tamerXpForExpedition(durationMinutes, opts) {
    if (durationMinutes < MIN_EXPEDITION_MINUTES)
        return 0;
    const base = Math.floor(durationMinutes * 5);
    let mult = 1;
    if (durationMinutes >= 240)
        mult = 2; // +100% for ≥4h
    else if (durationMinutes >= 60)
        mult = 1.5; // +50% for ≥1h
    if (opts.isFirstToday)
        mult *= 2;
    if (opts.escortReady)
        mult *= 1.2;
    return Math.floor(base * mult);
}
// Pet Tamer mission progress reporter. Pet expedition/training state is
// currently client-side, so this endpoint trusts the client's event claim
// but is heavily rate-limited (1 per 30s per player) so it can't be spammed
// to inflate mission progress. Profession XP impact is small (~150 XP per
// mission completion); abuse risk is bounded by daily mission count + the
// per-save professionXp cap.
//
// When a server-side pet system exists, this endpoint should be replaced
// with direct hooks in the expedition/training-claim endpoints.
const VALID_EVENTS = ['expedition', 'long-expedition', 'pet-train'];
const EVENT_TO_KIND = {
    'expedition': 'pet-tamer-expeditions',
    'long-expedition': 'pet-tamer-long-expeditions',
    'pet-train': 'pet-tamer-pet-train',
};
const VALID_EXPEDITION_TYPES = ['scout', 'forage', 'ruins'];
// Per-type Ryo/drop tables (mirrors client formula in PetYard.collectExpedition).
const RYO_MULT = { scout: 1.35, forage: 1.0, ruins: 1.1 };
const BONE_RATE = { scout: 0.25, forage: 0.30, ruins: 0.40 };
const AURA_RATE = { scout: 0.00, forage: 0.01, ruins: 0.01 };
const FATE_RATE = { scout: 0.05, forage: 0.05, ruins: 0.10 };
function petTamerExpeditionMultFromRank(rank, profession) {
    if (profession !== 'petTamer')
        return 1;
    const r = Math.max(0, Math.min(10, rank));
    return 1 + (10 + r * 1.5) / 100;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // 1 report per 30 s per player. Rate limit BEFORE auth check so spam
    // attempts at unknown names also get throttled.
    const bodyPeek = typeof req.body === 'string' ? (() => { try {
        return JSON.parse(req.body);
    }
    catch {
        return {};
    } })() : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'report-pet-event', 1, 30_000, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        // event/duration/expType/petLevel are re-derived from the sealed
        // expedition token below for expedition events (audit M1), so they're
        // `let`. They stay client-supplied only for the non-currency pet-train.
        let event = String(body.event ?? '');
        let durationMinutes = Math.max(0, Math.min(MAX_EXPEDITION_MINUTES, Math.floor(Number(body.durationMinutes ?? 0))));
        let expType = (body.expType && VALID_EXPEDITION_TYPES.includes(body.expType) ? body.expType : null);
        let petLevel = Math.max(1, Math.min(100, Math.floor(Number(body.petLevel ?? 1))));
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!VALID_EVENTS.includes(event))
            return res.status(400).json({ error: 'Invalid event.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own events.' });
        }
        // Verify the player is actually a Pet Tamer. Cheap pre-lock peek; the
        // authoritative read happens under the lock below.
        const saveKey = `save:${playerName}`;
        const preCheck = await _storage_js_1.kv.get(saveKey);
        const preChar = preCheck?.character;
        if (preChar?.profession !== 'petTamer') {
            return res.status(200).json({ ok: true, petTamer: false });
        }
        // ── Expedition token: REQUIRED, single-use, time-gated (audit M1) ──
        // Expedition rewards (Ryo + premium drops + Tamer XP) are gated on a
        // token minted by /api/missions/expedition-start at launch. The token
        // seals expType/duration/petLevel so they can't be tampered with at
        // redeem, and an endsAt the redeem must be past so rewards require the
        // expedition to have actually run for its full duration. No fallback: an
        // expedition event without a valid, matured token earns nothing (returns
        // 200 + a reason so the client mirrors the zero-reward result cleanly).
        const NO_REWARD = { expeditionXp: 0, ryoEarned: 0, foundBone: 0, foundAura: 0, foundFate: 0, missionsCompleted: [] };
        // Pet Tamer mastery (Expeditioner path) reward multipliers, sealed into the
        // token at launch (PvE currency only). Default 1 = no bonus.
        let expRewardMult = 1;
        let expMaterialMult = 1;
        if (event === 'expedition' || event === 'long-expedition') {
            const tokRaw = typeof body.expeditionToken === 'string' && body.expeditionToken.trim() ? body.expeditionToken.trim() : undefined;
            const tok = tokRaw && /^[A-Za-z0-9]+$/.test(tokRaw) ? tokRaw : undefined;
            if (!tok) {
                return res.status(200).json({ ok: true, petTamer: true, reason: 'missing-expedition-token', ...NO_REWARD });
            }
            const tokenKey = `pet-exp-token:${playerName}:${tok}`;
            const tokenData = await _storage_js_1.kv.get(tokenKey);
            if (!tokenData || (tokenData.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
                return res.status(200).json({ ok: true, petTamer: true, reason: 'invalid-or-spent-expedition-token', ...NO_REWARD });
            }
            // Must have actually elapsed (60s grace for clock/latency skew).
            if (Date.now() < Number(tokenData.endsAt ?? 0) - 60_000) {
                return res.status(200).json({ ok: true, petTamer: true, reason: 'expedition-not-complete', ...NO_REWARD });
            }
            // Atomic single-use consume. kv.del resolves to the number of rows
            // it actually removed, so of two racing reports sharing ONE token
            // exactly one sees 1 — the loser sees 0 and earns nothing. The
            // earlier get→del was a non-atomic check-then-act (both reads could
            // see the token and both proceed). The pet-exp-token: key isn't
            // disk-routed, so del hits the atomic base store.
            const consumed = await _storage_js_1.kv.del(tokenKey).catch(() => 0);
            if (!consumed) {
                return res.status(200).json({ ok: true, petTamer: true, reason: 'invalid-or-spent-expedition-token', ...NO_REWARD });
            }
            // Drive all reward math from the SEALED token values, not the client
            // body — including the expedition/long-expedition split (long fires
            // extra mission progress) which is re-derived from the sealed duration.
            if (tokenData.expType && VALID_EXPEDITION_TYPES.includes(tokenData.expType))
                expType = tokenData.expType;
            durationMinutes = Math.max(0, Math.min(MAX_EXPEDITION_MINUTES, Math.floor(Number(tokenData.durationMinutes ?? durationMinutes))));
            petLevel = Math.max(1, Math.min(100, Math.floor(Number(tokenData.petLevel ?? petLevel))));
            event = durationMinutes >= 240 ? 'long-expedition' : 'expedition';
            // Capture the sealed mastery multipliers (clamped for safety).
            expRewardMult = Math.max(1, Math.min(2, Number(tokenData.expRewardMult ?? 1)));
            expMaterialMult = Math.max(1, Math.min(2, Number(tokenData.expMaterialMult ?? 1)));
        }
        // For expedition events, server computes Tamer XP AND the Ryo + drop
        // currencies (previously client-trusted). Pet stat/XP gains stay
        // client-side since they're per-pet state not global currency.
        //
        // Wrap the whole daily-counter check + currency credit in
        // withKvLock(save:<player>) so a concurrent /api/save auto-save can't
        // clobber the credit (previously an unlocked RMW — concurrent saves
        // could lose ryo / bone / aura / fate, or double-consume the escort
        // bonus). awardProfessionXp + reportMissionEvent run OUTSIDE the
        // lock because they take their own save lock.
        let expeditionXp = 0;
        let ryoEarned = 0;
        let foundBone = 0;
        let foundAura = 0;
        let foundFate = 0;
        let dailyCapHit = false;
        const isExpedition = event === 'expedition' || event === 'long-expedition';
        if (isExpedition && durationMinutes > 0) {
            // ── withKvLock: the daily-cap check + write must be atomic ────
            // Two concurrent expedition claims (multi-tab race) used to both
            // read the same `expeditionsClaimedToday`, both pass the cap
            // check, and both grant ryo/drops/Tamer XP. The lock serializes
            // them so the second sees the updated counter and short-circuits.
            await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                const record = await _storage_js_1.kv.get(saveKey);
                const char = record?.character;
                if (!char)
                    return; // race: save deleted mid-call
                const today = utcDateKey();
                const sameDay = char.lastExpeditionClaimDate === today;
                const claimedToday = sameDay ? Number(char.expeditionsClaimedToday ?? 0) : 0;
                // Caravan Master mastery capstone: +2 to the daily expedition cap.
                const dailyCap = MAX_EXPEDITIONS_PER_DAY + ((0, _profession_mastery_js_1.masteryHasCapstone)('petTamer', char.masterySpec, 'caravan-master') ? 2 : 0);
                if (claimedToday >= dailyCap) {
                    dailyCapHit = true;
                    return;
                }
                const isFirstToday = claimedToday === 0;
                const escortReady = !!char.petEscortBonusReady;
                const rank = Number(char.professionRank ?? 1);
                expeditionXp = tamerXpForExpedition(durationMinutes, { isFirstToday, escortReady });
                // Ryo + drop calculation (mirrors client formula). Requires expType.
                if (expType) {
                    const durationHours = Math.max(1, durationMinutes / 60);
                    const tamerMult = petTamerExpeditionMultFromRank(rank, char.profession);
                    const firstBonus = isFirstToday ? 2 : 1;
                    const dropBonus = (tamerMult - 1) + (isFirstToday ? 0.5 : 0);
                    ryoEarned = Math.round((90 * durationHours * RYO_MULT[expType] + petLevel * 6) * tamerMult * firstBonus * expRewardMult);
                    foundBone = Math.random() < (BONE_RATE[expType] + dropBonus) * expMaterialMult ? 1 : 0;
                    foundAura = Math.random() < (AURA_RATE[expType] + dropBonus * 0.1) * expMaterialMult ? 1 : 0;
                    foundFate = Math.random() < (FATE_RATE[expType] + dropBonus * 0.1) * expMaterialMult ? 1 : 0;
                }
                // Stamp daily tracking + consume escort bonus + apply currencies.
                const updated = {
                    ...record,
                    character: {
                        ...char,
                        lastExpeditionClaimDate: today,
                        expeditionsClaimedToday: claimedToday + 1,
                        ryo: Number(char.ryo ?? 0) + ryoEarned,
                        boneCharms: Number(char.boneCharms ?? 0) + foundBone,
                        auraStones: Number(char.auraStones ?? 0) + foundAura,
                        fateShards: Number(char.fateShards ?? 0) + foundFate,
                        ...(escortReady ? { petEscortBonusReady: false } : {}),
                    },
                };
                await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(updated, record));
            });
            // Daily cap reached — short-circuit cleanly with the same shape
            // the pre-lock cap check used to return.
            if (dailyCapHit) {
                return res.status(200).json({
                    ok: true,
                    petTamer: true,
                    reason: 'daily-expedition-cap',
                    expeditionXp: 0,
                    ryoEarned: 0,
                    foundBone: 0,
                    foundAura: 0,
                    foundFate: 0,
                    missionsCompleted: [],
                });
            }
            // Grant Tamer XP (subject to per-save cap and Rank-2 multiplier).
            // awardProfessionXp acquires its own lock — kept outside the
            // expedition-counter lock above so we don't nest lock acquires.
            if (expeditionXp > 0) {
                await (0, _progress_js_1.awardProfessionXp)(playerName, 'petTamer', expeditionXp);
            }
        }
        const kind = EVENT_TO_KIND[event];
        const result = await (0, _progress_js_1.reportMissionEvent)({
            playerName,
            profession: 'petTamer',
            kind,
        });
        const missionsCompleted = result.missionsCompleted;
        // For long-expedition events also fire the regular expedition counter
        // (a 4hr+ expedition counts as both a "completed expedition" and a
        // "long expedition" toward the relevant missions).
        let extraCompleted = [];
        if (event === 'long-expedition') {
            const extra = await (0, _progress_js_1.reportMissionEvent)({
                playerName,
                profession: 'petTamer',
                kind: 'pet-tamer-expeditions',
            });
            extraCompleted = extra.missionsCompleted;
        }
        // Re-read for the final post-grant state.
        const finalRecord = await _storage_js_1.kv.get(saveKey);
        const finalChar = finalRecord?.character;
        return res.status(200).json({
            ok: true,
            petTamer: true,
            expeditionXp,
            ryoEarned,
            foundBone,
            foundAura,
            foundFate,
            missionXpAwarded: result.xpAwarded,
            missionsCompleted: [...missionsCompleted, ...extraCompleted],
            professionXp: Number(finalChar?.professionXp ?? 0),
            professionRank: Number(finalChar?.professionRank ?? 1),
        });
    }
    catch (err) {
        console.error('[missions/report-pet-event]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
