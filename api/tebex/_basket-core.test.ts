import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    BASKET_CUSTOM_PLAYER_KEY,
    basketCustomForPlayer,
    buildAddPackageBody,
    buildCreateBasketBody,
    parseBasketIdent,
    parseCheckoutLink,
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
        // Checkout opens in a second tab; redirecting on completion would boot a
        // whole extra copy of the SPA alongside the running one.
        assert.equal(body.complete_auto_redirect, false);
        assert.equal(typeof body.complete_url, 'string');
        assert.equal(typeof body.cancel_url, 'string');
    });

    it('⛔ never sends ip_address — it needs Basic auth and 422s the basket', () => {
        /*
         * Setting a buyer's IP is privileged: Tebex answers
         * 422 "Basic auth credentials are required" unless the request carries
         * the store's SECRET key, which this public-token flow does not and
         * should not hold. While this field was sent, EVERY purchase attempt
         * failed — /api/tebex/basket returned 502 and the checkout tab opened
         * blank and went nowhere.
         */
        const body = buildCreateBasketBody({ playerName: 'kaito', env: {} as NodeJS.ProcessEnv });
        assert.ok(!('ip_address' in body), 'ip_address must never be sent on the public token');
        // The whole body, so a future field addition is a deliberate act.
        assert.deepEqual(
            Object.keys(body).sort(),
            ['cancel_url', 'complete_auto_redirect', 'complete_url', 'custom'],
        );
    });

    it('never adds a package with a nonsense quantity', () => {
        assert.equal(buildAddPackageBody('4').quantity, 1);
        assert.equal(buildAddPackageBody('4', 0).quantity, 1);
        assert.equal(buildAddPackageBody('4', -5).quantity, 1);
        assert.equal(buildAddPackageBody('4', 2.9).quantity, 2);
    });
});

describe('basket response parsing', () => {
    /*
     * These shapes are taken from live responses, not from the docs. A freshly
     * created basket is EMPTY and returns `links` as an empty ARRAY; the
     * checkout URL only exists once a package has been added. Requiring the
     * link at create time made every purchase attempt fail with a 502.
     */
    const CREATED = { data: { ident: 'drj5y1-fa22', links: [] } };
    const WITH_PACKAGE = { data: { ident: 'drj5y1-fa22', links: { checkout: 'https://pay.tebex.io/drj5y1-fa22' } } };

    it('reads the ident from a freshly created, linkless basket', () => {
        assert.equal(parseBasketIdent(CREATED), 'drj5y1-fa22');
        assert.equal(parseBasketIdent(CREATED.data), 'drj5y1-fa22', 'tolerates an unwrapped body');
    });

    it('returns no checkout link until the basket holds something', () => {
        // `links: []` — an array, not an object. Reading `.checkout` off it
        // yields undefined rather than throwing, which is how this stayed
        // invisible.
        assert.equal(parseCheckoutLink(CREATED), null);
        assert.equal(parseCheckoutLink(WITH_PACKAGE), 'https://pay.tebex.io/drj5y1-fa22');
    });

    it('fails closed on anything malformed', () => {
        for (const value of [null, 'nope', {}, { data: {} }, { data: { links: {} } }]) {
            assert.equal(parseCheckoutLink(value), null, JSON.stringify(value));
        }
        assert.equal(parseBasketIdent({ data: { links: { checkout: 'https://x' } } }), null);
        assert.equal(parseBasketIdent(null), null);
    });
});
