import test from 'node:test';
import assert from 'node:assert/strict';
import { kunaiFish, kunaiFlightMs, kunaiShoal, scoreKunaiFishing, type KunaiThrow } from './kunai-fishing.js';

const seed = 2718;
function intercept(at = 1000, misses: KunaiThrow[] = [], index = 0) {
    const shot: KunaiThrow = { kind: 'throw', at, x: 50, y: 45 };
    for (let n = 0; n < 20; n++) {
        const point = kunaiFish(seed, index, at + kunaiFlightMs(shot), misses);
        shot.x = point.x; shot.y = point.y;
    }
    return shot;
}

test('interception is resolved at impact and cannot settle before the catch comes ashore', () => {
    const shot = intercept(), impact = shot.at + kunaiFlightMs(shot);
    assert.equal(scoreKunaiFishing(seed, [shot], shot.at, true)?.phase, 'flight');
    assert.equal(scoreKunaiFishing(seed, [shot], impact + 1, true)?.phase, 'hauling');
    assert.equal(scoreKunaiFishing(seed, [shot], impact + 1249), null);
    const result = scoreKunaiFishing(seed, [shot], impact + 1250)!;
    assert.equal(result.phase, 'landed'); assert.equal(result.hit, 0);
    assert.equal(result.failed, false); assert.equal(result.performance, 10);
    assert.deepEqual(scoreKunaiFishing(seed, [shot], impact + 1250, true), result);
});

test('ranked shoals progress with Fishing skill and always include an attainable species', () => {
    for (let level = 1; level <= 10; level++) {
        const shoal = kunaiShoal(level);
        assert.equal(shoal.length, 3);
        assert.ok(shoal.some(fish => fish.level <= level));
    }
    assert.deepEqual(kunaiShoal(1).map(fish => fish.level), [1, 4, 7]);
    assert.deepEqual(kunaiShoal(7).map(fish => fish.level), [4, 7, 10]);
});

test('an over-level strike ends the whole attempt as a failure; meeting its exact requirement succeeds', () => {
    const shot = intercept(1000, [], 1), impact = shot.at + kunaiFlightMs(shot), end = impact + 1250;
    assert.equal(scoreKunaiFishing(seed, [shot], shot.at, true, 1)?.phase, 'flight');
    assert.equal(scoreKunaiFishing(seed, [shot], impact + 1, true, 1)?.phase, 'resisting');
    assert.equal(scoreKunaiFishing(seed, [shot], end - 1, false, 1), null);
    const blocked = scoreKunaiFishing(seed, [shot], end, false, 1)!;
    assert.equal(blocked.phase, 'outmatched'); assert.equal(blocked.failed, true); assert.equal(blocked.performance, 0);
    assert.deepEqual(blocked.catchInfo, { name: 'Bronze Carp', requiredLevel: 4, fisherLevel: 1, tooStrong: true });
    assert.equal(scoreKunaiFishing(seed, [shot, { kind: 'throw', at: end + 20, x: 50, y: 40 }], end + 50, true, 1), null);
    assert.equal(scoreKunaiFishing(seed, [shot], end, false, 4)?.failed, false);
    assert.equal(scoreKunaiFishing(seed, [shot], end)?.failed, false, 'pre-ranked sessions preserve their admitted rules');
});

test('three misses scatter the shoal and return the kunai before closing the attempt', () => {
    const shots: KunaiThrow[] = [];
    for (let n = 0; n < 3; n++) {
        const at = shots.length ? scoreKunaiFishing(seed, shots, 18_000, true)!.availableAt : 650;
        shots.push({ kind: 'throw', at, x: 6, y: 12 });
    }
    const impact = shots[0].at + kunaiFlightMs(shots[0]);
    assert.notDeepEqual(kunaiFish(seed, 0, impact + 200, shots.slice(0, 1)), kunaiFish(seed, 0, impact + 200));
    const end = shots[2].at + kunaiFlightMs(shots[2]) + 850;
    assert.equal(scoreKunaiFishing(seed, shots, end - 1), null);
    assert.equal(scoreKunaiFishing(seed, shots, end)?.failed, true);
    assert.equal(scoreKunaiFishing(seed, [], 17_999), null);
    assert.equal(scoreKunaiFishing(seed, [], 18_000)?.phase, 'escaped');
});

test('a second throw can intercept the disturbed shoal but scores below a perfect first throw', () => {
    const miss: KunaiThrow = { kind: 'throw', at: 650, x: 6, y: 12 };
    const hit = intercept(miss.at + kunaiFlightMs(miss) + 850, [miss]);
    const result = scoreKunaiFishing(seed, [miss, hit], hit.at + kunaiFlightMs(hit) + 1250)!;
    assert.equal(result.failed, false); assert.equal(result.performance, 8);
});

test('rejects malformed coordinates, early/future throws, overlapping throws and extra input after a catch', () => {
    const hit = intercept(), miss: KunaiThrow = { kind: 'throw', at: 650, x: 6, y: 12 };
    for (const events of [null, {}, [null], [{ ...hit, x: NaN }], [{ ...hit, y: Infinity }],
        [{ ...hit, x: 95 }], [{ ...hit, y: 11 }], [{ ...hit, kind: 'hook' }],
        [{ ...hit, at: 649 }], [{ ...hit, at: 17_001 }], [miss, { ...miss, at: 700 }],
        [hit, { ...miss, at: 5000 }], Array(4).fill(miss)]) {
        assert.equal(scoreKunaiFishing(seed, events, 18_000, true), null, JSON.stringify(events));
    }
    assert.equal(scoreKunaiFishing(seed, [hit], hit.at - 101, true), null);
    assert.equal(scoreKunaiFishing(seed, [], NaN), null);
});
