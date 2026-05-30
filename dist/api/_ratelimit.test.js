"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _ratelimit_js_1 = require("./_ratelimit.js");
// Covers the in-memory bucket that underpins both rate-limit tiers AND the
// strict KV-outage fallback (allowKv strict=true delegates to allow()).
// Deterministic + pure: no KV, no network. Uses unique keys per case so the
// module-level bucket map doesn't bleed state between tests.
(0, node_test_1.describe)('allow (in-memory rate bucket)', () => {
    (0, node_test_1.it)('permits up to `limit` hits then blocks', () => {
        const key = `test-basic-${Math.random()}`;
        for (let i = 0; i < 5; i++) {
            node_assert_1.strict.equal((0, _ratelimit_js_1.allow)(key, 5, 60_000).ok, true, `hit ${i + 1} should pass`);
        }
        const blocked = (0, _ratelimit_js_1.allow)(key, 5, 60_000);
        node_assert_1.strict.equal(blocked.ok, false, '6th hit over limit 5 should block');
        if (!blocked.ok) {
            node_assert_1.strict.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 60_000, `retryAfterMs should be within the window, got ${blocked.retryAfterMs}`);
        }
    });
    (0, node_test_1.it)('keeps separate buckets per key', () => {
        const a = `test-a-${Math.random()}`;
        const b = `test-b-${Math.random()}`;
        node_assert_1.strict.equal((0, _ratelimit_js_1.allow)(a, 1, 60_000).ok, true);
        node_assert_1.strict.equal((0, _ratelimit_js_1.allow)(a, 1, 60_000).ok, false, 'a is exhausted');
        node_assert_1.strict.equal((0, _ratelimit_js_1.allow)(b, 1, 60_000).ok, true, 'b is independent of a');
    });
    (0, node_test_1.it)('resets after the window elapses', async () => {
        const key = `test-reset-${Math.random()}`;
        node_assert_1.strict.equal((0, _ratelimit_js_1.allow)(key, 1, 50).ok, true);
        node_assert_1.strict.equal((0, _ratelimit_js_1.allow)(key, 1, 50).ok, false, 'second hit within window blocks');
        await new Promise((r) => setTimeout(r, 70));
        node_assert_1.strict.equal((0, _ratelimit_js_1.allow)(key, 1, 50).ok, true, 'window elapsed → bucket resets');
    });
});
