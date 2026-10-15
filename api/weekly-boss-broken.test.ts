import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicWeeklyBossState, applyWeeklyBossRunDamageReceipt } from './weekly-boss.js';

test('legacy exhausted weekly spawns publish unlimited health and retain scores and attempts', () => {
    const boss = { weekKey: '2026-W34', aiId: 'oni', startedAt: 1, expiresAt: 2,
        hpMax: 1_000, hpRemaining: 0, scaleFactor: 1,
        damageByPlayer: { alice: 1_000_000 }, attemptsByPlayer: { alice: 3 },
        bankedRunDamage: { run: 1_000_000 }, attemptRunReceipts: { run: 'alice' } };
    const view = publicWeeklyBossState(boss)!;
    assert.equal(view.healthMode, 'unlimited');
    assert.equal(view.hpMax, null);
    assert.equal(view.hpRemaining, null);
    assert.equal(view.broken, false);
    assert.equal(view.totalDamage, 1_000_000);
    assert.deepEqual(view.attemptsByPlayer, { alice: 3 });
    assert.ok(!('bankedRunDamage' in view));
    assert.ok(!('attemptRunReceipts' in view));
    const next = publicWeeklyBossState(applyWeeklyBossRunDamageReceipt(boss, 'next', 'bob', 5_000_000).boss)!;
    assert.equal(next.broken, false);
    assert.equal(next.totalDamage, 6_000_000);
});
