import assert from "node:assert/strict";
import test from "node:test";
import { PetSettlementRetryError, postPetBattleReceipt } from "./pet-battle-receipt";

test("a stalled receipt times out and retries the same sealed battle", async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    const body = { battleToken: "same-seal", reportKey: "23:tactical", warfrontPlan: { formation: [0, 1, 2, 3] } };
    // AbortSignal's Node timer is unref'd; keep this test alive until it fires.
    const keepAlive = setInterval(() => {}, 1000);
    globalThis.fetch = (async (_url, init) => {
        requests.push(String(init?.body));
        if (requests.length > 1) return Response.json({ ok: true, replayed: true });
        return new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
        });
    }) as typeof fetch;
    try {
        await assert.rejects(postPetBattleReceipt(body, 10), { name: "TimeoutError" });
        assert.deepEqual(await postPetBattleReceipt(body), { ok: true, replayed: true });
        assert.deepEqual(requests, [JSON.stringify(body), JSON.stringify(body)]);
    } finally {
        clearInterval(keepAlive);
        globalThis.fetch = originalFetch;
    }
});

test("the server's settlement wait remains retryable without changing its duration", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ error: "Still playing", retryAfterMs: 7800 }, { status: 425 });
    try {
        await assert.rejects(postPetBattleReceipt({}), (error: unknown) => {
            assert.ok(error instanceof PetSettlementRetryError);
            assert.equal(error.retryAfterMs, 7800);
            return true;
        });
    } finally { globalThis.fetch = originalFetch; }
});

test("failed or unreadable receipts never count as a recorded result", async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async () => Response.json({ error: "Try again" }, { status: 503 });
        await assert.rejects(postPetBattleReceipt({}), /Try again/);
        globalThis.fetch = async () => new Response("broken json");
        await assert.rejects(postPetBattleReceipt({}), /unreadable/);
    } finally { globalThis.fetch = originalFetch; }
});
