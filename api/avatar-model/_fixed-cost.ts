import { kv, type KvCasOp } from '../_storage.js';

type Provider = 'modal' | 'openai';
type Reservation = { provider: string; cycle: string; micros: number };
type Budget = { spentMicros: number; reservedMicros: number };
/** A real statement posted later replaces this receipt (scripts/reconcile-avatar-cost.ts). */
export type FixedSettlement = { digest: string; releasedMicros: number; spentMicros: number; basis: 'fixed'; cycle: string };
/** What one job does to one budget row: `release` leaves reservedMicros, `spend` joins spentMicros. */
export type BudgetDelta = { key: string; release: number; spend: number };

const prefix = 'avatar-model:';
const cyclePattern = /^[A-Za-z0-9_-]{1,64}$/;
/**
 * What one finished job is charged when it ends, per provider, in millionths of a US dollar.
 * Neither provider bills per job, so a job settles a fixed amount the moment it ends and its
 * worst-case reservation goes back to the budget. The first live job cost $0.76 on Modal.
 * OpenAI was $0.25 while a model was one costume image; it now also paints a combat sprite
 * (workers/avatar-model/paint_battle_sprite.py), so a finished job is charged for two.
 */
export const DEFAULT_SETTLE_MICROS: Record<Provider, number> = { modal: 1_000_000, openai: 500_000 };

/** The owner can tune the amounts with `settleMicros` on a provider in AVATAR_MODEL_RESERVATIONS_JSON. */
export function fixedSettleMicros(env: NodeJS.ProcessEnv = process.env): Record<Provider, number> {
    const amounts = { ...DEFAULT_SETTLE_MICROS };
    try {
        const config = JSON.parse(env.AVATAR_MODEL_RESERVATIONS_JSON ?? '{}') as { providers?: unknown };
        if (!Array.isArray(config?.providers)) return amounts;
        for (const entry of config.providers as Array<{ provider?: unknown; settleMicros?: unknown }>) {
            if ((entry?.provider === 'modal' || entry?.provider === 'openai') &&
                Number.isSafeInteger(entry.settleMicros) && (entry.settleMicros as number) >= 0)
                amounts[entry.provider] = entry.settleMicros as number;
        }
    } catch { /* An unreadable policy keeps the defaults; admission refuses new jobs on it anyway. */ }
    return amounts;
}

/**
 * The fixed settlement of one dispatched job: each held amount is released and the fixed charge
 * (never more than was held) is spent. The receipts go under `settledCosts`, so neither this nor a
 * later statement settles the same provider twice. Pure: the caller turns the deltas into writes.
 */
export function fixedSettlement(job: { reserved?: Reservation[]; settledCosts?: Record<string, unknown> },
    amounts = fixedSettleMicros()) {
    const settledCosts: Record<string, unknown> = { ...job.settledCosts };
    const deltas: BudgetDelta[] = [];
    if (!Array.isArray(job.reserved)) throw new Error('Invalid provider reservation');
    for (const reservation of job.reserved) {
        const provider = reservation?.provider as Provider;
        if (!(provider in DEFAULT_SETTLE_MICROS) || settledCosts[provider] || !cyclePattern.test(reservation.cycle) ||
            !Number.isSafeInteger(reservation.micros) || reservation.micros < 0)
            throw new Error('Invalid provider reservation');
        const spend = Math.min(amounts[provider], reservation.micros);
        deltas.push({ key: prefix + 'budget:' + provider + ':' + reservation.cycle, release: reservation.micros, spend });
        const receipt: FixedSettlement = { digest: 'fixed:' + reservation.cycle + ':' + spend,
            releasedMicros: reservation.micros, spentMicros: spend, basis: 'fixed', cycle: reservation.cycle };
        settledCosts[provider] = receipt;
    }
    return { settledCosts, deltas };
}

/** One compare-and-set per budget row for any number of jobs' deltas. A missing or short row is refused. */
export async function budgetDeltaOps(deltas: BudgetDelta[]): Promise<KvCasOp[]> {
    const totals = new Map<string, { release: number; spend: number }>();
    for (const { key, release, spend } of deltas) {
        const total = totals.get(key) ?? { release: 0, spend: 0 };
        totals.set(key, { release: total.release + release, spend: total.spend + spend });
    }
    const ops: KvCasOp[] = [];
    for (const [key, { release, spend }] of totals) {
        const row = await kv.get<Budget>(key);
        if (!row || !Number.isSafeInteger(row.reservedMicros) || !Number.isSafeInteger(row.spentMicros) || row.spentMicros < 0)
            throw new Error('Reserved budget missing');
        const next = { ...row, reservedMicros: row.reservedMicros - release, spentMicros: row.spentMicros + spend };
        if (next.reservedMicros < 0 || !Number.isSafeInteger(next.spentMicros)) throw new Error('Inconsistent provider budget');
        ops.push({ op: 'cas', key, expected: row, value: next });
    }
    return ops;
}

/** One job's settlement as ready-to-commit writes. The caller commits them with the job's own end. */
export async function fixedSettlementOps(job: { reserved?: Reservation[]; settledCosts?: Record<string, unknown> },
    amounts = fixedSettleMicros()) {
    const { settledCosts, deltas } = fixedSettlement(job, amounts);
    return { ops: await budgetDeltaOps(deltas), settledCosts };
}
