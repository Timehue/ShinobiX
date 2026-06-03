import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { listActiveEscorters } from '../clan/pet-escort/_storage.js';
import type { PvpSession } from './session.js';

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

const VANGUARD_SEALS_PER_KILL = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5] as const;
const DAILY_SEAL_CAP = 50;
const PER_TARGET_DAILY_CAP = 3;
const ACCOUNT_AGE_MIN_MS = 72 * 60 * 60 * 1000;
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
    return withKvLock(`save:${winnerName}`, async () => {
        // Load winner save (inside the lock so we observe the latest
        // committed value).
        const winnerKey = `save:${winnerName}`;
        const winnerRecord = await kv.get<Record<string, unknown>>(winnerKey);
        const winnerChar = winnerRecord?.character as Record<string, unknown> | undefined;
        if (!winnerChar) return { granted: false };
        if (winnerChar.profession !== 'vanguard') return { granted: false, reason: 'not-vanguard' };

        // Load loser save for anti-alt checks. Loser save is read-only
        // here, so it doesn't need a lock.
        const loserRecord = await kv.get<Record<string, unknown>>(`save:${loserName}`);
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

        // Level-gap rule.
        const rank = Math.max(1, Math.min(MAX_RANK, Number(winnerChar.professionRank ?? 1)));
        const baseSeals = VANGUARD_SEALS_PER_KILL[rank];
        const gapMult = levelGapMult(Number(winnerChar.level ?? 1), Number(loserChar.level ?? 1));
        let seals = Math.floor(baseSeals * gapMult);
        if (seals <= 0) return { granted: false, reason: 'level-gap' };

        // Daily + per-target caps.
        const today = todayKey();
        const dailyActive = winnerChar.vanguardDailyResetDate === today;
        const dailySoFar = dailyActive ? Number(winnerChar.dailyHonorSealsEarned ?? 0) : 0;
        const byTarget: Record<string, number> = dailyActive
            ? ((winnerChar.dailyHonorSealsByTarget as Record<string, number>) ?? {})
            : {};
        const loserKey = loserName.toLowerCase();
        const targetSoFar = byTarget[loserKey] ?? 0;
        seals = Math.min(seals, Math.max(0, DAILY_SEAL_CAP - dailySoFar));
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
        const nextByTarget = { ...byTarget, [loserKey]: targetSoFar + seals };

        // Transactional ordering: escort stamps go FIRST. Each escort stamp is
        // idempotent (setting petEscortBonusReady=true twice is a no-op), so if
        // we crash between escorts the next retry safely re-stamps any missed
        // ones. The winner save commits LAST — that's the "transaction commit"
        // and the only write that's hard to retry without double-grant. If the
        // winner save fails, the session's vanguardRewardsGranted flag never
        // gets set, so the next call retries the whole grant.
        await Promise.all(escorters.map(async (escorterName) => {
            const eKey = `save:${escorterName}`;
            const eRecord = await kv.get<Record<string, unknown>>(eKey);
            const eChar = eRecord?.character as Record<string, unknown> | undefined;
            if (!eChar || eChar.profession !== 'petTamer') return;
            await kv.set(eKey, {
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
        await kv.set(winnerKey, updated);

        return { granted: true, seals, xp: xpGain };
    });
}
