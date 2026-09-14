import assert from "node:assert/strict";
import test from "node:test";
import { createStoryEpilogueLoader } from "./story-epilogue-loader-core";

const epilogue = [{ lane: "honorable", title: "After", pages: [{ title: "Dawn", scene: "Village", speaker: "Narrator", dialogue: ["Home."] }] }];

test("epilogue loader retries a transient failure and caches validated content", async () => {
    let calls = 0;
    const loader = createStoryEpilogueLoader({
        urlFor: () => "/epilogue.json",
        attempts: 2,
        retryDelayMs: 0,
        fetchContent: async () => (++calls === 1
            ? { ok: false, status: 503, json: async () => null }
            : { ok: true, status: 200, json: async () => epilogue }),
    });
    assert.deepEqual(await loader.load("Stormveil Village"), epilogue);
    assert.deepEqual(await loader.load("Stormveil Village"), epilogue);
    assert.equal(calls, 2);
});

test("epilogue loader rejects invalid content and permits a later retry", async () => {
    let valid = false;
    const loader = createStoryEpilogueLoader({
        urlFor: () => "/epilogue.json",
        attempts: 1,
        retryDelayMs: 0,
        fetchContent: async () => ({ ok: true, status: 200, json: async () => valid ? epilogue : [{ lane: "honorable" }] }),
    });
    await assert.rejects(loader.load("Stormveil Village"), /validation/);
    valid = true;
    assert.deepEqual(await loader.load("Stormveil Village"), epilogue);
});

test("epilogue loader rejects malformed optional gates and empty scenes", async () => {
    for (const invalid of [
        [{ lane: "honorable", title: "After", requireAnyTrait: "proof", pages: epilogue[0].pages }],
        [{ lane: "honorable", title: "After", requireAnyTrait: [], pages: epilogue[0].pages }],
        [{ lane: "honorable", title: "After", requireTrait: 7, pages: epilogue[0].pages }],
        [{ lane: "honorable", title: "After", pages: [] }],
    ]) {
        const loader = createStoryEpilogueLoader({
            urlFor: () => "/epilogue.json", attempts: 1, retryDelayMs: 0,
            fetchContent: async () => ({ ok: true, status: 200, json: async () => invalid }),
        });
        await assert.rejects(loader.load("Stormveil Village"), /validation/);
    }
});
