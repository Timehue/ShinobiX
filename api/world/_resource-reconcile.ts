import { kv } from '../_storage.js';
import { economyTxKey, completeEconomyTx, markEconomyTx, type EconomyTxRecord } from '../_economy-tx.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { readResourceGathering } from '../../shared/resource-gathering.js';
import { resourceNode } from '../../shared/resource-nodes.js';
import { finishResourcePool } from './_resource-pool.js';
import type { ResourceSeal } from './_resource-gathering.js';

/** Admission recovery only: never grants an item or skill XP. Save -> pool lock
 * order matches Start and Explore. Receipt eviction fails closed for a human. */
export async function reconcileResourceAdmission(txId: string) {
    const tx = await kv.get<EconomyTxRecord>(economyTxKey(txId));
    const name = tx?.meta?.playerName, seal = tx?.meta?.seal as ResourceSeal | undefined;
    const node = seal && resourceNode(seal.nodeId);
    if (!tx || tx.kind !== 'resource-gathering' || typeof name !== 'string' || !seal || !node) return { ok: false, error: 'Invalid gathering journal.' };
    const result = await mutatePlayerSave<Record<string, unknown>>(name, async ({ character }) => {
        const state = readResourceGathering(character.resourceGathering);
        const admitted = state.active?.id === seal.id || state.receipts.some(receipt => receipt.id === seal.id);
        if (!admitted && tx.state === 'complete') return { ok: true, character, write: false, value: { completed: true } };
        const absenceProvable = state.receipts.length < 100 || state.receipts.every(receipt => typeof receipt.settledAt === 'number')
            && Math.min(...state.receipts.map(receipt => receipt.settledAt!)) <= tx.createdAt;
        if (!admitted && !absenceProvable) return { ok: false, status: 409, error: 'Admission receipt may have aged out. Review the gathering journal before releasing its slot.' };
        if (tx.meta?.poolEnabled) await finishResourcePool(node.sector, seal.startedAt, txId, admitted);
        if (admitted) await completeEconomyTx(txId);
        else await markEconomyTx(txId, 'refunded', { note: 'No save admission receipt: uncommitted sector slot released; player was not charged.' });
        return { ok: true, character, write: false, value: { admitted, released: !admitted } };
    });
    return result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error };
}
