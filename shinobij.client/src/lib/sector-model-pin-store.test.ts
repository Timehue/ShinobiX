import assert from "node:assert/strict";
import test from "node:test";
import { createSectorModelPinStore } from "./sector-model-pin-store";

test("a failed registry load preserves portraits, then one shared retry enables NPCs", async () => {
    let calls = 0;
    const store = createSectorModelPinStore(["/portrait.webp", null], async () => {
        if (++calls === 1) throw new Error("offline");
        return [["field-guard", "1".repeat(64)], ["starter-one", "2".repeat(64)]];
    });
    await assert.rejects(store.loadPins(), /offline/);
    assert.equal(store.snapshot(), 0);
    assert.equal(store.portraitModels.size, 0);
    const first = store.loadPins();
    assert.equal(store.loadPins(), first);
    let updates = 0;
    const remove = store.subscribe(() => updates++);
    await first;
    assert.equal(calls, 2);
    assert.equal(updates, 1);
    assert.equal(store.snapshot(), 1);
    assert.equal(store.revisions["starter-one"], "2".repeat(64));
    assert.equal(store.portraitModels.get("/portrait.webp"), "field-guard");
    assert.equal(store.portraitModels.size, 1);
    remove();
    await store.loadPins();
    assert.equal(calls, 2);
});

test("invalid registry rows never expose a partially admitted model", async () => {
    for (const rows of [[], [["field-guard", "1".repeat(64)], ["bad/path", "2".repeat(64)]],
        [["field-guard", "1".repeat(64)], ["field-guard", "2".repeat(64)]],
        [["field-guard", "1".repeat(64)], ["starter-one", "wrong"]],
        [["field-guard", "1".repeat(64)], ["untrusted", "2".repeat(64), "//other/portrait.webp"]]]) {
        const store = createSectorModelPinStore(["/guard.webp", "/starter.webp"], async () => rows);
        await assert.rejects(store.loadPins(), /Invalid model registry/);
        assert.deepEqual(Object.keys(store.revisions), []);
        assert.equal(store.portraitModels.size, 0);
        assert.equal(store.snapshot(), 0);
    }
});

test("both built and public portraits resolve after the registry arrives", async () => {
    const store = createSectorModelPinStore(["/assets/built.webp", null], async () => [
        ["guard", "1".repeat(64)], ["medic", "2".repeat(64), "/portraits/medic.webp"],
    ]);
    await store.loadPins();
    assert.deepEqual([...store.portraitModels], [["/assets/built.webp", "guard"], ["/portraits/medic.webp", "medic"]]);
});
