import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
    verifyWebhookSignature,
    signState,
    verifyState,
    computeEntitlement,
    parseWebhookMember,
    isPatreonSubscriber,
    patreonTier,
    SUBSCRIBER_TIER,
} from './_patreon.js';

// The core reads secrets from env at CALL time, so setting them here (after the
// hoisted imports, before any test runs) is sufficient.
process.env.PATREON_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.PATREON_SUB_MIN_CENTS = '1500';

test('verifyWebhookSignature accepts a correct HMAC-MD5 and rejects tampering', () => {
    const body = JSON.stringify({ data: { id: 'm1' } });
    const good = createHmac('md5', 'test-webhook-secret').update(body).digest('hex');
    const wrong = createHmac('md5', 'other-secret').update(body).digest('hex');

    assert.equal(verifyWebhookSignature(Buffer.from(body), good), true);
    assert.equal(verifyWebhookSignature(Buffer.from(body), wrong), false);
    // A single changed byte in the body invalidates the signature.
    assert.equal(verifyWebhookSignature(Buffer.from(body + ' '), good), false);
    assert.equal(verifyWebhookSignature(Buffer.from(body), ''), false);
});

test('signState / verifyState round-trip, and reject tampering + expiry', () => {
    // safeName normalizes to lowercase (matching how save:<name> keys are
    // stored), so a valid state round-trips to the normalized player name.
    const state = signState('Rill');
    assert.equal(verifyState(state), 'rill');
    assert.equal(verifyState(state + 'x'), null);   // corrupted signature
    assert.equal(verifyState('garbage'), null);
    assert.equal(verifyState(''), null);

    // A manually forged state with a past expiry must be rejected even though
    // its signature is valid.
    const past = `Rill.${Date.now() - 1000}`;
    const sig = createHmac('sha256', 'test-session-secret').update(past).digest('base64url');
    const expired = `${Buffer.from(past, 'utf8').toString('base64url')}.${sig}`;
    assert.equal(verifyState(expired), null);
});

test('computeEntitlement gates on active_patron AND the cents threshold', () => {
    assert.deepEqual(
        computeEntitlement({ patronStatus: 'active_patron', entitledCents: 1500, lastChargeStatus: 'Paid' }),
        { active: true, tier: SUBSCRIBER_TIER, entitledCents: 1500 },
    );
    // Active but below $15 → not a subscriber.
    assert.equal(computeEntitlement({ patronStatus: 'active_patron', entitledCents: 500, lastChargeStatus: 'Paid' }).active, false);
    // At/above $15 but not currently active → not a subscriber.
    assert.equal(computeEntitlement({ patronStatus: 'declined_patron', entitledCents: 1500, lastChargeStatus: 'Declined' }).active, false);
    assert.equal(computeEntitlement(null).active, false);
});

test('parseWebhookMember extracts the Patreon user id + membership', () => {
    const payload = {
        data: {
            type: 'member',
            attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: 1500 },
            relationships: { user: { data: { id: 'u123' } } },
        },
    };
    const parsed = parseWebhookMember(payload);
    assert.ok(parsed);
    assert.equal(parsed.userId, 'u123');
    assert.equal(parsed.membership.entitledCents, 1500);
    assert.equal(parsed.membership.patronStatus, 'active_patron');
    // No user relationship → not a usable member event.
    assert.equal(parseWebhookMember({ data: { attributes: {} } }), null);
    assert.equal(parseWebhookMember({}), null);
});

test('isPatreonSubscriber / patreonTier read the server-owned save flag', () => {
    assert.equal(isPatreonSubscriber({ patreon: { active: true, tier: SUBSCRIBER_TIER } }), true);
    assert.equal(isPatreonSubscriber({ patreon: { active: false } }), false);
    assert.equal(isPatreonSubscriber({}), false);
    assert.equal(isPatreonSubscriber(null), false);
    assert.equal(patreonTier({ patreon: { active: true, tier: SUBSCRIBER_TIER } }), SUBSCRIBER_TIER);
    assert.equal(patreonTier({ patreon: { active: false } }), null);
    assert.equal(patreonTier({}), null);
});

test('admin-comp expiry: a future expiresAt is active, a past one is not', () => {
    // A Patreon-driven sub has no expiresAt → always active while the flag is set.
    assert.equal(isPatreonSubscriber({ patreon: { active: true } }), true);
    // An admin comp with time remaining is active; a lapsed comp reads inactive
    // without any cron flipping the stored flag.
    assert.equal(isPatreonSubscriber({ patreon: { active: true, expiresAt: Date.now() + 60_000 } }), true);
    assert.equal(isPatreonSubscriber({ patreon: { active: true, expiresAt: Date.now() - 1_000 } }), false);
    assert.equal(patreonTier({ patreon: { active: true, tier: SUBSCRIBER_TIER, expiresAt: Date.now() - 1_000 } }), null);
});
