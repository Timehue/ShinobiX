import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { kv } from './_storage.js';
import { allow, allowKv } from './_ratelimit.js';

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

describe('allowKv (durable rate bucket)', () => {
    it('rejects the first request over the durable limit', async () => {
        const original = kv.incr;
        let count = 0;
        kv.incr = async () => ++count;
        try {
            const key = `test-kv-${Math.random()}`;
            assert.equal((await allowKv(key, 2, 60_000, true)).ok, true);
            assert.equal((await allowKv(key, 2, 60_000, true)).ok, true);
            assert.equal((await allowKv(key, 2, 60_000, true)).ok, false);
        } finally {
            kv.incr = original;
        }
    });

    it('strict mode retains a local ceiling during a KV outage', async () => {
        const original = kv.incr;
        kv.incr = async () => { throw new Error('simulated outage'); };
        try {
            const key = `test-strict-${Math.random()}`;
            assert.equal((await allowKv(key, 1, 60_000, true)).ok, true);
            assert.equal((await allowKv(key, 1, 60_000, true)).ok, false);
        } finally {
            kv.incr = original;
        }
    });

    it('admin login is wired to the durable strict limiter', () => {
        const source = readFileSync('api/admin-auth.ts', 'utf8');
        assert.match(source, /enforceRateLimitKv\([^;]+admin-auth[^;]+strict:\s*true/s);
    });
});
