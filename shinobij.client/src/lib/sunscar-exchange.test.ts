import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { EXCHANGE_MARKET_DEFAULT_QUERY, EXCHANGE_MARKET_PAGE_SIZE } from "../../../shared/sunscar-exchange";
import { ExchangeRequestError, requestExchange, requestExchangeMarket } from "./sunscar-exchange";

/*
 * The Exchange screen now reads the open market one server-built page at a
 * time. The transport must accept a paged reply, still accept the whole-market
 * reply a server without paging sends, and refuse a page it cannot trust.
 */

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

type Recorded = { url: string; body: Record<string, unknown> };
function respondWith(payload: unknown, status = 200, calls: Recorded[] = []): Recorded[] {
    globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
        calls.push({ url: String(input), body: JSON.parse(String(init.body ?? "{}")) });
        return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    return calls;
}

const page = (over: Record<string, unknown> = {}) => ({
    v: 2, query: EXCHANGE_MARKET_DEFAULT_QUERY, page: 1, pageSize: EXCHANGE_MARKET_PAGE_SIZE, pages: 1, total: 0, listings: [], ...over,
});
const snapshot = (over: Record<string, unknown> = {}) => ({
    ok: true, character: { name: "shopper" }, _saveVersion: 4, inventory: [], activity: [], creatorItems: [], recoveryErrors: [], ...over,
});

test("a browse carries the market query and reads back one page", { concurrency: false }, async () => {
    const calls = respondWith(snapshot({ market: page({ total: 30, pages: 3 }) }));
    const data = await requestExchange("Shopper", { action: "browse" }, undefined, { ...EXCHANGE_MARKET_DEFAULT_QUERY, page: 2 });
    assert.equal(calls[0]?.url, "/api/festival/exchange");
    assert.deepEqual(calls[0]?.body.market, { ...EXCHANGE_MARKET_DEFAULT_QUERY, page: 2 });
    assert.equal(data.market?.total, 30);
    assert.equal(data.listings, undefined);
});

test("a reply from a server without market paging is still accepted whole", { concurrency: false }, async () => {
    respondWith(snapshot({ listings: [{ id: "a" }, { id: "b" }] }));
    const data = await requestExchange("Shopper", { action: "browse" }, undefined, EXCHANGE_MARKET_DEFAULT_QUERY);
    assert.equal(data.listings?.length, 2);
    assert.equal(data.market, undefined);
});

test("a reply with neither a page nor a listing array is refused as incomplete", { concurrency: false }, async () => {
    respondWith(snapshot());
    await assert.rejects(requestExchange("Shopper", { action: "browse" }), (error: ExchangeRequestError) => {
        assert.match(error.message, /incomplete/);
        assert.equal(error.uncertain, true, "a trade reply that cannot be read must stay retryable");
        return true;
    });
});

test("a market read returns the page and never claims a trade is in doubt", { concurrency: false }, async () => {
    const calls = respondWith({ ok: true, market: page({ total: 5 }) });
    const answered = await requestExchangeMarket("Shopper", EXCHANGE_MARKET_DEFAULT_QUERY, new AbortController().signal);
    assert.equal(answered.total, 5);
    assert.equal(calls[0]?.body.action, "market");
    assert.equal(calls[0]?.body.playerName, "Shopper");

    respondWith({ ok: false, error: "Invalid market filters. Refresh the Exchange." }, 400);
    await assert.rejects(requestExchangeMarket("Shopper", EXCHANGE_MARKET_DEFAULT_QUERY, new AbortController().signal), (error: ExchangeRequestError) => {
        assert.match(error.message, /Invalid market filters/);
        assert.equal(error.uncertain, false, "browsing never leaves a trade unconfirmed");
        return true;
    });
});

test("a malformed page is refused rather than rendered", { concurrency: false }, async () => {
    for (const bad of [page({ pageSize: 50 }), page({ page: 4, pages: 2 }), page({ listings: new Array(EXCHANGE_MARKET_PAGE_SIZE + 1).fill({}) }), page({ query: { v: 1 } }), undefined]) {
        respondWith({ ok: true, market: bad });
        await assert.rejects(requestExchangeMarket("Shopper", EXCHANGE_MARKET_DEFAULT_QUERY, new AbortController().signal), ExchangeRequestError);
    }
});

const screen = readFileSync(new URL("../components/SunscarExchange.tsx", import.meta.url), "utf8");

test("the Exchange screen renders the server's page and drops stale replies", () => {
    // Every request carries the current query, and a reply is adopted only if
    // the player has not moved to other filters or another page meanwhile.
    assert.match(screen, /requestExchange\(character\.name, action, signal, marketQuery\)/);
    assert.match(screen, /if \(requestedKey !== marketWantedRef\.current\) return false;/);
    assert.match(screen, /if \(seq !== marketSeq\.current \|\| signal\.aborted\) return;/);
    // The browse grid, its count and its pager come from the server page.
    assert.match(screen, /const serverPaged = tab === 'browse' && !legacyMarket && !!market;/);
    assert.match(screen, /const resultCount = serverPaged \? market!\.total : rows\.length;/);
    assert.match(screen, /const pages = serverPaged \? market!\.pages :/);
    assert.match(screen, /visibleRows = serverPaged \? rows : rows\.slice\(/);
    // A server without paging keeps the old local filtering.
    assert.match(screen, /setLegacyMarket\(!data\.market && Array\.isArray\(data\.listings\)\)/);
    // Typing does not fire a request per keystroke.
    assert.match(screen, /setTimeout\(\(\) => \{ setSearchTerm\(search\); setPage\(1\); \}, 300\)/);
});

test("the Exchange screen keeps its controls, labels and page size", () => {
    for (const control of ["Search the Exchange", "Rarity", "Listing currency", "Sort listings", "Within my budget", "Listing pages", "← Previous", "Next →"]) {
        assert.ok(screen.includes(control), control);
    }
    for (const option of ["All rarities", "All currencies", "Newest first", "Price: low to high", "Price: high to low", "Rarity: highest first"]) {
        assert.ok(screen.includes(option), option);
    }
    assert.match(screen, /Prices are sorted within each currency: ryo, then Fate Shards\./);
    assert.equal(EXCHANGE_MARKET_PAGE_SIZE, 12, "the grid still shows twelve");
});
