import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Minimal browser surface for the store and its visibility-aware poll.
const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document = doc;

const answer = { obstaclesEnabled: true, modelArtBase: "https://art.example/sector-models", playerGaitsEnabled: true };

test("one failed flags request is retried in seconds, not after the five-minute poll", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const calls: number[] = [];
    let fail = true;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
        calls.push(calls.length);
        if (fail) throw new TypeError("network down");
        return new Response(JSON.stringify(answer), { status: 200 });
    }) as typeof fetch;
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    try {
        const store = await import("./sector-obstacles");
        let notified = 0;
        const stop = store.subscribeSectorPresentation(() => { notified++; });
        await flush();
        assert.equal(calls.length, 1, "asks once on subscribe");
        assert.equal(store.sectorPlayerGaitsOn(), false, "a failed answer leaves figures off");

        fail = false;
        mock.timers.tick(1_999);
        await flush();
        assert.equal(calls.length, 1);
        mock.timers.tick(1);
        await flush();
        assert.equal(calls.length, 2, "retried after 2 s");
        assert.equal(store.sectorPlayerGaitsOn(), true, "figures come back on");
        assert.equal(notified, 1, "views are told");

        mock.timers.tick(60_000);
        await flush();
        assert.equal(calls.length, 2, "no further quick retries after a success");
        stop();
    } finally {
        globalThis.fetch = realFetch;
        mock.timers.reset();
    }
});
