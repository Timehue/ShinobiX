import { createHash } from 'node:crypto';
import type { KvLike } from './_storage.js';

/**
 * Small, durable journal for the few multi-record economy operations that
 * cannot be made atomic by putting a receipt in one player save.  The journal
 * is deliberately operation-specific: callers still own authorization,
 * balance validation, and the actual domain records.
 */
export type DurableSettlementState =
    | 'pending'
    | 'reserved'
    | 'debit-applied'
    | 'credit-applied'
    | 'completed'
    | 'cancelled'
    | 'refunded'
    | 'reconciliation-required';

export type DurableSettlementRecord = {
    transactionId: string;
    idempotencyKey: string;
    operationType: string;
    fingerprint: string;
    actorIds: string[];
    resource: string;
    amount: number;
    state: DurableSettlementState;
    createdAt: number;
    updatedAt: number;
    attempts: number;
    failureReason?: string;
    completedAt?: number;
    result?: Record<string, unknown>;
    meta?: Record<string, unknown>;
};

export type SettlementReceipt = {
    transactionId: string;
    fingerprint: string;
    resource: string;
    amount: number;
    appliedAt: number;
};

export const DURABLE_SETTLEMENT_PREFIX = 'economy-settlement:';
export const DURABLE_SETTLEMENT_INDEX = 'economy-settlement:index';
export const DURABLE_SETTLEMENT_PENDING_PREFIX = 'economy-settlement-pending:';
export const DURABLE_SETTLEMENT_RECONCILIATION_STATUS = 'economy-settlement:reconciliation-status';
export const DURABLE_SETTLEMENT_TTL_SECONDS = 90 * 24 * 60 * 60;
export const DURABLE_SETTLEMENT_STALE_AFTER_MS = 15 * 60 * 1000;
const INDEX_LIMIT = 1000;

export function settlementFingerprint(parts: Record<string, unknown>): string {
    const canonical = Object.keys(parts).sort().map((key) => `${key}=${JSON.stringify(parts[key])}`).join('|');
    return createHash('sha256').update(canonical).digest('hex');
}

export function settlementTransactionId(operationType: string, idempotencyKey: string): string {
    const safeKind = operationType.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'settlement';
    const digest = createHash('sha256').update(`${safeKind}:${idempotencyKey}`).digest('hex').slice(0, 40);
    return `${safeKind}-${digest}`;
}

export function durableSettlementKey(transactionId: string): string {
    return `${DURABLE_SETTLEMENT_PREFIX}${transactionId}`;
}

type SettlementStore = Pick<KvLike, 'get' | 'set' | 'del' | 'keys'>;

function pendingSettlementKey(transactionId: string): string {
    return `${DURABLE_SETTLEMENT_PENDING_PREFIX}${transactionId}`;
}

function settlementIsTerminal(state: DurableSettlementState): boolean {
    return state === 'completed' || state === 'cancelled' || state === 'refunded';
}

async function rememberSettlement(record: DurableSettlementRecord, store: SettlementStore): Promise<void> {
    // Per-transaction pending pointers keep the frequent scanner proportional
    // to unsettled work rather than all 90 days of retained journals. Write the
    // pointer before the best-effort discovery index so an index failure cannot
    // hide a financial operation.
    if (settlementIsTerminal(record.state)) await store.del(pendingSettlementKey(record.transactionId));
    else await store.set(pendingSettlementKey(record.transactionId), record.transactionId, { ex: DURABLE_SETTLEMENT_TTL_SECONDS });
    const current = (await store.get<string[]>(DURABLE_SETTLEMENT_INDEX)) ?? [];
    const next = [record.transactionId, ...current.filter((id) => id !== record.transactionId)].slice(0, INDEX_LIMIT);
    await store.set(DURABLE_SETTLEMENT_INDEX, next, { ex: DURABLE_SETTLEMENT_TTL_SECONDS });
}

export async function getDurableSettlement(
    transactionId: string,
    opts: { kv: SettlementStore },
): Promise<DurableSettlementRecord | null> {
    return opts.kv.get<DurableSettlementRecord>(durableSettlementKey(transactionId));
}

export async function beginDurableSettlement(
    input: Omit<DurableSettlementRecord, 'transactionId' | 'state' | 'createdAt' | 'updatedAt' | 'attempts'> & { transactionId?: string },
    opts: { kv: SettlementStore },
): Promise<{ status: 'created' | 'existing' | 'conflict'; record: DurableSettlementRecord }> {
    const transactionId = input.transactionId ?? settlementTransactionId(input.operationType, input.idempotencyKey);
    const now = Date.now();
    const record: DurableSettlementRecord = {
        transactionId,
        idempotencyKey: input.idempotencyKey,
        operationType: input.operationType,
        fingerprint: input.fingerprint,
        actorIds: [...input.actorIds],
        resource: input.resource,
        amount: Math.max(0, Math.floor(Number(input.amount) || 0)),
        state: 'pending',
        createdAt: now,
        updatedAt: now,
        attempts: 0,
        ...(input.meta ? { meta: { ...input.meta } } : {}),
        ...(input.result ? { result: { ...input.result } } : {}),
    };
    const key = durableSettlementKey(transactionId);
    const placed = await opts.kv.set(key, record, { nx: true, ex: DURABLE_SETTLEMENT_TTL_SECONDS });
    if (placed) {
        await rememberSettlement(record, opts.kv);
        return { status: 'created', record };
    }
    const existing = await opts.kv.get<DurableSettlementRecord>(key);
    if (!existing) throw new Error('Settlement reservation was not readable after an NX collision.');
    if (existing.fingerprint !== input.fingerprint
        || existing.operationType !== input.operationType
        || existing.idempotencyKey !== input.idempotencyKey) {
        return { status: 'conflict', record: existing };
    }
    // Repair pending/index pointers after a process boundary interrupted the
    // original reservation's secondary writes.
    await rememberSettlement(existing, opts.kv);
    return { status: 'existing', record: existing };
}

export async function updateDurableSettlement(
    transactionId: string,
    patch: Partial<Pick<DurableSettlementRecord, 'state' | 'failureReason' | 'completedAt' | 'result' | 'meta'>>,
    opts: { kv: SettlementStore },
): Promise<DurableSettlementRecord> {
    const key = durableSettlementKey(transactionId);
    const current = await opts.kv.get<DurableSettlementRecord>(key);
    if (!current) throw new Error(`Settlement ${transactionId} does not exist.`);
    const next: DurableSettlementRecord = {
        ...current,
        ...patch,
        updatedAt: Date.now(),
        attempts: current.attempts + 1,
    };
    await opts.kv.set(key, next, { ex: DURABLE_SETTLEMENT_TTL_SECONDS });
    await rememberSettlement(next, opts.kv);
    return next;
}

export async function completeDurableSettlement(
    transactionId: string,
    result: Record<string, unknown>,
    opts: { kv: SettlementStore },
): Promise<DurableSettlementRecord> {
    return updateDurableSettlement(transactionId, {
        state: 'completed',
        result,
        completedAt: Date.now(),
        failureReason: undefined,
    }, opts);
}

/**
 * Finish a request that made no economic mutation. Cancelled records stay
 * bound to their idempotency key but are intentionally retryable: callers may
 * revalidate the same request after a transient business condition changes.
 */
export async function cancelDurableSettlement(
    transactionId: string,
    result: Record<string, unknown>,
    opts: { kv: SettlementStore },
): Promise<DurableSettlementRecord> {
    return updateDurableSettlement(transactionId, {
        state: 'cancelled',
        result,
        completedAt: Date.now(),
        failureReason: typeof result.error === 'string' ? result.error : undefined,
    }, opts);
}

export function inspectSettlementReceipt(
    container: Record<string, unknown>,
    transactionId: string,
    fingerprint: string,
    field = 'settlementReceipts',
): 'fresh' | 'replay' | 'conflict' | 'invalid' {
    const raw = container[field];
    if (raw === undefined) return 'fresh';
    if (!Array.isArray(raw)) return 'invalid';
    const found = raw.find((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).transactionId === transactionId) as Record<string, unknown> | undefined;
    if (!found) return 'fresh';
    return found.fingerprint === fingerprint ? 'replay' : 'conflict';
}

export function appendSettlementReceipt(
    container: Record<string, unknown>,
    receipt: SettlementReceipt,
    field = 'settlementReceipts',
    limit = 100,
): Record<string, unknown> {
    const current = Array.isArray(container[field]) ? container[field] : [];
    const next = [receipt, ...current.filter((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).transactionId !== receipt.transactionId)].slice(0, limit);
    return { ...container, [field]: next };
}

export async function listPendingDurableSettlements(
    opts: { kv: SettlementStore; includeLegacyScan?: boolean },
): Promise<DurableSettlementRecord[]> {
    const pointerKeys = await opts.kv.keys(`${DURABLE_SETTLEMENT_PENDING_PREFIX}*`);
    const pointerIds = pointerKeys.map((key) => key.slice(DURABLE_SETTLEMENT_PENDING_PREFIX.length));
    // A legacy/full prefix pass is reserved for boot repair and explicit admin
    // scans. Frequent reconciliation ticks use pending pointers only.
    const legacyIds = opts.includeLegacyScan === false
        ? []
        : (await opts.kv.keys(`${DURABLE_SETTLEMENT_PREFIX}*`))
            .filter((key) => key.startsWith(DURABLE_SETTLEMENT_PREFIX))
            .map((key) => key.slice(DURABLE_SETTLEMENT_PREFIX.length));
    const ids = [...new Set([...pointerIds, ...legacyIds])];
    const records = await Promise.all(ids.map((id) => opts.kv.get<DurableSettlementRecord>(durableSettlementKey(id))));
    await Promise.all(records.map((record, index) => {
        if (record && !Array.isArray(record) && !settlementIsTerminal(record.state)) return Promise.resolve(0);
        return opts.kv.del(pendingSettlementKey(ids[index])).catch(() => 0);
    }));
    return records.filter((record): record is DurableSettlementRecord => Boolean(record)
        && !Array.isArray(record)
        && typeof (record as DurableSettlementRecord).transactionId === 'string'
        && (record as DurableSettlementRecord).state !== 'completed'
        && (record as DurableSettlementRecord).state !== 'cancelled'
        && (record as DurableSettlementRecord).state !== 'refunded');
}

/** Read all journal records for recovery paths that need to locate an old
 * token after its short-lived client token has expired. Completed records are
 * intentionally retained here; callers decide whether a terminal record can
 * answer a retry. */
export async function listDurableSettlements(
    opts: { kv: SettlementStore },
): Promise<DurableSettlementRecord[]> {
    const indexedIds = (await opts.kv.get<string[]>(DURABLE_SETTLEMENT_INDEX)) ?? [];
    const discoveredKeys = await opts.kv.keys(`${DURABLE_SETTLEMENT_PREFIX}*`);
    const ids = [...new Set([
        ...indexedIds,
        ...discoveredKeys
            .filter((key) => key.startsWith(DURABLE_SETTLEMENT_PREFIX))
            .map((key) => key.slice(DURABLE_SETTLEMENT_PREFIX.length)),
    ])];
    const records = await Promise.all(ids.map((id) => opts.kv.get<DurableSettlementRecord>(durableSettlementKey(id))));
    return records.filter((record): record is DurableSettlementRecord => Boolean(record)
        && !Array.isArray(record)
        && typeof (record as DurableSettlementRecord).transactionId === 'string');
}

export type DurableSettlementReconciliationSummary = {
    ranAt: number;
    staleAfterMs: number;
    scanned: number;
    active: number;
    alreadyRequired: number;
    markedRequired: number;
    failures: Array<{ transactionId: string; error: string }>;
    oldestPendingAgeMs: number;
};

/**
 * Bounded operational sweep. It never credits, debits, refunds, or deletes
 * value. It only promotes stale non-terminal journal entries to an explicit
 * operator-visible state; the original idempotent request can still resume and
 * complete the transaction from its durable receipts.
 */
export async function reconcileStaleDurableSettlements(
    opts: {
        kv: SettlementStore;
        now?: number;
        staleAfterMs?: number;
        limit?: number;
        includeLegacyScan?: boolean;
    },
): Promise<DurableSettlementReconciliationSummary> {
    const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now();
    const staleAfterMs = Math.max(0, Math.floor(opts.staleAfterMs ?? DURABLE_SETTLEMENT_STALE_AFTER_MS));
    const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 100)));
    const pending = (await listPendingDurableSettlements({ kv: opts.kv, includeLegacyScan: opts.includeLegacyScan }))
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, limit);
    const summary: DurableSettlementReconciliationSummary = {
        ranAt: now,
        staleAfterMs,
        scanned: pending.length,
        active: 0,
        alreadyRequired: 0,
        markedRequired: 0,
        failures: [],
        oldestPendingAgeMs: pending.length > 0
            ? Math.max(0, now - Math.min(...pending.map((record) => record.updatedAt)))
            : 0,
    };

    for (const record of pending) {
        if (record.state === 'reconciliation-required') {
            summary.alreadyRequired += 1;
            continue;
        }
        const ageMs = Math.max(0, now - record.updatedAt);
        if (ageMs < staleAfterMs) {
            summary.active += 1;
            continue;
        }
        try {
            // Re-read immediately before the write. A request that resumed
            // during the scan either completed (skip) or refreshed updatedAt
            // (leave active) instead of being overwritten as stale.
            const fresh = await getDurableSettlement(record.transactionId, { kv: opts.kv });
            if (!fresh || fresh.state === 'completed' || fresh.state === 'cancelled' || fresh.state === 'refunded') continue;
            if (fresh.state === 'reconciliation-required') {
                summary.alreadyRequired += 1;
                continue;
            }
            if (Math.max(0, now - fresh.updatedAt) < staleAfterMs) {
                summary.active += 1;
                continue;
            }
            await updateDurableSettlement(record.transactionId, {
                state: 'reconciliation-required',
                failureReason: `Settlement remained ${fresh.state} for at least ${staleAfterMs}ms. Retry the original request or inspect receipts.`,
            }, { kv: opts.kv });
            summary.markedRequired += 1;
        } catch (error) {
            summary.failures.push({
                transactionId: record.transactionId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    await opts.kv.set(DURABLE_SETTLEMENT_RECONCILIATION_STATUS, summary, {
        ex: DURABLE_SETTLEMENT_TTL_SECONDS,
    });
    return summary;
}
