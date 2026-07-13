import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseLegacyTraining } from './_legacy.js';

describe('legacy stat training migration', () => {
    it('seals a bounded, tokenless stored session', () => {
        const endsAt = 2_000_000_000_000;
        const out = parseLegacyTraining({ stat: 'strength', endsAt, durationMs: 60 * 60 * 1000, statGain: 22, xp: 70 });
        assert.equal(out?.stat, 'strength');
        assert.equal(out?.startedAt, endsAt - 60 * 60 * 1000);
        assert.match(out?.token ?? '', /^legacy[A-Za-z0-9]+$/);
    });

    it('rejects token sessions, unknown durations, stats, and excessive grants', () => {
        const base = { stat: 'strength', endsAt: 2_000_000_000_000, durationMs: 60 * 60 * 1000, statGain: 22, xp: 70 };
        assert.equal(parseLegacyTraining({ ...base, token: 'sealed' }), null);
        assert.equal(parseLegacyTraining({ ...base, durationMs: 1234 }), null);
        assert.equal(parseLegacyTraining({ ...base, stat: 'adminPower' }), null);
        assert.equal(parseLegacyTraining({ ...base, statGain: 301 }), null);
        assert.equal(parseLegacyTraining({ ...base, xp: 751 }), null);
    });
});
