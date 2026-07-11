/**
 * Fail-closed idempotency receipts for operations that move currency, rewards,
 * inventory, or competitive rating.
 *
 * A surprising number of reward paths historically treated an unavailable KV
 * store as though an NX reservation had succeeded. That preserves availability
 * by giving the caller permission to apply a reward without any durable replay
 * guard. For economic operations the safe contract is the opposite: an
 * unavailable or ambiguous receipt store denies the operation and lets the
 * client retry later.
 */

import { randomUUID } from 'node:crypto';

export interface EconomicReceiptRecord {
    version: 4;
    state: 'pending' | 'committed' | 'aborted';
    ownerId: string;
    fingerprint: string;
    createdAt: number;
    leaseExpiresAt?: number;
    metadata?: Record<string, string | number | boolean>;
}

export type EconomicReceiptStore = {
    get<T = unknown>(key: string): Promise<T | null>;
    set(
        key: string,
        value: unknown,
        options?: { ex?: number; nx?: boolean },
    ): Promise<unknown>;
    del(...keys: string[]): Promise<number>;
};

export type EconomicReceiptReservation =
    | { status: 'reserved'; receipt: EconomicReceiptRecord }
    | { status: 'replay'; receipt: EconomicReceiptRecord | null }
    | { status: 'conflict'; receipt: EconomicReceiptRecord };

export class EconomicReceiptStorageError extends Error {
    constructor(
        public readonly receiptKey: string,
        public readonly operation: 'reserve' | 'read-after-collision' | 'pending' | 'commit' | 'abort',
        cause?: unknown,
    ) {
        super(`Economic receipt ${operation} failed for "${receiptKey}".`, { cause });
        this.name = 'EconomicReceiptStorageError';
    }
}

function cleanStoredReceipt(raw: unknown): EconomicReceiptRecord | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if ((value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4)
        || typeof value.fingerprint !== 'string' || !value.fingerprint) return null;
    const createdAt = Number(value.createdAt);
    const leaseExpiresAt = Number(value.leaseExpiresAt);
    return {
        version: 4,
        state: value.version === 4 && value.state === 'aborted'
            ? 'aborted'
            : (value.version === 2 || value.version === 3 || value.version === 4) && value.state === 'pending'
                ? 'pending'
                : 'committed',
        ownerId: (value.version === 2 || value.version === 3 || value.version === 4) && typeof value.ownerId === 'string' && value.ownerId
            ? value.ownerId
            : 'legacy-committed',
        fingerprint: value.fingerprint,
        createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        ...(Number.isFinite(leaseExpiresAt) && leaseExpiresAt > 0 ? { leaseExpiresAt } : {}),
        ...(value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
            ? { metadata: value.metadata as Record<string, string | number | boolean> }
            : {}),
    };
}

function legacyPendingReceiptKey(key: string): string {
    return `${key}:pending`;
}

/**
 * Reserve `key` itself as a durable pending record before the protected
 * mutation begins, then transition that same record to committed afterward.
 * A pending primary row does not expire: without compare-and-swap support, that
 * is what prevents an old owner from racing and overwriting a successor. The
 * short `leaseExpiresAt` only describes how long a request is actively in
 * flight. If a process dies, the durable pending row becomes an uncertain
 * replay and can never authorize the reward again; operations staff can then
 * reconcile it from its fingerprint/metadata without risking a double grant.
 *
 * - New reservation: the caller may perform the protected operation.
 * - Same committed fingerprint: a retry/replay; do not perform it again.
 * - Same pending fingerprint: another request may still be mutating; fail with
 *   a retryable storage error instead of pretending the mutation completed.
 * - Different fingerprint: conflicting reports for one entity; deny both the
 *   second report and any attempt to reinterpret the first.
 * - Storage failure/ambiguous collision: throw. Callers surface 503/500 and do
 *   not grant anything.
 *
 * Legacy scalar receipts are treated as replays. We cannot prove their original
 * fingerprint, and denying a possible duplicate is safer than paying it again.
 */
export async function reserveEconomicReceipt(
    store: EconomicReceiptStore,
    opts: {
        key: string;
        fingerprint: string;
        ttlSeconds: number;
        pendingTtlSeconds?: number;
        now?: number;
        metadata?: EconomicReceiptRecord['metadata'];
    },
): Promise<EconomicReceiptReservation> {
    if (!opts.key || !opts.fingerprint) throw new TypeError('Receipt key and fingerprint are required.');
    if (!Number.isFinite(opts.ttlSeconds) || opts.ttlSeconds <= 0) throw new TypeError('Receipt TTL must be positive.');

    const pendingTtlSeconds = Math.max(10, Math.min(
        300,
        Math.floor(opts.pendingTtlSeconds ?? 60),
        Math.floor(opts.ttlSeconds),
    ));
    const createdAt = opts.now ?? Date.now();

    const receipt: EconomicReceiptRecord = {
        version: 4,
        state: 'pending',
        ownerId: randomUUID(),
        fingerprint: opts.fingerprint,
        createdAt,
        leaseExpiresAt: createdAt + pendingTtlSeconds * 1000,
        ...(opts.metadata ? { metadata: { ...opts.metadata } } : {}),
    };

    // The primary row is the durable authorization boundary. Legacy scalar or
    // malformed rows are spent rather than reinterpreted as a fresh request.
    let committedRaw: unknown;
    try {
        committedRaw = await store.get(opts.key);
    } catch (error) {
        throw new EconomicReceiptStorageError(opts.key, 'reserve', error);
    }
    if (committedRaw != null) {
        const existing = cleanStoredReceipt(committedRaw);
        if (!existing) return { status: 'replay', receipt: null };
        if (existing.fingerprint !== receipt.fingerprint) return { status: 'conflict', receipt: existing };
        if (existing.state === 'aborted') throw new EconomicReceiptStorageError(opts.key, 'pending');
        if (existing.state === 'pending' && existing.leaseExpiresAt && createdAt < existing.leaseExpiresAt) {
            throw new EconomicReceiptStorageError(opts.key, 'pending');
        }
        return { status: 'replay', receipt: existing };
    }

    // Version 3 used a separate short-lived `${key}:pending` lease. Honor an
    // active legacy lease during a rolling deployment so the new primary-key
    // protocol cannot race an older worker that is already applying a reward.
    const legacyLeaseKey = legacyPendingReceiptKey(opts.key);
    let legacyRaw: unknown;
    try {
        legacyRaw = await store.get(legacyLeaseKey);
    } catch (error) {
        throw new EconomicReceiptStorageError(opts.key, 'reserve', error);
    }
    if (legacyRaw != null) {
        const legacy = cleanStoredReceipt(legacyRaw);
        if (!legacy) throw new EconomicReceiptStorageError(opts.key, 'read-after-collision');
        if (!legacy.leaseExpiresAt || createdAt < legacy.leaseExpiresAt) {
            if (legacy.fingerprint === receipt.fingerprint) {
                throw new EconomicReceiptStorageError(opts.key, 'pending');
            }
            return { status: 'conflict', receipt: legacy };
        }
    }

    let placed: unknown;
    try {
        // Intentionally no expiry while pending. Commit applies the requested
        // TTL; abort replaces this with a short tombstone.
        placed = await store.set(opts.key, receipt, { nx: true });
    } catch (error) {
        // Remote NX writes can apply and then lose their HTTP acknowledgement.
        // Recover only our exact owner record; every other outcome is ambiguous
        // and remains fail-closed.
        try {
            const recovered = cleanStoredReceipt(await store.get(opts.key));
            if (recovered?.state === 'pending'
                && recovered.ownerId === receipt.ownerId
                && recovered.fingerprint === receipt.fingerprint) {
                placed = true;
            } else {
                throw new EconomicReceiptStorageError(opts.key, 'reserve', error);
            }
        } catch (readError) {
            if (readError instanceof EconomicReceiptStorageError) throw readError;
            throw new EconomicReceiptStorageError(opts.key, 'reserve', readError);
        }
    }

    if (!placed) {
        let raw: unknown;
        try {
            raw = await store.get(opts.key);
        } catch (error) {
            throw new EconomicReceiptStorageError(opts.key, 'read-after-collision', error);
        }
        if (raw == null) throw new EconomicReceiptStorageError(opts.key, 'read-after-collision');
        const existing = cleanStoredReceipt(raw);
        if (!existing) return { status: 'replay', receipt: null };
        if (existing.fingerprint === receipt.fingerprint) {
            if (existing.state !== 'pending'
                || (existing.leaseExpiresAt != null && createdAt >= existing.leaseExpiresAt)) {
                return { status: 'replay', receipt: existing };
            }
            throw new EconomicReceiptStorageError(opts.key, 'pending');
        }
        return { status: 'conflict', receipt: existing };
    }

    // Close the rolling-deploy race where a v3 worker placed its legacy lease
    // after our preflight read but before our primary NX write. Leave our
    // durable pending row in place: its uncertain state must remain replay-
    // blocking if that older worker subsequently applied the mutation.
    try {
        legacyRaw = await store.get(legacyLeaseKey);
    } catch (error) {
        throw new EconomicReceiptStorageError(opts.key, 'read-after-collision', error);
    }
    if (legacyRaw != null) {
        const legacy = cleanStoredReceipt(legacyRaw);
        if (!legacy) throw new EconomicReceiptStorageError(opts.key, 'read-after-collision');
        if (!legacy.leaseExpiresAt || createdAt < legacy.leaseExpiresAt) {
            if (legacy.fingerprint === receipt.fingerprint) {
                throw new EconomicReceiptStorageError(opts.key, 'pending');
            }
            return { status: 'conflict', receipt: legacy };
        }
    }
    return { status: 'reserved', receipt };
}

function requireOwnedPending(
    raw: unknown,
    reservation: Extract<EconomicReceiptReservation, { status: 'reserved' }>,
): EconomicReceiptRecord | null {
    const current = cleanStoredReceipt(raw);
    if (!current) return null;
    if (current.fingerprint !== reservation.receipt.fingerprint
        || current.ownerId !== reservation.receipt.ownerId) return null;
    return current;
}

/**
 * Mark a successful protected mutation as committed and refresh its full TTL.
 * The non-expiring primary row cannot be taken over while pending, so an owned
 * transition remains safe even if the short active-request lease has elapsed.
 */
export async function commitEconomicReceipt(
    store: EconomicReceiptStore,
    key: string,
    reservation: EconomicReceiptReservation,
    ttlSeconds: number,
): Promise<void> {
    if (reservation.status !== 'reserved') return;
    if (!key || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new TypeError('Receipt key and positive TTL are required.');
    try {
        const current = requireOwnedPending(await store.get(key), reservation);
        if (!current) throw new Error('Receipt reservation ownership was lost before commit.');
        if (current.state === 'committed') return;
        if (current.state !== 'pending') throw new Error('Receipt reservation is not pending.');
        const committed: EconomicReceiptRecord = { ...current, version: 4, state: 'committed' };
        delete committed.leaseExpiresAt;
        try {
            const placed = await store.set(key, committed, { ex: Math.floor(ttlSeconds) });
            if (!placed) throw new Error('Receipt commit write was not acknowledged.');
        } catch (writeError) {
            // A remote write may have committed and lost its acknowledgement.
            const recovered = cleanStoredReceipt(await store.get(key));
            if (recovered?.state === 'committed'
                && recovered.ownerId === current.ownerId
                && recovered.fingerprint === current.fingerprint) return;
            throw writeError;
        }
    } catch (error) {
        if (error instanceof EconomicReceiptStorageError) throw error;
        throw new EconomicReceiptStorageError(key, 'commit', error);
    }
}

/**
 * Mark an owned failed reservation as abandoned with a short tombstone. The
 * durable primary row cannot have a successor owner until this transition, so
 * shortening its TTL is safe without compare-and-delete. If the abort write
 * fails, the long pending row remains fail-closed rather than risking a replay.
 */
export async function abortEconomicReceipt(
    store: EconomicReceiptStore,
    key: string,
    reservation: EconomicReceiptReservation,
): Promise<boolean> {
    if (reservation.status !== 'reserved') return false;
    try {
        const current = requireOwnedPending(await store.get(key), reservation);
        if (!current || current.state !== 'pending') return false;
        const retryDelaySeconds = 10;
        const aborted: EconomicReceiptRecord = {
            ...current,
            version: 4,
            state: 'aborted',
            leaseExpiresAt: Date.now() + retryDelaySeconds * 1000,
        };
        return Boolean(await store.set(key, aborted, { ex: retryDelaySeconds }));
    } catch (error) {
        if (error instanceof EconomicReceiptStorageError) throw error;
        throw new EconomicReceiptStorageError(key, 'abort', error);
    }
}

export function isEconomicReceiptStorageError(error: unknown): error is EconomicReceiptStorageError {
    return error instanceof EconomicReceiptStorageError;
}
