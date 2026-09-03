import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    cleanMiraaBet,
    FATE_DICE_COST,
    FATE_DICE_DAILY_CAP,
    FATE_DICE_SYMBOLS,
    resolveMiraaRefund,
    rollFateDice,
} from './_sunscar.js';

/** Walk one roll with a fixed symbol triple; extra draws (randInt) get 0.5. */
function rollWith(a: number, b: number, c: number) {
    const S = FATE_DICE_SYMBOLS.length;
    const queue = [a / S + 1e-9, b / S + 1e-9, c / S + 1e-9];
    return rollFateDice(() => (queue.length ? queue.shift() as number : 0.5));
}

describe('_sunscar', () => {
    it('keeps the dice FREE and the daily cap pinned', () => {
        assert.equal(FATE_DICE_COST, 0);
        assert.equal(FATE_DICE_DAILY_CAP, 5);
    });

    it('rolls the eye triple payout server-side', () => {
        const values = [0.34, 0.34, 0.34];
        const result = rollFateDice(() => values.shift() ?? 0.5);
        assert.deepEqual(result.roll, ['eye', 'eye', 'eye']);
        assert.deepEqual(result.reward, {
            ryo: 100,
            xp: 0,
            statPoints: 0,
            stamina: 0,
            boneCharms: 3,
            fateShards: 1,
            auraStones: 0,
        });
    });

    // THE load-bearing property. The Play content rating declares this draw is
    // not gambling, and that is only true while EVERY face pays: no stake, no
    // losing branch. If a zero-ryo outcome ever comes back, the declaration on
    // the store listing silently becomes false — so this is exhaustive, not a
    // spot check.
    it('has NO losing branch — every one of the 216 outcomes pays ryo', () => {
        const S = FATE_DICE_SYMBOLS.length;
        for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) for (let c = 0; c < S; c++) {
            const { roll, reward } = rollWith(a, b, c);
            assert.ok(reward.ryo > 0, `${roll.join('/')} paid no ryo — that is a losing branch`);
        }
    });

    it('NEVER pays stat points, xp, stamina or aura stones', () => {
        const S = FATE_DICE_SYMBOLS.length;
        for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) for (let c = 0; c < S; c++) {
            const { roll, reward } = rollWith(a, b, c);
            const label = roll.join('/');
            assert.equal(reward.statPoints, 0, `${label} must pay no stat points`);
            assert.equal(reward.xp, 0, `${label} must pay no xp`);
            assert.equal(reward.stamina, 0, `${label} must pay no stamina`);
            assert.equal(reward.auraStones, 0, `${label} must pay no aura stones`);
        }
    });

    it('keeps the free faucet small and the premium drip rare', () => {
        const S = FATE_DICE_SYMBOLS.length;
        const total = S * S * S;
        let ryo = 0;
        let shardOutcomes = 0;
        let charmOutcomes = 0;
        for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) for (let c = 0; c < S; c++) {
            const { reward } = rollWith(a, b, c);
            ryo += reward.ryo;
            if (reward.fateShards > 0) shardOutcomes++;
            if (reward.boneCharms > 0) charmOutcomes++;
        }
        const expectedRyo = ryo / total;
        // Free draw × 5/day. Bounded on BOTH sides: too low is pointless, too
        // high inflates ryo from outside the mission growth budget.
        assert.ok(expectedRyo > 30 && expectedRyo < 90, `expected ryo ${expectedRyo.toFixed(1)} outside the 30-90 band`);
        // Fate Shards ride the triple eye alone (1/216); bone charms any triple (6/216).
        assert.equal(shardOutcomes, 1);
        assert.equal(charmOutcomes, 6);
    });

    it('still sanitizes a sealed Miraa stake to the allowed ladder', () => {
        assert.equal(cleanMiraaBet(100), 100);
        assert.equal(cleanMiraaBet(75), 0);
        assert.equal(cleanMiraaBet('500'), 500);
        assert.equal(cleanMiraaBet(-50), 0);
    });

    it('refunds an in-flight Miraa stake in full — no roll, no losing branch', () => {
        for (const bet of [50, 100, 250, 500]) {
            assert.deepEqual(resolveMiraaRefund(bet), { outcome: 'refund', credit: bet });
        }
        // An unrecognised stake refunds nothing rather than inventing a payout.
        assert.deepEqual(resolveMiraaRefund(75), { outcome: 'refund', credit: 0 });
    });

    // Source assertion, same pattern as server-routes.test.ts: the wager is a
    // RATING commitment, not just a balance choice. Re-adding a staked outcome
    // would quietly falsify the Play content-rating questionnaire, so CI holds
    // the line rather than a code comment.
    it('keeps the staked wager OUT of the festival source', () => {
        // Matches DECLARATIONS, not prose — the header comments in these files
        // name the removed symbols on purpose, to explain why they are gone.
        for (const file of ['api/festival/_sunscar.ts', 'api/festival/sunscar.ts']) {
            const src = readFileSync(path.join(process.cwd(), file), 'utf8');
            assert.ok(!/(export\s+)?const\s+MIRAA_WIN_CHANCE\s*=/.test(src), `${file} reintroduced MIRAA_WIN_CHANCE`);
            assert.ok(!/function\s+resolveMiraaWager/.test(src), `${file} reintroduced resolveMiraaWager`);
        }
    });
});
