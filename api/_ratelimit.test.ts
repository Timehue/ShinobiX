import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { kv } from './_storage.js';
import { allow, allowKv, hasBudget } from './_ratelimit.js';

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

describe('hasBudget (check without consuming)', () => {
    it('reports remaining budget without charging the bucket', () => {
        const key = `test-peek-${Math.random()}`;
        // Peeking must be free, or the failed-password guard would charge honest
        // clients on every request just for asking.
        for (let i = 0; i < 10; i++) assert.equal(hasBudget(key, 2), true);
        assert.equal(allow(key, 2, 60_000).ok, true);
        assert.equal(hasBudget(key, 2), true, 'one of two consumed');
        assert.equal(allow(key, 2, 60_000).ok, true);
        assert.equal(hasBudget(key, 2), false, 'budget exhausted');
    });

    it('reports budget again once the window elapses', async () => {
        const key = `test-peek-reset-${Math.random()}`;
        assert.equal(allow(key, 1, 50).ok, true);
        assert.equal(hasBudget(key, 1), false);
        await new Promise((r) => setTimeout(r, 70));
        assert.equal(hasBudget(key, 1), true);
    });
});

describe('scrypt denial-of-service guard on the generic auth path', () => {
    const authSource = readFileSync('api/_auth.ts', 'utf8');

    it('checks the failure budget BEFORE spending scrypt', () => {
        // verifyPlayerPassword is ~100ms of blocking single-threaded CPU. Checking
        // after the fact would not help: the CPU is already spent.
        const guard = authSource.indexOf('if (!hasBudget(failKey, PASSWORD_FAIL_LIMIT)) return null;');
        const verify = authSource.indexOf('await verifyPlayerPassword(canonical, pw)');
        assert.ok(guard > 0, 'the password path must consult a failure budget');
        assert.ok(verify > 0, 'the password path must still verify the password');
        assert.ok(guard < verify, 'the budget check must precede the scrypt call');
    });

    it('charges only failures, so the token-less fallback still works', () => {
        // When SESSION_SECRET is unset this path carries ALL traffic. Charging every
        // attempt would throttle honest play; a correct password must cost nothing.
        assert.match(
            authSource,
            /if \(!\(await verifyPlayerPassword\(canonical, pw\)\)\) \{\s*allow\(failKey, PASSWORD_FAIL_LIMIT, PASSWORD_FAIL_WINDOW_MS\);\s*return null;\s*\}/,
            'the failure bucket must be charged on failure only',
        );
        // A bare `allow(failKey...)` before the verify would charge successes too.
        const beforeVerify = authSource.slice(0, authSource.indexOf('await verifyPlayerPassword(canonical, pw)'));
        assert.doesNotMatch(beforeVerify, /allow\(failKey/, 'successes must not be charged');
    });

    it('keys the failure bucket on the client IP', () => {
        // The player name is attacker-supplied here, so keying on it would let a
        // rotating name mint unlimited scrypt budget.
        assert.match(authSource, /const failKey = `authpw-fail:\$\{clientIp\(req\) \?\? 'unknown'\}`/);
    });
});

describe('IP backstop for name-keyed buckets', () => {
    const source = readFileSync('api/_ratelimit.ts', 'utf8');

    it('charges an IP-keyed cap alongside every name-keyed check', () => {
        // ~17 handlers pass a name peeked from the request body BEFORE authenticating
        // it, so the key is attacker-controlled: rotating it mints a fresh bucket per
        // request and the per-account limit means nothing without this backstop.
        assert.match(source, /const IP_BACKSTOP_MULTIPLIER = \d+;/);
        assert.match(source, /allow\(`\$\{bucket\}:ipcap:\$\{ip\}`, limit \* IP_BACKSTOP_MULTIPLIER, windowMs\)/);

        // Both enforcement entry points must charge it, or the bypass survives in one.
        const sync = source.slice(source.indexOf('export function enforceRateLimit('), source.indexOf('export async function enforceRateLimitKv('));
        const durable = source.slice(source.indexOf('export async function enforceRateLimitKv('));
        assert.match(sync, /chargeIpBackstop\(req, bucket, limit, windowMs, authedName\)/);
        assert.match(durable, /chargeIpBackstop\(req, bucket, limit, windowMs, authedName\)/);
    });

    it('is a no-op when the bucket is already IP-keyed', () => {
        // Without this an IP-keyed bucket would be charged twice per request, halving
        // every anonymous endpoint's real limit.
        assert.match(source, /if \(!authedName\) return \{ ok: true \};/);
    });
});
