import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldBossFloor, worldBossMatchHpForParty } from './_encounter';

test('each world boss is sealed with its own defensive Tower mechanic', () => {
    const hollowBeast = worldBossFloor('hollow-beast', 'Chicxulub');
    assert.equal(hollowBeast.boss?.mechanic, 'regen');
    assert.deepEqual(hollowBeast.boss?.strike, { kind: 'nova', pct: 12, radius: 2, everyRounds: 4 });

    const bullGuardian = worldBossFloor('hollow-gate-bull', 'Murogane');
    assert.equal(bullGuardian.boss?.mechanic, 'bulwark');
    assert.deepEqual(bullGuardian.boss?.strike, { kind: 'slam', pct: 14, radius: 1, everyRounds: 3 });
    assert.equal(bullGuardian.enemies.reduce((count, enemy) => count + enemy.count, 0), 2);

    const mazeWarden = worldBossFloor('hollow-maze-minotaur', 'Donkaku');
    assert.deepEqual(mazeWarden.boss?.phases, [75, 50, 25]);
    assert.deepEqual(mazeWarden.boss?.aegis, { shieldPct: 10 });
    assert.deepEqual(mazeWarden.boss?.strike, { kind: 'volley', pct: 12, radius: 1, everyRounds: 3 });
});

test('world boss match HP budget scales to solo, duo, and trio size without exceeding shared HP', () => {
    assert.equal(worldBossMatchHpForParty(200_000, 1), 28_000);
    assert.equal(worldBossMatchHpForParty(200_000, 2), 56_000);
    assert.equal(worldBossMatchHpForParty(200_000, 3), 84_000);
    assert.equal(worldBossMatchHpForParty(42_000, 3), 42_000);
});
