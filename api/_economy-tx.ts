import { randomUUID } from 'node:crypto';
import type { KvLike } from './_storage.js';

export type EconomyTxState = 'reserved' | 'debit-applied' | 'credit-applied' | 'complete' | 'needs-reconcile';

export type EconomyTxRecord = {
    id: string;
    kind: string;
    state: EconomyTxState;
    debitKey: string;
    creditKey: string;
    resource: string;
    amount: number;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    error?: string;
    note?: string;
    meta?: Record<string, unknown>;
};

type EconomyTxKv = Pick<KvLike, 'get' | 'set'>;

export const ECONOMY_TX_PREFIX = 'economy-tx:';
export const ECONOMY_TX_RECENT_KEY = 'economy-tx:recent';
export const ECONOMY_TX_TTL_SECONDS = 90 * 24 * 60 * 60;
export const ECONOMY_TX_RECENT_LIMIT = 500;

export function makeEconomyTxId(kind: string): string {
    return `${kind}:${randomUUID().replace(/-/g, '')}`;
}

export function economyTxKey(id: string): string {
    return `${ECONOMY_TX_PREFIX}${id}`;
}

async function getDefaultKv(): Promise<EconomyTxKv> {
    return (await import('./_storage.js')).kv;
}

function cleanRecord(input: Omit<EconomyTxRecord, 'state' | 'createdAt' | 'updatedAt'> & { state?: EconomyTxState }): EconomyTxRecord {
    const now = Date.now();
    return {
        ...input,
        id: String(input.id),
        kind: String(input.kind),
        state: input.state ?? 'reserved',
        debitKey: String(input.debitKey),
        creditKey: String(input.creditKey),
        resource: String(input.resource),
        amount: Math.max(0, Math.floor(Number(input.amount) || 0)),
        createdAt: now,
        updatedAt: now,
    };
}

async function rememberRecent(id: string, store: EconomyTxKv): Promise<void> {
    const recent = Array.isArray(await store.get<string[]>(ECONOMY_TX_RECENT_KEY))
        ? (await store.get<string[]>(ECONOMY_TX_RECENT_KEY))!
        : [];
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, ECONOMY_TX_RECENT_LIMIT);
    await store.set(ECONOMY_TX_RECENT_KEY, next, { ex: ECONOMY_TX_TTL_SECONDS } as never);
}

export async function reserveEconomyTx(
    input: Omit<EconomyTxRecord, 'state' | 'createdAt' | 'updatedAt'>,
    opts: { kv?: EconomyTxKv } = {},
): Promise<EconomyTxRecord> {
    const store = opts.kv ?? await getDefaultKv();
    const record = cleanRecord(input);
    const key = economyTxKey(record.id);
    const ok = await store.set(key, record, { nx: true, ex: ECONOMY_TX_TTL_SECONDS } as never);
    if (ok === null) {
        const existing = await store.get<EconomyTxRecord>(key);
        if (existing) return existing;
    }
    await rememberRecent(record.id, store);
    return record;
}

export async function markEconomyTx(
    id: string,
    state: EconomyTxState,
    patch: Partial<Omit<EconomyTxRecord, 'id' | 'state' | 'createdAt' | 'updatedAt'>> = {},
    opts: { kv?: EconomyTxKv } = {},
): Promise<EconomyTxRecord> {
    const store = opts.kv ?? await getDefaultKv();
    const key = economyTxKey(id);
    const current = await store.get<EconomyTxRecord>(key);
    const now = Date.now();
    const next: EconomyTxRecord = {
        ...(current ?? {
            id,
            kind: String(patch.kind ?? 'unknown'),
            debitKey: String(patch.debitKey ?? ''),
            creditKey: String(patch.creditKey ?? ''),
            resource: String(patch.resource ?? ''),
            amount: Math.max(0, Math.floor(Number(patch.amount) || 0)),
            createdAt: now,
        }),
        ...patch,
        state,
        updatedAt: now,
    };
    await store.set(key, next, { ex: ECONOMY_TX_TTL_SECONDS } as never);
    await rememberRecent(id, store);
    return next;
}

export function completeEconomyTx(
    id: string,
    patch: Partial<Omit<EconomyTxRecord, 'id' | 'state' | 'createdAt' | 'updatedAt'>> = {},
    opts: { kv?: EconomyTxKv } = {},
): Promise<EconomyTxRecord> {
    return markEconomyTx(id, 'complete', { ...patch, completedAt: Date.now() }, opts);
}

export function failEconomyTx(
    id: string,
    error: unknown,
    patch: Partial<Omit<EconomyTxRecord, 'id' | 'state' | 'createdAt' | 'updatedAt'>> = {},
    opts: { kv?: EconomyTxKv } = {},
): Promise<EconomyTxRecord> {
    const message = error instanceof Error ? error.message : String(error);
    return markEconomyTx(id, 'needs-reconcile', { ...patch, error: message }, opts);
}

export async function readEconomyTxSnapshot(limit = 100, opts: { kv?: EconomyTxKv } = {}): Promise<{ recent: EconomyTxRecord[]; stuck: EconomyTxRecord[] }> {
    const store = opts.kv ?? await getDefaultKv();
    const ids = Array.isArray(await store.get<string[]>(ECONOMY_TX_RECENT_KEY))
        ? (await store.get<string[]>(ECONOMY_TX_RECENT_KEY))!
        : [];
    const cappedIds = ids.slice(0, Math.max(1, Math.min(500, Math.floor(Number(limit) || 100))));
    const recent = (await Promise.all(cappedIds.map((id) => store.get<EconomyTxRecord>(economyTxKey(id))))).filter(Boolean) as EconomyTxRecord[];
    return { recent, stuck: recent.filter((tx) => tx.state !== 'complete') };
}
