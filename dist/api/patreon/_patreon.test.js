"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const crypto_1 = require("crypto");
const _patreon_js_1 = require("./_patreon.js");
// The core reads secrets from env at CALL time, so setting them here (after the
// hoisted imports, before any test runs) is sufficient.
process.env.PATREON_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.PATREON_SUB_MIN_CENTS = '1500';
(0, node_test_1.test)('verifyWebhookSignature accepts a correct HMAC-MD5 and rejects tampering', () => {
    const body = JSON.stringify({ data: { id: 'm1' } });
    const good = (0, crypto_1.createHmac)('md5', 'test-webhook-secret').update(body).digest('hex');
    const wrong = (0, crypto_1.createHmac)('md5', 'other-secret').update(body).digest('hex');
    strict_1.default.equal((0, _patreon_js_1.verifyWebhookSignature)(Buffer.from(body), good), true);
    strict_1.default.equal((0, _patreon_js_1.verifyWebhookSignature)(Buffer.from(body), wrong), false);
    // A single changed byte in the body invalidates the signature.
    strict_1.default.equal((0, _patreon_js_1.verifyWebhookSignature)(Buffer.from(body + ' '), good), false);
    strict_1.default.equal((0, _patreon_js_1.verifyWebhookSignature)(Buffer.from(body), ''), false);
});
(0, node_test_1.test)('signState / verifyState round-trip, and reject tampering + expiry', () => {
    // safeName normalizes to lowercase (matching how save:<name> keys are
    // stored), so a valid state round-trips to the normalized player name.
    const state = (0, _patreon_js_1.signState)('Rill');
    strict_1.default.equal((0, _patreon_js_1.verifyState)(state), 'rill');
    strict_1.default.equal((0, _patreon_js_1.verifyState)(state + 'x'), null); // corrupted signature
    strict_1.default.equal((0, _patreon_js_1.verifyState)('garbage'), null);
    strict_1.default.equal((0, _patreon_js_1.verifyState)(''), null);
    // A manually forged state with a past expiry must be rejected even though
    // its signature is valid.
    const past = `Rill.${Date.now() - 1000}`;
    const sig = (0, crypto_1.createHmac)('sha256', 'test-session-secret').update(past).digest('base64url');
    const expired = `${Buffer.from(past, 'utf8').toString('base64url')}.${sig}`;
    strict_1.default.equal((0, _patreon_js_1.verifyState)(expired), null);
});
(0, node_test_1.test)('computeEntitlement gates on active_patron AND the cents threshold', () => {
    strict_1.default.deepEqual((0, _patreon_js_1.computeEntitlement)({ patronStatus: 'active_patron', entitledCents: 1500, lastChargeStatus: 'Paid' }), { active: true, tier: _patreon_js_1.SUBSCRIBER_TIER, entitledCents: 1500 });
    // Active but below $15 → not a subscriber.
    strict_1.default.equal((0, _patreon_js_1.computeEntitlement)({ patronStatus: 'active_patron', entitledCents: 500, lastChargeStatus: 'Paid' }).active, false);
    // At/above $15 but not currently active → not a subscriber.
    strict_1.default.equal((0, _patreon_js_1.computeEntitlement)({ patronStatus: 'declined_patron', entitledCents: 1500, lastChargeStatus: 'Declined' }).active, false);
    strict_1.default.equal((0, _patreon_js_1.computeEntitlement)(null).active, false);
});
(0, node_test_1.test)('parseWebhookMember extracts the Patreon user id + membership', () => {
    const payload = {
        data: {
            type: 'member',
            attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: 1500 },
            relationships: { user: { data: { id: 'u123' } } },
        },
    };
    const parsed = (0, _patreon_js_1.parseWebhookMember)(payload);
    strict_1.default.ok(parsed);
    strict_1.default.equal(parsed.userId, 'u123');
    strict_1.default.equal(parsed.membership.entitledCents, 1500);
    strict_1.default.equal(parsed.membership.patronStatus, 'active_patron');
    // No user relationship → not a usable member event.
    strict_1.default.equal((0, _patreon_js_1.parseWebhookMember)({ data: { attributes: {} } }), null);
    strict_1.default.equal((0, _patreon_js_1.parseWebhookMember)({}), null);
});
(0, node_test_1.test)('isPatreonSubscriber / patreonTier read the server-owned save flag', () => {
    strict_1.default.equal((0, _patreon_js_1.isPatreonSubscriber)({ patreon: { active: true, tier: _patreon_js_1.SUBSCRIBER_TIER } }), true);
    strict_1.default.equal((0, _patreon_js_1.isPatreonSubscriber)({ patreon: { active: false } }), false);
    strict_1.default.equal((0, _patreon_js_1.isPatreonSubscriber)({}), false);
    strict_1.default.equal((0, _patreon_js_1.isPatreonSubscriber)(null), false);
    strict_1.default.equal((0, _patreon_js_1.patreonTier)({ patreon: { active: true, tier: _patreon_js_1.SUBSCRIBER_TIER } }), _patreon_js_1.SUBSCRIBER_TIER);
    strict_1.default.equal((0, _patreon_js_1.patreonTier)({ patreon: { active: false } }), null);
    strict_1.default.equal((0, _patreon_js_1.patreonTier)({}), null);
});
(0, node_test_1.test)('admin-comp expiry: a future expiresAt is active, a past one is not', () => {
    // A Patreon-driven sub has no expiresAt → always active while the flag is set.
    strict_1.default.equal((0, _patreon_js_1.isPatreonSubscriber)({ patreon: { active: true } }), true);
    // An admin comp with time remaining is active; a lapsed comp reads inactive
    // without any cron flipping the stored flag.
    strict_1.default.equal((0, _patreon_js_1.isPatreonSubscriber)({ patreon: { active: true, expiresAt: Date.now() + 60_000 } }), true);
    strict_1.default.equal((0, _patreon_js_1.isPatreonSubscriber)({ patreon: { active: true, expiresAt: Date.now() - 1_000 } }), false);
    strict_1.default.equal((0, _patreon_js_1.patreonTier)({ patreon: { active: true, tier: _patreon_js_1.SUBSCRIBER_TIER, expiresAt: Date.now() - 1_000 } }), null);
});
