import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The Tebex webhook's TRUST ORDER, asserted against the handler source.
 *
 * A source-order assertion rather than a behavioural one because the handler
 * reaches straight into storage (mutatePlayerSave), so exercising it would drag
 * in the database for a property that is really about which check runs first.
 * server-routes.test.ts and heartbeat-force-reload.test.ts guard their own
 * invariants the same way.
 *
 * ── WHY THIS ORDER IS LOAD-BEARING ────────────────────────────────────────
 * The IP allowlist used to gate first: anything not from Tebex's two published
 * addresses got a bare 404, before the signature was ever examined. This origin
 * sits behind Cloudflare AND Railway, so attributing a request to its true
 * source depends on CF-Connecting-IP / X-Forwarded-For resolving exactly right
 * through two proxies. When that slipped, a genuine correctly-signed delivery
 * was refused — silently, with no log line — and the player had already paid.
 *
 * The signature is the real authentication: an HMAC recomputed with a secret
 * only Tebex holds, which no proxy can disturb. It must be what decides.
 * Reverting to an IP-first gate reintroduces silent, paid-for data loss.
 */

const HANDLER = readFileSync(join(process.cwd(), 'api', 'tebex', 'webhook.ts'), 'utf8');

describe('tebex webhook trust order', () => {
    it('verifies the signature BEFORE consulting the source IP', () => {
        const signatureAt = HANDLER.indexOf('verifyTebexSignature(');
        const ipCheckAt = HANDLER.indexOf('isTebexSourceIp(');
        assert.ok(signatureAt > 0, 'handler must verify the Tebex signature');
        assert.ok(ipCheckAt > 0, 'handler should still evaluate the source IP');
        assert.ok(
            signatureAt < ipCheckAt,
            'the signature must be checked before the IP — an IP-first gate silently '
            + 'discards correctly-signed, already-paid deliveries when proxy attribution slips',
        );
    });

    it('never rejects on the source IP alone', () => {
        // The IP is a logged signal now. A `return` on the IP branch would mean
        // a signed webhook could still be thrown away over proxy attribution.
        const ipCheckAt = HANDLER.indexOf('isTebexSourceIp(');
        const branch = HANDLER.slice(ipCheckAt, ipCheckAt + 400);
        assert.ok(
            !/isTebexSourceIp\([^)]*\)\)\s*return/.test(HANDLER),
            'the source-IP check must not short-circuit the request',
        );
        assert.match(branch, /console\.warn/, 'an unlisted source IP must still be logged');
    });

    it('fails closed on a bad signature, and says why in the log', () => {
        // Both silent causes — an unset secret and a rawBody the parser never
        // captured — must leave a trace. They are indistinguishable from
        // Tebex's side, and used to leave none.
        assert.match(HANDLER, /secretConfigured/, 'log whether the webhook secret is configured');
        assert.match(HANDLER, /rawBodyBytes/, 'log whether the raw body was captured');
    });
});
