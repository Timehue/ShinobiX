import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { useGLTF } from "@react-three/drei";
import { petCombatModel } from "./pet-3d-models";

// Keep the Node subject and loader in Drei's CJS module graph.
const nodeRequire = createRequire(import.meta.url);
const THREE = nodeRequire("three") as typeof import("three");
const { GLTFLoader } = nodeRequire("three-stdlib") as typeof import("three-stdlib");

function freshWarmup() {
    // Each test represents a new page. Preserve the production one-probe cache
    // within a page while keeping unsupported/capable fixtures independent.
    const filename = nodeRequire.resolve("./pet-model-preload.ts");
    delete nodeRequire.cache[filename];
    return (nodeRequire(filename) as typeof import("./pet-model-preload")).warmShowdownModels;
}

function installCanvasProbe(t: TestContext, supported: boolean) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    let probes = 0;
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement(tag: string) {
                assert.equal(tag, "canvas");
                return {
                    width: 300,
                    height: 150,
                    getContext(kind: string) {
                        probes++;
                        assert.equal(kind, "webgl2");
                        return supported ? { getExtension: () => null } : null;
                    },
                };
            },
        },
    });
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
        else Reflect.deleteProperty(globalThis, "document");
    });
    return () => probes;
}

test("without WebGL2 the warm-up fetches no model and probes the device once per page", async t => {
    const probes = installCanvasProbe(t, false);
    const warmShowdownModels = freshWarmup();
    const requested: string[] = [];
    t.mock.method(globalThis, "fetch", async (input: unknown) => {
        requested.push(String(input));
        throw new Error("model fetches are not expected without WebGL2");
    });
    // Both fighters resolve to approved roster GLBs on a capable device.
    const state = {
        player: [{ id: "viewer", templateId: "standard-1", name: "Viewer", rarity: "standard", element: "Fire" }],
        enemy: [{ id: "showdown-ai-0-rare-24", templateId: "rare-24", name: "Young Direwolf", rarity: "rare", element: "Earth" }],
    } as unknown as Parameters<typeof warmShowdownModels>[0];
    await warmShowdownModels(state);
    await warmShowdownModels(state);
    assert.deepEqual(requested, []);
    assert.equal(probes(), 1);
});

test("completed warmups retire their timeout on every repeated entry", async t => {
    const probes = installCanvasProbe(t, true);
    const warmShowdownModels = freshWarmup();
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const scheduled = t.mock.method(globalThis, "setTimeout");
    const cleared = t.mock.method(globalThis, "clearTimeout");
    for (let cycle = 0; cycle < 20; cycle++) {
        await warmShowdownModels({ player: [], enemy: [] });
    }
    assert.equal(probes(), 1, "capable repeated entries must also probe only once per page");
    assert.equal(scheduled.mock.callCount(), 20);
    assert.equal(cleared.mock.callCount(), 20, "completed warmups must not leave twenty 8-second timers pending");
    for (let cycle = 0; cycle < 20; cycle++) {
        assert.equal(cleared.mock.calls[cycle].arguments[0], scheduled.mock.calls[cycle].result);
    }
});

test("a stalled atlas still lets the match enter at the existing eight-second deadline", async t => {
    installCanvasProbe(t, true);
    const warmShowdownModels = freshWarmup();
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const cleared = t.mock.method(globalThis, "clearTimeout");
    const url = petCombatModel({ id: "starter-fire", rarity: "Standard" })!.url;
    useGLTF.clear(url);
    t.after(() => useGLTF.clear(url));
    t.mock.method(GLTFLoader.prototype, "load", (_url, onLoad) => {
        onLoad({ scene: new THREE.Group(), animations: [] } as unknown as import("three-stdlib").GLTF);
    });
    t.mock.method(THREE.FileLoader.prototype, "loadAsync", () => new Promise(() => {}));
    let finished = false;
    const warmup = warmShowdownModels({
        player: [{ id: "starter-fire", name: "Ember Wolf", rarity: "Standard", element: "Fire" }], enemy: [],
    }).then(() => { finished = true; });
    t.mock.timers.tick(7_999);
    await Promise.resolve();
    assert.equal(finished, false);
    t.mock.timers.tick(1);
    await warmup;
    assert.equal(finished, true);
    assert.equal(cleared.mock.callCount(), 1);
});
