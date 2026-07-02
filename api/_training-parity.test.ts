import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { TRAINING_TIERS as CLIENT_TIERS, trainingStatGain as clientGain } from '../shinobij.client/src/lib/training-config.js';
import { TRAINING_TIERS as SERVER_TIERS, trainingStatGain as serverGain } from './_training-config.js';

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
