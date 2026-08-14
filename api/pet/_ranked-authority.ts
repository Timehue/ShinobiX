import { safeName } from '../_utils.js';

/** Shared queue/match authority for ranked pet battles. */
export const PET_RANKED_QUEUE_KEY = 'pvp:pet-ranked-queue';
export const PET_RANKED_QUEUE_MATCH_TTL_SECONDS = 30;
export const PET_RANKED_TOKEN_TTL_SECONDS = 15 * 60;
export const PET_RANKED_ACTIVE_REGISTRY_KEY = 'pet:ranked-active';
export const PET_RANKED_AUTHORITY = 'pet-ranked-queue-v1' as const;

export const petRankedQueueMatchKey = (name: string) => `${PET_RANKED_QUEUE_KEY}:match:${safeName(name)}`;
export const petRankedStartClaimKey = (pairId: string) => `pet:ranked-start-claim:${pairId}`;
export const petRankedSettlementIntentKey = (matchToken: string) => `pet:ranked-intent:${matchToken}`;

export type PetRankedQueueMatch = {
    opponent: string;
    opponentElo: number;
    opponentLevel: number;
    initiator: boolean;
    createdAt: number;
    pairId: string;
};

export type RankedPetMatchToken = {
    authority: typeof PET_RANKED_AUTHORITY;
    pairId: string;
    a: string;
    b: string;
    aRating: number;
    bRating: number;
    aPet: Record<string, unknown>;
    bPet: Record<string, unknown>;
    seed: number;
    createdAt: number;
    settledAt?: number;
};

export type RankedPetActivePointer = {
    matchToken: string;
    pairId: string;
    opponent: string;
    initiator: boolean;
    createdAt: number;
    expiresAt: number;
};

export type RankedPetActiveRegistry = Record<string, RankedPetActivePointer>;

export type RankedPetStartClaim = {
    version: 1;
    matchToken: string;
    pairId: string;
    token: RankedPetMatchToken;
    expiresAt: number;
};

export type RankedPetSettlementIntent = {
    version: 1;
    matchToken: string;
    token: RankedPetMatchToken;
    winnerName: string | null;
    createdAt: number;
};

export function isPetRankedQueueMatch(value: unknown): value is PetRankedQueueMatch {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const match = value as Partial<PetRankedQueueMatch>;
    return !!safeName(match.opponent ?? '')
        && typeof match.initiator === 'boolean'
        && typeof match.pairId === 'string'
        && /^[0-9a-f-]{36}$/i.test(match.pairId)
        && Number.isFinite(Number(match.createdAt));
}

export function isRankedPetMatchToken(value: unknown): value is RankedPetMatchToken {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const token = value as Partial<RankedPetMatchToken>;
    return token.authority === PET_RANKED_AUTHORITY
        && typeof token.pairId === 'string'
        && /^[0-9a-f-]{36}$/i.test(token.pairId)
        && !!safeName(token.a ?? '')
        && !!safeName(token.b ?? '')
        && safeName(token.a ?? '') !== safeName(token.b ?? '')
        && Number.isFinite(Number(token.aRating))
        && Number.isFinite(Number(token.bRating))
        && !!token.aPet && typeof token.aPet === 'object' && !Array.isArray(token.aPet)
        && !!token.bPet && typeof token.bPet === 'object' && !Array.isArray(token.bPet)
        && Number.isSafeInteger(token.seed)
        && Number.isFinite(Number(token.createdAt));
}

export function isRankedPetStartClaim(value: unknown): value is RankedPetStartClaim {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const claim = value as Partial<RankedPetStartClaim>;
    return claim.version === 1
        && typeof claim.matchToken === 'string'
        && /^[0-9a-f-]{36}$/i.test(claim.matchToken)
        && typeof claim.pairId === 'string'
        && Number.isFinite(Number(claim.expiresAt))
        && isRankedPetMatchToken(claim.token)
        && claim.token.pairId === claim.pairId;
}

export function isRankedPetSettlementIntent(value: unknown): value is RankedPetSettlementIntent {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const intent = value as Partial<RankedPetSettlementIntent>;
    return intent.version === 1
        && typeof intent.matchToken === 'string'
        && /^[0-9a-f-]{36}$/i.test(intent.matchToken)
        && isRankedPetMatchToken(intent.token)
        && (intent.winnerName === null || intent.winnerName === intent.token.a || intent.winnerName === intent.token.b)
        && Number.isFinite(Number(intent.createdAt));
}

export function pruneRankedPetActiveRegistry(value: unknown, now = Date.now()): RankedPetActiveRegistry {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: RankedPetActiveRegistry = {};
    for (const [rawName, rawPointer] of Object.entries(value as Record<string, unknown>)) {
        const name = safeName(rawName);
        if (!name || !rawPointer || typeof rawPointer !== 'object' || Array.isArray(rawPointer)) continue;
        const pointer = rawPointer as Partial<RankedPetActivePointer>;
        if (typeof pointer.matchToken !== 'string' || !/^[0-9a-f-]{36}$/i.test(pointer.matchToken)) continue;
        if (typeof pointer.pairId !== 'string' || !/^[0-9a-f-]{36}$/i.test(pointer.pairId)) continue;
        const opponent = safeName(pointer.opponent ?? '');
        if (!opponent || opponent === name || typeof pointer.initiator !== 'boolean') continue;
        const expiresAt = Number(pointer.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
        out[name] = {
            matchToken: pointer.matchToken,
            pairId: pointer.pairId,
            opponent,
            initiator: pointer.initiator,
            createdAt: Number(pointer.createdAt) || now,
            expiresAt,
        };
    }
    return out;
}
