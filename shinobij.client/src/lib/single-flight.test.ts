import assert from "node:assert/strict";
import test from "node:test";

import { runSingleFlight } from "./single-flight";

test("runSingleFlight shares concurrent work and clears after success", async () => {
    const pending = new Map<string, Promise<number>>();
    let calls = 0;
    let resolveWork!: (value: number) => void;
    const work = () => {
        calls += 1;
        return new Promise<number>((resolve) => { resolveWork = resolve; });
    };

    const first = runSingleFlight(pending, "images", work);
    const second = runSingleFlight(pending, "images", work);

    assert.equal(first, second);
    assert.equal(calls, 0, "work starts in a microtask");
    await Promise.resolve();
    assert.equal(calls, 1);
    resolveWork(7);
    assert.equal(await first, 7);
    assert.equal(pending.size, 0);
});

test("runSingleFlight clears a rejected entry so the next call can retry", async () => {
    const pending = new Map<string, Promise<number>>();
    let calls = 0;
    const work = async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary failure");
        return 9;
    };

    await assert.rejects(runSingleFlight(pending, "images", work), /temporary failure/);
    assert.equal(await runSingleFlight(pending, "images", work), 9);
    assert.equal(calls, 2);
});
