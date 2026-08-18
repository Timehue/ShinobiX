import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    TRAINING_TIERS as CLIENT_TIERS,
    trainingStatGain as clientGain,
    rookieStatMultiplier as clientRookie,
    ROOKIE_STAT_PEAK_MULTIPLIER as CLIENT_PEAK,
    ROOKIE_TAPER_END_LEVEL as CLIENT_END,
} from '../shinobij.client/src/lib/training-config.js';
import {
    TRAINING_TIERS as SERVER_TIERS,
    trainingStatGain as serverGain,
    rookieStatMultiplier as serverRookie,
    ROOKIE_STAT_PEAK_MULTIPLIER as SERVER_PEAK,
    ROOKIE_TAPER_END_LEVEL as SERVER_END,
} from './_training-config.js';
import { MAX_SEALED_STAT_GAIN } from './training/_session.js';
import { WAR_BUFF_TRAINING_XP_MULT, WAR_DEBUFF_TRAINING_XP_MULT } from './_war-morale.js';

// Pins the server training config (api/_training-config.ts) to the client copy
// (shinobij.client/src/lib/training-config.ts) so /api/training/start seals the
// exact gain the client shows and applies. A drift in either side breaks here.

describe('training-config parity — server mirrors client', () => {
    it('has identical tier tables', () => {
        assert.equal(SERVER_TIERS.length, CLIENT_TIERS.length);
        for (let i = 0; i < CLIENT_TIERS.length; i++) {
            const c = CLIENT_TIERS[i], s = SERVER_TIERS[i];
            assert.equal(s.id, c.id, `tier ${i} id`);
            assert.equal(s.ms, c.ms, `tier ${c.id} ms`);
            assert.equal(s.ratePerHour, c.ratePerHour, `tier ${c.id} ratePerHour`);
            assert.equal(s.xp, c.xp, `tier ${c.id} xp`);
            assert.equal(s.staminaCost, c.staminaCost, `tier ${c.id} staminaCost`);
        }
    });
    it('trainingStatGain is identical across tiers, elapsed fractions, and bonuses', () => {
        for (const tier of CLIENT_TIERS) {
            for (const frac of [0, 0.25, 0.5, 1, 5]) {
                for (const bonus of [0, 25, 60]) {
                    const elapsed = tier.ms * frac;
                    assert.equal(serverGain(tier, elapsed, bonus), clientGain(tier, elapsed, bonus), `${tier.id} frac ${frac} bonus ${bonus}`);
                }
            }
        }
    });
});

describe('rookie momentum curve — server mirrors client', () => {
    it('shares the same dials', () => {
        assert.equal(SERVER_PEAK, CLIENT_PEAK);
        assert.equal(SERVER_END, CLIENT_END);
    });

    it('is identical at every level and on junk input', () => {
        for (let level = 0; level <= 120; level++) {
            assert.equal(serverRookie(level), clientRookie(level), `parity at L${level}`);
        }
        for (const junk of [undefined, null, NaN, -5, '12', 1.9]) {
            assert.equal(serverRookie(junk), clientRookie(junk), `parity on ${String(junk)}`);
        }
    });

    it('peaks at level 1, reaches exactly 1.0 at the taper end, and never drops below it', () => {
        assert.equal(serverRookie(1), SERVER_PEAK);
        assert.equal(serverRookie(SERVER_END), 1);
        for (const level of [SERVER_END, SERVER_END + 1, 60, 100, 999]) {
            assert.equal(serverRookie(level), 1, `flat at L${level}`);
        }
        // Never a nerf: no level is ever slower than an untouched rate.
        for (let level = 1; level <= 120; level++) {
            assert.ok(serverRookie(level) >= 1, `>= 1 at L${level}`);
        }
    });

    it('decreases monotonically, with no cliff at any single level-up', () => {
        for (let level = 1; level < 120; level++) {
            const here = serverRookie(level);
            const next = serverRookie(level + 1);
            assert.ok(next <= here, `monotone at L${level}`);
            // A single level-up must never cut the rate by more than 15% —
            // a cliff would make levelling feel like a punishment.
            assert.ok(next >= here * 0.85, `no cliff at L${level}: ${here} → ${next}`);
        }
    });

    it('a sealed 8h grant stays inside the session validation bound', () => {
        const eightHour = SERVER_TIERS.find((tier) => tier.id === '8h')!;
        // The worst case a lease can carry, in the order api/training/start.ts
        // actually applies them: the tier base × the 2.5 aggregate boost ceiling
        // × the rookie peak (trustedTrainingRewards) × the war-morale ceiling
        // (applyMoraleToGain, applied AFTER the seal). It must stay under
        // MAX_SEALED_STAT_GAIN or storedTrainingGrant rejects a legitimate lease
        // at completion — the player would lose a finished session.
        const moraleCeiling = Math.max(WAR_BUFF_TRAINING_XP_MULT, WAR_DEBUFF_TRAINING_XP_MULT);
        const worstCase = Math.round(serverGain(eightHour, eightHour.ms, 0) * 2.5 * SERVER_PEAK * moraleCeiling);
        assert.ok(
            worstCase <= MAX_SEALED_STAT_GAIN,
            `worst-case sealed gain ${worstCase} exceeds MAX_SEALED_STAT_GAIN ${MAX_SEALED_STAT_GAIN}`,
        );
    });
});
