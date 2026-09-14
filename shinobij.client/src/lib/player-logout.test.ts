import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character } from "../types/character";
import { createPlayerLogout, type PlayerLogoutParams } from "./player-logout";
import { SaveRateLimitError } from "./save-persistence";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function harness() {
    const flow = createPlayerLogout();
    const calls: string[] = [];
    const saveSessionEpochRef = { current: 1 };
    const saveCoordinator: PlayerLogoutParams["saveCoordinator"] = {
        charDirtyRef: { current: true }, latestSaveRef: { current: null },
        saveAuthority: { isCurrent: (key, epoch) => key === "kaya" && epoch === saveSessionEpochRef.current },
        pushSaveToServer: async () => { calls.push("save"); saveCoordinator.charDirtyRef.current = false; },
    };
    const params: PlayerLogoutParams = {
        character: { name: "Kaya" } as Character, currentAccountName: "Kaya", saveSessionEpochRef, saveCoordinator,
        confirm: async () => { calls.push("prompt"); return false; },
        endLocalSession: () => { calls.push("end"); },
    };
    return { flow, params, calls, saveCoordinator, saveSessionEpochRef };
}

test("rapid logout requests share one save and wait for its acknowledgement", async () => {
    const h = harness(), gate = deferred<void>();
    h.saveCoordinator.pushSaveToServer = async (_character, name, overrides, options) => {
        h.calls.push("save");
        assert.equal(name, "Kaya");
        assert.equal(overrides, undefined);
        assert.equal(options?.useLatestAtExecution, true);
        await gate.promise;
        h.saveCoordinator.charDirtyRef.current = false;
    };
    const pending = h.flow.run(h.params);
    assert.equal(h.flow.run(h.params), pending);
    await Promise.resolve();
    assert.deepEqual(h.calls, ["save"]);
    gate.resolve();
    await pending;
    assert.deepEqual(h.calls, ["save", "end"]);
});

test("duplicate clicks cannot queue more prompts, and staying allows a later retry", async () => {
    const h = harness(), decision = deferred<boolean>();
    h.saveCoordinator.pushSaveToServer = async () => { h.calls.push("save"); throw new SaveRateLimitError(3000); };
    h.params.confirm = async (_message, options) => {
        h.calls.push("prompt"); assert.equal(options.initialFocus, "cancel"); return decision.promise;
    };
    const pending = h.flow.run(h.params);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(h.flow.run(h.params), pending);
    decision.resolve(false);
    await pending;
    assert.deepEqual(h.calls, ["save", "prompt"]);
    assert.equal(h.saveCoordinator.charDirtyRef.current, true);
    h.saveCoordinator.pushSaveToServer = async () => { h.calls.push("retry"); h.saveCoordinator.charDirtyRef.current = false; };
    await h.flow.run(h.params);
    assert.deepEqual(h.calls, ["save", "prompt", "retry", "end"]);
});

test("a newer dirty snapshot gets the existing second save before logout", async () => {
    const h = harness();
    const newer = { name: "Kaya", level: 2 } as Character;
    h.saveCoordinator.latestSaveRef.current = { character: newer } as NonNullable<typeof h.saveCoordinator.latestSaveRef.current>;
    let writes = 0;
    h.saveCoordinator.pushSaveToServer = async (character) => {
        writes += 1;
        if (writes === 2) { assert.equal(character, newer); h.saveCoordinator.charDirtyRef.current = false; }
    };
    await h.flow.run(h.params);
    assert.equal(writes, 2);
    assert.deepEqual(h.calls, ["end"]);
});

test("continued dirty progress after both saves still requires the player's decision", async () => {
    const h = harness();
    h.saveCoordinator.latestSaveRef.current = { character: h.params.character! } as NonNullable<typeof h.saveCoordinator.latestSaveRef.current>;
    h.saveCoordinator.pushSaveToServer = async () => { h.calls.push("save"); };
    await h.flow.run(h.params);
    assert.deepEqual(h.calls, ["save", "save", "prompt"]);
});

for (const outcome of ["acknowledged", "rejected"] as const) {
    test(`a ${outcome} response from a retired session cannot show a prompt or end the new session`, async () => {
        const h = harness(), gate = deferred<void>();
        h.saveCoordinator.pushSaveToServer = () => gate.promise;
        const pending = h.flow.run(h.params);
        await Promise.resolve();
        h.saveSessionEpochRef.current += 1;
        h.saveCoordinator.charDirtyRef.current = false;
        if (outcome === "acknowledged") gate.resolve(); else gate.reject(new SaveRateLimitError(3000));
        await pending;
        assert.deepEqual(h.calls, []);
        assert.equal(h.saveCoordinator.charDirtyRef.current, false);
    });
}

test("an old force-logout confirmation cannot end a replacement session", async () => {
    const h = harness(), decision = deferred<boolean>();
    h.saveCoordinator.pushSaveToServer = async () => { throw new SaveRateLimitError(3000); };
    h.params.confirm = () => decision.promise;
    const pending = h.flow.run(h.params);
    await Promise.resolve(); await Promise.resolve();
    h.saveSessionEpochRef.current += 1;
    decision.resolve(true);
    await pending;
    assert.deepEqual(h.calls, []);
});

test("a retired request cannot unlock a newer session's pending logout", async () => {
    const h = harness(), oldSave = deferred<void>(), newSave = deferred<void>();
    h.saveCoordinator.pushSaveToServer = () => oldSave.promise;
    const oldRequest = h.flow.run(h.params);
    await Promise.resolve();
    h.saveSessionEpochRef.current += 1;
    h.saveCoordinator.pushSaveToServer = async () => { await newSave.promise; h.saveCoordinator.charDirtyRef.current = false; };
    const newRequest = h.flow.run(h.params);
    await Promise.resolve();
    oldSave.resolve(); await oldRequest;
    assert.equal(h.flow.run(h.params), newRequest);
    assert.deepEqual(h.calls, []);
    newSave.resolve(); await newRequest;
    assert.deepEqual(h.calls, ["end"]);
});

test("unmount retirement suppresses late completion", async () => {
    const h = harness(), gate = deferred<void>();
    h.saveCoordinator.pushSaveToServer = () => gate.promise;
    const pending = h.flow.run(h.params);
    await Promise.resolve();
    h.flow.retire(); gate.resolve(); await pending;
    assert.deepEqual(h.calls, []);
});

test("an explicit discard in the same session preserves the existing escape path", async () => {
    const h = harness();
    h.saveCoordinator.pushSaveToServer = async () => { throw new SaveRateLimitError(); };
    h.params.confirm = async () => true;
    await h.flow.run(h.params);
    assert.deepEqual(h.calls, ["end"]);
    assert.equal(h.saveCoordinator.charDirtyRef.current, true);
});
