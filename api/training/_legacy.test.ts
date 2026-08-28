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

    it('rejects unknown durations, stats, and excessive grants', () => {
        const base = { stat: 'strength', endsAt: 2_000_000_000_000, durationMs: 60 * 60 * 1000, statGain: 22, xp: 70 };
        assert.equal(parseLegacyTraining({ ...base, durationMs: 1234 }), null);
        assert.equal(parseLegacyTraining({ ...base, stat: 'adminPower' }), null);
        assert.equal(parseLegacyTraining({ ...base, statGain: 301 }), null);
        assert.equal(parseLegacyTraining({ ...base, xp: 751 }), null);
    });

    // The build retired on 2026-07-12 minted a token but never wrote
    // startedAt/expiresAt. Those leases matched NEITHER validator — the modern one
    // needs both fields, and this parser used to refuse anything with a token — so
    // their owners could not collect, cancel, or start new training. 14 saves were
    // stranded that way for ~7 weeks; a token alone must not disqualify a lease.
    it('rescues a token-bearing lease that lacks the modern startedAt/expiresAt', () => {
        const endsAt = 2_000_000_000_000;
        const out = parseLegacyTraining({
            stat: 'strength', endsAt, durationMs: 4 * 60 * 60 * 1000,
            statGain: 84, xp: 220, token: '760cdb928fbe421781da30579188f615',
        });
        assert.equal(out?.stat, 'strength');
        assert.equal(out?.sealedGain, 84);
        assert.equal(out?.startedAt, endsAt - 4 * 60 * 60 * 1000);
        // The synthetic token keeps receipt/replay handling uniform across paths.
        assert.match(out?.token ?? '', /^legacy[A-Za-z0-9]+$/);
    });

    it('leaves a MODERN lease to normalizeActiveTrainingSession so it cannot double-pay', () => {
        const startedAt = 2_000_000_000_000;
        assert.equal(parseLegacyTraining({
            stat: 'strength', startedAt, endsAt: startedAt + 60 * 60 * 1000,
            expiresAt: startedAt + 2 * 60 * 60 * 1000,
            durationMs: 60 * 60 * 1000, statGain: 22, xp: 70, token: 'sealed',
        }), null);
    });

    // The deadlock was a record that satisfied NEITHER validator. Deferring here on
    // field shape ("has startedAt and expiresAt") rather than on what the modern
    // path will actually take would reopen that hole one shape over, so pin it: a
    // lease the modern validator turns down stays rescuable no matter which fields
    // it happens to carry.
    it('still rescues a lease the modern validator refuses, whatever fields it carries', () => {
        const startedAt = 2_000_000_000_000;
        const shape = {
            stat: 'strength', startedAt, endsAt: startedAt + 60 * 60 * 1000,
            expiresAt: startedAt + 2 * 60 * 60 * 1000,
            durationMs: 60 * 60 * 1000, statGain: 22, xp: 70,
        };
        // No token: normalizeActiveTrainingSession rejects it, so this parser must not.
        assert.equal(parseLegacyTraining(shape)?.sealedGain, 22);
        assert.equal(parseLegacyTraining({ ...shape, token: '   ' })?.sealedGain, 22);
        // expiresAt must exceed endsAt for the modern path; when it does not, the
        // lease is ours to rescue rather than something to stand down from.
        assert.equal(parseLegacyTraining({ ...shape, token: 'sealed', expiresAt: startedAt })?.sealedGain, 22);
    });
});
