import test from "node:test";
import assert from "node:assert/strict";
import { exploreAmbushDialogState, exploreAmbushFightRequest, exploreAmbushWanderer, fleeRoadAmbush, roadFleePriceLine } from "./road-flee-api";
import { rollOrdinaryPveEncounter } from '../../../shared/ordinary-pve-encounter';

test('Explore previews display the sealed identity, level and portrait without a second roll', () => {
    const encounter = rollOrdinaryPveEncounter({ sourceId: 'receipt_123456', playerLevel: 75, sector: 60, portraitImage: '/portraits/pve/assassin.webp' });
    const actor = exploreAmbushWanderer('receipt_123456', 75, encounter);
    assert.equal(actor.name, encounter.displayName);
    assert.equal(actor.level, encounter.level);
    assert.equal(actor.avatarImage, encounter.portraitImage);
    const dialog = exploreAmbushDialogState(60, 'receipt_123456', 75, encounter);
    const request = exploreAmbushFightRequest(60, 'receipt_123456', 75, encounter);
    assert.equal(dialog.encounter, encounter);
    assert.equal(request.encounter, encounter);
    assert.equal(request.opponentName, encounter.displayName);
    assert.equal(request.opponentLevel, encounter.level);
    assert.equal(request.worldExploreRequestId, dialog.ambush.requestId);
});

function withFetch(stub: typeof fetch, body: () => Promise<void>) {
    const real = globalThis.fetch;
    globalThis.fetch = stub;
    return body().finally(() => { globalThis.fetch = real; });
}

test("the flee request sends no amount, only who is running from what", async () => {
    let sent: Record<string, unknown> = {};
    await withFetch((async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ ok: true, cost: { hp: 50, ryo: 10 }, totals: { hp: 50, ryo: 90 }, _saveVersion: 4 }), { status: 200 });
    }) as typeof fetch, async () => {
        const result = await fleeRoadAmbush("kira", "flee-0123456789", { kind: "explore", sector: 12, requestId: "req-0123456789" });
        assert.deepEqual(result, { ok: true, cost: { hp: 50, ryo: 10 }, totals: { hp: 50, ryo: 90 }, _saveVersion: 4 });
    });
    assert.deepEqual(sent, { playerName: "kira", fleeId: "flee-0123456789", kind: "explore", sector: 12, requestId: "req-0123456789" });
});

test("a stalled flee request ends, so the forced choice can be made again", async () => {
    // The Fight/Flee dialog cannot be dismissed, and its buttons are disabled
    // while a flee is in flight. A request that never settled used to hold the
    // player there for good; it now carries a timeout and answers retryably.
    let signal: AbortSignal | null | undefined;
    await withFetch(((_url: string, init: RequestInit) => {
        signal = init.signal;
        return new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
    }) as typeof fetch, async () => {
        const pending = fleeRoadAmbush("kira", "flee-0123456789", { kind: "road" });
        assert.ok(signal instanceof AbortSignal, "the flee request carries an abort signal");
        (signal as AbortSignal & { dispatchEvent(e: Event): boolean }).dispatchEvent(new Event("abort"));
        const result = await pending;
        assert.equal(result.ok, false);
        assert.match(result.ok ? "" : result.error, /try to run again/u);
    });
});

test("a refusal keeps the server's reason and words", async () => {
    await withFetch((async () => new Response(JSON.stringify({ ok: false, reason: "already-resolved", error: "That fight has already begun." }), { status: 200 })) as typeof fetch, async () => {
        assert.deepEqual(await fleeRoadAmbush("kira", "flee-0123456789", { kind: "road" }),
            { ok: false, reason: "already-resolved", error: "That fight has already begun." });
    });
});

test("the price line says what running costs, or that it costs nothing", () => {
    assert.equal(roadFleePriceLine({ hp: 1, ryo: 0, level: 10 }), "You have nothing left to lose by running.");
    assert.match(roadFleePriceLine({ hp: 200, ryo: 1_000, level: 10 }), /^If you flee, you lose 100 HP and drop 100 ryo\.$/u);
});
