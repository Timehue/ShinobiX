"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleeperTargetBlock = sleeperTargetBlock;
exports.computeSleeperSeals = computeSleeperSeals;
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const online_store_js_1 = require("../_realtime/online-store.js");
const _xp_engine_js_1 = require("../_xp-engine.js");
const _reward_farm_js_1 = require("../pvp/_reward-farm.js");
const _player_ips_js_1 = require("../_player-ips.js");
const _vanguard_rewards_js_1 = require("../pvp/_vanguard-rewards.js");
const _profession_mastery_js_1 = require("../_profession-mastery.js");
const _save_version_js_1 = require("../save/_save-version.js");
// "Sleeping target" KO. When a player logs out / closes the tab while standing
// in a WILD sector (currentSector >= 1) they don't vanish — they remain a
// visible, attackable target there (see api/player/roster.ts, which reports
// every registered player with online:false + their last-saved currentSector).
// A logout in the village or Central hub leaves currentSector at 0 (App.tsx's
// !inField effect), so those players are NOT sleepers and stay safe.
//
// Per the owner's design call this is a FREE KILL (no fight, fully
// server-resolved → nothing is trusted from the client) that grants the
// attacker the SAME rewards as a live PvP win — base ryo+XP (with the existing
// repeat-opponent decay), a PvP kill credit, and Vanguard Honor Seals under the
// existing daily / per-target caps — and sends the victim to the hospital +
// back to the village. Anti-farm is structural: the KO relocates the victim to
// sector 0 so they immediately leave the sleeper pool and can't be re-killed
// until they log in, travel out, and log off again.
const HOSPITAL_DURATION_MS = 60_000;
function todayKey() {
    return new Date().toISOString().slice(0, 10);
}
function monthKey() {
    return new Date().toISOString().slice(0, 7);
}
// Pure gate predicate over a target's SAVE state (no I/O). The online check is
// done separately by the caller (it needs the presence store, not the save).
// Returns null when the KO may proceed.
//
// Per owner decision: ANY player classified as a sleeper is fair game,
// regardless of level. Academy protection (sub-Genin) is deliberately NOT
// applied on this path — it still protects new players in live/online PvP. The
// structural anti-farm bounds remain: a KO relocates the victim to the village
// (removing them from the sleeper pool), and rewards are anti-alt'd + daily /
// per-target capped.
function sleeperTargetBlock(targetChar, sector) {
    if (!targetChar)
        return { status: 404, error: 'Target not found.' };
    // Safe-zone gate: village / Central / any town screen saves currentSector 0.
    // Only a logout in a real wild sector (>= 1) leaves a sleeper.
    if (!(Number.isFinite(sector) && sector >= 1)) {
        return { status: 409, error: 'Target logged out in a safe zone and cannot be attacked.' };
    }
    if (targetChar.hospitalized) {
        return { status: 409, error: 'Target has already been defeated.' };
    }
    return null;
}
// Mirrors the seal math in api/pvp/_vanguard-rewards.ts
// (grantVanguardRewardsForSession): level-gap softening, the daily cap, and the
// per-target daily cap — all keyed off the SAME exported table + constants so
// the numbers can't drift. Intentionally omits the two things that have no
// meaning for a no-fight KO: the pet-escort bonus and the 15s minimum-fight-
// duration gate. Anti-alt (same-device / too-young) is enforced by the caller.
function computeSleeperSeals(winnerChar, loserChar, loserSlug) {
    const spec = winnerChar.masterySpec;
    const rank = Math.max(1, Math.min(10, Number(winnerChar.professionRank ?? 1)));
    const baseSeals = _vanguard_rewards_js_1.VANGUARD_SEALS_PER_KILL[rank] ?? 0;
    const gapMult = (0, _vanguard_rewards_js_1.levelGapMult)(Number(winnerChar.level ?? 1), Number(loserChar.level ?? 1));
    const gapSoftenPct = Math.min(100, (0, _profession_mastery_js_1.masteryBonus)('vanguard', spec, 'sealGapSoftenPct'));
    const effectiveGapMult = gapMult + (1 - gapMult) * (gapSoftenPct / 100);
    let seals = Math.floor(baseSeals * effectiveGapMult);
    if (seals <= 0 && (0, _profession_mastery_js_1.masteryHasCapstone)('vanguard', spec, 'warmonger') && baseSeals > 0)
        seals = 1;
    if (seals <= 0)
        return null;
    const today = todayKey();
    const dailyActive = winnerChar.vanguardDailyResetDate === today;
    const dailySoFar = dailyActive ? Number(winnerChar.dailyHonorSealsEarned ?? 0) : 0;
    const byTarget = dailyActive
        ? (winnerChar.dailyHonorSealsByTarget ?? {})
        : {};
    const targetSoFar = byTarget[loserSlug] ?? 0;
    const dailyCap = _vanguard_rewards_js_1.DAILY_SEAL_CAP + Math.min(15, (0, _profession_mastery_js_1.masteryBonus)('vanguard', spec, 'sealDailyCapFlat'));
    seals = Math.min(seals, Math.max(0, dailyCap - dailySoFar));
    seals = Math.min(seals, Math.max(0, _vanguard_rewards_js_1.PER_TARGET_DAILY_CAP - targetSoFar));
    if (seals <= 0)
        return null;
    const baseXpGain = (0, _vanguard_rewards_js_1.vanguardXpForLevel)(Number(loserChar.level ?? 1));
    const xpGain = rank >= 2 ? Math.floor(baseXpGain * 1.1) : baseXpGain;
    return { seals, xpGain, today, dailySoFar, nextByTarget: { ...byTarget, [loserSlug]: targetSoFar + seals } };
}
// Lock both fighters' saves in a deterministic (sorted) order — same pattern as
// pvp/claim-rewards.ts — so two attackers racing the same target (or the
// attacker's own concurrent autosave) can't interleave their read-modify-write
// or deadlock. failClosed: a contended lock aborts (caller returns 503) rather
// than racing a currency / save write.
async function withSavesLocked(slugs, fn) {
    const ordered = [...new Set(slugs.filter(Boolean))].sort();
    let run = fn;
    for (let i = ordered.length - 1; i >= 0; i--) {
        const slug = ordered[i];
        const next = run;
        run = () => (0, _lock_js_1.withKvLock)(`save:${slug}`, next, { failClosed: true });
    }
    return run();
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    // Per-actor rate limit — mirrors /api/player/attack. A KO is a deliberate,
    // one-off action; anything past a handful a minute is a spam/farm loop.
    if (!identity.admin && !(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'player-sleeper-kill', 6, 60_000, identity.name))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { targetName, attackerName } = (body ?? {});
        if (!targetName)
            return res.status(400).json({ error: 'Missing targetName.' });
        // Admins act on behalf of attackerName (they have no player identity of
        // their own); regular players are always the authed identity.
        const attackerSlug = identity.admin
            ? (attackerName ? (0, _utils_js_1.safeName)(String(attackerName)) : '')
            : identity.name;
        const targetSlug = (0, _utils_js_1.safeName)(String(targetName));
        if (!attackerSlug || !targetSlug)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (attackerSlug === targetSlug)
            return res.status(400).json({ error: 'You cannot attack yourself.' });
        // Sleepers are OFFLINE by definition. A live (fresh-presence) player must
        // be fought through the normal interactive PvP attack flow.
        if (online_store_js_1.onlineStore.get(targetName)) {
            return res.status(409).json({ error: 'Target is online — use a normal attack.' });
        }
        const targetRecord = await _storage_js_1.kv.get(`save:${targetSlug}`);
        const targetChar = targetRecord?.character;
        const targetSector = Number(targetRecord?.currentSector ?? 0);
        const preBlock = sleeperTargetBlock(targetChar, targetSector);
        if (preBlock)
            return res.status(preBlock.status).json({ error: preBlock.error });
        // Anti-alt: a shared recent IP / browser fingerprint means this is almost
        // certainly the attacker's own alt. Mirrors the Vanguard same-device rule
        // — the KO still lands, but it pays out NOTHING (no ryo/XP/kill/seals), so
        // there's no incentive to farm a sleeping alt. Computed outside the lock
        // (read-only) and fails OPEN so a KV hiccup never blocks a real KO.
        let rewardEligible = true;
        try {
            if (await (0, _player_ips_js_1.hasRecentIpOrFpOverlap)(attackerSlug, targetSlug))
                rewardEligible = false;
        }
        catch { /* fail open */ }
        const targetTooYoung = (() => {
            const created = Number(targetChar?.createdAt ?? 0);
            return created > 0 && (Date.now() - created) < _vanguard_rewards_js_1.ACCOUNT_AGE_MIN_MS;
        })();
        const settled = await withSavesLocked([attackerSlug, targetSlug], async () => {
            // Re-read both saves inside the lock so we settle against committed state.
            const tRec = await _storage_js_1.kv.get(`save:${targetSlug}`);
            const tChar = tRec?.character;
            // Re-validate the sleeper conditions — another attacker may have won
            // the race (relocated + hospitalized them) between our checks and the lock.
            const reBlock = sleeperTargetBlock(tChar, Number(tRec?.currentSector ?? 0));
            if (reBlock)
                return reBlock;
            if (online_store_js_1.onlineStore.get(targetName))
                return { status: 409, error: 'Target came online — use a normal attack.' };
            if (!tRec || !tChar)
                return { status: 404, error: 'Target not found.' };
            const aRec = await _storage_js_1.kv.get(`save:${attackerSlug}`);
            const aChar = aRec?.character;
            if (!aRec || !aChar)
                return { status: 404, error: 'Attacker save not found.' };
            let updatedAttacker = aChar;
            let ryoGained = 0;
            let xpGained = 0;
            let sealsGained = 0;
            if (rewardEligible) {
                // Base ryo + XP — same primitives the live PvP winner uses,
                // scaled by the existing repeat-opponent decay.
                const { xpGain, ryoGain } = (0, _xp_engine_js_1.computePvpWinGains)(aChar, targetSector);
                const decay = await (0, _reward_farm_js_1.recordPairWinAndDecay)(attackerSlug, targetSlug);
                xpGained = Math.max(0, Math.floor(xpGain * decay));
                ryoGained = Math.max(0, Math.floor(ryoGain * decay));
                const credit = (0, _xp_engine_js_1.creditPvpWinBase)(aChar, xpGained, ryoGained);
                updatedAttacker = credit.char;
                // PvP kill credit (server-side; the live path applies this on the
                // attacker's own client).
                const month = monthKey();
                const monthlyBase = updatedAttacker.pvpKillMonth === month ? Number(updatedAttacker.monthlyPvpKills ?? 0) : 0;
                updatedAttacker = {
                    ...updatedAttacker,
                    totalPvpKills: Number(updatedAttacker.totalPvpKills ?? 0) + 1,
                    monthlyPvpKills: monthlyBase + 1,
                    pvpKillMonth: month,
                };
                // Vanguard Honor Seals — capped, and skipped for a too-young
                // target (same as the live grant's account-age rule).
                if (updatedAttacker.profession === 'vanguard' && !targetTooYoung) {
                    const grant = computeSleeperSeals(updatedAttacker, tChar, targetSlug);
                    if (grant) {
                        const nextXp = Number(updatedAttacker.professionXp ?? 0) + grant.xpGain;
                        updatedAttacker = {
                            ...updatedAttacker,
                            honorSeals: Number(updatedAttacker.honorSeals ?? 0) + grant.seals,
                            professionXp: nextXp,
                            professionRank: (0, _vanguard_rewards_js_1.rankFromXp)(nextXp),
                            dailyHonorSealsEarned: grant.dailySoFar + grant.seals,
                            dailyHonorSealsByTarget: grant.nextByTarget,
                            vanguardDailyResetDate: grant.today,
                        };
                        sealsGained = grant.seals;
                    }
                }
                const attackerRecord = (0, _save_version_js_1.bumpSaveVersion)({ ...aRec, character: updatedAttacker });
                await _storage_js_1.kv.set(`save:${attackerSlug}`, (0, _utils_js_1.mergePreservingImages)(attackerRecord, aRec));
            }
            // KO the victim: HP 0 + hospitalized for the standard duration, and
            // relocate to the village (sector 0). The save validator in
            // save/[name].ts enforces the hospital timer against the victim's
            // stale autosave on re-login, and currentSector:0 drops them from the
            // sleeper pool immediately.
            const now = Date.now();
            const koChar = {
                ...tChar,
                hp: 0,
                hospitalized: true,
                hospitalizedUntil: now + HOSPITAL_DURATION_MS,
                hospitalizedAt: now,
            };
            const targetKoRecord = (0, _save_version_js_1.bumpSaveVersion)({ ...tRec, currentSector: 0, character: koChar });
            await _storage_js_1.kv.set(`save:${targetSlug}`, (0, _utils_js_1.mergePreservingImages)(targetKoRecord, tRec));
            return {
                status: 200,
                character: updatedAttacker,
                reward: {
                    ryo: ryoGained,
                    xp: xpGained,
                    seals: sealsGained,
                    rewardEligible,
                    target: String(tChar.name ?? targetName),
                },
            };
        });
        if (settled.status !== 200) {
            return res.status(settled.status).json({ error: settled.error });
        }
        return res.status(200).json({ ok: true, koed: true, character: settled.character, reward: settled.reward });
    }
    catch (err) {
        // failClosed lock contention surfaces here — signal "transient, retry".
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'Could not record the KO — please retry.' });
        }
        console.error('[sleeper-kill]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
