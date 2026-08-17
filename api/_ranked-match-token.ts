import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { kv, type KvLike } from './_storage.js';
import { safeName } from './_utils.js';
import {
    getPlayerRankedAdmission,
    isPlayerRankedMatchId,
    makePlayerRankedAdmission,
    PLAYER_RANKED_ADMISSION_TTL_MS,
    readPetRankedSeasonGateFresh,
    reservePlayerRankedAdmission,
    type PlayerRankedAdmission,
} from './pet/_ranked-preparation.js';
import { playerRankedV2AdmissionsEnabled } from './pvp/_player-ranked-rollout.js';

export type RankedLadder = 'player' | 'pet';
export const PLAYER_RANKED_TOKEN_VERSION = 'player-ranked-match-token-v2' as const;
const RANKED_TOKEN_TTL_SECONDS = 30 * 60;
const CURRENT_SEASON_KEY = 'ranked:season:current';

export type PlayerRankedMatchToken = {
    version: typeof PLAYER_RANKED_TOKEN_VERSION;
    matchId: string;
    a: string;
    b: string;
    seasonId: number;
    seasonEpoch: number;
    createdAt: number;
};

type TokenStore = Pick<KvLike, 'get' | 'set' | 'compareSet' | 'del'>;

type PetRankedMatchToken = {
    mintedAt: number;
    battleId?: string;
    consumedAt?: number;
};

function isPetRankedMatchToken(value: unknown): value is PetRankedMatchToken {
    if (!isRecord(value)
        || !Number.isSafeInteger(value.mintedAt)
        || Number(value.mintedAt) <= 0) return false;
    if (value.battleId === undefined && value.consumedAt === undefined) return true;
    return typeof value.battleId === 'string'
        && /^pvp-[0-9a-f-]{36}$/.test(value.battleId)
        && Number.isSafeInteger(value.consumedAt)
        && Number(value.consumedAt) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isPlayerRankedMatchToken(value: unknown): value is PlayerRankedMatchToken {
    if (!isRecord(value)) return false;
    if (Object.keys(value).sort().join('|') !== [
        'version', 'matchId', 'a', 'b', 'seasonId', 'seasonEpoch', 'createdAt',
    ].sort().join('|')) return false;
    return value.version === PLAYER_RANKED_TOKEN_VERSION
        && isPlayerRankedMatchId(value.matchId)
        && value.a === safeName(String(value.a))
        && value.b === safeName(String(value.b))
        && String(value.a) < String(value.b)
        && Number.isSafeInteger(value.seasonId)
        && Number(value.seasonId) > 0
        && Number.isSafeInteger(value.seasonEpoch)
        && Number(value.seasonEpoch) > 0
        && Number.isSafeInteger(value.createdAt)
        && Number(value.createdAt) > 0;
}

export function rankedMatchTokenKey(a: string, b: string, ladder: RankedLadder): string {
    const [lo, hi] = [safeName(a), safeName(b)].sort();
    return `pvp:ranked-match-token:${ladder}:${lo}:${hi}`;
}

/**
 * V2 player proofs intentionally live outside the legacy pair namespace. A
 * d76a worker blindly deletes any value at the old key before inspecting its
 * shape; a match-id key makes that old consumer incapable of spending or
 * reinterpreting a new season admission during a rolling deploy.
 */
export function playerRankedMatchTokenKey(matchId: string): string {
    if (!isPlayerRankedMatchId(matchId)) throw new Error('player-ranked-match-id-invalid');
    return `pvp:player-ranked-match-token-v2:${matchId}`;
}

function tokenFromAdmission(admission: PlayerRankedAdmission): PlayerRankedMatchToken {
    return {
        version: PLAYER_RANKED_TOKEN_VERSION,
        matchId: admission.matchId,
        a: admission.a,
        b: admission.b,
        seasonId: admission.seasonId,
        seasonEpoch: admission.seasonEpoch,
        createdAt: admission.createdAt,
    };
}

async function exactRead<T>(store: Pick<KvLike, 'get' | 'compareSet'>, key: string): Promise<T | null> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const value = await store.get<T>(key);
        if (value === null) return null;
        try {
            if (await store.compareSet(key, value, value, { ex: RANKED_TOKEN_TTL_SECONDS })) return value;
        } catch (error) {
            const recovered = await store.get<T>(key).catch(() => null);
            if (isDeepStrictEqual(recovered, value)) return value;
            throw error;
        }
    }
    throw new Error('player-ranked-token-busy');
}

async function materializePlayerToken(
    store: TokenStore,
    admission: PlayerRankedAdmission,
): Promise<PlayerRankedMatchToken> {
    const token = tokenFromAdmission(admission);
    const key = playerRankedMatchTokenKey(admission.matchId);
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const current = await store.get<unknown>(key);
        if (isDeepStrictEqual(current, token)) {
            await store.compareSet(key, current, current, { ex: RANKED_TOKEN_TTL_SECONDS });
            return token;
        }
        if (current !== null && !isPlayerRankedMatchToken(current)) {
            throw new Error('player-ranked-token-live-conflict');
        }
        try {
            if (await store.compareSet(key, current, token, { ex: RANKED_TOKEN_TTL_SECONDS })) return token;
        } catch (error) {
            const recovered = await store.get<unknown>(key).catch(() => null);
            if (isDeepStrictEqual(recovered, token)) return token;
            throw error;
        }
    }
    throw new Error('player-ranked-token-busy');
}

export async function mintPlayerRankedMatchTokenWithStore(
    store: TokenStore,
    input: {
        a: string;
        b: string;
        aLevel: number;
        bLevel: number;
        aRating: number;
        bRating: number;
        now?: number;
        matchId?: string;
    },
): Promise<PlayerRankedMatchToken> {
    const now = Math.max(1, Math.floor(input.now ?? Date.now()));
    const [gate, season] = await Promise.all([
        readPetRankedSeasonGateFresh(store),
        store.get<{ id?: unknown }>(CURRENT_SEASON_KEY),
    ]);
    if (!gate
        || gate.state !== 'open'
        || gate.seasonId !== Number(season?.id)) {
        throw new Error('player-ranked-season-admission-closed');
    }
    const admission = makePlayerRankedAdmission({
        matchId: input.matchId ?? `player-ranked-${randomUUID()}`,
        a: input.a,
        b: input.b,
        aLevel: input.aLevel,
        bLevel: input.bLevel,
        aRating: input.aRating,
        bRating: input.bRating,
        createdAt: now,
        seasonId: gate.seasonId,
        seasonEpoch: gate.epoch,
    });
    const admitted = await reservePlayerRankedAdmission(store, admission);
    return materializePlayerToken(store, admitted);
}

export async function mintPlayerRankedMatchToken(
    input: Parameters<typeof mintPlayerRankedMatchTokenWithStore>[1],
): Promise<PlayerRankedMatchToken> {
    if (!playerRankedV2AdmissionsEnabled()) throw new Error('player-ranked-v2-rollout-disabled');
    return mintPlayerRankedMatchTokenWithStore(kv, input);
}

export async function provePlayerRankedMatchTokenWithStore(
    store: TokenStore,
    input: { a: string; b: string; matchId: string },
): Promise<{ token: PlayerRankedMatchToken; admission: PlayerRankedAdmission } | null> {
    const [a, b] = [safeName(input.a), safeName(input.b)].sort();
    if (!a || !b || a === b || !isPlayerRankedMatchId(input.matchId)) return null;
    const key = playerRankedMatchTokenKey(input.matchId);
    const token = await exactRead<unknown>(store, key);
    if (!isPlayerRankedMatchToken(token)
        || token.matchId !== input.matchId
        || token.a !== a
        || token.b !== b) return null;
    const [gate, season] = await Promise.all([
        readPetRankedSeasonGateFresh(store),
        store.get<{ id?: unknown }>(CURRENT_SEASON_KEY),
    ]);
    const admission = gate?.playerAdmissions.find((entry) => entry.matchId === token.matchId) ?? null;
    if (!gate
        || gate.state !== 'open'
        || gate.seasonId !== Number(season?.id)
        || gate.seasonId !== token.seasonId
        || gate.epoch !== token.seasonEpoch
        || !admission
        || admission.phase !== 'queued'
        || Date.now() - admission.createdAt > PLAYER_RANKED_ADMISSION_TTL_MS
        || admission.a !== token.a
        || admission.b !== token.b) return null;
    return { token, admission };
}

export async function provePlayerRankedMatchToken(
    input: Parameters<typeof provePlayerRankedMatchTokenWithStore>[1],
): Promise<{ token: PlayerRankedMatchToken; admission: PlayerRankedAdmission } | null> {
    return provePlayerRankedMatchTokenWithStore(kv, input);
}

/** Legacy pet-PvP session proof; private pet ranked uses its own authority. */
export async function mintRankedMatchToken(a: string, b: string, ladder: RankedLadder): Promise<void> {
    if (ladder === 'player') throw new Error('use-mintPlayerRankedMatchToken');
    await kv.set(rankedMatchTokenKey(a, b, ladder), { mintedAt: Date.now() }, { ex: RANKED_TOKEN_TTL_SECONDS });
}

export async function proveRankedMatchTokenForBattleWithStore(
    store: Pick<TokenStore, 'get'>,
    a: string,
    b: string,
    ladder: RankedLadder,
    battleId: string,
): Promise<boolean> {
    if (ladder === 'player') throw new Error('use-provePlayerRankedMatchToken');
    const token = await store.get<unknown>(rankedMatchTokenKey(a, b, ladder));
    return isPetRankedMatchToken(token) && (token.battleId === undefined || token.battleId === battleId);
}

export async function consumeRankedMatchTokenForBattleWithStore(
    store: Pick<TokenStore, 'get' | 'compareSet'>,
    a: string,
    b: string,
    ladder: RankedLadder,
    battleId: string,
): Promise<boolean> {
    if (ladder === 'player') throw new Error('use-provePlayerRankedMatchToken');
    const key = rankedMatchTokenKey(a, b, ladder);
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const current = await store.get<unknown>(key);
        if (!isPetRankedMatchToken(current)) return false;
        if (current.battleId !== undefined) return current.battleId === battleId;
        const desired: PetRankedMatchToken = {
            mintedAt: current.mintedAt,
            battleId,
            consumedAt: Date.now(),
        };
        try {
            if (await store.compareSet(key, current, desired, { ex: RANKED_TOKEN_TTL_SECONDS })) return true;
        } catch (error) {
            const recovered = await store.get<unknown>(key).catch(() => null);
            if (isPetRankedMatchToken(recovered) && recovered.battleId === battleId) return true;
            throw error;
        }
    }
    throw new Error('pet-ranked-token-consume-busy');
}

export async function proveRankedMatchTokenForBattle(
    a: string,
    b: string,
    ladder: RankedLadder,
    battleId: string,
): Promise<boolean> {
    return proveRankedMatchTokenForBattleWithStore(kv, a, b, ladder, battleId);
}

export async function consumeRankedMatchTokenForBattle(
    a: string,
    b: string,
    ladder: RankedLadder,
    battleId: string,
): Promise<boolean> {
    return consumeRankedMatchTokenForBattleWithStore(kv, a, b, ladder, battleId);
}

/** @deprecated Only old callers may use destructive pair-token consumption. */
export async function consumeRankedMatchToken(a: string, b: string, ladder: RankedLadder): Promise<boolean> {
    if (ladder === 'player') throw new Error('use-provePlayerRankedMatchToken');
    return (await kv.del(rankedMatchTokenKey(a, b, ladder))) > 0;
}
