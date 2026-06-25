"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_AGE_MIN_MS = exports.PER_TARGET_DAILY_CAP = exports.DAILY_SEAL_CAP = exports.VANGUARD_SEALS_PER_KILL = void 0;
exports.levelGapMult = levelGapMult;
exports.vanguardXpForLevel = vanguardXpForLevel;
exports.vanguardSealsForRank = vanguardSealsForRank;
exports.rankFromXp = rankFromXp;
exports.grantVanguardRewardsForSession = grantVanguardRewardsForSession;
const _storage_js_1 = require("../_storage.js");
const _lock_js_1 = require("../_lock.js");
const _utils_js_1 = require("../_utils.js");
const _player_ips_js_1 = require("../_player-ips.js");
const _storage_js_2 = require("../clan/pet-escort/_storage.js");
const _profession_mastery_js_1 = require("../_profession-mastery.js");
// Pet escort: Vanguard with an active pet on a PvP win gets +5% Seals AND
// each Pet Tamer in their clan with an active escort offer gets a +20% Tamer
// XP bonus on their next expedition (consumed via petEscortBonusReady flag).
const PET_ESCORT_SEAL_BONUS = 1.05;
// Server-side Vanguard reward grant. Runs once per session when checkWinner
// flips status to 'done' with a non-draw winner. Idempotent via the
// `vanguardRewardsGranted` flag stamped on the session.
//
// Matches the client-side formula in shinobij.client/src/App.tsx
// (vanguardSealsForKill / vanguardXpForKill) so removing the client-side
// grant later won't change observable balance.
// Exported so the sleeper-KO path (api/player/sleeper-kill.ts) reuses the EXACT
// same seal table + caps — keeping that no-fight payout in lockstep with live
// PvP balance instead of duplicating the numbers. Adding `export` is the only
// change here; the grant logic below is untouched.
exports.VANGUARD_SEALS_PER_KILL = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
exports.DAILY_SEAL_CAP = 50;
exports.PER_TARGET_DAILY_CAP = 3;
exports.ACCOUNT_AGE_MIN_MS = 72 * 60 * 60 * 1000;
const MIN_FIGHT_DURATION_MS = 15_000;
function todayKey() {
    return new Date().toISOString().slice(0, 10);
}
function levelGapMult(attackerLevel, opponentLevel) {
    const gap = attackerLevel - opponentLevel;
    if (gap > 20)
        return 0;
    if (gap > 10)
        return 0.5;
    return 1;
}
function vanguardXpForLevel(targetLevel) {
    return 100 + 10 * Math.max(0, targetLevel - 30);
}
function vanguardSealsForRank(rank) {
    const r = Math.max(0, Math.min(MAX_RANK, rank));
    return exports.VANGUARD_SEALS_PER_KILL[r];
}
// Healer 1.5× / baseline thresholds — duplicated from save/[name].ts and
// missions/_progress.ts. Kept in sync manually; eventually consolidate.
const XP_BASELINE = [0, 100, 350, 850, 1850, 3850, 7350, 12850, 20850, 32850];
const MAX_RANK = 10;
function rankFromXp(xp) {
    let rank = 1;
    for (let i = 1; i <= MAX_RANK; i += 1) {
        if (xp >= XP_BASELINE[i])
            rank = Math.min(MAX_RANK, i + 1);
    }
    return Math.min(MAX_RANK, rank);
}
async function grantVanguardRewardsForSession(session) {
    if (session.status !== 'done')
        return { granted: false };
    if (!session.winner || session.winner === 'draw')
        return { granted: false };
    // Idempotency: bail if we already granted on a prior write of this session.
    if (session.vanguardRewardsGranted) {
        return { granted: false, reason: 'already-granted' };
    }
    const winnerSlot = session.winner === 'p1' ? session.p1 : session.p2;
    const loserSlot = session.winner === 'p1' ? session.p2 : session.p1;
    const winnerName = winnerSlot.name;
    const loserName = loserSlot.name;
    // Player saves are keyed `save:<safeName-slug>`. The fighter `.name` is the
    // DISPLAY name (may contain spaces / uppercase), so building `save:${name}`
    // directly missed the real row for any non-trivial name — the lookup
    // returned null and the grant silently no-op'd (winner got nothing). Use the
    // canonical slug for every save key + the lock target. (audit #7)
    const winnerSlug = (0, _utils_js_1.safeName)(String(winnerName));
    const loserSlug = (0, _utils_js_1.safeName)(String(loserName));
    if (!winnerSlug || !loserSlug)
        return { granted: false };
    // Fight duration anti-abuse.
    const started = Number(session.createdAt ?? 0);
    if (started && (Date.now() - started) < MIN_FIGHT_DURATION_MS) {
        return { granted: false, reason: 'too-quick' };
    }
    // Per-player save lock around the read-modify-write below. Without
    // this, a Vanguard winning two fights back-to-back within ms can
    // race their own save: both grants read the same `dailySoFar` value
    // and the second write clobbers the first, leaving the player with
    // only one fight's worth of Honor Seals + XP credited even though
    // they earned both. The lock serializes the two grants so they
    // each see the updated daily counter from the prior commit.
    // NOTE: deliberately NOT failClosed. The grant fires on the single terminal
    // move that flips the session to 'done'; move.ts then early-returns on any
    // later move (status==='done') and claim-rewards does not re-invoke this, so
    // there is no retry path. A failClosed throw under lock contention would
    // therefore PERMANENTLY lose the winner's earned Seals. Idempotency instead
    // comes from the durable NX receipt below, which is what actually prevents a
    // same-battle replay double-pay; the lock just serializes the common
    // back-to-back-fights case. (audit #7 — fail-open chosen over reward loss.)
    return (0, _lock_js_1.withKvLock)(`save:${winnerSlug}`, async () => {
        // Load winner save (inside the lock so we observe the latest
        // committed value).
        const winnerKey = `save:${winnerSlug}`;
        const winnerRecord = await _storage_js_1.kv.get(winnerKey);
        const winnerChar = winnerRecord?.character;
        if (!winnerChar)
            return { granted: false };
        if (winnerChar.profession !== 'vanguard')
            return { granted: false, reason: 'not-vanguard' };
        // Load loser save for anti-alt checks. Loser save is read-only
        // here, so it doesn't need a lock.
        const loserRecord = await _storage_js_1.kv.get(`save:${loserSlug}`);
        const loserChar = loserRecord?.character;
        if (!loserChar)
            return { granted: false };
        // Anti-alt: account age and IP overlap.
        const loserCreated = Number(loserChar.createdAt ?? 0);
        if (loserCreated > 0 && (Date.now() - loserCreated) < exports.ACCOUNT_AGE_MIN_MS) {
            return { granted: false, reason: 'too-young' };
        }
        // Includes browser-fingerprint overlap, so VPN rotation alone no
        // longer defeats the check — an attacker would also need a different
        // browser profile per alt.
        const sharesDevice = await (0, _player_ips_js_1.hasRecentIpOrFpOverlap)(winnerName, loserName);
        if (sharesDevice)
            return { granted: false, reason: 'same-device' };
        // Level-gap rule. Mastery (Bloodletter) softens the penalty: recover a
        // fraction of the seals the gap would have stripped.
        const spec = winnerChar.masterySpec;
        const rank = Math.max(1, Math.min(MAX_RANK, Number(winnerChar.professionRank ?? 1)));
        const baseSeals = exports.VANGUARD_SEALS_PER_KILL[rank];
        const gapMult = levelGapMult(Number(winnerChar.level ?? 1), Number(loserChar.level ?? 1));
        const gapSoftenPct = Math.min(100, (0, _profession_mastery_js_1.masteryBonus)('vanguard', spec, 'sealGapSoftenPct'));
        const effectiveGapMult = gapMult + (1 - gapMult) * (gapSoftenPct / 100);
        let seals = Math.floor(baseSeals * effectiveGapMult);
        // Warmonger capstone: a win always pays at least 1 Seal (still capped below).
        const hasWarmonger = (0, _profession_mastery_js_1.masteryHasCapstone)('vanguard', spec, 'warmonger');
        if (seals <= 0 && hasWarmonger && baseSeals > 0)
            seals = 1;
        if (seals <= 0)
            return { granted: false, reason: 'level-gap' };
        // Daily + per-target caps. Mastery (Relentless) raises the daily cap.
        const today = todayKey();
        const dailyActive = winnerChar.vanguardDailyResetDate === today;
        const dailySoFar = dailyActive ? Number(winnerChar.dailyHonorSealsEarned ?? 0) : 0;
        const byTarget = dailyActive
            ? (winnerChar.dailyHonorSealsByTarget ?? {})
            : {};
        const loserKey = loserSlug; // per-target daily cap keyed by canonical slug
        const targetSoFar = byTarget[loserKey] ?? 0;
        const dailyCap = exports.DAILY_SEAL_CAP + Math.min(15, (0, _profession_mastery_js_1.masteryBonus)('vanguard', spec, 'sealDailyCapFlat'));
        seals = Math.min(seals, Math.max(0, dailyCap - dailySoFar));
        seals = Math.min(seals, Math.max(0, exports.PER_TARGET_DAILY_CAP - targetSoFar));
        if (seals <= 0)
            return { granted: false, reason: 'capped' };
        // Pet escort: if the Vanguard has an active pet and their clan has any
        // Pet Tamer with an active escort offer, +5% Seals to Vanguard AND set
        // a next-expedition bonus flag on each offering Pet Tamer.
        const winnerClan = typeof winnerChar.clan === 'string' ? winnerChar.clan : '';
        const hasActivePet = typeof winnerChar.activePetId === 'string' && winnerChar.activePetId.length > 0;
        let escorters = [];
        if (winnerClan && hasActivePet) {
            try {
                escorters = await (0, _storage_js_2.listActiveEscorters)(winnerClan);
            }
            catch { /* best-effort */ }
            if (escorters.length > 0) {
                seals = Math.floor(seals * PET_ESCORT_SEAL_BONUS);
            }
        }
        // Profession XP (always granted when Vanguard wins a real human fight,
        // regardless of seal cap — XP and Seals can decouple at the daily cap).
        // Rank 2+ perk: +10% XP. Multiplier is based on rank BEFORE this grant.
        const baseXpGain = vanguardXpForLevel(Number(loserChar.level ?? 1));
        const xpGain = rank >= 2 ? Math.floor(baseXpGain * 1.1) : baseXpGain;
        const nextHonor = Number(winnerChar.honorSeals ?? 0) + seals;
        const nextProfessionXp = Number(winnerChar.professionXp ?? 0) + xpGain;
        const nextRank = rankFromXp(nextProfessionXp);
        const nextByTarget = { ...byTarget, [loserKey]: targetSoFar + seals };
        // Durable idempotency receipt (audit #7). Claimed atomically (NX) right
        // before any reward write. The session-only `vanguardRewardsGranted`
        // flag is lost if the session save crashes after the grant, which would
        // let a replayed terminal move re-pay; this receipt survives independent
        // of the session row, so a second grant attempt for the same battleId
        // short-circuits here. 7-day TTL outlives the 15-min session TTL by a
        // wide margin. (A crash AFTER claiming but BEFORE the winner write can
        // under-grant on retry — an accepted trade: never double-pay currency.)
        const receiptKey = `pvp:vanguard-rewarded:${session.battleId}`;
        const receipt = await _storage_js_1.kv.set(receiptKey, { winner: winnerSlug, at: Date.now() }, { nx: true, ex: 7 * 24 * 60 * 60 });
        if (!receipt)
            return { granted: false, reason: 'already-granted' };
        // Transactional ordering: escort stamps go FIRST. Each escort stamp is
        // idempotent (setting petEscortBonusReady=true twice is a no-op), so if
        // we crash between escorts the next retry safely re-stamps any missed
        // ones. The winner save commits LAST — that's the "transaction commit".
        await Promise.all(escorters.map(async (escorterName) => {
            const eKey = `save:${(0, _utils_js_1.safeName)(String(escorterName))}`;
            const eRecord = await _storage_js_1.kv.get(eKey);
            const eChar = eRecord?.character;
            if (!eChar || eChar.profession !== 'petTamer')
                return;
            await _storage_js_1.kv.set(eKey, {
                ...eRecord,
                character: { ...eChar, petEscortBonusReady: true },
            });
        }));
        // Now commit the winner save. If this throws, the session flag isn't set
        // and the next move's grant call retries cleanly (escorts already done = no-op).
        const updated = {
            ...winnerRecord,
            character: {
                ...winnerChar,
                honorSeals: nextHonor,
                professionXp: nextProfessionXp,
                professionRank: nextRank,
                dailyHonorSealsEarned: dailySoFar + seals,
                dailyHonorSealsByTarget: nextByTarget,
                vanguardDailyResetDate: today,
            },
        };
        await _storage_js_1.kv.set(winnerKey, updated);
        return { granted: true, seals, xp: xpGain };
    });
}
