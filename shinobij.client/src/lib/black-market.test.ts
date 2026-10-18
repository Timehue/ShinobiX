import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { resetBrokerPullIntentsForTests } from './black-market-intent';
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
    resetBrokerPullIntentsForTests();
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

test('certificate redemption explicitly selects its payment method', async () => {
    let sent: { playerName: string; payment: string; requestId: string };
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body));
        return json({ ok: true, cost: 0, payment: 'certificate', dailyUsed: 1 });
    }) as typeof fetch;
    const result = await pullBlackMarket('Kaito', 'certificate');
    assert.equal(sent!.playerName, 'Kaito');
    assert.equal(sent!.payment, 'certificate');
    assert.match(sent!.requestId, /^\d{4}-\d{2}-\d{2}_[a-f0-9-]+$/);
    assert.equal(result.cost, 0);
    assert.equal(result.payment, 'certificate');
});

test('an uncertain response retries the same request and payment instead of buying twice', async () => {
    const sent: Array<{ requestId: string; payment: string }> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        if (sent.length === 1) throw new Error('lost response');
        return json({ ok: true, payment: 'certificate', dailyUsed: 1 });
    }) as typeof fetch;
    const uncertain = await pullBlackMarket('Kaito', 'certificate');
    assert.equal(uncertain.ok, false);
    assert.match(uncertain.error!, /unconfirmed/i);
    assert.match(uncertain.error!, /Wait until the game has saved, then refresh to recover/);
    assert.equal((await pullBlackMarket('Kaito', 'ryo')).ok, true);
    assert.deepEqual(sent[1], sent[0], 'recover the original certificate purchase before any new paid pull');
    await pullBlackMarket('Kaito', 'ryo');
    assert.notEqual(sent[2].requestId, sent[1].requestId);
    assert.equal(sent[2].payment, 'ryo');
});

test('pull counts use the server day when a response crosses midnight', async () => {
    const serverDay = '2026-10-19';
    reply = () => json({ ok: true, dailyUsed: 1, day: serverDay });
    await pullBlackMarket('MidnightNinja');
    assert.equal(knownBlackMarketUsage('MidnightNinja', serverDay), 1);
});

test('a declined purchase retains the authoritative character for a stale device', async () => {
    reply = () => json({ error: 'No certificates remain.', character: { name: 'Kaito', brokerCertificates: 0 }, _saveVersion: 12 }, 400);
    const result = await pullBlackMarket('Kaito', 'certificate');
    assert.equal(result.ok, false);
    assert.equal(result.character?.brokerCertificates, 0);
    assert.equal(result._saveVersion, 12);
});
