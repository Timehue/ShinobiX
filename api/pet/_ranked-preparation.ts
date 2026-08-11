import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';
import {
    isPetRankedMatchId,
    isServerResolvedPetRankedToken,
    type ServerResolvedPetRankedToken,
} from './_ranked-engine.js';
import { petRankedTokenFingerprint, PET_RANKED_REPLAY_TTL_SECONDS } from './_ranked-journal.js';

/**
 * Durable admission + preclaim authority shared by ranked starts and rollover.
 *
 * A complete preparation is first inserted into the single season gate with an
 * exact JSON CAS. The immutable per-match row is then materialized before either
 * participant's non-expiring combat lease is claimed. If the process dies in
 * that small mirror-write window, the gate contains the complete bytes required
 * for any participant or the season job to help the preparation forward.
 */

export const PET_RANKED_PREPARATION_VERSION = 'pet-ranked-preparation-v1' as const;
export const PET_RANKED_SEASON_GATE_VERSION = 'pet-ranked-season-gate-v1' as const;
export const PLAYER_RANKED_ADMISSION_VERSION = 'player-ranked-admission-v1' as const;
export const PLAYER_RANKED_SESSION_CLOSE_FENCE_VERSION = 'player-ranked-session-close-fence-v1' as const;
export const PLAYER_RANKED_SESSION_CLOSE_TOMBSTONE_VERSION = 'player-ranked-session-close-tombstone-v1' as const;
export const PLAYER_RANKED_SESSION_ORPHAN_TOMBSTONE_VERSION = 'player-ranked-session-orphan-tombstone-v1' as const;
export const PLAYER_RANKED_ADMISSION_TTL_MS = 3 * 60 * 1_000;
export const PLAYER_RANKED_JOIN_DEADLINE_MS = 3 * 60 * 1_000;
export const PLAYER_RANKED_ACTIVE_ORPHAN_TTL_MS = 30 * 60 * 1_000;
// A pre-publication writer can be paused well beyond the ordinary 15 minute
// combat lease. Keep the cancellation capability for the full ranked journal
// recovery horizon; a writer that somehow resumes later is still quarantined
// by the post-publication gate check before any result can have effects.
export const PLAYER_RANKED_ORPHAN_TOMBSTONE_TTL_SECONDS = 400 * 24 * 60 * 60;
export const PET_RANKED_SEASON_GATE_KEY = 'ranked:season:authority';
export const PET_RANKED_PREPARATION_PREFIX = 'pet:ranked-preparation:';
const MAX_GATE_ADMISSIONS = 256;
const MAX_PREPARATION_BYTES = 256 * 1024;

export type PetRankedPreparation = {
    version: typeof PET_RANKED_PREPARATION_VERSION;
    matchId: string;
    a: string;
    b: string;
    seed: number;
    createdAt: number;
    seasonId: number;
    seasonEpoch: number;
    tokenFingerprint: string;
    token: ServerResolvedPetRankedToken;
};

export type PlayerRankedAdmission = {
    version: typeof PLAYER_RANKED_ADMISSION_VERSION;
    matchId: string;
    a: string;
    b: string;
    aLevel: number;
    bLevel: number;
    aRating: number;
    bRating: number;
    createdAt: number;
    seasonId: number;
    seasonEpoch: number;
    phase: 'queued' | 'active' | 'terminal' | 'cancelled';
    battleId: string | null;
    activatedAt: number | null;
    sessionPublishedAt: number | null;
    terminalAt: number | null;
    cancelledAt: number | null;
    winner: 'a' | 'b' | 'draw' | null;
    rankedEligible: boolean | null;
    terminalFingerprint: string | null;
};

export type PlayerRankedSessionCloseFence = {
    version: typeof PLAYER_RANKED_SESSION_CLOSE_FENCE_VERSION;
    matchId: string;
    seasonId: number;
    seasonEpoch: number;
    transitionId: string;
    fencedAt: number;
};

export type PlayerRankedSessionCloseTombstone = Omit<PlayerRankedSessionCloseFence, 'version'> & {
    version: typeof PLAYER_RANKED_SESSION_CLOSE_TOMBSTONE_VERSION;
    battleId: string;
};

export type PlayerRankedSessionOrphanTombstone = {
    version: typeof PLAYER_RANKED_SESSION_ORPHAN_TOMBSTONE_VERSION;
    battleId: string;
    matchId: string;
    a: string;
    b: string;
    seasonId: number;
    seasonEpoch: number;
    cancelledAt: number;
};

export type PetRankedSeasonGate = {
    version: typeof PET_RANKED_SEASON_GATE_VERSION;
    state: 'open' | 'closing';
    seasonId: number;
    epoch: number;
    transitionId: string | null;
    nextSeasonId: number | null;
    changedAt: number;
    admissions: PetRankedPreparation[];
    /** Player-PvP admissions share this exact CAS boundary with pet matches. */
    playerAdmissions: PlayerRankedAdmission[];
};

type PreparationStore = Pick<KvLike, 'get' | 'set' | 'compareSet' | 'keys'>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(record).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safePositiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function makePlayerRankedSessionCloseFence(
    admission: PlayerRankedAdmission,
    transitionId: string,
    now: number,
): PlayerRankedSessionCloseFence {
    return {
        version: PLAYER_RANKED_SESSION_CLOSE_FENCE_VERSION,
        matchId: admission.matchId,
        seasonId: admission.seasonId,
        seasonEpoch: admission.seasonEpoch,
        transitionId,
        fencedAt: Math.max(1, Math.floor(now)),
    };
}

export function makePlayerRankedSessionCloseTombstone(
    admission: PlayerRankedAdmission,
    transitionId: string,
    now: number,
): PlayerRankedSessionCloseTombstone {
    if (!admission.battleId) throw new Error('player-ranked-close-battle-missing');
    return {
        ...makePlayerRankedSessionCloseFence(admission, transitionId, now),
        version: PLAYER_RANKED_SESSION_CLOSE_TOMBSTONE_VERSION,
        battleId: admission.battleId,
    };
}

export function parsePlayerRankedSessionCloseTombstone(
    value: unknown,
): PlayerRankedSessionCloseTombstone | null {
    if (!isRecord(value) || !hasExactKeys(value, [
        'version', 'battleId', 'matchId', 'seasonId', 'seasonEpoch', 'transitionId', 'fencedAt',
    ])) return null;
    if (value.version !== PLAYER_RANKED_SESSION_CLOSE_TOMBSTONE_VERSION
        || typeof value.battleId !== 'string'
        || !/^pvp-[0-9a-f-]{36}$/.test(value.battleId)
        || !isPlayerRankedMatchId(value.matchId)
        || !safePositiveInt(value.seasonId)
        || !safePositiveInt(value.seasonEpoch)
        || typeof value.transitionId !== 'string'
        || !value.transitionId
        || !safePositiveInt(value.fencedAt)) return null;
    return value as PlayerRankedSessionCloseTombstone;
}

export function makePlayerRankedSessionOrphanTombstone(
    admission: PlayerRankedAdmission,
    now: number,
): PlayerRankedSessionOrphanTombstone {
    if (!admission.battleId) throw new Error('player-ranked-orphan-battle-missing');
    return {
        version: PLAYER_RANKED_SESSION_ORPHAN_TOMBSTONE_VERSION,
        battleId: admission.battleId,
        matchId: admission.matchId,
        a: admission.a,
        b: admission.b,
        seasonId: admission.seasonId,
        seasonEpoch: admission.seasonEpoch,
        cancelledAt: Math.max(1, Math.floor(now)),
    };
}

export function parsePlayerRankedSessionOrphanTombstone(
    value: unknown,
): PlayerRankedSessionOrphanTombstone | null {
    if (!isRecord(value) || !hasExactKeys(value, [
        'version', 'battleId', 'matchId', 'a', 'b', 'seasonId', 'seasonEpoch', 'cancelledAt',
    ])) return null;
    if (value.version !== PLAYER_RANKED_SESSION_ORPHAN_TOMBSTONE_VERSION
        || typeof value.battleId !== 'string'
        || !/^pvp-[0-9a-f-]{36}$/.test(value.battleId)
        || !isPlayerRankedMatchId(value.matchId)
        || typeof value.a !== 'string'
        || typeof value.b !== 'string'
        || value.a !== safeName(value.a)
        || value.b !== safeName(value.b)
        || !value.a
        || value.a >= value.b
        || !safePositiveInt(value.seasonId)
        || !safePositiveInt(value.seasonEpoch)
        || !safePositiveInt(value.cancelledAt)) return null;
    return value as PlayerRankedSessionOrphanTombstone;
}

export function playerRankedOrphanTombstoneMatchesAdmission(
    value: unknown,
    admission: PlayerRankedAdmission,
): value is PlayerRankedSessionOrphanTombstone {
    const tombstone = parsePlayerRankedSessionOrphanTombstone(value);
    return !!tombstone
        && !!admission.battleId
        && tombstone.battleId === admission.battleId
        && tombstone.matchId === admission.matchId
        && tombstone.a === admission.a
        && tombstone.b === admission.b
        && tombstone.seasonId === admission.seasonId
        && tombstone.seasonEpoch === admission.seasonEpoch;
}

function expiredUnjoinedPlayerRankedV2Session(
    value: unknown,
    admission: PlayerRankedAdmission,
    joinCutoff: number,
): boolean {
    if (!isRecord(value)
        || !admission.battleId
        || value.status !== 'active'
        || value.battleId !== admission.battleId
        || value.playerRankedAuthorityVersion !== 2
        || value.ranked === true
        || value.rankedKind !== 'player'
        || value.rankedMatchId !== admission.matchId
        || value.rankedSeasonId !== admission.seasonId
        || value.rankedSeasonEpoch !== admission.seasonEpoch
        || value.rewardAuthority !== 'ranked'
        || value.baseRewards === true
        || !safePositiveInt(value.createdAt)
        || value.createdAt >= joinCutoff
        || !isRecord(value.p1)
        || !isRecord(value.p2)) return false;
    const p1 = safeName(String(value.p1.name ?? ''));
    const p2 = safeName(String(value.p2.name ?? ''));
    const pair = [p1, p2].sort();
    const p1Rating = p1 === admission.a ? admission.aRating : admission.bRating;
    const p2Rating = p2 === admission.a ? admission.aRating : admission.bRating;
    const joined = isRecord(value.joined) ? value.joined : {};
    return pair[0] === admission.a
        && pair[1] === admission.b
        && value.p1Rating === p1Rating
        && value.p2Rating === p2Rating
        && (joined.p1 !== true || joined.p2 !== true);
}

function matchingCloseCore(
    value: unknown,
    admission: PlayerRankedAdmission,
    transitionId: string,
): value is PlayerRankedSessionCloseFence {
    if (!isRecord(value)) return false;
    return value.matchId === admission.matchId
        && value.seasonId === admission.seasonId
        && value.seasonEpoch === admission.seasonEpoch
        && value.transitionId === transitionId
        && safePositiveInt(value.fencedAt);
}

export function playerRankedSessionIsFencedForClose(
    value: unknown,
    admission: PlayerRankedAdmission,
    transitionId: string,
): boolean {
    if (!admission.battleId || !isRecord(value)) return false;
    if (value.version === PLAYER_RANKED_SESSION_CLOSE_TOMBSTONE_VERSION) {
        return hasExactKeys(value, [
            'version', 'battleId', 'matchId', 'seasonId', 'seasonEpoch', 'transitionId', 'fencedAt',
        ])
            && value.battleId === admission.battleId
            && matchingCloseCore(value, admission, transitionId);
    }
    const fence = value.rankedCloseFence;
    return value.battleId === admission.battleId
        && value.status === 'active'
        && isRecord(fence)
        && hasExactKeys(fence, [
            'version', 'matchId', 'seasonId', 'seasonEpoch', 'transitionId', 'fencedAt',
        ])
        && fence.version === PLAYER_RANKED_SESSION_CLOSE_FENCE_VERSION
        && matchingCloseCore(fence, admission, transitionId);
}

export function isPlayerRankedMatchId(value: unknown): value is string {
    return typeof value === 'string'
        && /^player-ranked-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function validPlayerAdmission(value: unknown): value is PlayerRankedAdmission {
    if (!isRecord(value) || !hasExactKeys(value, [
        'version', 'matchId', 'a', 'b', 'aLevel', 'bLevel', 'aRating', 'bRating',
        'createdAt', 'seasonId', 'seasonEpoch', 'phase', 'battleId', 'activatedAt',
        'sessionPublishedAt', 'terminalAt', 'cancelledAt', 'winner', 'rankedEligible', 'terminalFingerprint',
    ])) return false;
    const admission = value as PlayerRankedAdmission;
    const nullablePositive = (entry: unknown) => entry === null || safePositiveInt(entry);
    if (admission.version !== PLAYER_RANKED_ADMISSION_VERSION
        || !isPlayerRankedMatchId(admission.matchId)
        || admission.a !== safeName(admission.a)
        || admission.b !== safeName(admission.b)
        || !admission.a
        || !admission.b
        || admission.a >= admission.b
        || !safePositiveInt(admission.aLevel)
        || !safePositiveInt(admission.bLevel)
        || !Number.isFinite(admission.aRating)
        || !Number.isFinite(admission.bRating)
        || admission.aRating < 0
        || admission.bRating < 0
        || !safePositiveInt(admission.createdAt)
        || !safePositiveInt(admission.seasonId)
        || !safePositiveInt(admission.seasonEpoch)
        || !['queued', 'active', 'terminal', 'cancelled'].includes(admission.phase)
        || !nullablePositive(admission.activatedAt)
        || !nullablePositive(admission.sessionPublishedAt)
        || !nullablePositive(admission.terminalAt)
        || !nullablePositive(admission.cancelledAt)) return false;
    if (admission.phase === 'queued') {
        return admission.battleId === null
            && admission.activatedAt === null
            && admission.sessionPublishedAt === null
            && admission.terminalAt === null
            && admission.cancelledAt === null
            && admission.winner === null
            && admission.rankedEligible === null
            && admission.terminalFingerprint === null;
    }
    if (admission.phase === 'active') {
        return typeof admission.battleId === 'string'
            && /^pvp-[0-9a-f-]{36}$/.test(admission.battleId)
            && admission.activatedAt !== null
            && admission.terminalAt === null
            && admission.cancelledAt === null
            && admission.winner === null
            && admission.rankedEligible === null
            && admission.terminalFingerprint === null;
    }
    if (admission.phase === 'terminal') {
        return typeof admission.battleId === 'string'
            && /^pvp-[0-9a-f-]{36}$/.test(admission.battleId)
            && admission.activatedAt !== null
            && admission.terminalAt !== null
            && admission.cancelledAt === null
            && (admission.winner === 'a' || admission.winner === 'b' || admission.winner === 'draw')
            && typeof admission.rankedEligible === 'boolean'
            && typeof admission.terminalFingerprint === 'string'
            && /^[a-f0-9]{64}$/.test(admission.terminalFingerprint);
    }
    return admission.terminalAt === null
        && admission.cancelledAt !== null
        && admission.winner === null
        && admission.rankedEligible === null
        && admission.terminalFingerprint === null
        && ((admission.battleId === null && admission.activatedAt === null)
            || (typeof admission.battleId === 'string'
                && /^pvp-[0-9a-f-]{36}$/.test(admission.battleId)
                && admission.activatedAt !== null));
}

function validPreparation(value: unknown): value is PetRankedPreparation {
    if (!isRecord(value) || !hasExactKeys(value, [
        'version', 'matchId', 'a', 'b', 'seed', 'createdAt', 'seasonId', 'seasonEpoch',
        'tokenFingerprint', 'token',
    ])) return false;
    const prep = value as PetRankedPreparation;
    if (prep.version !== PET_RANKED_PREPARATION_VERSION
        || !isPetRankedMatchId(prep.matchId)
        || prep.a !== safeName(prep.a)
        || prep.b !== safeName(prep.b)
        || !prep.a
        || !prep.b
        || prep.a >= prep.b
        || !Number.isSafeInteger(prep.seed)
        || prep.seed < 1
        || prep.seed > 0x7fffffff
        || !safePositiveInt(prep.createdAt)
        || !safePositiveInt(prep.seasonId)
        || !safePositiveInt(prep.seasonEpoch)
        || !isServerResolvedPetRankedToken(prep.token)
        || prep.token.matchId !== prep.matchId
        || safeName(prep.token?.a) !== prep.a
        || safeName(prep.token?.b) !== prep.b
        || prep.token?.seed !== prep.seed
        || prep.token?.createdAt !== prep.createdAt
        || !/^[a-f0-9]{64}$/.test(prep.tokenFingerprint)
        || prep.tokenFingerprint !== petRankedTokenFingerprint(prep.token)) {
        return false;
    }
    return true;
}

function validGate(value: unknown): value is PetRankedSeasonGate {
    if (!isRecord(value) || !hasExactKeys(value, [
        'version', 'state', 'seasonId', 'epoch', 'transitionId', 'nextSeasonId', 'changedAt',
        'admissions', 'playerAdmissions',
    ])) return false;
    const gate = value as PetRankedSeasonGate;
    if (gate.version !== PET_RANKED_SEASON_GATE_VERSION
        || (gate.state !== 'open' && gate.state !== 'closing')
        || !safePositiveInt(gate.seasonId)
        || !safePositiveInt(gate.epoch)
        || !safePositiveInt(gate.changedAt)
        || !Array.isArray(gate.admissions)
        || gate.admissions.length > MAX_GATE_ADMISSIONS
        || !gate.admissions.every(validPreparation)
        || !Array.isArray(gate.playerAdmissions)
        || gate.admissions.length + gate.playerAdmissions.length > MAX_GATE_ADMISSIONS
        || !gate.playerAdmissions.every(validPlayerAdmission)) {
        return false;
    }
    if (gate.state === 'open') {
        if (gate.transitionId !== null || gate.nextSeasonId !== null) return false;
    } else if (typeof gate.transitionId !== 'string'
        || !/^ranked-season-[1-9][0-9]*-[1-9][0-9]*$/.test(gate.transitionId)
        || !safePositiveInt(gate.nextSeasonId)
        || gate.nextSeasonId !== gate.seasonId + 1) {
        return false;
    }
    const ids = new Set<string>();
    const players = new Set<string>();
    for (const admission of gate.admissions) {
        if (admission.seasonId !== gate.seasonId || admission.seasonEpoch !== gate.epoch) return false;
        if (ids.has(admission.matchId) || players.has(admission.a) || players.has(admission.b)) return false;
        ids.add(admission.matchId);
        players.add(admission.a);
        players.add(admission.b);
    }
    const playerIds = new Set<string>();
    const playerParticipants = new Set<string>();
    for (const admission of gate.playerAdmissions) {
        if (admission.seasonId !== gate.seasonId || admission.seasonEpoch !== gate.epoch) return false;
        if (playerIds.has(admission.matchId)
            || playerParticipants.has(admission.a)
            || playerParticipants.has(admission.b)) return false;
        playerIds.add(admission.matchId);
        playerParticipants.add(admission.a);
        playerParticipants.add(admission.b);
    }
    return true;
}

function serializePreparation(preparation: PetRankedPreparation): string {
    return JSON.stringify(preparation);
}

export function parsePetRankedPreparation(raw: unknown): PetRankedPreparation | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PREPARATION_BYTES) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        return validPreparation(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function parsePetRankedSeasonGate(raw: unknown): PetRankedSeasonGate | null {
    // In-place migration for the short-lived pet-only v1 authority. The raw
    // bytes remain the CAS expectation; the next successful mutation writes
    // the unified shape.
    if (isRecord(raw)) {
        const playerAdmissions = Array.isArray(raw.playerAdmissions)
            ? raw.playerAdmissions.map((entry) => (
                isRecord(entry) && !Object.hasOwn(entry, 'sessionPublishedAt')
                    ? { ...entry, sessionPublishedAt: null }
                    : entry
            ))
            : [];
        const migrated = { ...raw, playerAdmissions };
        return validGate(migrated) ? migrated : null;
    }
    return null;
}

export function petRankedPreparationKey(matchId: string): string {
    return `${PET_RANKED_PREPARATION_PREFIX}${matchId}`;
}

export function makePetRankedPreparation(
    token: ServerResolvedPetRankedToken,
    season: { seasonId: number; epoch: number },
): PetRankedPreparation {
    const names = [safeName(token.a), safeName(token.b)].sort();
    const preparation: PetRankedPreparation = {
        version: PET_RANKED_PREPARATION_VERSION,
        matchId: token.matchId,
        a: names[0],
        b: names[1],
        seed: token.seed,
        createdAt: token.createdAt,
        seasonId: season.seasonId,
        seasonEpoch: season.epoch,
        tokenFingerprint: petRankedTokenFingerprint(token),
        token,
    };
    if (!validPreparation(preparation)) throw new Error('pet-ranked-preparation-invalid');
    return preparation;
}

async function putImmutablePreparation(store: PreparationStore, preparation: PetRankedPreparation): Promise<void> {
    const key = petRankedPreparationKey(preparation.matchId);
    const raw = serializePreparation(preparation);
    try {
        const written = await store.set(key, raw, { nx: true });
        if (written === 'OK') return;
    } catch (error) {
        if (await store.get<string>(key).catch(() => null) === raw) return;
        throw error;
    }
    if (await store.get<string>(key) === raw) return;
    throw new Error('pet-ranked-preparation-conflict');
}

async function readGate(store: Pick<KvLike, 'get'>): Promise<{ raw: unknown; gate: PetRankedSeasonGate } | null> {
    const raw = await store.get<unknown>(PET_RANKED_SEASON_GATE_KEY);
    if (raw === null) return null;
    const gate = parsePetRankedSeasonGate(raw);
    if (!gate) throw new Error('pet-ranked-season-gate-invalid');
    return { raw, gate };
}

/** Exact no-op CAS turns a possibly cached read into a verified current read. */
export async function readPetRankedSeasonGateFresh(
    store: Pick<KvLike, 'get' | 'compareSet'>,
): Promise<PetRankedSeasonGate | null> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const stored = await readGate(store);
        if (!stored) return null;
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, stored.raw)) return stored.gate;
        } catch (error) {
            const recovered = await store.get<unknown>(PET_RANKED_SEASON_GATE_KEY).catch(() => null);
            if (isDeepStrictEqual(recovered, stored.raw)) return stored.gate;
            throw error;
        }
    }
    throw new Error('pet-ranked-season-gate-busy');
}

export async function ensurePetRankedSeasonGate(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    seasonId: number,
    now = Date.now(),
): Promise<PetRankedSeasonGate> {
    if (!safePositiveInt(seasonId)) throw new Error('pet-ranked-season-invalid');
    const changedAt = Math.max(1, Math.floor(Number(now) || Date.now()));
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const stored = await readGate(store);
        if (stored) {
            if (stored.gate.seasonId === seasonId) return stored.gate;
            throw new Error('pet-ranked-season-gate-epoch-conflict');
        }
        const initial: PetRankedSeasonGate = {
            version: PET_RANKED_SEASON_GATE_VERSION,
            state: 'open',
            seasonId,
            epoch: seasonId,
            transitionId: null,
            nextSeasonId: null,
            changedAt,
            admissions: [],
            playerAdmissions: [],
        };
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, null, initial)) return initial;
        } catch (error) {
            const recovered = await store.get<unknown>(PET_RANKED_SEASON_GATE_KEY).catch(() => null);
            if (isDeepStrictEqual(recovered, initial)) return initial;
            throw error;
        }
    }
    throw new Error('pet-ranked-season-gate-busy');
}

export function makePlayerRankedAdmission(input: {
    matchId: string;
    a: string;
    b: string;
    aLevel: number;
    bLevel: number;
    aRating: number;
    bRating: number;
    createdAt: number;
    seasonId: number;
    seasonEpoch: number;
}): PlayerRankedAdmission {
    const [a, b] = [safeName(input.a), safeName(input.b)].sort();
    const inputA = safeName(input.a);
    const admission: PlayerRankedAdmission = {
        version: PLAYER_RANKED_ADMISSION_VERSION,
        matchId: input.matchId,
        a,
        b,
        aLevel: Math.max(1, Math.floor(a === inputA ? input.aLevel : input.bLevel)),
        bLevel: Math.max(1, Math.floor(a === inputA ? input.bLevel : input.aLevel)),
        aRating: Math.max(0, Number(a === inputA ? input.aRating : input.bRating)),
        bRating: Math.max(0, Number(a === inputA ? input.bRating : input.aRating)),
        createdAt: Math.max(1, Math.floor(input.createdAt)),
        seasonId: input.seasonId,
        seasonEpoch: input.seasonEpoch,
        phase: 'queued',
        battleId: null,
        activatedAt: null,
        terminalAt: null,
        sessionPublishedAt: null,
        cancelledAt: null,
        winner: null,
        rankedEligible: null,
        terminalFingerprint: null,
    };
    if (!validPlayerAdmission(admission)) throw new Error('player-ranked-admission-invalid');
    return admission;
}

/** Queue mint and season close serialize on this exact CAS. */
export async function reservePlayerRankedAdmission(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    admission: PlayerRankedAdmission,
): Promise<PlayerRankedAdmission> {
    if (!validPlayerAdmission(admission) || admission.phase !== 'queued') {
        throw new Error('player-ranked-admission-invalid');
    }
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored
            || stored.gate.state !== 'open'
            || stored.gate.seasonId !== admission.seasonId
            || stored.gate.epoch !== admission.seasonEpoch) {
            throw new Error('player-ranked-season-admission-closed');
        }
        const exact = stored.gate.playerAdmissions.find((entry) => entry.matchId === admission.matchId);
        if (exact) {
            if (!isDeepStrictEqual(exact, admission)) throw new Error('player-ranked-admission-conflict');
            return exact;
        }
        const occupied = stored.gate.playerAdmissions.find((entry) => (
            entry.a === admission.a || entry.a === admission.b
            || entry.b === admission.a || entry.b === admission.b
        ));
        if (occupied) throw new Error('player-ranked-player-already-admitted');
        if (stored.gate.admissions.length + stored.gate.playerAdmissions.length >= MAX_GATE_ADMISSIONS) {
            throw new Error('ranked-season-admission-capacity');
        }
        const next: PetRankedSeasonGate = {
            ...stored.gate,
            playerAdmissions: [...stored.gate.playerAdmissions, admission]
                .sort((left, right) => left.matchId.localeCompare(right.matchId)),
        };
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) return admission;
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            const won = recovered?.gate.playerAdmissions.find((entry) => entry.matchId === admission.matchId);
            if (won && isDeepStrictEqual(won, admission)) return won;
            throw error;
        }
    }
    throw new Error('player-ranked-season-gate-busy');
}

export async function findPlayerRankedAdmissionForPlayer(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    playerName: string,
): Promise<PlayerRankedAdmission | null> {
    const player = safeName(playerName);
    if (!player) return null;
    const gate = await readPetRankedSeasonGateFresh(store);
    const matches = gate?.playerAdmissions.filter((entry) => entry.a === player || entry.b === player) ?? [];
    if (matches.length > 1) throw new Error('player-ranked-player-admission-conflict');
    return matches[0] ?? null;
}

export async function getPlayerRankedAdmission(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    matchId: string,
): Promise<PlayerRankedAdmission | null> {
    if (!isPlayerRankedMatchId(matchId)) return null;
    const gate = await readPetRankedSeasonGateFresh(store);
    return gate?.playerAdmissions.find((entry) => entry.matchId === matchId) ?? null;
}

/**
 * Release a queue-only capability after leave/decline/expiry. Active or
 * terminal matches can never be erased through this path. During season close,
 * the close runner owns cancellation and its durable no-contest evidence.
 */
export async function releaseQueuedPlayerRankedAdmission(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    matchId: string,
    participant: string,
): Promise<boolean> {
    const player = safeName(participant);
    if (!isPlayerRankedMatchId(matchId) || !player) return false;
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored || stored.gate.state !== 'open') return false;
        const admission = stored.gate.playerAdmissions.find((entry) => entry.matchId === matchId);
        if (!admission) return true;
        if (admission.a !== player && admission.b !== player) {
            throw new Error('player-ranked-admission-participant-conflict');
        }
        if (admission.phase !== 'queued') return false;
        const next = {
            ...stored.gate,
            playerAdmissions: stored.gate.playerAdmissions.filter((entry) => entry.matchId !== matchId),
        };
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) return true;
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            if (recovered && !recovered.gate.playerAdmissions.some((entry) => entry.matchId === matchId)) return true;
            throw error;
        }
    }
    throw new Error('player-ranked-season-gate-busy');
}

/** One-CAS deployment/traffic cleanup for expired queue-only capabilities. */
export async function releaseExpiredQueuedPlayerRankedAdmissions(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    cutoff: number,
): Promise<PlayerRankedAdmission[]> {
    const boundedCutoff = Math.max(1, Math.floor(cutoff));
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored || stored.gate.state !== 'open') return [];
        const expired = stored.gate.playerAdmissions.filter((entry) => (
            entry.phase === 'queued' && entry.createdAt < boundedCutoff
        ));
        if (expired.length === 0) return [];
        const expiredIds = new Set(expired.map((entry) => entry.matchId));
        const next = {
            ...stored.gate,
            playerAdmissions: stored.gate.playerAdmissions.filter((entry) => !expiredIds.has(entry.matchId)),
        };
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) return expired;
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            if (recovered && [...expiredIds].every((matchId) => (
                !recovered.gate.playerAdmissions.some((entry) => entry.matchId === matchId)
            ))) return expired;
            throw error;
        }
    }
    throw new Error('player-ranked-season-gate-busy');
}

export async function activatePlayerRankedAdmission(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    matchId: string,
    battleId: string,
    now = Date.now(),
): Promise<PlayerRankedAdmission> {
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored || stored.gate.state !== 'open') throw new Error('player-ranked-season-admission-closed');
        const current = stored.gate.playerAdmissions.find((entry) => entry.matchId === matchId);
        if (!current) throw new Error('player-ranked-admission-missing');
        if (current.phase === 'active' && current.battleId === battleId) return current;
        if (current.phase !== 'queued') throw new Error('player-ranked-admission-not-queued');
        const active: PlayerRankedAdmission = {
            ...current,
            phase: 'active',
            battleId,
            activatedAt: Math.max(1, Math.floor(now)),
        };
        if (!validPlayerAdmission(active)) throw new Error('player-ranked-admission-invalid');
        const next = {
            ...stored.gate,
            playerAdmissions: stored.gate.playerAdmissions.map((entry) => (
                entry.matchId === matchId ? active : entry
            )),
        };
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) return active;
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            const won = recovered?.gate.playerAdmissions.find((entry) => entry.matchId === matchId);
            if (won && isDeepStrictEqual(won, active)) return won;
            throw error;
        }
    }
    throw new Error('player-ranked-season-gate-busy');
}

/**
 * Fence session publication/reconstruction against orphan cleanup. A missing
 * session retry touches this gate row before rebuilding, so a cleanup CAS based
 * on an older heartbeat cannot cancel a battle that is being recovered.
 */
export async function markPlayerRankedSessionPublished(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    matchId: string,
    battleId: string,
    now = Date.now(),
): Promise<PlayerRankedAdmission> {
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored || stored.gate.state !== 'open') throw new Error('player-ranked-season-admission-closed');
        const current = stored.gate.playerAdmissions.find((entry) => entry.matchId === matchId);
        if (!current || current.phase !== 'active' || current.battleId !== battleId) {
            throw new Error('player-ranked-admission-session-conflict');
        }
        const published: PlayerRankedAdmission = {
            ...current,
            sessionPublishedAt: Math.max(1, Math.floor(now)),
        };
        const next = {
            ...stored.gate,
            playerAdmissions: stored.gate.playerAdmissions.map((entry) => (
                entry.matchId === matchId ? published : entry
            )),
        };
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) return published;
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            const won = recovered?.gate.playerAdmissions.find((entry) => entry.matchId === matchId);
            if (won && isDeepStrictEqual(won, published)) return won;
            throw error;
        }
    }
    throw new Error('player-ranked-season-gate-busy');
}

/**
 * Cancel old active admissions whose exact session row is absent, plus exact V2
 * sessions that never acquired both join handshakes before the bounded join
 * deadline. In both cases an exact session CAS installs the same durable
 * no-contest tombstone before the gate cancellation, linearizing against a
 * paused publisher, join, or gameplay writer.
 */
export async function cancelExpiredOrphanPlayerRankedAdmissions(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    cutoff: number,
    now = Date.now(),
): Promise<PlayerRankedAdmission[]> {
    const boundedCutoff = Math.max(1, Math.floor(cutoff));
    const joinCutoff = Math.max(1, Math.floor(now - PLAYER_RANKED_JOIN_DEADLINE_MS));
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored || stored.gate.state !== 'open') return [];
        const durableCancelled = stored.gate.playerAdmissions.filter((entry) => entry.phase === 'cancelled');
        const candidates = stored.gate.playerAdmissions.filter((entry) => (
            entry.phase === 'active' && !!entry.battleId
        ));
        const orphanIds = new Set<string>();
        const cancelledAt = Math.max(1, Math.floor(now));
        for (const candidate of candidates) {
            const sessionKey = `pvp:${candidate.battleId}`;
            let session = await store.get<unknown>(sessionKey);
            const tombstone = makePlayerRankedSessionOrphanTombstone(candidate, cancelledAt);
            // A tombstone that already won remains cancellation authority even
            // if an overlapping recovery heartbeat refreshed the gate. This
            // prevents active+tombstone capacity stranding after the gate CAS
            // loses and the sweep loops.
            if (playerRankedOrphanTombstoneMatchesAdmission(session, candidate)) {
                orphanIds.add(candidate.matchId);
                continue;
            }
            const missingSessionStale = (candidate.sessionPublishedAt
                ?? candidate.activatedAt
                ?? candidate.createdAt) < boundedCutoff;
            const unjoinedExpired = expiredUnjoinedPlayerRankedV2Session(session, candidate, joinCutoff);
            if (!missingSessionStale && !unjoinedExpired) continue;
            if (session === null && missingSessionStale) {
                try {
                    if (await store.compareSet(sessionKey, null, tombstone, {
                        ex: PLAYER_RANKED_ORPHAN_TOMBSTONE_TTL_SECONDS,
                    })) {
                        session = tombstone;
                    } else {
                        session = await store.get<unknown>(sessionKey);
                    }
                } catch (error) {
                    const recovered = await store.get<unknown>(sessionKey).catch(() => null);
                    if (!isDeepStrictEqual(recovered, tombstone)) throw error;
                    session = recovered;
                }
            } else if (unjoinedExpired) {
                const expected = session;
                try {
                    if (await store.compareSet(sessionKey, expected, tombstone, {
                        ex: PLAYER_RANKED_ORPHAN_TOMBSTONE_TTL_SECONDS,
                    })) {
                        session = tombstone;
                    } else {
                        session = await store.get<unknown>(sessionKey);
                    }
                } catch (error) {
                    const recovered = await store.get<unknown>(sessionKey).catch(() => null);
                    if (!isDeepStrictEqual(recovered, tombstone)) throw error;
                    session = recovered;
                }
            }
            // The exact null/row -> tombstone CAS linearizes against the
            // creator's NX publication and every join/gameplay mutation. Once
            // it wins, gate cancellation can be retried after unrelated churn.
            if (playerRankedOrphanTombstoneMatchesAdmission(session, candidate)) {
                orphanIds.add(candidate.matchId);
            }
        }
        if (orphanIds.size === 0) return durableCancelled;
        const cancelled = stored.gate.playerAdmissions
            .filter((entry) => orphanIds.has(entry.matchId))
            .map((entry): PlayerRankedAdmission => ({ ...entry, phase: 'cancelled', cancelledAt }));
        const cancelledById = new Map(cancelled.map((entry) => [entry.matchId, entry]));
        const next = {
            ...stored.gate,
            playerAdmissions: stored.gate.playerAdmissions.map((entry) => (
                cancelledById.get(entry.matchId) ?? entry
            )),
        };
        const allCancelled = next.playerAdmissions.filter((entry) => entry.phase === 'cancelled');
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) return allCancelled;
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            if (recovered && cancelled.every((entry) => {
                const won = recovered.gate.playerAdmissions.find((candidate) => candidate.matchId === entry.matchId);
                return won?.phase === 'cancelled' && won.cancelledAt === cancelledAt;
            })) return recovered.gate.playerAdmissions.filter((entry) => entry.phase === 'cancelled');
            throw error;
        }
    }
    throw new Error('player-ranked-season-gate-busy');
}

export async function markPlayerRankedAdmissionTerminal(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    matchId: string,
    battleId: string,
    terminalInput: {
        winner: 'a' | 'b' | 'draw';
        rankedEligible: boolean;
        terminalAt: number;
        terminalFingerprint: string;
    },
): Promise<PlayerRankedAdmission> {
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored) throw new Error('player-ranked-season-gate-missing');
        const current = stored.gate.playerAdmissions.find((entry) => entry.matchId === matchId);
        if (!current) throw new Error('player-ranked-admission-missing');
        if (current.phase === 'terminal' && current.battleId === battleId) {
            if (current.terminalFingerprint !== terminalInput.terminalFingerprint
                || current.winner !== terminalInput.winner
                || current.rankedEligible !== terminalInput.rankedEligible) {
                throw new Error('player-ranked-admission-terminal-conflict');
            }
            return current;
        }
        if (current.phase !== 'active' || current.battleId !== battleId) {
            throw new Error(current.phase === 'cancelled'
                ? 'player-ranked-admission-cancelled'
                : 'player-ranked-admission-terminal-conflict');
        }
        const terminalAdmission: PlayerRankedAdmission = {
            ...current,
            phase: 'terminal',
            terminalAt: Math.max(1, Math.floor(terminalInput.terminalAt)),
            winner: terminalInput.winner,
            rankedEligible: terminalInput.rankedEligible,
            terminalFingerprint: terminalInput.terminalFingerprint,
        };
        const next = {
            ...stored.gate,
            playerAdmissions: stored.gate.playerAdmissions.map((entry) => (
                entry.matchId === matchId ? terminalAdmission : entry
            )),
        };
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) return terminalAdmission;
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            const won = recovered?.gate.playerAdmissions.find((entry) => entry.matchId === matchId);
            if (won && isDeepStrictEqual(won, terminalAdmission)) return won;
            throw error;
        }
    }
    throw new Error('player-ranked-season-gate-busy');
}

/** Closing chooses no-contest for every match that has not terminalized. */
export async function cancelNonterminalPlayerRankedAdmissions(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    closing: Pick<PetRankedSeasonGate, 'seasonId' | 'epoch' | 'transitionId'>,
    now = Date.now(),
): Promise<PlayerRankedAdmission[]> {
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored
            || stored.gate.state !== 'closing'
            || stored.gate.seasonId !== closing.seasonId
            || stored.gate.epoch !== closing.epoch
            || stored.gate.transitionId !== closing.transitionId) {
            throw new Error('ranked-season-transition-authority-changed');
        }
        const pending = stored.gate.playerAdmissions.filter((entry) => (
            entry.phase === 'queued' || entry.phase === 'active'
        ));
        if (pending.length === 0) {
            return stored.gate.playerAdmissions.filter((entry) => entry.phase === 'cancelled');
        }
        for (const active of pending.filter((entry) => entry.phase === 'active')) {
            const session = active.battleId
                ? await store.get<unknown>(`pvp:${active.battleId}`)
                : null;
            if (!playerRankedSessionIsFencedForClose(session, active, String(closing.transitionId ?? ''))) {
                throw new Error('player-ranked-active-cancellation-unfenced');
            }
        }
        const cancelledAt = Math.max(1, Math.floor(now));
        const nextAdmissions = stored.gate.playerAdmissions.map((entry): PlayerRankedAdmission => (
            entry.phase === 'queued' || entry.phase === 'active'
                ? { ...entry, phase: 'cancelled', cancelledAt }
                : entry
        ));
        const next = { ...stored.gate, playerAdmissions: nextAdmissions };
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) {
                return nextAdmissions.filter((entry) => entry.phase === 'cancelled');
            }
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            if (recovered?.gate.playerAdmissions.every((entry) => (
                entry.phase !== 'queued' && entry.phase !== 'active'
            ))) return recovered.gate.playerAdmissions.filter((entry) => entry.phase === 'cancelled');
            throw error;
        }
    }
    throw new Error('player-ranked-season-gate-busy');
}

export async function completePlayerRankedAdmission(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    admission: PlayerRankedAdmission,
): Promise<void> {
    if (admission.phase !== 'terminal' && admission.phase !== 'cancelled') {
        throw new Error('player-ranked-admission-not-complete');
    }
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored) throw new Error('player-ranked-season-gate-missing');
        const current = stored.gate.playerAdmissions.find((entry) => entry.matchId === admission.matchId);
        if (!current) return;
        if (!isDeepStrictEqual(current, admission)) throw new Error('player-ranked-admission-conflict');
        const next = {
            ...stored.gate,
            playerAdmissions: stored.gate.playerAdmissions.filter((entry) => entry.matchId !== admission.matchId),
        };
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) return;
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            if (recovered && !recovered.gate.playerAdmissions.some((entry) => entry.matchId === admission.matchId)) return;
            throw error;
        }
    }
    throw new Error('player-ranked-season-gate-busy');
}

/** Atomically register the complete preparation in the open season epoch. */
export async function reservePetRankedPreparation(
    store: PreparationStore,
    preparation: PetRankedPreparation,
): Promise<PetRankedPreparation> {
    if (!validPreparation(preparation)) throw new Error('pet-ranked-preparation-invalid');
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored
            || stored.gate.state !== 'open'
            || stored.gate.seasonId !== preparation.seasonId
            || stored.gate.epoch !== preparation.seasonEpoch) {
            throw new Error('pet-ranked-season-admission-closed');
        }
        const existing = stored.gate.admissions.find((entry) => entry.matchId === preparation.matchId);
        if (existing) {
            if (existing.a !== preparation.a
                || existing.b !== preparation.b
                || existing.seasonId !== preparation.seasonId
                || existing.seasonEpoch !== preparation.seasonEpoch) {
                throw new Error('pet-ranked-preparation-conflict');
            }
            // Concurrent starters may generate different candidate seeds. The
            // one complete preparation that won the gate CAS is authoritative;
            // every loser helps that exact seed/token forward.
            await putImmutablePreparation(store, existing);
            return existing;
        }
        if (stored.gate.admissions.length + stored.gate.playerAdmissions.length >= MAX_GATE_ADMISSIONS) {
            throw new Error('pet-ranked-season-admission-capacity');
        }
        if (stored.gate.admissions.some((entry) => (
            entry.a === preparation.a || entry.a === preparation.b
            || entry.b === preparation.a || entry.b === preparation.b
        ))) {
            throw new Error('pet-ranked-player-already-prepared');
        }
        const next: PetRankedSeasonGate = {
            ...stored.gate,
            admissions: [...stored.gate.admissions, preparation]
                .sort((a, b) => a.matchId.localeCompare(b.matchId)),
        };
        if (!validGate(next)) throw new Error('pet-ranked-season-gate-invalid');
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) {
                await putImmutablePreparation(store, preparation);
                return preparation;
            }
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            const admitted = recovered?.gate.admissions.find((entry) => entry.matchId === preparation.matchId);
            if (admitted && isDeepStrictEqual(admitted, preparation)) {
                await putImmutablePreparation(store, preparation);
                return preparation;
            }
            throw error;
        }
    }
    throw new Error('pet-ranked-season-gate-busy');
}

/** Gate admission can reconstruct an immutable row lost before acknowledgement. */
export async function loadPetRankedPreparation(
    store: PreparationStore,
    matchId: string,
): Promise<PetRankedPreparation | null> {
    if (!isPetRankedMatchId(matchId)) return null;
    const key = petRankedPreparationKey(matchId);
    const raw = await store.get<unknown>(key);
    if (raw !== null) {
        const parsed = parsePetRankedPreparation(raw);
        if (!parsed || parsed.matchId !== matchId) throw new Error('pet-ranked-preparation-invalid');
        return parsed;
    }
    const gate = await readPetRankedSeasonGateFresh(store);
    const admitted = gate?.admissions.find((entry) => entry.matchId === matchId) ?? null;
    if (!admitted) return null;
    await putImmutablePreparation(store, admitted);
    return admitted;
}

export async function findPetRankedPreparationForPlayer(
    store: PreparationStore,
    playerName: string,
): Promise<PetRankedPreparation | null> {
    const player = safeName(playerName);
    if (!player) return null;
    const gate = await readPetRankedSeasonGateFresh(store);
    const matches = gate?.admissions.filter((entry) => entry.a === player || entry.b === player) ?? [];
    if (matches.length > 1) throw new Error('pet-ranked-player-preparation-conflict');
    if (!matches[0]) return null;
    await putImmutablePreparation(store, matches[0]);
    return matches[0];
}

export async function assertPetRankedPreparationAdmitted(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    preparation: PetRankedPreparation,
): Promise<void> {
    const gate = await readPetRankedSeasonGateFresh(store);
    const admitted = gate?.admissions.find((entry) => entry.matchId === preparation.matchId);
    if (!admitted || !isDeepStrictEqual(admitted, preparation)) {
        throw new Error('pet-ranked-preparation-no-longer-admitted');
    }
}

export async function closePetRankedSeasonGate(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    seasonId: number,
    now = Date.now(),
): Promise<PetRankedSeasonGate> {
    const gate = await ensurePetRankedSeasonGate(store, seasonId, now);
    const transitionId = `ranked-season-${gate.seasonId}-${gate.epoch}`;
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored) throw new Error('pet-ranked-season-gate-missing');
        if (stored.gate.state === 'closing') {
            if (stored.gate.transitionId !== transitionId) throw new Error('pet-ranked-season-transition-conflict');
            return stored.gate;
        }
        if (stored.gate.seasonId !== seasonId || stored.gate.epoch !== gate.epoch) {
            throw new Error('pet-ranked-season-gate-epoch-conflict');
        }
        const next: PetRankedSeasonGate = {
            ...stored.gate,
            state: 'closing',
            transitionId,
            nextSeasonId: seasonId + 1,
            changedAt: Math.max(1, Math.floor(Number(now) || Date.now())),
        };
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) return next;
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            if (recovered?.gate.transitionId === transitionId && recovered.gate.state === 'closing') return recovered.gate;
            throw error;
        }
    }
    throw new Error('pet-ranked-season-gate-busy');
}

async function retainPreparationBounded(store: PreparationStore, preparation: PetRankedPreparation): Promise<void> {
    const key = petRankedPreparationKey(preparation.matchId);
    const raw = serializePreparation(preparation);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            if (await store.compareSet(key, raw, raw, { ex: PET_RANKED_REPLAY_TTL_SECONDS })) return;
        } catch (error) {
            lastError = error;
        }
        if (await store.get<string>(key).catch(() => null) !== raw) throw new Error('pet-ranked-preparation-conflict');
    }
    if (lastError) throw lastError;
    throw new Error('pet-ranked-preparation-retention-unconfirmed');
}

/** Completion evidence is durable before the admission is removed. */
export async function completePetRankedPreparation(
    store: PreparationStore,
    preparation: PetRankedPreparation,
): Promise<void> {
    await retainPreparationBounded(store, preparation);
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored) throw new Error('pet-ranked-season-gate-missing');
        const existing = stored.gate.admissions.find((entry) => entry.matchId === preparation.matchId);
        if (!existing) return;
        if (!isDeepStrictEqual(existing, preparation)) throw new Error('pet-ranked-preparation-conflict');
        const next: PetRankedSeasonGate = {
            ...stored.gate,
            admissions: stored.gate.admissions.filter((entry) => entry.matchId !== preparation.matchId),
        };
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) return;
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            if (recovered && !recovered.gate.admissions.some((entry) => entry.matchId === preparation.matchId)) return;
            throw error;
        }
    }
    throw new Error('pet-ranked-season-gate-busy');
}

export async function reopenPetRankedSeasonGate(
    store: Pick<KvLike, 'get' | 'compareSet'>,
    completedSeasonId: number,
    nextSeasonId: number,
    now = Date.now(),
): Promise<PetRankedSeasonGate> {
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const stored = await readGate(store);
        if (!stored) throw new Error('pet-ranked-season-gate-missing');
        if (stored.gate.state === 'open' && stored.gate.seasonId === nextSeasonId) return stored.gate;
        if (stored.gate.state !== 'closing'
            || stored.gate.seasonId !== completedSeasonId
            || stored.gate.nextSeasonId !== nextSeasonId
            || stored.gate.admissions.length !== 0
            || stored.gate.playerAdmissions.length !== 0) {
            throw new Error('pet-ranked-season-reopen-blocked');
        }
        const next: PetRankedSeasonGate = {
            version: PET_RANKED_SEASON_GATE_VERSION,
            state: 'open',
            seasonId: nextSeasonId,
            epoch: stored.gate.epoch + 1,
            transitionId: null,
            nextSeasonId: null,
            changedAt: Math.max(1, Math.floor(Number(now) || Date.now())),
            admissions: [],
            playerAdmissions: [],
        };
        try {
            if (await store.compareSet(PET_RANKED_SEASON_GATE_KEY, stored.raw, next)) return next;
        } catch (error) {
            const recovered = await readGate(store).catch(() => null);
            if (recovered?.gate.state === 'open' && recovered.gate.seasonId === nextSeasonId) return recovered.gate;
            throw error;
        }
    }
    throw new Error('pet-ranked-season-gate-busy');
}

export async function listPetRankedPreparations(store: PreparationStore): Promise<PetRankedPreparation[]> {
    const keys = await store.keys(`${PET_RANKED_PREPARATION_PREFIX}*`);
    const out: PetRankedPreparation[] = [];
    for (const key of keys) {
        const matchId = key.slice(PET_RANKED_PREPARATION_PREFIX.length);
        if (!isPetRankedMatchId(matchId)) continue;
        const preparation = await loadPetRankedPreparation(store, matchId);
        if (preparation) out.push(preparation);
    }
    return out;
}

export function rankedSeasonTransitionFingerprint(gate: PetRankedSeasonGate): string {
    return createHash('sha256').update(JSON.stringify({
        version: gate.version,
        seasonId: gate.seasonId,
        epoch: gate.epoch,
        transitionId: gate.transitionId,
        nextSeasonId: gate.nextSeasonId,
        changedAt: gate.changedAt,
    })).digest('hex');
}
