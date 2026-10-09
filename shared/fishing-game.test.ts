import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { scoreFishing, type FishingEvent } from './fishing-game.js';

const hookAt = 2000;
const controlled: FishingEvent[] = [{ kind: 'hook', at: hookAt },
    { kind: 'reel', at: 2050 }, { kind: 'release', at: 3350 },
    { kind: 'reel', at: 4050 }, { kind: 'release', at: 5350 },
    { kind: 'reel', at: 6050 }, { kind: 'release', at: 7350 }];

test('controlled reeling succeeds and previews replay the same tension and progress', () => {
    const result = scoreFishing(hookAt, controlled, 8500)!;
    assert.equal(result.failed, false);
    assert.ok(result.performance >= 8);
    assert.deepEqual(scoreFishing(hookAt, controlled, 8500, true), result);
    assert.equal(scoreFishing(hookAt, controlled, 8000), null);
});
test('an untended line, missed hook and continuous hard pull fail', () => {
    for (const events of [[{ kind: 'hook', at: 2000 }, { kind: 'reel', at: 8500 }],
        [{ kind: 'hook', at: 3400 }, { kind: 'reel', at: 3450 }],
        [{ kind: 'hook', at: 2000 }, { kind: 'reel', at: 2050 }]]) {
        assert.equal(scoreFishing(hookAt, events, 10000)?.failed, true);
    }
});
test('forged, unordered, repeated and unbounded fishing inputs are rejected', () => {
    for (const events of [null, [], [{ kind: 'hook', at: NaN }], [...controlled, { kind: 'hook', at: 8500 }],
        [controlled[0], { kind: 'reel', at: 9000 }], [controlled[0], { kind: 'release', at: 2050 }],
        [controlled[0], { kind: 'reel', at: 2100 }, { kind: 'reel', at: 2200 }],
        [controlled[0], { kind: 'reel', at: 1000 }], Array(49).fill(controlled[0])]) {
        assert.equal(scoreFishing(hookAt, events, 8500), null);
    }
});
