import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { kv } from '../_storage.js';
import type { KvLike } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { safeName, setSafeRecordValue } from '../_utils.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { listActiveEscorters } from '../clan/pet-escort/_storage.js';
import { masteryBonus, masteryHasCapstone } from '../_profession-mastery.js';
import {
    writeVersionedPlayerSave,
    writeVersionedPlayerSaveWithStore,
} from '../save/_mutate-player-save.js';
import {
    abortEconomicReceipt,
    commitEconomicReceipt,
    reserveEconomicReceipt,
} from '../_economic-receipt.js';
import {
    isPlayerRankedV2Session,
    pvpSessionMayGrantProgress,
    type PvpSession,
} from './session.js';
import type { PlayerRankedTerminal } from './_player-ranked-journal.js';

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

async function grantVanguardRewardsForSessionLegacy(session: PvpSession): Promise<GrantResult> {
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

// ---------------------------------------------------------------------------
// Vanguard reward authority V2
// ---------------------------------------------------------------------------

type DurableVanguardReason = Exclude<NonNullable<GrantResult['reason']>, 'already-granted'>;
type VanguardRewardOutcome =
    | { granted: true; seals: number; xp: number }
    | { granted: false; reason: DurableVanguardReason };

export const VANGUARD_REWARD_SETTLEMENT_FIELD = 'vanguardRewardSettlementStamp' as const;
export const VANGUARD_REWARD_INTENT_VERSION = 'vanguard-reward-intent-v1' as const;
export const VANGUARD_REWARD_SETTLEMENT_VERSION = 'vanguard-reward-settlement-v1' as const;
const VANGUARD_REWARD_TTL_SECONDS = 7 * 24 * 60 * 60;
const VANGUARD_RANKED_REWARD_TTL_SECONDS = 400 * 24 * 60 * 60;
const VANGUARD_REWARD_LEASE_MS = 10_000;

type VanguardRewardStore = Pick<KvLike, 'get' | 'compareSet'>;
export type VanguardSaveLockRunner = <T>(saveKey: string, action: () => Promise<T>) => Promise<T>;

type VanguardRewardIntentV2 = {
    version: typeof VANGUARD_REWARD_INTENT_VERSION;
    state: 'pending' | 'committed' | 'aborted';
    ownerId: string;
    fingerprint: string;
    authorityFingerprint: string;
    battleId: string;
    winner: string;
    loser: string;
    expectedSaveVersion: number;
    createdAt: number;
    leaseExpiresAt: number | null;
    markerSettledAt: number | null;
    outcome: VanguardRewardOutcome | null;
};

export type VanguardRewardSettlementMarker = {
    version: typeof VANGUARD_REWARD_SETTLEMENT_VERSION;
    state: 'reserved' | 'settled';
    ownerId: string;
    fingerprint: string;
    authorityFingerprint: string;
    battleId: string;
    winner: string;
    loser: string;
    expectedSaveVersion: number;
    createdAt: number;
    settledAt: number | null;
    recoverUntil: number;
    outcome: VanguardRewardOutcome | null;
};

type VanguardRewardAuthority = {
    fingerprint: string;
    authorityFingerprint: string;
    battleId: string;
    winner: string;
    loser: string;
    terminalAt: number;
};

export type VanguardRewardOptions = {
    store?: VanguardRewardStore;
    lock?: VanguardSaveLockRunner;
    rankedTerminal?: PlayerRankedTerminal;
    now?: number;
    allowLeaseTakeover?: boolean;
    overlap?: (a: string, b: string) => Promise<boolean>;
    activeEscorters?: (clan: string) => Promise<string[]>;
    /** Store-isolated rollout test hook; production callers use the legacy implementation. */
    legacyGrant?: (session: PvpSession) => Promise<GrantResult>;
};

function vanguardRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function vanguardExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function validVanguardOutcome(value: unknown): value is VanguardRewardOutcome {
    if (!vanguardRecord(value) || typeof value.granted !== 'boolean') return false;
    if (value.granted) {
        return vanguardExactKeys(value, ['granted', 'seals', 'xp'])
            && Number.isSafeInteger(value.seals) && Number(value.seals) >= 0
            && Number.isSafeInteger(value.xp) && Number(value.xp) > 0;
    }
    return vanguardExactKeys(value, ['granted', 'reason'])
        && ['not-vanguard', 'not-human-pvp', 'too-quick', 'too-young', 'same-ip', 'same-device', 'level-gap', 'capped']
            .includes(String(value.reason));
}

function parseVanguardRewardIntent(raw: unknown): VanguardRewardIntentV2 | null {
    if (!vanguardRecord(raw) || !vanguardExactKeys(raw, [
        'version', 'state', 'ownerId', 'fingerprint', 'authorityFingerprint', 'battleId',
        'winner', 'loser', 'expectedSaveVersion', 'createdAt', 'leaseExpiresAt',
        'markerSettledAt', 'outcome',
    ])) return null;
    const value = raw as VanguardRewardIntentV2;
    if (value.version !== VANGUARD_REWARD_INTENT_VERSION
        || !['pending', 'committed', 'aborted'].includes(value.state)
        || !/^[0-9a-f-]{36}$/.test(value.ownerId)
        || !/^[a-f0-9]{64}$/.test(value.fingerprint)
        || !/^[a-f0-9]{64}$/.test(value.authorityFingerprint)
        || !value.battleId
        || value.winner !== safeName(value.winner)
        || value.loser !== safeName(value.loser)
        || !value.winner || !value.loser || value.winner === value.loser
        || !Number.isSafeInteger(value.expectedSaveVersion) || value.expectedSaveVersion < 0
        || !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0
        || (value.leaseExpiresAt !== null && (!Number.isSafeInteger(value.leaseExpiresAt) || value.leaseExpiresAt <= 0))
        || (value.markerSettledAt !== null && (!Number.isSafeInteger(value.markerSettledAt) || value.markerSettledAt <= 0))
        || (value.outcome !== null && !validVanguardOutcome(value.outcome))) return null;
    if (value.state === 'committed') {
        if (value.leaseExpiresAt !== null || value.markerSettledAt === null || value.outcome === null) return null;
    } else if (value.markerSettledAt !== null || value.outcome !== null || value.leaseExpiresAt === null) {
        return null;
    }
    return structuredClone(value);
}

export function parseVanguardRewardSettlementMarker(raw: unknown): VanguardRewardSettlementMarker | null {
    if (!vanguardRecord(raw) || !vanguardExactKeys(raw, [
        'version', 'state', 'ownerId', 'fingerprint', 'authorityFingerprint', 'battleId',
        'winner', 'loser', 'expectedSaveVersion', 'createdAt', 'settledAt',
        'recoverUntil', 'outcome',
    ])) return null;
    const value = raw as VanguardRewardSettlementMarker;
    if (value.version !== VANGUARD_REWARD_SETTLEMENT_VERSION
        || (value.state !== 'reserved' && value.state !== 'settled')
        || !/^[0-9a-f-]{36}$/.test(value.ownerId)
        || !/^[a-f0-9]{64}$/.test(value.fingerprint)
        || !/^[a-f0-9]{64}$/.test(value.authorityFingerprint)
        || !value.battleId
        || value.winner !== safeName(value.winner)
        || value.loser !== safeName(value.loser)
        || !value.winner || !value.loser || value.winner === value.loser
        || !Number.isSafeInteger(value.expectedSaveVersion) || value.expectedSaveVersion < 0
        || !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0
        || !Number.isSafeInteger(value.recoverUntil) || value.recoverUntil <= value.createdAt
        || (value.settledAt !== null && (!Number.isSafeInteger(value.settledAt) || value.settledAt <= 0))
        || (value.outcome !== null && !validVanguardOutcome(value.outcome))) return null;
    if (value.state === 'settled') {
        if (value.settledAt === null || value.outcome === null) return null;
    } else if (value.settledAt !== null || value.outcome !== null) {
        return null;
    }
    return structuredClone(value);
}

function vanguardSha(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function vanguardReceiptKey(battleId: string): string {
    return `pvp:vanguard-rewarded:${battleId}`;
}

function rankedTerminalWinner(terminal: PlayerRankedTerminal): { winner: string; loser: string } | null {
    if (terminal.winner === 'draw') return null;
    return terminal.winner === 'a'
        ? { winner: terminal.a, loser: terminal.b }
        : { winner: terminal.b, loser: terminal.a };
}

function genericVanguardAuthorityFingerprint(session: PvpSession, winner: string, loser: string): string {
    return vanguardSha({
        version: 1,
        battleId: session.battleId,
        createdAt: session.createdAt,
        lastMoveAt: session.lastMoveAt ?? null,
        winner,
        loser,
        winnerSlot: session.winner,
        rewardAuthority: session.rewardAuthority ?? null,
        joined: session.joined ?? null,
        baseRewards: session.baseRewards === true,
        ranked: session.ranked === true,
        rankedKind: session.rankedKind ?? null,
    });
}

function buildVanguardAuthority(session: PvpSession, terminal?: PlayerRankedTerminal): VanguardRewardAuthority | null {
    if (session.status !== 'done' || !session.winner || session.winner === 'draw') return null;
    const winnerSlot = session.winner === 'p1' ? session.p1 : session.p2;
    const loserSlot = session.winner === 'p1' ? session.p2 : session.p1;
    const winner = safeName(String(winnerSlot.name));
    const loser = safeName(String(loserSlot.name));
    if (!winner || !loser || winner === loser || !session.battleId) return null;
    let authorityFingerprint: string;
    let terminalAt: number;
    if (terminal) {
        const rankedWinner = rankedTerminalWinner(terminal);
        const participants = [safeName(session.p1.name), safeName(session.p2.name)].sort();
        if (!rankedWinner
            || !isPlayerRankedV2Session(session)
            || terminal.battleId !== session.battleId
            || terminal.matchId !== session.rankedMatchId
            || terminal.seasonId !== session.rankedSeasonId
            || terminal.seasonEpoch !== session.rankedSeasonEpoch
            || terminal.a !== participants[0]
            || terminal.b !== participants[1]
            || rankedWinner.winner !== winner
            || rankedWinner.loser !== loser) {
            throw new Error('vanguard-ranked-terminal-authority-conflict');
        }
        authorityFingerprint = terminal.fingerprint;
        // Journal publication may be delayed by a crash/retry. Duration and
        // reward-date economics bind to the timestamp committed in the exact
        // terminal session CAS, never to publication/recovery wall clock.
        const sealedMoveAt = Math.floor(Number(session.lastMoveAt ?? session.createdAt ?? 0));
        terminalAt = Number.isSafeInteger(sealedMoveAt)
            && sealedMoveAt >= Number(session.createdAt ?? 0)
            && sealedMoveAt <= terminal.terminalAt
            ? sealedMoveAt
            : Math.max(1, Math.floor(Number(session.createdAt ?? 1)));
    } else {
        authorityFingerprint = genericVanguardAuthorityFingerprint(session, winner, loser);
        // Never let retry wall-clock time turn a sub-15-second fight rewardable.
        terminalAt = Math.max(1, Math.floor(Number(session.lastMoveAt ?? session.createdAt ?? 1)));
    }
    return {
        authorityFingerprint,
        fingerprint: vanguardSha({ version: 1, authorityFingerprint, battleId: session.battleId, winner, loser }),
        battleId: session.battleId,
        winner,
        loser,
        terminalAt,
    };
}

function vanguardIntentMatches(intent: VanguardRewardIntentV2, authority: VanguardRewardAuthority): boolean {
    return intent.fingerprint === authority.fingerprint
        && intent.authorityFingerprint === authority.authorityFingerprint
        && intent.battleId === authority.battleId
        && intent.winner === authority.winner
        && intent.loser === authority.loser;
}

function vanguardMarkerMatches(marker: VanguardRewardSettlementMarker, authority: VanguardRewardAuthority): boolean {
    return marker.fingerprint === authority.fingerprint
        && marker.authorityFingerprint === authority.authorityFingerprint
        && marker.battleId === authority.battleId
        && marker.winner === authority.winner
        && marker.loser === authority.loser;
}

async function vanguardCompareSetConfirmed(
    store: VanguardRewardStore,
    key: string,
    expected: unknown | null,
    next: unknown,
    ttlSeconds?: number,
): Promise<boolean> {
    try {
        if (await store.compareSet(key, expected, next, ttlSeconds ? { ex: ttlSeconds } : undefined) === true) return true;
    } catch (error) {
        const readback = await store.get(key).catch(() => null);
        if (isDeepStrictEqual(readback, next)) return true;
        throw error;
    }
    // Remote adapters may commit but fulfill with false/null when the
    // acknowledgement is lost. Treat every non-true acknowledgement as
    // ambiguous until an exact readback distinguishes commit from conflict.
    return isDeepStrictEqual(await store.get(key), next);
}

function committedVanguardIntent(marker: VanguardRewardSettlementMarker): VanguardRewardIntentV2 {
    if (marker.state !== 'settled' || !marker.outcome || !marker.settledAt) {
        throw new Error('vanguard-reward-marker-not-settled');
    }
    return {
        version: VANGUARD_REWARD_INTENT_VERSION,
        state: 'committed',
        ownerId: marker.ownerId,
        fingerprint: marker.fingerprint,
        authorityFingerprint: marker.authorityFingerprint,
        battleId: marker.battleId,
        winner: marker.winner,
        loser: marker.loser,
        expectedSaveVersion: marker.expectedSaveVersion,
        createdAt: marker.createdAt,
        leaseExpiresAt: null,
        markerSettledAt: marker.settledAt,
        outcome: marker.outcome,
    };
}

async function commitVanguardMarker(
    store: VanguardRewardStore,
    marker: VanguardRewardSettlementMarker,
): Promise<VanguardRewardIntentV2> {
    const key = vanguardReceiptKey(marker.battleId);
    const committed = committedVanguardIntent(marker);
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const raw = await store.get<unknown>(key);
        if (isDeepStrictEqual(raw, committed)) return committed;
        const current = parseVanguardRewardIntent(raw);
        if (raw !== null && !current) throw new Error('vanguard-reward-legacy-or-invalid-receipt');
        if (current) {
            if (current.fingerprint !== marker.fingerprint) throw new Error('vanguard-reward-receipt-conflict');
            if (current.state === 'committed') {
                if (!isDeepStrictEqual(current.outcome, marker.outcome)) throw new Error('vanguard-reward-outcome-conflict');
                return current;
            }
            if (current.ownerId !== marker.ownerId) throw new Error('vanguard-reward-owner-conflict');
        }
        const retentionSeconds = Math.max(
            VANGUARD_REWARD_TTL_SECONDS,
            Math.ceil((marker.recoverUntil - marker.settledAt!) / 1000),
        );
        if (await vanguardCompareSetConfirmed(store, key, raw, committed, retentionSeconds)) return committed;
    }
    throw new Error('vanguard-reward-commit-busy');
}

function vanguardReplayResult(outcome: VanguardRewardOutcome): GrantResult {
    return outcome.granted
        ? { granted: false, reason: 'already-granted', seals: outcome.seals, xp: outcome.xp }
        : { granted: false, reason: 'already-granted' };
}

function legacyVanguardReceiptDisposition(
    raw: unknown,
    authority: VanguardRewardAuthority,
): 'pending' | 'spent' | 'conflict' | null {
    if (raw === null) return null;
    if (!vanguardRecord(raw)) return 'spent';
    const version = Number(raw.version);
    if (![1, 2, 3, 4].includes(version)) return null;
    const legacyFingerprint = `vanguard:${authority.battleId}:${authority.winner}:${authority.loser}`;
    if (typeof raw.fingerprint === 'string' && raw.fingerprint !== legacyFingerprint) return 'conflict';
    if ((version === 2 || version === 3 || version === 4) && raw.state === 'pending') return 'pending';
    return 'spent';
}

async function writeVanguardSave(
    store: VanguardRewardStore,
    saveKey: string,
    current: Record<string, unknown>,
    character: Record<string, unknown>,
): Promise<{ record: Record<string, unknown>; _saveVersion: number }> {
    return store === kv
        ? writeVersionedPlayerSave(saveKey, current, character)
        : writeVersionedPlayerSaveWithStore(store, saveKey, current, character);
}

async function abortVanguardIntent(
    store: VanguardRewardStore,
    key: string,
    intent: VanguardRewardIntentV2,
    now: number,
): Promise<void> {
    const current = await store.get<unknown>(key).catch(() => null);
    if (!isDeepStrictEqual(current, intent) || intent.state !== 'pending') return;
    const aborted: VanguardRewardIntentV2 = {
        ...intent,
        state: 'aborted',
        leaseExpiresAt: now + VANGUARD_REWARD_LEASE_MS,
    };
    await vanguardCompareSetConfirmed(
        store,
        key,
        intent,
        aborted,
        Math.ceil(VANGUARD_REWARD_LEASE_MS / 1000),
    ).catch(() => false);
}

function vanguardRecoveryEnabled(options: VanguardRewardOptions): boolean {
    if (options.allowLeaseTakeover !== undefined) return options.allowLeaseTakeover;
    // Exact player-ranked V2 admissions are themselves default-off until the
    // worker drain. Generic PvP requires its separate second-stage switch.
    return options.rankedTerminal !== undefined
        || process.env.ENABLE_VANGUARD_REWARD_V2 === '1';
}

function vanguardMarkerFromCharacter(
    character: Record<string, unknown>,
): VanguardRewardSettlementMarker | null | 'invalid' {
    const raw = character[VANGUARD_REWARD_SETTLEMENT_FIELD];
    if (raw === undefined) return null;
    return parseVanguardRewardSettlementMarker(raw) ?? 'invalid';
}

function makeReservedVanguardMarker(
    authority: VanguardRewardAuthority,
    ownerId: string,
    expectedSaveVersion: number,
    createdAt: number,
    now: number,
    retentionSeconds: number,
): VanguardRewardSettlementMarker {
    return {
        version: VANGUARD_REWARD_SETTLEMENT_VERSION,
        state: 'reserved',
        ownerId,
        fingerprint: authority.fingerprint,
        authorityFingerprint: authority.authorityFingerprint,
        battleId: authority.battleId,
        winner: authority.winner,
        loser: authority.loser,
        expectedSaveVersion,
        createdAt,
        settledAt: null,
        recoverUntil: now + retentionSeconds * 1000,
        outcome: null,
    };
}

function makeSettledVanguardMarker(
    authority: VanguardRewardAuthority,
    intent: VanguardRewardIntentV2,
    expectedSaveVersion: number,
    outcome: VanguardRewardOutcome,
    now: number,
    retentionSeconds: number,
): VanguardRewardSettlementMarker {
    return {
        version: VANGUARD_REWARD_SETTLEMENT_VERSION,
        state: 'settled',
        ownerId: intent.ownerId,
        fingerprint: authority.fingerprint,
        authorityFingerprint: authority.authorityFingerprint,
        battleId: authority.battleId,
        winner: authority.winner,
        loser: authority.loser,
        expectedSaveVersion,
        createdAt: intent.createdAt,
        settledAt: now,
        recoverUntil: now + retentionSeconds * 1000,
        outcome,
    };
}

function makePendingVanguardIntent(
    authority: VanguardRewardAuthority,
    ownerId: string,
    expectedSaveVersion: number,
    now: number,
): VanguardRewardIntentV2 {
    return {
        version: VANGUARD_REWARD_INTENT_VERSION,
        state: 'pending',
        ownerId,
        fingerprint: authority.fingerprint,
        authorityFingerprint: authority.authorityFingerprint,
        battleId: authority.battleId,
        winner: authority.winner,
        loser: authority.loser,
        expectedSaveVersion,
        createdAt: now,
        leaseExpiresAt: now + VANGUARD_REWARD_LEASE_MS,
        markerSettledAt: null,
        outcome: null,
    };
}

/** Exact proof consumed when a compacted V2 session is no longer readable. */
export async function hasDurableVanguardTerminalOutcome(
    store: Pick<KvLike, 'get'>,
    terminal: PlayerRankedTerminal,
): Promise<boolean> {
    if (!terminal.rankedEligible || terminal.winner === 'draw') return true;
    const sides = rankedTerminalWinner(terminal);
    if (!sides) return true;
    const authority: VanguardRewardAuthority = {
        authorityFingerprint: terminal.fingerprint,
        fingerprint: vanguardSha({
            version: 1,
            authorityFingerprint: terminal.fingerprint,
            battleId: terminal.battleId,
            winner: sides.winner,
            loser: sides.loser,
        }),
        battleId: terminal.battleId,
        winner: sides.winner,
        loser: sides.loser,
        terminalAt: terminal.terminalAt,
    };
    const intent = parseVanguardRewardIntent(await store.get<unknown>(vanguardReceiptKey(terminal.battleId)));
    if (!!intent
        && intent.state === 'committed'
        && vanguardIntentMatches(intent, authority)
        && intent.outcome !== null) return true;
    // The winner-save marker is the save-atomic source of truth and remains a
    // valid proof even if an external TTL was accidentally shortened during a
    // mixed deployment. The normal V2 retention matches the 400-day journal.
    const winnerRecord = await store.get<Record<string, unknown>>(`save:${authority.winner}`);
    const winnerChar = winnerRecord?.character;
    if (!vanguardRecord(winnerChar)) return false;
    const marker = parseVanguardRewardSettlementMarker(winnerChar[VANGUARD_REWARD_SETTLEMENT_FIELD]);
    return !!marker
        && marker.state === 'settled'
        && vanguardMarkerMatches(marker, authority)
        && marker.outcome !== null;
}

async function computeVanguardReward(
    session: PvpSession,
    authority: VanguardRewardAuthority,
    winnerChar: Record<string, unknown>,
    loserChar: Record<string, unknown>,
    options: VanguardRewardOptions,
): Promise<{
    outcome: VanguardRewardOutcome;
    character: Record<string, unknown>;
    escorters: string[];
}> {
    const winnerSlot = session.winner === 'p1' ? session.p1 : session.p2;
    const loserSlot = session.winner === 'p1' ? session.p2 : session.p1;
    const winnerSnapshot = vanguardRecord(winnerSlot.character) ? winnerSlot.character : winnerChar;
    const loserSnapshot = vanguardRecord(loserSlot.character) ? loserSlot.character : loserChar;
    const noGrant = (reason: DurableVanguardReason) => ({
        outcome: { granted: false, reason } as VanguardRewardOutcome,
        character: winnerChar,
        escorters: [] as string[],
    });

    if (!pvpSessionMayGrantProgress(session)) return noGrant('not-human-pvp');
    if (winnerSnapshot.profession !== 'vanguard') return noGrant('not-vanguard');
    if (authority.terminalAt - Number(session.createdAt ?? 0) < MIN_FIGHT_DURATION_MS) {
        return noGrant('too-quick');
    }
    const loserCreated = Number(loserChar.createdAt ?? 0);
    if (loserCreated > 0 && authority.terminalAt - loserCreated < ACCOUNT_AGE_MIN_MS) {
        return noGrant('too-young');
    }
    // Ranked V2 uses the journal's already-sealed strict anti-alt decision.
    // Re-evaluating mutable IP/fingerprint history here would make retries pay
    // differently after the overlap horizon ages out.
    if (!options.rankedTerminal
        && await (options.overlap ?? hasRecentIpOrFpOverlap)(winnerSlot.name, loserSlot.name)) {
        return noGrant('same-device');
    }

    const spec = winnerSnapshot.masterySpec;
    const rank = Math.max(1, Math.min(MAX_RANK, Number(winnerSnapshot.professionRank ?? 1)));
    const baseSeals = VANGUARD_SEALS_PER_KILL[rank];
    const gapMult = levelGapMult(
        Number(winnerSnapshot.level ?? 1),
        Number(loserSnapshot.level ?? 1),
    );
    const gapSoftenPct = Math.min(100, masteryBonus('vanguard', spec, 'sealGapSoftenPct'));
    const effectiveGapMult = gapMult + (1 - gapMult) * (gapSoftenPct / 100);
    let seals = Math.floor(baseSeals * effectiveGapMult);
    if (seals <= 0 && masteryHasCapstone('vanguard', spec, 'warmonger') && baseSeals > 0) seals = 1;
    if (seals <= 0) return noGrant('level-gap');

    const rewardDate = new Date(authority.terminalAt).toISOString().slice(0, 10);
    const storedDate = typeof winnerChar.vanguardDailyResetDate === 'string'
        ? winnerChar.vanguardDailyResetDate
        : '';
    const dailyActive = storedDate === rewardDate;
    const dailySoFar = dailyActive ? Math.max(0, Number(winnerChar.dailyHonorSealsEarned ?? 0)) : 0;
    const byTarget: Record<string, number> = dailyActive && vanguardRecord(winnerChar.dailyHonorSealsByTarget)
        ? winnerChar.dailyHonorSealsByTarget as Record<string, number>
        : {};
    const targetSoFar = Math.max(0, Number(byTarget[authority.loser] ?? 0));
    const dailyCap = DAILY_SEAL_CAP + Math.min(15, masteryBonus('vanguard', spec, 'sealDailyCapFlat'));
    // A delayed retry must not roll a newer UTC day's counters backward. XP
    // remains payable; only the now-unprovable past-day Seal slice fails closed.
    if (storedDate && storedDate > rewardDate) {
        seals = 0;
    } else {
        seals = Math.min(seals, Math.max(0, dailyCap - dailySoFar));
        seals = Math.min(seals, Math.max(0, PER_TARGET_DAILY_CAP - targetSoFar));
    }

    const winnerClan = typeof winnerSnapshot.clan === 'string' ? winnerSnapshot.clan : '';
    const hasActivePet = typeof winnerSnapshot.activePetId === 'string' && winnerSnapshot.activePetId.length > 0;
    let escorters: string[] = [];
    if (seals > 0 && winnerClan && hasActivePet) {
        try {
            escorters = await (options.activeEscorters ?? listActiveEscorters)(winnerClan);
        } catch (error) {
            // V2 terminal completion is an authoritative settlement, so an
            // unavailable escort source must remain retryable rather than
            // permanently sealing a smaller reward. Legacy remains best-effort.
            if (options.rankedTerminal) throw error;
            escorters = [];
        }
        if (escorters.length > 0) seals = Math.floor(seals * PET_ESCORT_SEAL_BONUS);
    }

    // XP intentionally survives a zero Seal daily/per-target cap.
    const baseXpGain = vanguardXpForLevel(Number(loserSnapshot.level ?? 1));
    const xpGain = rank >= 2 ? Math.floor(baseXpGain * 1.1) : baseXpGain;
    const nextProfessionXp = Number(winnerChar.professionXp ?? 0) + xpGain;
    let character: Record<string, unknown> = {
        ...winnerChar,
        honorSeals: Number(winnerChar.honorSeals ?? 0) + seals,
        professionXp: nextProfessionXp,
        professionRank: rankFromXp(nextProfessionXp),
    };
    if (seals > 0) {
        const nextByTarget = { ...byTarget };
        setSafeRecordValue(nextByTarget, authority.loser, targetSoFar + seals);
        character = {
            ...character,
            dailyHonorSealsEarned: dailySoFar + seals,
            dailyHonorSealsByTarget: nextByTarget,
            vanguardDailyResetDate: rewardDate,
        };
    }
    return {
        outcome: { granted: true, seals, xp: xpGain },
        character,
        escorters,
    };
}

export async function grantVanguardRewardsForSession(
    session: PvpSession,
    options: VanguardRewardOptions = {},
): Promise<GrantResult> {
    // Stage-1 rolling compatibility: legacy terminal callers stay on the
    // d76a receipt/save shape. The marker saga is activated only by an exact
    // V2 terminal journal after the documented worker drain.
    if (!options.rankedTerminal && process.env.ENABLE_VANGUARD_REWARD_V2 !== '1') {
        return (options.legacyGrant ?? grantVanguardRewardsForSessionLegacy)(session);
    }
    const authority = buildVanguardAuthority(session, options.rankedTerminal);
    if (!authority) return { granted: false };
    if (!options.rankedTerminal
        && (session as PvpSession & { vanguardRewardsGranted?: boolean }).vanguardRewardsGranted) {
        return { granted: false, reason: 'already-granted' };
    }
    if (options.rankedTerminal && (!session.joined?.p1 || !session.joined?.p2)) {
        throw new Error('vanguard-ranked-terminal-participants-unconfirmed');
    }

    const store = options.store ?? kv;
    const lock: VanguardSaveLockRunner = options.lock
        ?? ((saveKey, action) => withKvLock(saveKey, action, { failClosed: true }));
    const now = Math.max(1, Math.floor(options.now ?? Date.now()));
    const retentionSeconds = options.rankedTerminal
        ? VANGUARD_RANKED_REWARD_TTL_SECONDS
        : VANGUARD_REWARD_TTL_SECONDS;
    const winnerKey = `save:${authority.winner}`;
    const loserKey = `save:${authority.loser}`;
    const intentKey = vanguardReceiptKey(authority.battleId);

    return lock(winnerKey, async () => {
        let winnerRecord = await store.get<Record<string, unknown>>(winnerKey);
        let winnerChar = winnerRecord?.character as Record<string, unknown> | undefined;
        if (!winnerRecord || !winnerChar) {
            if (options.rankedTerminal) throw new Error('vanguard-winner-save-missing');
            return { granted: false };
        }

        const readMarker = vanguardMarkerFromCharacter(winnerChar);
        if (readMarker === 'invalid') throw new Error('vanguard-reward-marker-invalid');
        let marker = readMarker;
        if (marker?.state === 'settled') {
            await commitVanguardMarker(store, marker);
            if (vanguardMarkerMatches(marker, authority)) return vanguardReplayResult(marker.outcome!);
        } else if (marker && !vanguardMarkerMatches(marker, authority)) {
            const priorIntent = parseVanguardRewardIntent(
                await store.get<unknown>(vanguardReceiptKey(marker.battleId)),
            );
            const priorResolved = !!priorIntent
                && priorIntent.fingerprint === marker.fingerprint
                && priorIntent.state === 'committed';
            if (!priorResolved && (!vanguardRecoveryEnabled(options) || now < marker.recoverUntil)) {
                throw new Error('vanguard-prior-reward-unresolved');
            }
        }

        let intent: VanguardRewardIntentV2 | null = null;
        for (let attempt = 0; attempt < 16 && !intent; attempt += 1) {
            const raw = await store.get<unknown>(intentKey);
            const current = parseVanguardRewardIntent(raw);
            if (!current) {
                const legacy = legacyVanguardReceiptDisposition(raw, authority);
                if (legacy === 'pending') throw new Error('vanguard-reward-legacy-owner-pending');
                if (legacy === 'conflict') throw new Error('vanguard-reward-receipt-conflict');
                if (legacy === 'spent' || raw !== null) return { granted: false, reason: 'already-granted' };
                const ownerId = marker && vanguardMarkerMatches(marker, authority) && marker.state === 'reserved'
                    ? marker.ownerId
                    : randomUUID();
                const pending = makePendingVanguardIntent(
                    authority,
                    ownerId,
                    Number(winnerRecord._saveVersion ?? 0),
                    now,
                );
                if (await vanguardCompareSetConfirmed(store, intentKey, null, pending)) intent = pending;
                continue;
            }
            if (!vanguardIntentMatches(current, authority)) throw new Error('vanguard-reward-receipt-conflict');
            if (current.state === 'committed') return vanguardReplayResult(current.outcome!);
            if (current.state === 'aborted') {
                const pending = makePendingVanguardIntent(
                    authority,
                    randomUUID(),
                    Number(winnerRecord._saveVersion ?? 0),
                    now,
                );
                if (await vanguardCompareSetConfirmed(store, intentKey, current, pending)) intent = pending;
                continue;
            }
            if (marker && vanguardMarkerMatches(marker, authority)) {
                if (marker.state === 'settled') {
                    const committed = await commitVanguardMarker(store, marker);
                    return vanguardReplayResult(committed.outcome!);
                }
                if (marker.ownerId === current.ownerId) {
                    intent = current;
                    continue;
                }
                // Crash after the save fence but before the external owner CAS:
                // the exact reserved successor proves the old predecessor can
                // no longer win its save write, so finish that transfer rather
                // than requiring the pre-fence save version forever.
                if (marker.createdAt === current.createdAt
                    && marker.expectedSaveVersion === current.expectedSaveVersion) {
                    const successor: VanguardRewardIntentV2 = {
                        ...current,
                        ownerId: marker.ownerId,
                        expectedSaveVersion: Number(winnerRecord._saveVersion ?? 0),
                        leaseExpiresAt: now + VANGUARD_REWARD_LEASE_MS,
                    };
                    if (await vanguardCompareSetConfirmed(store, intentKey, current, successor)) intent = successor;
                    continue;
                }
            }
            if (now < Number(current.leaseExpiresAt ?? 0)) throw new Error('vanguard-reward-owner-active');
            if (!vanguardRecoveryEnabled(options)) throw new Error('vanguard-reward-owner-drain-required');
            if (Number(winnerRecord._saveVersion ?? 0) < current.expectedSaveVersion) {
                throw new Error('vanguard-reward-save-version-rollback');
            }

            // Fence the expired writer in the save before changing external
            // ownership. After the explicit rolling drain flag is enabled,
            // every intervening writer is exact-CAS. Unrelated save churn is
            // therefore already a liveness fence; this marker CAS records the
            // successor durably and also fences the no-churn case.
            const successorOwner = randomUUID();
            const fence = makeReservedVanguardMarker(
                authority,
                successorOwner,
                Number(winnerRecord._saveVersion ?? 0),
                current.createdAt,
                now,
                retentionSeconds,
            );
            const fenced = await writeVanguardSave(store, winnerKey, winnerRecord, {
                ...winnerChar,
                [VANGUARD_REWARD_SETTLEMENT_FIELD]: fence,
            });
            winnerRecord = fenced.record;
            winnerChar = winnerRecord.character as Record<string, unknown>;
            marker = fence;
            const successor: VanguardRewardIntentV2 = {
                ...current,
                ownerId: successorOwner,
                expectedSaveVersion: fenced._saveVersion,
                leaseExpiresAt: now + VANGUARD_REWARD_LEASE_MS,
            };
            if (await vanguardCompareSetConfirmed(store, intentKey, current, successor)) intent = successor;
        }
        if (!intent) throw new Error('vanguard-reward-reservation-busy');

        const loserRecord = await store.get<Record<string, unknown>>(loserKey);
        const loserChar = loserRecord?.character as Record<string, unknown> | undefined;
        if (!loserChar) {
            await abortVanguardIntent(store, intentKey, intent, now);
            if (options.rankedTerminal) throw new Error('vanguard-loser-save-missing');
            return { granted: false };
        }

        const computed = await computeVanguardReward(
            session,
            authority,
            winnerChar,
            loserChar,
            options,
        );

        // Escort flags are boolean/idempotent and precede the winner's exact
        // transaction. A crash is repaired by this same battle intent.
        const escorterSlugs = [...new Set(computed.escorters
            .map((name) => safeName(String(name)))
            .filter((slug): slug is string => Boolean(slug) && slug !== authority.winner))];
        await Promise.all(escorterSlugs.map(async (escorterSlug) => {
            const escorterKey = `save:${escorterSlug}`;
            await lock(escorterKey, async () => {
                const record = await store.get<Record<string, unknown>>(escorterKey);
                const character = record?.character as Record<string, unknown> | undefined;
                if (!record || !character || character.profession !== 'petTamer' || character.petEscortBonusReady === true) return;
                await writeVanguardSave(store, escorterKey, record, { ...character, petEscortBonusReady: true });
            });
        }));

        const settlement = makeSettledVanguardMarker(
            authority,
            intent,
            Number(winnerRecord._saveVersion ?? 0),
            computed.outcome,
            now,
            retentionSeconds,
        );
        try {
            await writeVanguardSave(store, winnerKey, winnerRecord, {
                ...computed.character,
                [VANGUARD_REWARD_SETTLEMENT_FIELD]: settlement,
            });
        } catch (error) {
            const latest = await store.get<Record<string, unknown>>(winnerKey).catch(() => null);
            const latestMarker = latest?.character && vanguardRecord(latest.character)
                ? vanguardMarkerFromCharacter(latest.character)
                : null;
            if (latestMarker && latestMarker !== 'invalid'
                && latestMarker.state === 'settled'
                && vanguardMarkerMatches(latestMarker, authority)) {
                await commitVanguardMarker(store, latestMarker);
                return vanguardReplayResult(latestMarker.outcome!);
            }
            if (error instanceof Error && error.message === 'player-save-version-conflict') {
                await abortVanguardIntent(store, intentKey, intent, now);
            }
            throw error;
        }
        await commitVanguardMarker(store, settlement);
        return computed.outcome.granted
            ? { granted: true, seals: computed.outcome.seals, xp: computed.outcome.xp }
            : { granted: false, reason: computed.outcome.reason };
    });
}
