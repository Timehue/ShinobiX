import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ROAD_FLEE_HP_SHARE, ROAD_FLEE_RYO_SHARE, roadFleeCost } from './road-flee.js';
import { hospitalDischargeBaseCost } from './hospital-discharge-cost.js';

describe('road flee cost', () => {
    it('takes half your HP and a tenth of the ryo you carry', () => {
        assert.equal(ROAD_FLEE_HP_SHARE, 0.5);
        assert.equal(ROAD_FLEE_RYO_SHARE, 0.1);
        assert.deepEqual(roadFleeCost(800, 1_000, 60), { hp: 400, ryo: 100 });
        assert.deepEqual(roadFleeCost(801, 1_009, 60), { hp: 400, ryo: 100 }, 'whole points, rounded down');
    });

    it('never knocks you out', () => {
        assert.deepEqual(roadFleeCost(1, 0, 10), { hp: 0, ryo: 0 });
        assert.deepEqual(roadFleeCost(2, 0, 10), { hp: 1, ryo: 0 });
        assert.deepEqual(roadFleeCost(3, 0, 10), { hp: 1, ryo: 0 });
        for (let hp = 1; hp <= 50; hp += 1) {
            assert.ok(hp - roadFleeCost(hp, 0, 10).hp >= 1, `${hp} HP must keep at least one point`);
        }
    });

    it('never costs more ryo than the hospital charges to skip its timer', () => {
        assert.deepEqual(roadFleeCost(100, 1_000_000, 100), { hp: 50, ryo: hospitalDischargeBaseCost(100) });
        assert.deepEqual(roadFleeCost(100, 1_000_000, 1), { hp: 50, ryo: hospitalDischargeBaseCost(1) });
        assert.equal(roadFleeCost(100, 10_000, 20).ryo, hospitalDischargeBaseCost(20));
        assert.equal(roadFleeCost(100, 2_000, 20).ryo, 200, 'a small purse pays its percentage under the cap');
    });

    it('treats missing, negative and malformed values as nothing to lose', () => {
        assert.deepEqual(roadFleeCost(undefined, undefined, undefined), { hp: 0, ryo: 0 });
        assert.deepEqual(roadFleeCost(-50, -10, 50), { hp: 0, ryo: 0 });
        assert.deepEqual(roadFleeCost('abc', Number.NaN, 'x'), { hp: 0, ryo: 0 });
        assert.deepEqual(roadFleeCost(Number.POSITIVE_INFINITY, 500, 50), { hp: 0, ryo: 50 });
    });
});
