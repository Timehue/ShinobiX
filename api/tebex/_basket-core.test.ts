import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    BASKET_CUSTOM_PLAYER_KEY,
    basketCustomForPlayer,
    buildAddPackageBody,
    buildCreateBasketBody,
    parseCreatedBasket,
    readPlayerNameFromCustom,
    tebexPackageIdFor,
} from './_basket-core.js';
import { PROVIDER_PACKAGE_IDS } from '../../shared/shard-packages.js';

/** Run `body` with a temporary Tebex id mapping, always restoring it after. */
function withTebexMapping(map: Record<string, string>, body: () => void): void {
    const original = PROVIDER_PACKAGE_IDS.tebex;
    PROVIDER_PACKAGE_IDS.tebex = map as typeof original;
    try { body(); } finally { PROVIDER_PACKAGE_IDS.tebex = original; }
}

describe('basket identity round trip', () => {
    it('carries the player name through custom and back out', () => {
        const custom = basketCustomForPlayer('kaito');
        assert.equal(custom[BASKET_CUSTOM_PLAYER_KEY], 'kaito');
        assert.equal(readPlayerNameFromCustom(custom), 'kaito');
    });

    it('reads custom that Tebex handed back as a JSON string', () => {
        // Some store configurations round-trip `custom` as text rather than an
        // object. Failing that parse would strand a real purchase.
        assert.equal(readPlayerNameFromCustom(JSON.stringify(basketCustomForPlayer('kaito'))), 'kaito');
    });

    it('fails closed on anything it cannot read', () => {
        for (const value of [null, undefined, '', 'not json', '[]', [], 42, {}, { playerName: 12 }]) {
            assert.equal(readPlayerNameFromCustom(value), '', `expected no identity from ${JSON.stringify(value)}`);
        }
    });
});

describe('package resolution', () => {
    it('refuses a package with no Tebex product behind it', () => {
        // The live state until the dashboard packages exist. Selling here would
        // charge for something the webhook could never map back to shards.
        withTebexMapping({}, () => {
            assert.equal(tebexPackageIdFor('shards-155'), null);
        });
    });

    it('refuses an id that is not in our catalogue at all', () => {
        withTebexMapping({ 'shards-155': '4' }, () => {
            assert.equal(tebexPackageIdFor('shards-999999'), null);
            assert.equal(tebexPackageIdFor(''), null);
        });
    });

    it('resolves a mapped id to the catalogue row, not to the request', () => {
        withTebexMapping({ 'shards-155': '4' }, () => {
            const resolved = tebexPackageIdFor('shards-155');
            assert.equal(resolved?.tebexId, '4');
            assert.equal(resolved?.pack.shards, 155);
        });
    });
});

describe('request bodies', () => {
    it('seals the player into custom and does not auto-redirect', () => {
        const body = buildCreateBasketBody({ playerName: 'kaito', env: {} as NodeJS.ProcessEnv });
        assert.deepEqual(body.custom, basketCustomForPlayer('kaito'));
        // Checkout runs in an overlay over a live game session; a redirect would
        // throw the player out of it.
        assert.equal(body.complete_auto_redirect, false);
        assert.equal(typeof body.complete_url, 'string');
        assert.equal(typeof body.cancel_url, 'string');
        assert.ok(!('ip_address' in body), 'ip_address omitted when unknown');
    });

    it('forwards the buyer IP when known', () => {
        const body = buildCreateBasketBody({ playerName: 'kaito', ipAddress: '203.0.113.7', env: {} as NodeJS.ProcessEnv });
        assert.equal(body.ip_address, '203.0.113.7');
    });

    it('never adds a package with a nonsense quantity', () => {
        assert.equal(buildAddPackageBody('4').quantity, 1);
        assert.equal(buildAddPackageBody('4', 0).quantity, 1);
        assert.equal(buildAddPackageBody('4', -5).quantity, 1);
        assert.equal(buildAddPackageBody('4', 2.9).quantity, 2);
    });
});

describe('created basket parsing', () => {
    const ok = { data: { ident: 'abc123', links: { checkout: 'https://checkout.tebex.io/abc123' } } };

    it('reads the wrapped Headless response', () => {
        assert.deepEqual(parseCreatedBasket(ok), { ident: 'abc123', checkoutUrl: 'https://checkout.tebex.io/abc123' });
    });

    it('tolerates an unwrapped body', () => {
        assert.deepEqual(parseCreatedBasket(ok.data), { ident: 'abc123', checkoutUrl: 'https://checkout.tebex.io/abc123' });
    });

    it('rejects a basket with no checkout link', () => {
        // Already paid, or malformed. Either way the ident goes nowhere, and
        // handing it to the client would look like success and do nothing.
        assert.equal(parseCreatedBasket({ data: { ident: 'abc123', links: {} } }), null);
        assert.equal(parseCreatedBasket({ data: { links: { checkout: 'https://x' } } }), null);
        assert.equal(parseCreatedBasket(null), null);
        assert.equal(parseCreatedBasket('nope'), null);
    });
});
