import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { safeName, setSafeRecordValue } from '../_utils.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { listActiveEscorters } from '../clan/pet-escort/_storage.js';
import { masteryBonus, masteryHasCapstone } from '../_profession-mastery.js';
import { writeVersionedPlayerSave } from '../save/_mutate-player-save.js';
import {
    abortEconomicReceipt,
    commitEconomicReceipt,
    reserveEconomicReceipt,
} from '../_economic-receipt.js';
import type { PvpSession } from './session.js';

// Pet escort: Vanguard with an active pet on a PvP win gets +5% Seals AND
// each Pet Tamer in their clan with an active escort offer gets a +20% Tamer
// XP bonus on their next expedition (consumed via petEscortBonusReady flag).
const PET_ESCORT_SEAL_BONUS = 1.05;

// Server-side Vanguard reward grant. Runs once per session when checkWinner
// flips status to 'done' with a non-draw winner. The session flag is a fast
// path; the durable economic receipt is the authoritative idempotency guard.
//
// Matches the client-side formula in shinobij.client/src/App.tsx
// (vanguardSealsForKill / vanguardXpForKill) so removing the client-side
// grant later won't change observable balance.

// Exported so the sleeper-KO path (api/player/sleeper-kill.ts) reuses the EXACT
// same seal table + caps — keeping that no-fight payout in lockstep with live
// PvP balance instead of duplicating the numbers. Adding `export` is the only
// change here; the grant logic below is untouched.
export const VANGUARD_SEALS_PER_KILL = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5] as const;
/**
 * Honor Seals a Vanguard may earn per day (plus up to +15 from mastery).
 *
 * Raised 50 → 150. Honor Seals are the Vanguard's whole economy: they buy jutsu
 * mastery levels 31-50 via /api/jutsu/train-with-seals, and the seated Kage spends
 * 10,000 of them to open the village's Hollow Gate. At 50/day that unlock was ~200
 * days of flawless play for the single best-placed player on the server, which put an
 * endgame activity out of reach for a launch season rather than merely far away.
 *
 * The per-target cap below is what actually keeps this honest — the daily ceiling is
 * not the anti-abuse control, PER_TARGET_DAILY_CAP is. You cannot farm one willing
 * friend for 150; reaching the ceiling needs a genuinely wide spread of opponents, and
 * levelGapMult() already zeroes seals for anyone punching 20+ levels down.
 *
 * NOTE for tuning: on a 100-200 player server the binding constraint is likely
 * OPPONENT AVAILABILITY, not this number — at 3 seals per target you need ~50 distinct
 * valid targets in a day to hit 150. Raising PER_TARGET_DAILY_CAP would move the real
 * rate more, but that is the dial that enables friend-farming, so it is left alone.
 */
export const DAILY_SEAL_CAP = 150;
export const PER_TARGET_DAILY_CAP = 3;
export const ACCOUNT_AGE_MIN_MS = 72 * 60 * 60 * 1000;
const MIN_FIGHT_DURATION_MS = 15_000;

function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

export function levelGapMult(attackerLevel: number, opponentLevel: number): number {
    const gap = attackerLevel - opponentLevel;
    if (gap > 20) return 0;
    if (gap > 10) return 0.5;
    return 1;
}

export function vanguardXpForLevel(targetLevel: number): number {
    return 100 + 10 * Math.max(0, targetLevel - 30);
}

export function vanguardSealsForRank(rank: number): number {
    const r = Math.max(0, Math.min(MAX_RANK, rank));
    return VANGUARD_SEALS_PER_KILL[r];
}

// Healer 1.5× / baseline thresholds — duplicated from save/[name].ts and
// missions/_progress.ts. Kept in sync manually; eventually consolidate.
const XP_BASELINE = [0, 100, 350, 850, 1850, 3850, 7350, 12850, 20850, 32850];
const MAX_RANK = 10;
export function rankFromXp(xp: number): number {
    let rank = 1;
    for (let i = 1; i <= MAX_RANK; i += 1) {
        if (xp >= XP_BASELINE[i]) rank = Math.min(MAX_RANK, i + 1);
    }
    return Math.min(MAX_RANK, rank);
}

export type GrantResult = {
    granted: boolean;
    reason?: 'not-vanguard' | 'not-human-pvp' | 'too-quick' | 'too-young' | 'same-ip' | 'same-device' | 'level-gap' | 'capped' | 'already-granted';
    seals?: number;
    xp?: number;
};

export async function grantVanguardRewardsForSession(session: PvpSession): Promise<GrantResult> {
    if (session.status !== 'done') return { granted: false };
    if (!session.winner || session.winner === 'draw') return { granted: false };
    // Idempotency: bail if we already granted on a prior write of this session.
    if ((session as PvpSession & { vanguardRewardsGranted?: boolean }).vanguardRewardsGranted) {
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
    const winnerSlug = safeName(String(winnerName));
    const loserSlug = safeName(String(loserName));
    if (!winnerSlug || !loserSlug) return { granted: false };

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
    // Economy writes must never fall through unlocked. The durable settlement
    // receipt/retry path owns availability; this lock owns serialization with
    // autosaves and every other server-side player mutation.
    return withKvLock(`save:${winnerSlug}`, async () => {
        // Load winner save (inside the lock so we observe the latest
        // committed value).
        const winnerKey = `save:${winnerSlug}`;
        const winnerRecord = await kv.get<Record<string, unknown>>(winnerKey);
        const winnerChar = winnerRecord?.character as Record<string, unknown> | undefined;
        if (!winnerRecord || !winnerChar) return { granted: false };
        if (winnerChar.profession !== 'vanguard') return { granted: false, reason: 'not-vanguard' };

        // Load loser save for anti-alt checks. Loser save is read-only
        // here, so it doesn't need a lock.
        const loserRecord = await kv.get<Record<string, unknown>>(`save:${loserSlug}`);
        const loserChar = loserRecord?.character as Record<string, unknown> | undefined;
        if (!loserChar) return { granted: false };

        // Anti-alt: account age and IP overlap.
        const loserCreated = Number(loserChar.createdAt ?? 0);
        if (loserCreated > 0 && (Date.now() - loserCreated) < ACCOUNT_AGE_MIN_MS) {
            return { granted: false, reason: 'too-young' };
        }
        // Includes browser-fingerprint overlap, so VPN rotation alone no
        // longer defeats the check — an attacker would also need a different
        // browser profile per alt.
        const sharesDevice = await hasRecentIpOrFpOverlap(winnerName, loserName);
        if (sharesDevice) return { granted: false, reason: 'same-device' };

        // Level-gap rule. Mastery (Bloodletter) softens the penalty: recover a
        // fraction of the seals the gap would have stripped.
        const spec = winnerChar.masterySpec;
        const rank = Math.max(1, Math.min(MAX_RANK, Number(winnerChar.professionRank ?? 1)));
        const baseSeals = VANGUARD_SEALS_PER_KILL[rank];
        const gapMult = levelGapMult(Number(winnerChar.level ?? 1), Number(loserChar.level ?? 1));
        const gapSoftenPct = Math.min(100, masteryBonus('vanguard', spec, 'sealGapSoftenPct'));
        const effectiveGapMult = gapMult + (1 - gapMult) * (gapSoftenPct / 100);
        let seals = Math.floor(baseSeals * effectiveGapMult);
        // Warmonger capstone: a win always pays at least 1 Seal (still capped below).
        const hasWarmonger = masteryHasCapstone('vanguard', spec, 'warmonger');
        if (seals <= 0 && hasWarmonger && baseSeals > 0) seals = 1;
        if (seals <= 0) return { granted: false, reason: 'level-gap' };

        // Daily + per-target caps. Mastery (Relentless) raises the daily cap.
        const today = todayKey();
        const dailyActive = winnerChar.vanguardDailyResetDate === today;
        const dailySoFar = dailyActive ? Number(winnerChar.dailyHonorSealsEarned ?? 0) : 0;
        const byTarget: Record<string, number> = dailyActive
            ? ((winnerChar.dailyHonorSealsByTarget as Record<string, number>) ?? {})
            : {};
        const loserKey = loserSlug; // per-target daily cap keyed by canonical slug
        const targetSoFar = byTarget[loserKey] ?? 0;
        const dailyCap = DAILY_SEAL_CAP + Math.min(15, masteryBonus('vanguard', spec, 'sealDailyCapFlat'));
        seals = Math.min(seals, Math.max(0, dailyCap - dailySoFar));
        seals = Math.min(seals, Math.max(0, PER_TARGET_DAILY_CAP - targetSoFar));
        if (seals <= 0) return { granted: false, reason: 'capped' };

        // Pet escort: if the Vanguard has an active pet and their clan has any
        // Pet Tamer with an active escort offer, +5% Seals to Vanguard AND set
        // a next-expedition bonus flag on each offering Pet Tamer.
        const winnerClan = typeof winnerChar.clan === 'string' ? winnerChar.clan : '';
        const hasActivePet = typeof winnerChar.activePetId === 'string' && winnerChar.activePetId.length > 0;
        let escorters: string[] = [];
        if (winnerClan && hasActivePet) {
            try {
                escorters = await listActiveEscorters(winnerClan);
            } catch { /* best-effort */ }
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
        const nextByTarget = { ...byTarget };
        setSafeRecordValue(nextByTarget, loserKey, targetSoFar + seals);

        // Durable idempotency receipt (audit #7). Claimed atomically (NX) right
        // before any reward write. The session-only `vanguardRewardsGranted`
        // flag is lost if the session save crashes after the grant, which would
        // let a replayed terminal move re-pay; this receipt survives independent
        // of the session row, so a second grant attempt for the same battleId
        // short-circuits here. 7-day TTL outlives the 15-min session TTL by a
        // wide margin. (A crash AFTER claiming but BEFORE the winner write can
        // under-grant on retry — an accepted trade: never double-pay currency.)
        const receiptKey = `pvp:vanguard-rewarded:${session.battleId}`;
        const receiptTtl = 7 * 24 * 60 * 60;
        const reservation = await reserveEconomicReceipt(kv, {
            key: receiptKey,
            fingerprint: `vanguard:${session.battleId}:${winnerSlug}:${loserSlug}`,
            ttlSeconds: receiptTtl,
            pendingTtlSeconds: 10,
            metadata: { battleId: session.battleId, winner: winnerSlug, loser: loserSlug },
        });
        if (reservation.status !== 'reserved') return { granted: false, reason: 'already-granted' };

        // Transactional ordering: escort stamps go FIRST. Each escort stamp is
        // idempotent (setting petEscortBonusReady=true twice is a no-op), so if
        // we crash between escorts the next retry safely re-stamps any missed
        // ones. The winner save commits LAST — that's the "transaction commit".
        let winnerWriteAttempted = false;
        try {
            const escorterSlugs = [...new Set(escorters
                .map((escorterName) => safeName(String(escorterName)))
                .filter((slug): slug is string => Boolean(slug)))];
            await Promise.all(escorterSlugs.map(async (escorterSlug) => {
                const eKey = `save:${escorterSlug}`;
                await withKvLock(eKey, async () => {
                    const eRecord = await kv.get<Record<string, unknown>>(eKey);
                    const eChar = eRecord?.character as Record<string, unknown> | undefined;
                    if (!eRecord || !eChar || eChar.profession !== 'petTamer' || eChar.petEscortBonusReady === true) return;
                    await writeVersionedPlayerSave(eKey, eRecord, { ...eChar, petEscortBonusReady: true });
                }, { failClosed: true });
            }));

            // The verified claim endpoint is the durable retry path if the
            // terminal move could not finish this grant. Escort stamps are
            // already idempotent and therefore safe to encounter again.
            const updatedCharacter = {
                ...winnerChar,
                honorSeals: nextHonor,
                professionXp: nextProfessionXp,
                professionRank: nextRank,
                dailyHonorSealsEarned: dailySoFar + seals,
                dailyHonorSealsByTarget: nextByTarget,
                vanguardDailyResetDate: today,
            };
            winnerWriteAttempted = true;
            await writeVersionedPlayerSave(winnerKey, winnerRecord, updatedCharacter);
            await commitEconomicReceipt(kv, receiptKey, reservation, receiptTtl);
        } catch (error) {
            // Escort stamps are idempotent, so they can be retried. Once the
            // winner write is attempted, however, a lost acknowledgement is
            // ambiguous and the durable pending receipt must remain in place.
            if (!winnerWriteAttempted) {
                await abortEconomicReceipt(kv, receiptKey, reservation).catch(() => false);
            }
            throw error;
        }

        return { granted: true, seals, xp: xpGain };
    }, { failClosed: true });
}
