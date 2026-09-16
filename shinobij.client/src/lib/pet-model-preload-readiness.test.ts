import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useGLTF } from "@react-three/drei";
import type { GLTFLoader as Loader, GLTF } from "three-stdlib";
import type { Pet } from "../types/pet";
import { petCombatModel } from "./pet-3d-models";

// Node resolves Drei's CJS main. Exercise the corresponding CJS dependency
// graph; mixing three-stdlib's ESM constructor with Drei's CJS key is invalid.
const nodeRequire = createRequire(import.meta.url);
const { GLTFLoader } = nodeRequire("three-stdlib") as typeof import("three-stdlib");
const THREE = nodeRequire("three") as typeof import("three");
const { preloadPetColiseumModels, warmShowdownModels } = nodeRequire("./pet-model-preload.ts") as typeof import("./pet-model-preload");
const { preloadPetGlbAtlas } = nodeRequire("./pet-glb-atlas.ts") as typeof import("./pet-glb-atlas");
const { preloadPetGltf } = nodeRequire("./pet-gltf-preload.ts") as typeof import("./pet-gltf-preload");

const pet = { id: "starter-fire", name: "Ember Wolf", rarity: "Standard", element: "Fire" } as Pet;
const gltfJson = JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "ReadinessFixture" }] });
let nextUrl = 0;

function installCapableCanvas(t: TestContext) {
    // Main skips Showdown warmup on devices without WebGL2. These deadline
    // cases exercise the capable-device path, not the separate 2D fallback.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement(tag: string) {
                assert.equal(tag, "canvas");
                return {
                    width: 300,
                    height: 150,
                    getContext(kind: string) {
                        assert.equal(kind, "webgl2");
                        return { getExtension: () => null };
                    },
                };
            },
        },
    });
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
        else Reflect.deleteProperty(globalThis, "document");
    });
}

function delayedModels(t: TestContext) {
    const urls: string[] = [];
    const pending = new Map<string, { finish: () => Promise<GLTF>; fail: (error: Error) => void }>();
    const load = t.mock.method(GLTFLoader.prototype, "load", function (this: Loader, url, onLoad, _onProgress, onError) {
        pending.set(url, {
            finish: () => new Promise<GLTF>((resolve, reject) => this.parse(gltfJson, "", gltf => {
                onLoad(gltf);
                resolve(gltf);
            }, reject)),
            fail: error => onError?.(error),
        });
    });
    // An atlas without an embedded image uses the existing material fallback.
    // This settles independently before the controlled real GLTF parse.
    t.mock.method(THREE.FileLoader.prototype, "loadAsync", async () => new ArrayBuffer(0));
    t.mock.method(console, "error", () => {});
    t.after(() => { for (const url of urls) useGLTF.clear(url); });
    return {
        load,
        pending,
        url(url = `http://127.0.0.1/pet-readiness-${++nextUrl}.gltf`) {
            urls.push(url);
            useGLTF.clear(url);
            return url;
        },
    };
}

function warmUrl(url: string, pets: readonly Pet[] = [pet]) {
    return preloadPetColiseumModels(pets, model => model && { ...model, url });
}

function rendererRead(url: string) {
    let result: ReturnType<typeof useGLTF> | undefined;
    function CachedPet() {
        result = useGLTF(url);
        return null;
    }
    renderToString(createElement(CachedPet));
    return result;
}

test("warmup waits for the shared GLTF parse after atlas fallback settles", async t => {
    const fixture = delayedModels(t);
    const url = fixture.url();
    let finished = false;
    const warmup = warmUrl(url).then(() => { finished = true; });
    try {
        assert.equal(await preloadPetGlbAtlas(url), null);
        await setImmediate();
        assert.equal(finished, false, "atlas completion alone must not report a parsed model ready");
    } finally {
        const parsed = await fixture.pending.get(url)!.finish();
        await warmup;
        assert.equal(finished, true);
        assert.equal(rendererRead(url), parsed, "the actual renderer hook must return the same parsed cache object");
        assert.equal(fixture.load.mock.callCount(), 1, "warmup and renderer must share one parse/load");
    }
});

test("concurrent warmups join a renderer-started load and retain cached object identity", async t => {
    const fixture = delayedModels(t);
    const url = fixture.url();
    useGLTF.preload(url);
    let completed = 0;
    const warmups = [warmUrl(url, [pet, pet]), warmUrl(url)].map(promise => promise.then(() => { completed++; }));
    await setImmediate();
    assert.equal(completed, 0);
    assert.equal(fixture.load.mock.callCount(), 1);
    const parsed = await fixture.pending.get(url)!.finish();
    await Promise.all(warmups);
    assert.equal(completed, 2);
    assert.equal(rendererRead(url), parsed);
    await warmUrl(url);
    assert.equal(rendererRead(url), parsed);
    assert.equal(fixture.load.mock.callCount(), 1, "cache hits must neither load nor parse the GLTF again");
});

test("a model already parsed by the renderer is reused on the first warmup", async t => {
    const fixture = delayedModels(t);
    const url = fixture.url();
    useGLTF.preload(url);
    const parsed = await fixture.pending.get(url)!.finish();
    await setImmediate();
    assert.equal(rendererRead(url), parsed);
    await warmUrl(url);
    assert.equal(rendererRead(url), parsed);
    assert.equal(fixture.load.mock.callCount(), 1);
});

test("cached model errors reject readiness and an explicit renderer cache clear permits retry", async t => {
    const fixture = delayedModels(t);
    const url = fixture.url();
    const rejected = assert.rejects(warmUrl(url), /readiness fixture load failed/);
    fixture.pending.get(url)!.fail(new Error("readiness fixture load failed"));
    await rejected;
    await assert.rejects(warmUrl(url), /readiness fixture load failed/);
    assert.equal(fixture.load.mock.callCount(), 1, "the observer must not clear errors or start an implicit retry");
    useGLTF.clear(url);
    const retry = warmUrl(url);
    const parsed = await fixture.pending.get(url)!.finish();
    await retry;
    assert.equal(rendererRead(url), parsed);
    assert.equal(fixture.load.mock.callCount(), 2);
});

test("a missing shared cache entry rejects without a second loader", async t => {
    const fixture = delayedModels(t);
    const url = fixture.url();
    const missingPreload = t.mock.method(useGLTF, "preload", () => {});
    await assert.rejects(preloadPetGltf(url), /preload cache entry is unavailable/);
    assert.equal(fixture.load.mock.callCount(), 0);
    missingPreload.mock.restore();
    const validPreload = preloadPetGltf(url);
    const parsed = await fixture.pending.get(url)!.finish();
    await validPreload;
    assert.equal(rendererRead(url), parsed, "a failed cache observation must not insert a poisoned entry");
    assert.equal(fixture.load.mock.callCount(), 1);
});

test("all selected model URLs must finish before a multi-pet warmup resolves", async t => {
    const fixture = delayedModels(t);
    const firstUrl = fixture.url();
    const secondUrl = fixture.url();
    const secondPet = { ...pet, id: "starter-water", name: "River Otter", element: "Water" } as Pet;
    let finished = false;
    const warmup = preloadPetColiseumModels([pet, secondPet], model => model && {
        ...model,
        url: model.url === petCombatModel(pet)!.url ? firstUrl : secondUrl,
    }).then(() => { finished = true; });
    assert.equal(fixture.load.mock.callCount(), 2);
    await fixture.pending.get(firstUrl)!.finish();
    await setImmediate();
    assert.equal(finished, false);
    await fixture.pending.get(secondUrl)!.finish();
    await warmup;
    assert.equal(finished, true);
    assert.equal(fixture.load.mock.callCount(), 2);
});

test("a stalled model keeps the eight-second fallback and can finish in the shared cache afterward", async t => {
    installCapableCanvas(t);
    const fixture = delayedModels(t);
    const url = fixture.url(petCombatModel(pet)!.url);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const cleared = t.mock.method(globalThis, "clearTimeout");
    let finished = false;
    const warmup = warmShowdownModels({ player: [pet], enemy: [] }).then(() => { finished = true; });
    assert.equal(await preloadPetGlbAtlas(url), null);
    await setImmediate();
    t.mock.timers.tick(7_999);
    await setImmediate();
    assert.equal(finished, false);
    t.mock.timers.tick(1);
    await warmup;
    assert.equal(finished, true);
    assert.equal(cleared.mock.callCount(), 1);
    const parsed = await fixture.pending.get(url)!.finish();
    await preloadPetGltf(url);
    assert.equal(rendererRead(url), parsed);
    assert.equal(fixture.load.mock.callCount(), 1);
});

test("a rejected model still lets Showdown enter and retires its deadline", async t => {
    installCapableCanvas(t);
    const fixture = delayedModels(t);
    const url = fixture.url(petCombatModel(pet)!.url);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const cleared = t.mock.method(globalThis, "clearTimeout");
    const warmup = warmShowdownModels({ player: [pet], enemy: [] });
    fixture.pending.get(url)!.fail(new Error("readiness fixture load failed"));
    await warmup;
    assert.equal(cleared.mock.callCount(), 1);
    assert.equal(fixture.load.mock.callCount(), 1);
});
