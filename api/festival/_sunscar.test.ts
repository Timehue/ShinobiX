import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    cleanMiraaBet,
    FATE_DICE_COST,
    FATE_DICE_DAILY_CAP,
    MIRAA_WIN_CHANCE,
    resolveMiraaWager,
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
            statPoints: 0,
            stamina: 0,
            boneCharms: 10,
            fateShards: 5,
            auraStones: 5,
        });
    });

    it('the dice pay tiny stat-pool points where they used to pay XP', () => {
        // moon (no triple, no scorpion/coin/blade in the roll): +5 pool points.
        const values = [0.7, 0.7, 0.9]; // moon, moon, star → includes moon
        const result = rollFateDice(() => values.shift() ?? 0);
        assert.equal(result.reward.xp, 0);
        assert.equal(result.reward.statPoints, 5);
        assert.equal(result.reward.ryo, 25);
    });

    it('sanitizes Miraa wagers to the allowed bet ladder', () => {
        assert.equal(cleanMiraaBet(100), 100);
        assert.equal(cleanMiraaBet(75), 0);
        assert.equal(cleanMiraaBet('500'), 500);
        assert.equal(cleanMiraaBet(-50), 0);
    });

    it('pins the owner-approved Miraa win chance', () => {
        assert.equal(MIRAA_WIN_CHANCE, 0.4);
    });

    it('server-rolls Miraa from the sealed bet — never a client outcome', () => {
        // rand() < 0.4 → WIN: pays 2×stake back (net +bet vs. the escrow taken at
        // start), right up to the boundary.
        assert.deepEqual(resolveMiraaWager(250, false, () => 0.1), { outcome: 'win', credit: 500 });
        assert.deepEqual(resolveMiraaWager(250, false, () => 0.39999), { outcome: 'win', credit: 500 });
        // rand() >= 0.4 → LOSS: no credit, the escrowed stake is kept (net −bet).
        assert.deepEqual(resolveMiraaWager(250, false, () => 0.4), { outcome: 'loss', credit: 0 });
        assert.deepEqual(resolveMiraaWager(250, false, () => 0.9), { outcome: 'loss', credit: 0 });
        // Forfeit (left mid-match) is an automatic loss with no roll.
        assert.deepEqual(resolveMiraaWager(250, true, () => 0.0), { outcome: 'forfeit', credit: 0 });
        // Invalid bets never pay.
        assert.deepEqual(resolveMiraaWager(75, false, () => 0.0), { outcome: 'loss', credit: 0 });
    });
});
