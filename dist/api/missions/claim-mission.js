"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _xp_engine_js_1 = require("../_xp-engine.js");
const _progress_js_1 = require("./_progress.js");
const _mission_catalog_js_1 = require("./_mission-catalog.js");
// Server-authoritative mission claim. Replaces the old client-side reward math
// for built-in COMBAT and FIELD missions and the onboarding ACADEMY-TRIAL: the
// client posts only { missionType, missionId } — never amounts — and the server
// resolves the reward from the trusted catalog, recomputes XP with the same
// engine as the client (api/_xp-engine.gainXp), enforces eligibility, persists
// under the save lock, and returns the server-computed amounts for the client to
// mirror onto its local character (same reconcile pattern as report-pet-event).
//
// Eligibility enforced server-side (against the SAVED character, not the body):
//   • combat       — missionId must be in pendingCombatMissionClaims (queued by
//                    the Arena win); consumed on claim. Counts toward daily cap.
//   • field        — level requirement + daily cap. (Explore/raid progress stays
//                    client-tracked — same trust model as raids/expeditions.)
//   • academy-trial— one-time (character.academyTrialClaimed). OFF the daily cap.
//
// Unknown / creator-authored mission ids are not in the catalog → the response
// signals clientFallback so the (unchanged) client path can still pay those.
const monthKeyOf = () => new Date().toISOString().slice(0, 7);
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const bodyPeek = typeof req.body === 'string' ? (() => { try {
        return JSON.parse(req.body);
    }
    catch {
        return {};
    } })() : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'claim-mission', 5, 10_000, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const missionType = String(body.missionType ?? '');
        const missionId = String(body.missionId ?? '').slice(0, 80);
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (missionType !== 'combat' && missionType !== 'field' && missionType !== 'academy-trial') {
            return res.status(400).json({ error: 'Invalid mission type.' });
        }
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only claim your own missions.' });
        }
        const saveKey = `save:${playerName}`;
        const todayKey = (0, _progress_js_1.utcDateKey)();
        const monthKey = monthKeyOf();
        // Currency path: persist under the SAME lock the save endpoint uses so a
        // concurrent auto-save can't clobber the credit, and so two rapid claims
        // can't both slip past the one-time / daily-cap / pending checks.
        const outcome = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
            const record = await _storage_js_1.kv.get(saveKey);
            const char = record?.character;
            if (!record || !char)
                return { applied: false, reason: 'no-save' };
            const bonusPct = (0, _mission_catalog_js_1.missionRewardBonusPct)(char);
            // ── Resolve mission + per-type eligibility ──────────────────────
            let baseXp = 0, baseRyo = 0, baseStamina = 0;
            let scrolls = 0;
            let currencyBase;
            let combat;
            let completion = 'daily';
            let academyTrialClaimed = false;
            if (missionType === 'combat') {
                const def = (0, _mission_catalog_js_1.combatMissionByKey)(missionId);
                if (!def)
                    return { applied: false, reason: 'unknown-mission', clientFallback: true };
                const pending = Array.isArray(char.pendingCombatMissionClaims) ? char.pendingCombatMissionClaims : [];
                if (!pending.includes(def.key))
                    return { applied: false, reason: 'not-queued' };
                if (!(0, _mission_catalog_js_1.hasDailyMissionSlot)(char, todayKey))
                    return { applied: false, reason: 'daily-cap' };
                baseXp = def.xp;
                baseRyo = def.ryo;
                scrolls = def.territoryScrolls;
                combat = { aiProfileId: def.aiProfileId, missionKey: def.key };
                completion = 'daily';
            }
            else if (missionType === 'field') {
                const def = (0, _mission_catalog_js_1.fieldMissionById)(missionId);
                if (!def)
                    return { applied: false, reason: 'unknown-mission', clientFallback: true };
                if (Number(char.level ?? 1) < def.levelReq)
                    return { applied: false, reason: 'level' };
                if (!(0, _mission_catalog_js_1.hasDailyMissionSlot)(char, todayKey))
                    return { applied: false, reason: 'daily-cap' };
                baseXp = def.xpReward;
                baseRyo = def.ryoReward;
                baseStamina = def.staminaReward;
                scrolls = _mission_catalog_js_1.FIELD_MISSION_SCROLLS;
                currencyBase = def.currencyRewards;
                completion = 'daily';
            }
            else {
                // academy-trial — one-time, off the daily cap.
                if (char.academyTrialClaimed)
                    return { applied: false, reason: 'already-claimed' };
                baseXp = _mission_catalog_js_1.ACADEMY_TRIAL.xp;
                baseRyo = _mission_catalog_js_1.ACADEMY_TRIAL.ryo;
                baseStamina = _mission_catalog_js_1.ACADEMY_TRIAL.stamina;
                completion = 'total';
                academyTrialClaimed = true;
            }
            // ── Compute server-authoritative amounts ────────────────────────
            const xpBoosted = (0, _mission_catalog_js_1.boostAmount)(baseXp, bonusPct);
            const ryoBoosted = (0, _mission_catalog_js_1.boostAmount)(baseRyo, bonusPct);
            const staminaBoosted = baseStamina > 0 ? (0, _mission_catalog_js_1.boostAmount)(baseStamina, bonusPct) : 0;
            // ── Apply onto the saved character ──────────────────────────────
            let next = (0, _xp_engine_js_1.gainXp)(char, xpBoosted);
            next = { ...next, ryo: Number(next.ryo ?? 0) + ryoBoosted };
            if (staminaBoosted > 0) {
                const maxStamina = Number(next.maxStamina ?? 0);
                next = { ...next, stamina: Math.min(maxStamina, Number(next.stamina ?? 0) + staminaBoosted) };
            }
            if (scrolls > 0) {
                next = { ...next, inventory: (0, _mission_catalog_js_1.grantTerritoryScrollsToInventory)(next, scrolls) };
            }
            const currencyFields = (0, _mission_catalog_js_1.applyCurrencyRewardFields)(next, currencyBase);
            next = { ...next, ...currencyFields };
            if (combat) {
                const aiId = combat.aiProfileId;
                const missionKey = combat.missionKey;
                const defeated = Array.isArray(next.defeatedAiIds) ? next.defeatedAiIds : [];
                const aiKills = (next.aiKills && typeof next.aiKills === 'object') ? next.aiKills : {};
                const pending = Array.isArray(next.pendingCombatMissionClaims) ? next.pendingCombatMissionClaims : [];
                next = {
                    ...next,
                    totalAiKills: Number(next.totalAiKills ?? 0) + 1,
                    dailyAiKills: Number(next.dailyAiKills ?? 0) + 1,
                    defeatedAiIds: defeated.includes(aiId) ? defeated : [...defeated, aiId],
                    aiKills: { ...aiKills, [aiId]: Number(aiKills[aiId] ?? 0) + 1 },
                    pendingCombatMissionClaims: pending.filter((k) => k !== missionKey),
                };
            }
            if (completion === 'daily') {
                next = { ...next, ...(0, _mission_catalog_js_1.markMissionCompletedFields)(next, todayKey, monthKey) };
            }
            else if (completion === 'total') {
                next = {
                    ...next,
                    clanMissionContrib: Number(next.clanMissionContrib ?? 0) + 1,
                    totalMissionsCompleted: Number(next.totalMissionsCompleted ?? 0) + 1,
                    clanContribMonth: monthKey,
                };
            }
            if (academyTrialClaimed)
                next = { ...next, academyTrialClaimed: true };
            const updated = { ...record, character: next };
            await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(updated, record));
            return {
                applied: true,
                reward: {
                    xpBoosted,
                    ryo: ryoBoosted,
                    stamina: staminaBoosted,
                    territoryScrolls: scrolls,
                    currency: currencyBase ? { ...currencyBase } : {},
                },
                combat,
                completion,
                ...(academyTrialClaimed ? { academyTrialClaimed: true } : {}),
            };
        }, { failClosed: true });
        // New-shinobi dailies: a successful mission claim is the main activity
        // signal for pre-profession players. reportNewbieEvent no-ops for anyone
        // who has a profession and takes its own locks, so it runs AFTER the
        // claim's save lock has released (no nested locking). Best-effort — a
        // failure here must never fail the (already-applied) claim.
        if (outcome.applied) {
            try {
                await (0, _progress_js_1.reportNewbieEvent)({ playerName, kind: 'newbie-missions' });
                if (missionType === 'combat') {
                    await (0, _progress_js_1.reportNewbieEvent)({ playerName, kind: 'newbie-battle-wins' });
                }
            }
            catch (e) {
                console.error('[claim-mission newbie]', e);
            }
        }
        return res.status(200).json({ ok: true, ...outcome });
    }
    catch (err) {
        console.error('[missions/claim-mission]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
