import test from "node:test";
import assert from "node:assert/strict";
import { fetchEras } from "./legacy.js";

// Hall of Legends' Eras tab asks for the eras from two effects on the same
// commit. Overlapping calls must share one request; a later call refetches.
test("overlapping fetchEras calls share one request, and a later call fetches fresh", async (t) => {
    const urls: string[] = [];
    let release!: () => void;
    const original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    globalThis.fetch = ((input: RequestInfo | URL) => {
        urls.push(String(input));
        const body = { eras: [{ id: `era-${urls.length}` }] };
        return new Promise<Response>((resolve) => {
            release = () => resolve(new Response(JSON.stringify(body), { status: 200 }));
        });
    }) as typeof fetch;

    const first = fetchEras();
    const second = fetchEras();
    assert.equal(urls.length, 1, "two overlapping calls make one request");
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, { eras: [{ id: "era-1" }] });
    assert.equal(b, a, "both callers receive the same result");

    const third = fetchEras();
    assert.equal(urls.length, 2, "a call after the first settled fetches again");
    release();
    assert.deepEqual(await third, { eras: [{ id: "era-2" }] });
});

test("a failed eras request still resolves null for every overlapping caller", async (t) => {
    const original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response("nope", { status: 503 }); }) as typeof fetch;
    const [a, b] = await Promise.all([fetchEras(), fetchEras()]);
    assert.equal(calls, 1);
    assert.equal(a, null);
    assert.equal(b, null);
});
