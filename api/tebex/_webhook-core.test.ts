import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'crypto';
import {
    TEBEX_WEBHOOK_IPS,
    MAX_PACKAGE_QUANTITY,
    tebexExpectedSignature,
    verifyTebexSignature,
    isTebexSourceIp,
    parseTebexWebhook,
    isValidationWebhook,
    isReversalWebhook,
    shardGrantsForPayment,
    type TebexWebhookEnvelope,
} from './_webhook-core.js';
import { shardPackage, type ShardPackage } from '../../shared/shard-packages.js';

const SECRET = '0d45982a10e3a072d0c1261c55dd9918';

/** Test lookup: provider package "4" is the 155-shard tier, everything else unknown. */
const lookup = (id: string): ShardPackage | null => (id === '4' ? shardPackage('shards-155') : null);

function payment(overrides: Record<string, unknown> = {}): TebexWebhookEnvelope {
    return {
        id: 'wh-1',
        type: 'payment.completed',
        date: '2026-08-31T00:00:00+00:00',
        subject: {
            transaction_id: 'tbx-abc123',
            status: { id: 1, description: 'Complete' },
            products: [{ id: 4, name: '155 Fate Shards', quantity: 1, username: { id: 'kaito', username: 'Kaito' } }],
            customer: { username: { id: 'kaito', username: 'Kaito' } },
            ...overrides,
        },
    };
}

describe('tebex signature verification', () => {
    it('matches the scheme from Tebex docs — HMAC over the SHA256 of the body', () => {
        const body = '{"id":"x"}';
        const expected = createHmac('sha256', SECRET)
            .update(createHash('sha256').update(body, 'utf8').digest('hex'), 'utf8')
            .digest('hex');
        assert.equal(tebexExpectedSignature(body, SECRET), expected);
        assert.equal(verifyTebexSignature(body, expected, SECRET), true);
    });

    it('⛔ fails closed when the secret is unset', () => {
        // An unconfigured deployment must reject everything, not accept everything.
        const body = '{"id":"x"}';
        assert.equal(verifyTebexSignature(body, tebexExpectedSignature(body, SECRET), ''), false);
    });

    it('rejects a tampered body, a wrong secret, and a missing signature', () => {
        const body = '{"id":"x"}';
        const sig = tebexExpectedSignature(body, SECRET);
        assert.equal(verifyTebexSignature('{"id":"y"}', sig, SECRET), false);
        assert.equal(verifyTebexSignature(body, sig, 'other-secret'), false);
        assert.equal(verifyTebexSignature(body, undefined, SECRET), false);
        assert.equal(verifyTebexSignature(body, '', SECRET), false);
        assert.equal(verifyTebexSignature('', sig, SECRET), false);
    });

    it('accepts the signature regardless of header case, and never throws', () => {
        const body = '{"id":"x"}';
        const sig = tebexExpectedSignature(body, SECRET);
        assert.equal(verifyTebexSignature(body, ` ${sig.toUpperCase()} `, SECRET), true);
        assert.equal(verifyTebexSignature(body, 'not-hex-and-short', SECRET), false);
    });
});

describe('tebex source ip allowlist', () => {
    it('accepts only the two published addresses', () => {
        for (const ip of TEBEX_WEBHOOK_IPS) assert.equal(isTebexSourceIp(ip), true);
        assert.equal(isTebexSourceIp('18.209.80.4'), false);
        assert.equal(isTebexSourceIp('127.0.0.1'), false);
        assert.equal(isTebexSourceIp(''), false);
        assert.equal(isTebexSourceIp(undefined), false);
        assert.equal(isTebexSourceIp(['18.209.80.3']), false);
    });
});

describe('envelope parsing', () => {
    it('accepts the standard envelope and defaults a missing subject', () => {
        const parsed = parseTebexWebhook({ id: 'a', type: 'validation.webhook', date: 'd' });
        assert.equal(parsed?.id, 'a');
        assert.deepEqual(parsed?.subject, {});
        assert.equal(isValidationWebhook(parsed!), true);
    });

    it('rejects anything without an id and a type', () => {
        assert.equal(parseTebexWebhook(null), null);
        assert.equal(parseTebexWebhook('{}'), null);
        assert.equal(parseTebexWebhook([]), null);
        assert.equal(parseTebexWebhook({ id: 'a' }), null);
        assert.equal(parseTebexWebhook({ type: 'payment.completed' }), null);
    });
});

describe('shard grant decision', () => {
    it('grants the catalogue amount for a completed payment', () => {
        const outcome = shardGrantsForPayment(payment(), lookup);
        assert.equal(outcome.action, 'grant');
        if (outcome.action !== 'grant') return;
        assert.equal(outcome.transactionId, 'tbx-abc123');
        assert.equal(outcome.playerName, 'kaito');
        assert.equal(outcome.totalShards, 155);
    });

    it('⛔ ignores any shard amount present in the payload', () => {
        // The decisive property: a payload claiming a huge amount still grants
        // exactly what the catalogue says the package is worth.
        const outcome = shardGrantsForPayment(payment({
            products: [{
                id: 4, quantity: 1, shards: 999_999, amount: 999_999,
                paid_price: { amount: 9999, currency: 'USD' },
                username: { id: 'kaito' },
            }],
        }), lookup);
        assert.equal(outcome.action, 'grant');
        if (outcome.action !== 'grant') return;
        assert.equal(outcome.totalShards, 155, 'must come from the catalogue, not the payload');
    });

    it('only pays out on status Complete', () => {
        for (const id of [2, 3, 18, 19, 21, -1]) {
            const outcome = shardGrantsForPayment(payment({ status: { id } }), lookup);
            assert.equal(outcome.action, 'ignore', `status ${id} must not grant`);
        }
    });

    it('ignores every webhook type that is not payment.completed', () => {
        for (const type of ['payment.declined', 'payment.refunded', 'recurring-payment.renewed', 'validation.webhook']) {
            const outcome = shardGrantsForPayment({ ...payment(), type }, lookup);
            assert.equal(outcome.action, 'ignore');
        }
    });

    it('skips packages it does not recognise rather than guessing', () => {
        const outcome = shardGrantsForPayment(payment({
            products: [{ id: 999, quantity: 1, username: { id: 'kaito' } }],
        }), lookup);
        assert.equal(outcome.action, 'ignore');
        if (outcome.action !== 'ignore') return;
        assert.equal(outcome.reason, 'no-known-packages');
    });

    it('grants only the known lines from a mixed basket', () => {
        const outcome = shardGrantsForPayment(payment({
            products: [
                { id: 999, quantity: 1, username: { id: 'kaito' } },
                { id: 4, quantity: 2, username: { id: 'kaito' } },
            ],
        }), lookup);
        assert.equal(outcome.action, 'grant');
        if (outcome.action !== 'grant') return;
        assert.equal(outcome.totalShards, 310);
        assert.equal(outcome.lines.length, 1);
    });

    it('caps quantity so a bad payload cannot mint without bound', () => {
        const outcome = shardGrantsForPayment(payment({
            products: [{ id: 4, quantity: 10_000, username: { id: 'kaito' } }],
        }), lookup);
        assert.equal(outcome.action, 'grant');
        if (outcome.action !== 'grant') return;
        assert.equal(outcome.lines[0]!.quantity, MAX_PACKAGE_QUANTITY);
        assert.equal(outcome.totalShards, 155 * MAX_PACKAGE_QUANTITY);
    });

    it('refuses to grant without a player identity', () => {
        const outcome = shardGrantsForPayment(payment({
            products: [{ id: 4, quantity: 1 }],
            customer: {},
        }), lookup);
        assert.equal(outcome.action, 'ignore');
        if (outcome.action !== 'ignore') return;
        assert.equal(outcome.reason, 'no-player-identity');
    });

    it('falls back to the customer ident when the product carries none', () => {
        const outcome = shardGrantsForPayment(payment({
            products: [{ id: 4, quantity: 1 }],
            customer: { username: { id: 'shiro' } },
        }), lookup);
        assert.equal(outcome.action, 'grant');
        if (outcome.action !== 'grant') return;
        assert.equal(outcome.playerName, 'shiro');
    });

    it('requires a transaction id, since that is the idempotency key', () => {
        const outcome = shardGrantsForPayment(payment({ transaction_id: '' }), lookup);
        assert.equal(outcome.action, 'ignore');
        if (outcome.action !== 'ignore') return;
        assert.equal(outcome.reason, 'missing-transaction-id');
    });

    it('flags reversals for an operator without auto-revoking', () => {
        assert.equal(isReversalWebhook({ ...payment(), type: 'payment.refunded' }), true);
        assert.equal(isReversalWebhook({ ...payment(), type: 'payment.dispute.lost' }), true);
        assert.equal(isReversalWebhook(payment()), false);
    });
});

describe('identity on a universal webstore', () => {
    /*
     * The store we actually run collects NO username — Tebex's own docs say so
     * for non-game webstores — so `username.id` arrives empty on every real
     * payment. Identity has to come from the `custom` blob our server sealed
     * into the basket. These are the payloads production will see; if they stop
     * resolving, players pay and receive nothing while the webhook answers 200.
     */
    it('resolves the player from product custom when no username exists', () => {
        const webhook = payment({
            products: [{ id: 4, name: '155 Fate Shards', quantity: 1, custom: { playerName: 'kaito' } }],
            customer: { first_name: 'K', username: null },
        });
        const outcome = shardGrantsForPayment(webhook, lookup);
        assert.equal(outcome.action, 'grant');
        if (outcome.action !== 'grant') return;
        assert.equal(outcome.playerName, 'kaito');
        assert.equal(outcome.totalShards, 155);
    });

    it('falls back to subject-level custom', () => {
        const webhook = payment({
            products: [{ id: 4, name: '155 Fate Shards', quantity: 1 }],
            customer: {},
            custom: { playerName: 'kaito' },
        });
        const outcome = shardGrantsForPayment(webhook, lookup);
        assert.equal(outcome.action, 'grant');
        if (outcome.action !== 'grant') return;
        assert.equal(outcome.playerName, 'kaito');
    });

    it('still ignores a payment it cannot attribute to anyone', () => {
        const webhook = payment({
            products: [{ id: 4, name: '155 Fate Shards', quantity: 1 }],
            customer: {},
        });
        const outcome = shardGrantsForPayment(webhook, lookup);
        assert.equal(outcome.action, 'ignore');
        if (outcome.action !== 'ignore') return;
        assert.equal(outcome.reason, 'no-player-identity');
    });
});
