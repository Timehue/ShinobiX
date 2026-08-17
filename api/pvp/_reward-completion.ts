import type { KvLike } from '../_storage.js';

type RewardCompletionStore = Pick<KvLike, 'get' | 'set' | 'compareSet'>;
export type PvpRewardOutcome = 'win' | 'loss' | 'draw';

export type PvpRewardClaimReceipt = {
    version: 2;
    outcome: PvpRewardOutcome;
    claimedAt: number;
    /** Exact session generation whose pointer this receipt may clear. */
    sessionCreatedAt?: number;
    /** Absolute terminal recovery deadline for newly-created receipts. */
    expiresAt?: number;
    /** Whether a browser continuation ACK is required after server credits. */
    completionRequired?: boolean;
    completionState: 'pending' | 'completed';
    completedAt: number | null;
    /**
     * The browser may only ACK after every authoritative server-side credit has
     * durably landed. Older v2 rows omitted this field and are treated as
     * already-ready for compatibility; every newly-created row seals it.
     */
    serverCreditsState?: 'pending' | 'completed';
    serverCreditsCompletedAt?: number | null;
};

export type PvpRewardClaimReservation = {
    alreadyClaimed: boolean;
    completionPending: boolean;
    serverCreditsPending: boolean;
};

function isReceipt(value: unknown): value is PvpRewardClaimReceipt {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const allowed = new Set([
        'version', 'outcome', 'claimedAt', 'sessionCreatedAt', 'expiresAt',
        'completionRequired', 'completionState', 'completedAt',
        'serverCreditsState', 'serverCreditsCompletedAt',
    ]);
    if (Object.keys(value as Record<string, unknown>).some((key) => !allowed.has(key))) return false;
    const candidate = value as Partial<PvpRewardClaimReceipt>;
    const completionTimestampValid = candidate.completionState === 'pending'
        ? candidate.completedAt === null
        : Number.isSafeInteger(candidate.completedAt) && Number(candidate.completedAt) > 0;
    const serverTimestampValid = candidate.serverCreditsState === undefined
        ? candidate.serverCreditsCompletedAt === undefined || candidate.serverCreditsCompletedAt === null
        : candidate.serverCreditsState === 'pending'
            ? candidate.serverCreditsCompletedAt === null
            : Number.isSafeInteger(candidate.serverCreditsCompletedAt)
                && Number(candidate.serverCreditsCompletedAt) > 0;
    return candidate.version === 2
        && (candidate.outcome === 'win' || candidate.outcome === 'loss' || candidate.outcome === 'draw')
        && Number.isSafeInteger(candidate.claimedAt)
        && Number(candidate.claimedAt) > 0
        && (candidate.sessionCreatedAt === undefined
            || (Number.isSafeInteger(candidate.sessionCreatedAt)
                && Number(candidate.sessionCreatedAt) > 0
                && Number(candidate.sessionCreatedAt) <= Number(candidate.claimedAt)))
        && (candidate.expiresAt === undefined
            || (Number.isSafeInteger(candidate.expiresAt)
                && Number(candidate.expiresAt) > Number(candidate.claimedAt)))
        && (candidate.completionRequired === undefined || typeof candidate.completionRequired === 'boolean')
        && (candidate.completionState === 'pending' || candidate.completionState === 'completed')
        && completionTimestampValid
        && (candidate.serverCreditsState === undefined
            || candidate.serverCreditsState === 'pending'
            || candidate.serverCreditsState === 'completed')
        && serverTimestampValid
        && !(candidate.completionState === 'completed' && candidate.serverCreditsState === 'pending')
        && !(candidate.completionRequired === false
            && candidate.serverCreditsState !== 'pending'
            && candidate.completionState !== 'completed');
}

export function pvpRewardCompletionSessionCreatedAt(value: unknown): number | null {
    if (!isReceipt(value)) {
        if (pvpRewardCompletionStatus(value) === 'invalid') {
            throw new Error('pvp-reward-claim-receipt-invalid');
        }
        return null;
    }
    return value.sessionCreatedAt ?? null;
}

export function pvpRewardCompletionStatus(
    value: unknown,
): 'missing' | 'pending' | 'completed' | 'invalid' {
    if (value === null) return 'missing';
    if (isReceipt(value)) {
        return value.completionState === 'completed' ? 'completed' : 'pending';
    }
    // Pre-v2 receipts were primitive NX markers and had no continuation to
    // replay. Preserve that read-only compatibility without treating malformed
    // object-shaped server state as proof of completion.
    if (typeof value === 'string' || typeof value === 'number' || value === true) return 'completed';
    return 'invalid';
}

function reservationFromCurrent(
    current: unknown,
    outcome: PvpRewardOutcome,
    expectedSessionCreatedAt?: number,
): PvpRewardClaimReservation {
    // Pre-upgrade primitive receipts never advertised a repair protocol, so
    // preserve their historical already-claimed behavior. Malformed object
    // state is not legacy proof and must fail closed.
    const status = pvpRewardCompletionStatus(current);
    if (status === 'invalid' || status === 'missing') {
        throw new Error('pvp-reward-claim-receipt-invalid');
    }
    if (!isReceipt(current)) {
        if (expectedSessionCreatedAt !== undefined) {
            throw new Error('pvp-reward-claim-generation-conflict');
        }
        return {
            alreadyClaimed: true,
            completionPending: false,
            serverCreditsPending: false,
        };
    }
    if (current.outcome !== outcome) throw new Error('pvp-reward-claim-outcome-conflict');
    if (expectedSessionCreatedAt !== undefined
        && current.sessionCreatedAt !== expectedSessionCreatedAt) {
        throw new Error('pvp-reward-claim-generation-conflict');
    }
    return {
        alreadyClaimed: true,
        completionPending: current.completionState === 'pending' && current.completionRequired !== false,
        serverCreditsPending: current.serverCreditsState === 'pending',
    };
}

function receiptTtlSeconds(receipt: PvpRewardClaimReceipt, fallback: number, now: number): number {
    if (receipt.expiresAt === undefined) return fallback;
    if (receipt.expiresAt <= now) throw new Error('pvp-reward-claim-receipt-expired');
    return Math.max(1, Math.ceil((receipt.expiresAt - now) / 1000));
}

/** Reserve the server claim and its browser-continuation obligation together. */
export async function reservePvpRewardCompletion(
    store: RewardCompletionStore,
    key: string,
    outcome: PvpRewardOutcome,
    completionRequired: boolean,
    ttlSeconds: number,
    now = Date.now(),
    serverCreditsRequired = false,
    absoluteExpiresAt?: number,
    sessionCreatedAt?: number,
): Promise<PvpRewardClaimReservation> {
    const receiptPending = completionRequired || serverCreditsRequired;
    const expiresAt = absoluteExpiresAt ?? now + ttlSeconds * 1000;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
        throw new Error('pvp-reward-claim-expiry-invalid');
    }
    const effectiveTtlSeconds = absoluteExpiresAt === undefined
        ? ttlSeconds
        : Math.max(1, Math.ceil((expiresAt - now) / 1000));
    const desired: PvpRewardClaimReceipt = {
        version: 2,
        outcome,
        claimedAt: now,
        ...(sessionCreatedAt !== undefined ? { sessionCreatedAt } : {}),
        expiresAt,
        completionRequired,
        completionState: receiptPending ? 'pending' : 'completed',
        completedAt: receiptPending ? null : now,
        serverCreditsState: serverCreditsRequired ? 'pending' : 'completed',
        serverCreditsCompletedAt: serverCreditsRequired ? null : now,
    };
    try {
        const placed = await store.set(key, desired, { nx: true, ex: effectiveTtlSeconds } as never);
        if (placed) return {
            alreadyClaimed: false,
            completionPending: completionRequired,
            serverCreditsPending: serverCreditsRequired,
        };
    } catch (error) {
        const recovered = await store.get<unknown>(key).catch(() => null);
        if (recovered === null) throw error;
        return reservationFromCurrent(recovered, outcome, sessionCreatedAt);
    }
    const current = await store.get<unknown>(key);
    // A false NX result followed by no row is an expiry/delete race (or an
    // ambiguous remote acknowledgement), never proof of a legacy completion.
    // Keep the claim retryable instead of permanently suppressing callbacks.
    if (current === null) throw new Error('pvp-reward-claim-reservation-unconfirmed');
    return reservationFromCurrent(current, outcome, sessionCreatedAt);
}

/** Seal that all authoritative server writes for this claim are durable. */
export async function markPvpRewardServerCreditsCompleted(
    store: RewardCompletionStore,
    key: string,
    outcome: PvpRewardOutcome,
    ttlSeconds: number,
    now = Date.now(),
    expectedSessionCreatedAt?: number,
): Promise<'completed' | 'missing'> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await store.get<unknown>(key);
        if (current === null) return 'missing';
        if (!isReceipt(current)) {
            if (pvpRewardCompletionStatus(current) === 'completed') return 'completed';
            throw new Error('pvp-reward-claim-receipt-invalid');
        }
        if (current.outcome !== outcome) throw new Error('pvp-reward-claim-outcome-conflict');
        if (expectedSessionCreatedAt !== undefined
            && current.sessionCreatedAt !== expectedSessionCreatedAt) {
            throw new Error('pvp-reward-claim-generation-conflict');
        }
        if (current.serverCreditsState !== 'pending') return 'completed';
        const next: PvpRewardClaimReceipt = {
            ...current,
            serverCreditsState: 'completed',
            serverCreditsCompletedAt: now,
            ...(current.completionRequired === false
                ? { completionState: 'completed' as const, completedAt: now }
                : {}),
        };
        try {
            if (await store.compareSet(key, current, next, {
                ex: receiptTtlSeconds(current, ttlSeconds, now),
            })) return 'completed';
        } catch (error) {
            const recovered = await store.get<unknown>(key).catch(() => null);
            if (isReceipt(recovered)
                && recovered.outcome === outcome
                && (expectedSessionCreatedAt === undefined
                    || recovered.sessionCreatedAt === expectedSessionCreatedAt)
                && recovered.serverCreditsState !== 'pending') return 'completed';
            throw error;
        }
    }
    throw new Error('pvp-reward-server-credits-busy');
}

/**
 * Acknowledge that every awaited App continuation has finished. The exact CAS
 * makes a lost ACK harmless: the next claim observes `completed`.
 */
export async function acknowledgePvpRewardCompletion(
    store: RewardCompletionStore,
    key: string,
    outcome: PvpRewardOutcome,
    ttlSeconds: number,
    now = Date.now(),
    expectedSessionCreatedAt?: number,
): Promise<'completed' | 'missing' | 'not-ready'> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await store.get<unknown>(key);
        if (current === null) return 'missing';
        // Legacy receipts are already complete by definition.
        if (!isReceipt(current)) {
            if (expectedSessionCreatedAt !== undefined) {
                throw new Error('pvp-reward-claim-generation-conflict');
            }
            if (pvpRewardCompletionStatus(current) === 'completed') return 'completed';
            throw new Error('pvp-reward-claim-receipt-invalid');
        }
        if (current.outcome !== outcome) throw new Error('pvp-reward-claim-outcome-conflict');
        if (expectedSessionCreatedAt !== undefined
            && current.sessionCreatedAt !== expectedSessionCreatedAt) {
            throw new Error('pvp-reward-claim-generation-conflict');
        }
        if (current.serverCreditsState === 'pending') return 'not-ready';
        if (current.completionState === 'completed') return 'completed';
        const next: PvpRewardClaimReceipt = {
            ...current,
            completionState: 'completed',
            completedAt: now,
        };
        try {
            if (await store.compareSet(key, current, next, {
                ex: receiptTtlSeconds(current, ttlSeconds, now),
            })) return 'completed';
        } catch (error) {
            const recovered = await store.get<unknown>(key).catch(() => null);
            if (isReceipt(recovered)
                && recovered.outcome === outcome
                && (expectedSessionCreatedAt === undefined
                    || recovered.sessionCreatedAt === expectedSessionCreatedAt)
                && recovered.completionState === 'completed') return 'completed';
            throw error;
        }
    }
    throw new Error('pvp-reward-completion-ack-busy');
}
