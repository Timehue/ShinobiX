import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { TRAINING_TIERS, trainingStatGain } from './training-config';

// Pins the two-axis training gains + the ~90-day-to-cap pacing anchor
// (docs/leveling-training-redesign-plan.md). A later rate tweak that would break
// the 90-day target or the gentle cross-tier slope fails here.

const byId: Record<string, (typeof TRAINING_TIERS)[number]> =
    Object.fromEntries(TRAINING_TIERS.map((t) => [t.id, t]));

describe('training tiers — full-session gains (10.5/10/9.5/9 per hour → 3/10/38/72)', () => {
    it('matches the calibrated table', () => {
        assert.equal(trainingStatGain(byId['15m'], byId['15m'].ms), 3);   // 10.5 × 0.25 = 2.625 → 3
        assert.equal(trainingStatGain(byId['1h'], byId['1h'].ms), 10);
        assert.equal(trainingStatGain(byId['4h'], byId['4h'].ms), 38);
        assert.equal(trainingStatGain(byId['8h'], byId['8h'].ms), 72);
    });
    it('is offline-safe: elapsed past the tier duration never over-grants', () => {
        assert.equal(trainingStatGain(byId['8h'], byId['8h'].ms * 5), 72);
    });
    it('prorates linearly within a tier and floors at 0', () => {
        assert.equal(trainingStatGain(byId['8h'], byId['8h'].ms / 2), 36);
        assert.equal(trainingStatGain(byId['1h'], 0), 0);
        assert.equal(trainingStatGain(byId['1h'], -1000), 0);
    });
    it('applies the village training bonus multiplicatively', () => {
        assert.equal(trainingStatGain(byId['8h'], byId['8h'].ms, 50), 108); // 72 × 1.5
    });
});

describe('cross-tier slope — shorter tiers pay more, and chaining them wins', () => {
    it('per-hour rates descend with tier length', () => {
        assert.equal(byId['15m'].ratePerHour, 10.5);
        assert.equal(byId['1h'].ratePerHour, 10);
        assert.equal(byId['4h'].ratePerHour, 9.5);
        assert.equal(byId['8h'].ratePerHour, 9);
        for (let i = 1; i < TRAINING_TIERS.length; i++) {
            assert.ok(
                TRAINING_TIERS[i].ratePerHour < TRAINING_TIERS[i - 1].ratePerHour,
                `${TRAINING_TIERS[i].id} must pay strictly less per hour than ${TRAINING_TIERS[i - 1].id}`,
            );
        }
    });

    it('chaining a SHORTER tier over 24h out-earns a longer one — the engagement reward', () => {
        // This is the reason short tiers exist. MAX_TRAINING_STARTS_PER_DAY = 96
        // (= 24h / 15min) lets any tier cover the full day, so the ordering below
        // is what makes coming back often worth doing. A flat table would delete
        // the incentive entirely — do not "balance" these to equality.
        const chained = (id: string) =>
            trainingStatGain(byId[id], byId[id].ms) * Math.floor((24 * 60 * 60 * 1000) / byId[id].ms);
        assert.ok(chained('15m') > chained('1h'), `15m ${chained('15m')} must beat 1h ${chained('1h')}`);
        assert.ok(chained('1h') > chained('4h'), `1h ${chained('1h')} must beat 4h ${chained('4h')}`);
        assert.ok(chained('4h') > chained('8h'), `4h ${chained('4h')} must beat 8h ${chained('8h')}`);
        // …but the payoff for 96 clicks a day stays modest, not a different game.
        assert.ok(chained('15m') / chained('8h') < 1.5, 'the short-tier edge must stay under 1.5×');
    });
});

describe('~90-day-to-cap pacing anchor', () => {
    // The owner's reference regimen (2026-08-17): 12× 1h + 1× 4h + 1× 8h — full
    // 24-hour coverage. This is the CEILING the pace is set against; anyone
    // covering less of the day scales down proportionally. The previous anchor
    // assumed ~16 train-hours/day, which understated the ceiling: 24h coverage
    // has always been reachable (MAX_TRAINING_STARTS_PER_DAY = 96).
    //
    // This asserts the RATE, not a closed-form day count. Training alone is only
    // part of the ledger — the rookie curve front-loads the first ~10 days and
    // the daily checklist adds ~60/day — so days-to-cap can only be measured by
    // running the real grant path. Measured there: 96× 15m ~74 days, the
    // reference regimen ~90, 3× 8h ~94, 16h/day ~127, one 8h/day ~267.
    const perDay = (id: string) => trainingStatGain(byId[id], byId[id].ms);
    const referencePerDay = 12 * perDay('1h') + perDay('4h') + perDay('8h');

    it('the reference 24h regimen yields the calibrated 230 points/day', () => {
        assert.equal(referencePerDay, 230);
    });

    it('the reference regimen sits between the laziest and the most attentive 24h plans', () => {
        const chained = (id: string) => perDay(id) * Math.floor((24 * 60 * 60 * 1000) / byId[id].ms);
        assert.ok(referencePerDay > chained('8h'), 'a mostly-1h regimen must beat three 8h sessions');
        assert.ok(referencePerDay < chained('15m'), 'but must not beat full 15m chaining');
    });
});
