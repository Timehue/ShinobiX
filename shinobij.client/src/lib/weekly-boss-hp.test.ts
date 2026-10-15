import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyBossScoreView } from './weekly-boss-hp';
test('weekly health always reads Unlimited and scores exceed the former pool', () => {
    for (const boss of [null, {}, { hpMax: 1000, hpRemaining: 0, broken: true, damageByPlayer: { a: 9000000, b: 1000000, c: -1 } }]) {
        const view = weeklyBossScoreView(boss);
        assert.equal(view.healthLabel, 'Unlimited');
        assert.equal(view.totalDamage, boss?.damageByPlayer ? 10000000 : 0);
    }
});
