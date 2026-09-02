import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    TEBEX_HEADLESS_API,
    TEBEX_HEADLESS_BASE,
    buildAddPackageBody,
    buildCreateBasketBody,
    parseBasketIdent,
    parseCheckoutLink,
    readPlayerNameFromCustom,
    tebexSubscriptionPackageId,
} from './_basket-core.js';
import { parseCataloguePrices } from './_basket-core.js';
import { PROVIDER_PACKAGE_IDS, shardPackageForProvider, SHARD_PACKAGES } from '../../shared/shard-packages.js';

/*
 * LIVE CONTRACT TEST — talks to the real Tebex storefront.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * Every other test here checks our code against fixtures WE wrote. That is
 * exactly how three bugs reached production on 2026-09-01: the fixtures encoded
 * what Tebex's documentation implied, the docs were wrong, and the tests passed
 * while the storefront was completely broken. A green unit test against a
 * third-party contract is evidence about your own assumptions, not their API.
 *
 * The three the docs got wrong, each now asserted below:
 *   • add-package is NOT account-scoped (the documented path 404s)
 *   • a fresh basket returns `links` as an empty ARRAY, not a checkout object
 *   • `ip_address` on the basket body needs Basic auth and 422s the request
 *
 * ── HOW IT RUNS ───────────────────────────────────────────────────────────
 * SKIPPED by default, including in normal CI, because it needs a real token and
 * depends on a third party being up. A Tebex outage must never redden an
 * ordinary build. It runs on a schedule (.github/workflows/tebex-contract.yml)
 * so a response-shape change reaches us from a cron job rather than from a
 * customer whose purchase silently failed.
 *
 * Enable with BOTH:
 *   TEBEX_LIVE_CONTRACT=1   (explicit opt-in, so a stray token cannot trigger it)
 *   TEBEX_PUBLIC_TOKEN=…    (the public storefront token)
 *
 * It creates unpaid baskets, which cost nothing and expire on their own.
 */

const TOKEN = String(process.env.TEBEX_PUBLIC_TOKEN ?? '').trim();
const OPTED_IN = String(process.env.TEBEX_LIVE_CONTRACT ?? '').trim() === '1';
const SKIP = !OPTED_IN || !TOKEN
    ? 'live contract test — set TEBEX_LIVE_CONTRACT=1 and TEBEX_PUBLIC_TOKEN to run'
    : false;

const TIMEOUT_MS = 30_000;

async function getJson(url: string): Promise<{ status: number; json: unknown }> {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: response.status, json: await response.json().catch(() => null) };
}

async function postJson(url: string, body: unknown): Promise<{ status: number; json: unknown }> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, json: await response.json().catch(() => null) };
}

describe('Tebex live contract', { skip: SKIP }, () => {
    it('every package we sell still exists, with the price and type we expect', async () => {
        const { status, json } = await getJson(`${TEBEX_HEADLESS_BASE}/${TOKEN}/packages`);
        assert.equal(status, 200, 'packages endpoint must answer 200');

        const rows = (json as { data?: unknown })?.data;
        assert.ok(Array.isArray(rows), 'packages response must carry a data array');
        const byId = new Map(rows.map((r) => [String((r as { id?: unknown }).id), r as Record<string, unknown>]));

        // Each shard tier maps to a real package charging its reference price.
        // A mis-filed id charges one tier and credits another, and nothing else
        // in the system would notice.
        for (const pack of SHARD_PACKAGES) {
            const tebexId = PROVIDER_PACKAGE_IDS.tebex?.[pack.id];
            assert.ok(tebexId, `${pack.id} has no Tebex id — it cannot be sold`);
            const row = byId.get(String(tebexId));
            assert.ok(row, `Tebex package ${tebexId} (${pack.id}) no longer exists`);
            assert.equal(Number(row.total_price), pack.usd, `${pack.id} price drifted from the catalogue`);
            assert.equal(row.type, 'single', `${pack.id} must be one-time — a recurring shard pack re-grants forever`);
            assert.equal(shardPackageForProvider('tebex', String(tebexId))?.shards, pack.shards);
        }

        // The subscription must stay recurring, or supporters are charged once
        // and keep the perks forever.
        const subId = tebexSubscriptionPackageId();
        if (subId) {
            const sub = byId.get(subId);
            assert.ok(sub, `subscription package ${subId} no longer exists`);
            assert.equal(sub.type, 'subscription', 'Shinobi Supporter must remain a subscription');
        }
    });

    it('the catalogue parser still finds every tier in the live response', async () => {
        const { json } = await getJson(`${TEBEX_HEADLESS_BASE}/${TOKEN}/packages`);
        const prices = parseCataloguePrices(json);
        for (const pack of SHARD_PACKAGES) {
            const row = prices.find((p) => p.packageId === pack.id);
            assert.ok(row, `${pack.id} vanished from the parsed catalogue — the shop would show an estimate`);
            assert.ok(row.amount > 0 && row.currency, `${pack.id} parsed without a usable price`);
        }
    });

    it('a purchase can be opened end to end, and identity survives the round trip', async () => {
        // 1. Create. ⛔ The basket comes back EMPTY: `links` is an ARRAY here,
        //    not an object, so there is no checkout URL yet. Requiring one at
        //    this step made every purchase fail with a 502.
        const created = await postJson(`${TEBEX_HEADLESS_BASE}/${TOKEN}/baskets`, buildCreateBasketBody({ playerName: 'contract-probe' }));
        assert.equal(created.status, 200, 'basket creation must answer 200');
        const ident = parseBasketIdent(created.json);
        assert.ok(ident, 'basket creation must yield an ident');
        assert.equal(parseCheckoutLink(created.json), null, 'a fresh basket still has no checkout link — if this changes, simplify the flow');

        // 2. Add a package. ⛔ NOT account-scoped: the documented
        //    /accounts/{token}/{ident}/packages path 404s.
        const tebexId = PROVIDER_PACKAGE_IDS.tebex?.['shards-35'];
        assert.ok(tebexId, 'the 35-shard tier must be mapped for this test to mean anything');
        const added = await postJson(`${TEBEX_HEADLESS_API}/baskets/${ident}/packages`, buildAddPackageBody(tebexId));
        assert.equal(added.status, 200, 'add-package must answer 200 at /api/baskets/{ident}/packages');

        // 3. The add response carries the populated checkout link.
        const checkout = parseCheckoutLink(added.json);
        assert.ok(checkout, 'add-package response must carry links.checkout');
        assert.match(checkout, /^https:\/\//, 'checkout must be an absolute https URL');

        // 4. Identity. This is the whole attribution model: a universal store
        //    collects no username, so `custom` is the only thing tying a payment
        //    to a player. If it stops round-tripping, buyers pay and receive
        //    nothing while the webhook answers 200.
        const basket = await getJson(`${TEBEX_HEADLESS_BASE}/${TOKEN}/baskets/${ident}`);
        const data = (basket.json as { data?: Record<string, unknown> })?.data ?? {};
        assert.equal(readPlayerNameFromCustom(data.custom), 'contract-probe', 'custom must round-trip, or purchases cannot be attributed');
        assert.equal(Number(data.total_price), 5, 'the 35-shard tier must still total $5');
    });
});
