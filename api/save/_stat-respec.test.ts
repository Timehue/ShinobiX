import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPaidStatRespec, STAT_RESPEC_FATE_COST } from './_stat-entitlement.js';

test('paid stat respec atomically resets stats, refunds points, and debits shards', () => {
    const character = { stats: { strength: 25, speed: 17 }, unspentStats: 4, fateShards: 70 };
    const next = applyPaidStatRespec(character);
    assert.ok(next);
    assert.equal((next!.stats as Record<string, number>).strength, 10);
    assert.equal((next!.stats as Record<string, number>).speed, 10);
    assert.equal(next!.unspentStats, 26);
    assert.equal(next!.fateShards, 70 - STAT_RESPEC_FATE_COST);
});

test('paid stat respec rejects empty allocations and insufficient shards', () => {
    assert.equal(applyPaidStatRespec({ stats: {}, unspentStats: 0, fateShards: 500 }), null);
    assert.equal(applyPaidStatRespec({ stats: { strength: 11 }, unspentStats: 0, fateShards: 49 }), null);
});
