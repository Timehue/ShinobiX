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
    version: 3;
    state: 'pending' | 'committed';
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
    if ((value.version !== 1 && value.version !== 2 && value.version !== 3)
        || typeof value.fingerprint !== 'string' || !value.fingerprint) return null;
    const createdAt = Number(value.createdAt);
    const leaseExpiresAt = Number(value.leaseExpiresAt);
    return {
        version: 3,
        state: (value.version === 2 || value.version === 3) && value.state === 'pending' ? 'pending' : 'committed',
        ownerId: (value.version === 2 || value.version === 3) && typeof value.ownerId === 'string' && value.ownerId
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

function pendingReceiptKey(key: string): string {
    return `${key}:pending`;
}

function classifyCommittedReceipt(
    raw: unknown,
    fingerprint: string,
): Extract<EconomicReceiptReservation, { status: 'replay' | 'conflict' }> {
    const existing = cleanStoredReceipt(raw);
    // Legacy scalar/unknown latches are spent. There is no safe way to prove
    // that they belong to a new request, so never authorize another mutation.
    if (!existing) return { status: 'replay', receipt: null };
    return existing.fingerprint === fingerprint
        ? { status: 'replay', receipt: existing }
        : { status: 'conflict', receipt: existing };
}

/**
 * Reserve `key` through a short-lived NX lease, then commit the durable receipt
 * at `key` only after the protected mutation succeeds.
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
        version: 3,
        state: 'pending',
        ownerId: randomUUID(),
        fingerprint: opts.fingerprint,
        createdAt,
        leaseExpiresAt: createdAt + pendingTtlSeconds * 1000,
        ...(opts.metadata ? { metadata: { ...opts.metadata } } : {}),
    };

    // Fast path for a durable committed receipt. This read is repeated after
    // acquiring the pending lease to close the read/lease race.
    let committedRaw: unknown;
    try {
        committedRaw = await store.get(opts.key);
    } catch (error) {
        throw new EconomicReceiptStorageError(opts.key, 'reserve', error);
    }
    if (committedRaw != null) return classifyCommittedReceipt(committedRaw, receipt.fingerprint);

    const leaseKey = pendingReceiptKey(opts.key);
    let placed: unknown;
    try {
        placed = await store.set(leaseKey, receipt, { nx: true, ex: pendingTtlSeconds });
    } catch (error) {
        throw new EconomicReceiptStorageError(opts.key, 'reserve', error);
    }

    if (!placed) {
        let raw: unknown;
        try {
            raw = await store.get(leaseKey);
        } catch (error) {
            throw new EconomicReceiptStorageError(opts.key, 'read-after-collision', error);
        }
        if (raw == null) throw new EconomicReceiptStorageError(opts.key, 'read-after-collision');
        const existing = cleanStoredReceipt(raw);
        if (existing?.fingerprint === receipt.fingerprint) {
            throw new EconomicReceiptStorageError(opts.key, 'pending');
        }
        if (existing) return { status: 'conflict', receipt: existing };
        throw new EconomicReceiptStorageError(opts.key, 'read-after-collision');
    }

    try {
        committedRaw = await store.get(opts.key);
    } catch (error) {
        throw new EconomicReceiptStorageError(opts.key, 'read-after-collision', error);
    }
    if (committedRaw != null) return classifyCommittedReceipt(committedRaw, receipt.fingerprint);
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
 * Mark a successful protected mutation as committed and extend its full TTL.
 * The owner check prevents one request from committing another request's lease.
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
        const current = requireOwnedPending(await store.get(pendingReceiptKey(key)), reservation);
        if (!current) throw new Error('Receipt reservation ownership was lost before commit.');
        if (current.state === 'committed') return;
        // Never let a request commit on the edge of lease expiry: a successor
        // could otherwise acquire the lease and begin the same mutation between
        // this ownership read and the committed NX write.
        if (!current.leaseExpiresAt || Date.now() >= current.leaseExpiresAt - 5_000) {
            throw new Error('Receipt reservation lease expired before commit.');
        }
        const committed: EconomicReceiptRecord = { ...current, version: 3, state: 'committed' };
        delete committed.leaseExpiresAt;
        const placed = await store.set(key, committed, { nx: true, ex: ttlSeconds });
        if (placed) return;
        const collision = cleanStoredReceipt(await store.get(key));
        if (collision?.state === 'committed' && collision.fingerprint === current.fingerprint) return;
        throw new Error('A conflicting committed receipt appeared before commit.');
    } catch (error) {
        if (error instanceof EconomicReceiptStorageError) throw error;
        throw new EconomicReceiptStorageError(key, 'commit', error);
    }
}

/**
 * Mark an owned failed reservation as abandoned. The lease is intentionally not
 * deleted: this store exposes no atomic compare-and-delete, so deleting after an
 * ownership read could erase a successor lease that appeared at expiry. The
 * short TTL releases it safely and a retry receives 503 until then.
 */
export async function abortEconomicReceipt(
    store: EconomicReceiptStore,
    key: string,
    reservation: EconomicReceiptReservation,
): Promise<boolean> {
    if (reservation.status !== 'reserved') return false;
    try {
        if (await store.get(key) != null) return false;
        const current = requireOwnedPending(await store.get(pendingReceiptKey(key)), reservation);
        if (!current || current.state !== 'pending') return false;
        return true;
    } catch (error) {
        if (error instanceof EconomicReceiptStorageError) throw error;
        throw new EconomicReceiptStorageError(key, 'abort', error);
    }
}

export function isEconomicReceiptStorageError(error: unknown): error is EconomicReceiptStorageError {
    return error instanceof EconomicReceiptStorageError;
}
