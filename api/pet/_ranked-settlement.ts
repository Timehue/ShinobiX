import { safeName } from '../_utils.js';

export const PET_RANKED_DISABLED_REASON = 'ranked-pet-server-authority-required';

/**
 * Ranked pet starts stay disabled until a server-side combat engine can produce
 * this resolution and seal it in the private match-token record. An environment
 * toggle cannot make a client-computed winner authoritative.
 */
export function petRankedStartsEnabled(): boolean {
    return false;
}

export interface ServerResolvedPetRankedToken {
    a: string;
    b: string;
    aRating: number;
    bRating: number;
    createdAt: number;
    resolution?: {
        authority: 'server-engine-v1';
        winner: 'a' | 'b';
        resolvedAt: number;
        /** Digest/version emitted by the future deterministic server engine. */
        engineDigest: string;
    };
}

export type PetRankedSettlement = {
    callerRole: 'winner' | 'loser';
    authoritativeOutcome: 'win' | 'loss';
    winnerName: string;
    loserName: string;
    winnerRating: number;
    loserRating: number;
};

export type PetRankedSettlementDecision =
    | { ok: true; settlement: PetRankedSettlement }
    | {
        ok: false;
        reason: 'server-resolution-required' | 'invalid-server-resolution' | 'caller-not-in-match' | 'conflicting-client-outcome';
    };

/**
 * Derive the settlement exclusively from a private, server-resolved token.
 * `reportedOutcome` is never an input to winner selection; it is only checked
 * so a stale/conflicting client gets a clear 409 instead of silently showing the
 * opposite result.
 */
export function derivePetRankedSettlement(
    token: ServerResolvedPetRankedToken,
    callerName: string,
    reportedOutcome: 'win' | 'loss',
): PetRankedSettlementDecision {
    const resolution = token?.resolution;
    if (!resolution || resolution.authority !== 'server-engine-v1') {
        return { ok: false, reason: 'server-resolution-required' };
    }
    if ((resolution.winner !== 'a' && resolution.winner !== 'b')
        || !Number.isFinite(resolution.resolvedAt)
        || resolution.resolvedAt < token.createdAt
        || typeof resolution.engineDigest !== 'string'
        || resolution.engineDigest.length < 16) {
        return { ok: false, reason: 'invalid-server-resolution' };
    }

    const a = safeName(token.a);
    const b = safeName(token.b);
    const caller = safeName(callerName);
    if (!a || !b || a === b || (caller !== a && caller !== b)) {
        return { ok: false, reason: 'caller-not-in-match' };
    }
    const aRating = Number(token.aRating);
    const bRating = Number(token.bRating);
    if (!Number.isFinite(aRating) || !Number.isFinite(bRating)) {
        return { ok: false, reason: 'invalid-server-resolution' };
    }

    const winnerName = resolution.winner === 'a' ? a : b;
    const loserName = resolution.winner === 'a' ? b : a;
    const winnerRating = resolution.winner === 'a' ? aRating : bRating;
    const loserRating = resolution.winner === 'a' ? bRating : aRating;
    const authoritativeOutcome: 'win' | 'loss' = caller === winnerName ? 'win' : 'loss';
    if (reportedOutcome !== authoritativeOutcome) {
        return { ok: false, reason: 'conflicting-client-outcome' };
    }

    return {
        ok: true,
        settlement: {
            callerRole: authoritativeOutcome === 'win' ? 'winner' : 'loser',
            authoritativeOutcome,
            winnerName,
            loserName,
            winnerRating,
            loserRating,
        },
    };
}
