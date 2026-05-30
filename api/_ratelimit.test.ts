import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { allow } from './_ratelimit.js';

// Covers the in-memory bucket that underpins both rate-limit tiers AND the
// strict KV-outage fallback (allowKv strict=true delegates to allow()).
// Deterministic + pure: no KV, no network. Uses unique keys per case so the
// module-level bucket map doesn't bleed state between tests.

describe('allow (in-memory rate bucket)', () => {
    it('permits up to `limit` hits then blocks', () => {
        const key = `test-basic-${Math.random()}`;
        for (let i = 0; i < 5; i++) {
            assert.equal(allow(key, 5, 60_000).ok, true, `hit ${i + 1} should pass`);
        }
        const blocked = allow(key, 5, 60_000);
        assert.equal(blocked.ok, false, '6th hit over limit 5 should block');
        if (!blocked.ok) {
            assert.ok(
                blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 60_000,
                `retryAfterMs should be within the window, got ${blocked.retryAfterMs}`,
            );
        }
    });

    it('keeps separate buckets per key', () => {
        const a = `test-a-${Math.random()}`;
        const b = `test-b-${Math.random()}`;
        assert.equal(allow(a, 1, 60_000).ok, true);
        assert.equal(allow(a, 1, 60_000).ok, false, 'a is exhausted');
        assert.equal(allow(b, 1, 60_000).ok, true, 'b is independent of a');
    });

    it('resets after the window elapses', async () => {
        const key = `test-reset-${Math.random()}`;
        assert.equal(allow(key, 1, 50).ok, true);
        assert.equal(allow(key, 1, 50).ok, false, 'second hit within window blocks');
        await new Promise((r) => setTimeout(r, 70));
        assert.equal(allow(key, 1, 50).ok, true, 'window elapsed → bucket resets');
    });
});
