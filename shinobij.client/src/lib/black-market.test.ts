import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
    knownBlackMarketUsage,
    pullBlackMarket,
    recordBlackMarketUsage,
    requestBlackMarketUsage,
    resetBlackMarketUsageForTests,
    utcDay,
} from "./black-market";

/*
 * The crate-count store behind the player card's "Sealed Crates" cell and the
 * festival hub. It must fetch once per player per day, stay monotonic within a
 * day, and keep each player's count separate.
 */

const DAY = "2026-10-01";
const realFetch = globalThis.fetch;
let calls: string[] = [];
let reply: () => Promise<Response>;

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    resetBlackMarketUsageForTests();
    calls = [];
    reply = () => json({ ok: true, dailyUsed: 3, dailyCap: 10, day: DAY });
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${String(input)}`);
        return reply();
    }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

test("utcDay is the UTC calendar day the server keys its counter by", () => {
    assert.equal(utcDay(Date.UTC(2026, 9, 1, 23, 59, 59)), "2026-10-01");
    assert.equal(utcDay(Date.UTC(2026, 9, 2, 0, 0, 0)), "2026-10-02");
});

test("the count is fetched once per player per day, however many surfaces ask", async () => {
    requestBlackMarketUsage("Kaito", DAY);
    requestBlackMarketUsage("kaito", DAY);
    requestBlackMarketUsage(" Kaito ", DAY);
    await settle();
    assert.deepEqual(calls, ["GET /api/festival/black-market?playerName=Kaito"]);
    assert.equal(knownBlackMarketUsage("Kaito", DAY), 3);
});

test("a failed fetch leaves the count unknown and lets the next surface retry", async () => {
    reply = () => json({ error: "Too many requests." }, 429);
    requestBlackMarketUsage("Kaito", DAY);
    await settle();
    assert.equal(knownBlackMarketUsage("Kaito", DAY), null);

    reply = () => json({ ok: true, dailyUsed: 2, dailyCap: 10, day: DAY });
    requestBlackMarketUsage("Kaito", DAY);
    await settle();
    assert.equal(calls.length, 2);
    assert.equal(knownBlackMarketUsage("Kaito", DAY), 2);
});

test("a response without a numeric count is treated as unknown, not zero", async () => {
    reply = () => json({});
    requestBlackMarketUsage("Kaito", DAY);
    await settle();
    assert.equal(knownBlackMarketUsage("Kaito", DAY), null);
});

test("within a day the count only rises, so a slow fetch cannot undo a pull", () => {
    recordBlackMarketUsage("Kaito", DAY, 4);
    recordBlackMarketUsage("Kaito", DAY, 2);
    assert.equal(knownBlackMarketUsage("Kaito", DAY), 4);
    recordBlackMarketUsage("Kaito", DAY, 5);
    assert.equal(knownBlackMarketUsage("Kaito", DAY), 5);
});

test("each player and each day keeps its own count", () => {
    recordBlackMarketUsage("Kaito", DAY, 7);
    recordBlackMarketUsage("Rin", DAY, 1);
    assert.equal(knownBlackMarketUsage("Kaito", DAY), 7);
    assert.equal(knownBlackMarketUsage("Rin", DAY), 1);
    assert.equal(knownBlackMarketUsage("Kaito", "2026-10-02"), null);
});

test("a pull's reply updates the shared count, including a refusal at the cap", async () => {
    const today = utcDay(Date.now());
    reply = () => json({ ok: true, dailyUsed: 6, reward: { tier: "scraps", label: "Scraps", ryo: 1, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0 } });
    await pullBlackMarket("Kaito");
    assert.equal(knownBlackMarketUsage("Kaito", today), 6);

    reply = () => json({ error: "Daily limit reached.", dailyUsed: 10, dailyCap: 10 }, 429);
    const refused = await pullBlackMarket("Kaito");
    assert.equal(refused.ok, false);
    assert.equal(knownBlackMarketUsage("Kaito", today), 10);
});
