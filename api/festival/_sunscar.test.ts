import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    cleanMiraaBet,
    FATE_DICE_COST,
    FATE_DICE_DAILY_CAP,
    FATE_DICE_SYMBOLS,
    MIRAA_WIN_CHANCE,
    resolveMiraaWager,
    rollFateDice,
} from './_sunscar.js';

describe('_sunscar', () => {
    it('keeps the dice cost and daily cap pinned', () => {
        assert.equal(FATE_DICE_COST, 250);
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
            fateShards: 3,
            auraStones: 5,
        });
    });

    it('NEVER pays stat points — progression is not purchasable with ryo', () => {
        // Every branch of the table, walked by its own rand() sequence.
        const rolls: Array<[string, number[]]> = [
            ['triple eye', [0.4, 0.4, 0.4]],
            ['other triple', [0.0, 0.0, 0.0, 0.5]],
            ['scorpion', [0.0, 0.9, 0.9]],
            ['coin', [0.2, 0.9, 0.9]],
            ['blade', [0.6, 0.9, 0.5]],
            ['moon', [0.7, 0.7, 0.9]],
            ['star only', [0.9, 0.9, 0.9]],
        ];
        for (const [label, values] of rolls) {
            const queue = [...values];
            const result = rollFateDice(() => queue.shift() ?? 0);
            assert.equal(result.reward.statPoints, 0, `${label} must pay no stat points`);
            assert.equal(result.reward.xp, 0, `${label} must pay no xp`);
        }
    });

    it('is a net ryo SINK at the current cost, not a faucet', () => {
        // Expected ryo return across the 6^3 symbol space must sit below the
        // pull cost — the dice are a gamble, and the old table was +EV.
        const S = FATE_DICE_SYMBOLS.length;
        let totalRyo = 0;
        for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) for (let c = 0; c < S; c++) {
            const seq = [a / S + 1e-9, b / S + 1e-9, c / S + 1e-9, 0.5];
            const queue = [...seq];
            totalRyo += rollFateDice(() => queue.shift() ?? 0).reward.ryo;
        }
        const expectedRyo = totalRyo / (S * S * S);
        assert.ok(expectedRyo < FATE_DICE_COST, `expected ryo ${expectedRyo.toFixed(1)} must be below the ${FATE_DICE_COST} cost`);
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
