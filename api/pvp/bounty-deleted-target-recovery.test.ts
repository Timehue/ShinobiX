import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
let sweep: typeof import('./_bounty-claim.js').sweepPendingBountyClaims;
before(async () => { sweep = (await import('./_bounty-claim.js')).sweepPendingBountyClaims; });

for (const refund of [true, false]) {
    test(`missing winner ${refund ? 'holds a deleted-target refund for reconciliation' : 'restores a normal claim'}`, async () => {
        const board = {
            bounties: [],
            pendingClaims: [{ id: refund ? 'deleted-target:departed:1:missing' : 'duel:missing', winner: 'missing',
                head: { target: 'departed', amount: 100, contributors: ['missing'], updatedAt: 1 }, at: 1 }],
        };
        const result = await sweep(board, 60_000);
        assert.equal(result.bounties.length, refund ? 0 : 1);
        assert.equal(result.pendingClaims?.length ?? 0, refund ? 1 : 0);
        if (refund) assert.deepEqual(result.pendingClaims, board.pendingClaims, 'legacy refunds await explicit escrow migration');
    });
}
