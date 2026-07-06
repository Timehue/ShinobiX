import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    cleanMiraaBet,
    cleanMiraaOutcome,
    FATE_DICE_COST,
    FATE_DICE_DAILY_CAP,
    miraaRyoDelta,
    rollFateDice,
} from './_sunscar.js';

describe('_sunscar', () => {
    it('keeps the dice cost and daily cap pinned', () => {
        assert.equal(FATE_DICE_COST, 25);
        assert.equal(FATE_DICE_DAILY_CAP, 5);
    });

    it('rolls the legendary eye triple payout server-side', () => {
        const values = [0.34, 0.34, 0.34];
        const result = rollFateDice(() => values.shift() ?? 0);
        assert.deepEqual(result.roll, ['eye', 'eye', 'eye']);
        assert.deepEqual(result.reward, {
            ryo: 0,
            xp: 0,
            stamina: 0,
            boneCharms: 10,
            fateShards: 5,
            auraStones: 5,
        });
    });

    it('sanitizes Miraa wagers and returns fixed deltas', () => {
        assert.equal(cleanMiraaBet(100), 100);
        assert.equal(cleanMiraaBet(75), 0);
        assert.equal(cleanMiraaOutcome('win'), 'win');
        assert.equal(cleanMiraaOutcome('cheat'), null);
        assert.equal(miraaRyoDelta(250, 'win'), 500);
        assert.equal(miraaRyoDelta(250, 'loss'), -250);
        assert.equal(miraaRyoDelta(250, 'forfeit'), -250);
        assert.equal(miraaRyoDelta(250, 'draw'), 0);
    });
});
