import { kv, type KvLike } from '../_storage.js';
import {
    DURABLE_SETTLEMENT_STALE_AFTER_MS,
    reconcileStaleDurableSettlements,
    type DurableSettlementReconciliationSummary,
} from '../_durable-settlement.js';

/**
 * Run the bounded durable-settlement sweep. This never moves player or shared
 * value; it only makes stale non-terminal journals visible for operator review
 * while preserving same-request recovery.
 */
export async function runSettlementReconciliation(options: {
    store?: Pick<KvLike, 'get' | 'set' | 'del' | 'keys'>;
    now?: number;
    staleAfterMs?: number;
    limit?: number;
    includeLegacyScan?: boolean;
} = {}): Promise<DurableSettlementReconciliationSummary> {
    return reconcileStaleDurableSettlements({
        kv: options.store ?? kv,
        now: options.now,
        staleAfterMs: options.staleAfterMs ?? DURABLE_SETTLEMENT_STALE_AFTER_MS,
        limit: options.limit ?? 100,
        includeLegacyScan: options.includeLegacyScan,
    });
}
