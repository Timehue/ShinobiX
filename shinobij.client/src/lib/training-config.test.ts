import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { LEGACY_TRAINING_TIERS, TRAINING_TIERS, trainingStatGain, trainingTiersFor } from './training-config';

// Pins the two-axis training gains and the cross-tier slope
// (docs/leveling-training-redesign-plan.md). The days-to-L90 pace is measured
// by the day-stepped server replay in api/_progression-pacing-replay.test.ts.

const byId: Record<string, (typeof TRAINING_TIERS)[number]> =
    Object.fromEntries(TRAINING_TIERS.map((t) => [t.id, t]));

describe('training tiers — full-session gains (10.5/9/8.25/8.125 per hour → 3/9/33/65)', () => {
    it('matches the calibrated table', () => {
        assert.equal(trainingStatGain(byId['15m'], byId['15m'].ms), 3);   // 10.5 × 0.25 = 2.625 → 3
        assert.equal(trainingStatGain(byId['1h'], byId['1h'].ms), 9);
        assert.equal(trainingStatGain(byId['4h'], byId['4h'].ms), 33);
        assert.equal(trainingStatGain(byId['8h'], byId['8h'].ms), 65);
    });
    it('is offline-safe: elapsed past the tier duration never over-grants', () => {
        assert.equal(trainingStatGain(byId['8h'], byId['8h'].ms * 5), 65);
    });
    it('prorates linearly within a tier and floors at 0', () => {
        assert.equal(trainingStatGain(byId['8h'], byId['8h'].ms / 2), 33); // 8.125 × 4 = 32.5 → 33
        assert.equal(trainingStatGain(byId['1h'], 0), 0);
        assert.equal(trainingStatGain(byId['1h'], -1000), 0);
    });
    it('applies the village training bonus multiplicatively', () => {
        assert.equal(trainingStatGain(byId['8h'], byId['8h'].ms, 50), 98); // 65 × 1.5 = 97.5 → 98
    });
    it('the kill-switch table is the pre-rebalance 3/10/38/72, selected only by "legacy"', () => {
        assert.deepEqual(LEGACY_TRAINING_TIERS.map((t) => trainingStatGain(t, t.ms)), [3, 10, 38, 72]);
        assert.equal(trainingTiersFor('legacy'), LEGACY_TRAINING_TIERS);
        assert.equal(trainingTiersFor('v2'), TRAINING_TIERS);
    });
});

// The slope rules hold for the live table AND the kill-switch table, so the
// emergency rollback can never break them either.
for (const [name, tiers] of [['v2', TRAINING_TIERS], ['legacy', LEGACY_TRAINING_TIERS]] as const) {
    const tier: Record<string, (typeof tiers)[number]> = Object.fromEntries(tiers.map((t) => [t.id, t]));
    const chained = (id: string) =>
        trainingStatGain(tier[id], tier[id].ms) * Math.floor((24 * 60 * 60 * 1000) / tier[id].ms);

    describe(`cross-tier slope (${name}) — shorter tiers pay more, and chaining them wins`, () => {
        it('per-hour rates descend with tier length', () => {
            for (let i = 1; i < tiers.length; i++) {
                assert.ok(
                    tiers[i].ratePerHour < tiers[i - 1].ratePerHour,
                    `${tiers[i].id} must pay strictly less per hour than ${tiers[i - 1].id}`,
                );
            }
        });

        it('chaining a SHORTER tier over 24h out-earns a longer one — the engagement reward', () => {
            // This is the reason short tiers exist. MAX_TRAINING_STARTS_PER_DAY = 96
            // (= 24h / 15min) lets any tier cover the full day, so the ordering below
            // is what makes coming back often worth doing. A flat table would delete
            // the incentive entirely — do not "balance" these to equality.
            assert.ok(chained('15m') > chained('1h'), `15m ${chained('15m')} must beat 1h ${chained('1h')}`);
            assert.ok(chained('1h') > chained('4h'), `1h ${chained('1h')} must beat 4h ${chained('4h')}`);
            assert.ok(chained('4h') > chained('8h'), `4h ${chained('4h')} must beat 8h ${chained('8h')}`);
            // …but the payoff for 96 clicks a day stays modest, not a different game.
            assert.ok(chained('15m') / chained('8h') < 1.5, 'the short-tier edge must stay under 1.5×');
        });
    });
}

describe('rebalanced per-hour rates (2026-10, framework S1)', () => {
    it('pays 10.5 / 9 / 8.25 / 8.125 per hour: 288 > 216 > 198 > 195 a day', () => {
        assert.equal(byId['15m'].ratePerHour, 10.5);
        assert.equal(byId['1h'].ratePerHour, 9);
        assert.equal(byId['4h'].ratePerHour, 8.25);
        assert.equal(byId['8h'].ratePerHour, 8.125);
        const chained = (id: string) => trainingStatGain(byId[id], byId[id].ms) * Math.floor((24 * 60 * 60 * 1000) / byId[id].ms);
        assert.deepEqual(['15m', '1h', '4h', '8h'].map(chained), [288, 216, 198, 195]);
    });
});

describe('reference 24h regimen', () => {
    // The owner's reference regimen (2026-08-17): 12× 1h + 1× 4h + 1× 8h — full
    // 24-hour coverage. This asserts the RATE, not a day count: training is only
    // part of the ledger (the rookie curve front-loads the first levels and the
    // daily checklist adds up to 45/day), so the days-to-L90 pace is measured by
    // the replay in api/_progression-pacing-replay.test.ts.
    const perDay = (id: string) => trainingStatGain(byId[id], byId[id].ms);
    const referencePerDay = 12 * perDay('1h') + perDay('4h') + perDay('8h');

    it('the reference 24h regimen yields 206 points/day', () => {
        assert.equal(referencePerDay, 206);
    });

    it('the reference regimen sits between the laziest and the most attentive 24h plans', () => {
        const chained = (id: string) => perDay(id) * Math.floor((24 * 60 * 60 * 1000) / byId[id].ms);
        assert.ok(referencePerDay > chained('8h'), 'a mostly-1h regimen must beat three 8h sessions');
        assert.ok(referencePerDay < chained('15m'), 'but must not beat full 15m chaining');
    });
});
