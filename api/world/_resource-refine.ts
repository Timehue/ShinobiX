import { RESOURCE_ITEMS } from '../../shared/resource-gathering.js';
import { countOwned, removeOwned, addOwned } from '../craft/_forge.js';
import { inspectSettlementReceipt, appendSettlementReceipt } from '../_settlement-receipts.js';
export function refineResource(character: Record<string, unknown>, itemId: unknown, quantity: unknown, requestId: string, now: number) {
    const item = RESOURCE_ITEMS.find(item => item.id === itemId && item.activity === 'mining' && item.grade > 0);
    if (!item || !Number.isInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 99) return { ok: false as const, error: 'Choose 1–99 units of graded ore to refine.' };
    const amount = Number(quantity), fingerprint = `resource:refine:${item.id}:${amount}`;
    const prior = inspectSettlementReceipt(character, requestId, fingerprint);
    if (prior.status === 'replay') return { ok: true as const, character, replayed: true, value: prior.receipt.value };
    if (prior.status !== 'fresh') return { ok: false as const, error: 'This refining request ID belongs to another action.' };
    if (countOwned(character, item.id) < amount) return { ok: false as const, error: 'You do not have enough of that ore.' };
    const output = amount * (item.grade + 1);
    if (countOwned(character, item.family) + output > 9999) return { ok: false as const, error: 'Make room in the refined mineral stack first.' };
    const value = { itemId: item.family, count: output };
    const next = addOwned(removeOwned(character, item.id, amount), item.family, output, true);
    return { ok: true as const, replayed: false, value,
        character: appendSettlementReceipt(next, prior.receipts, { requestId, fingerprint, value, settledAt: now }) };
}
