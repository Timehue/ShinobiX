import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveServerTopLevelFields } from './_sanitize-ledger.js';
import { combatProjection } from './_projections.js';

test('a client cannot mint, erase or replace a bandit toll receipt, even in a partial save', () => {
    const paid = [{ id: 'paid-toll', wandererId: 'w-12-5000-0', at: 1000 }];
    const forged: Record<string, unknown> = { banditTollReceipts: [{ id: 'unpaid' }] };
    preserveServerTopLevelFields(forged, null);
    assert.equal(forged.banditTollReceipts, undefined);
    const incoming: Record<string, unknown> = { banditTollReceipts: [] };
    preserveServerTopLevelFields(incoming, { banditTollReceipts: paid });
    assert.deepEqual(incoming.banditTollReceipts, paid);
    const partial: Record<string, unknown> = {};
    preserveServerTopLevelFields(partial, { banditTollReceipts: paid });
    assert.deepEqual(partial.banditTollReceipts, paid);
    assert.equal(combatProjection({ character: {}, banditTollReceipts: paid }).banditTollReceipts, undefined);
});
