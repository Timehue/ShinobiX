import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import * as THREE from "three";
import { preloadPetGlbAtlas, readPetGlbAtlas } from "./pet-glb-atlas.ts";

const modelBytes = await readFile(new URL("../../public/pet-models/roster/mythic-4.glb", import.meta.url));
let sequence = 0;
const modelUrl = () => `https://pet-models.invalid/roster/mythic-4.glb?case=${sequence++}`;

function browserFixtures(t: TestContext) {
    // Transport/ownership tests do not pretend to decode an image or render it.
    const originals = ["Image", "ProgressEvent"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    Object.defineProperty(globalThis, "Image", { configurable: true, value: class {
        onload?: () => void;
        decoding = "";
        set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    } });
    Object.defineProperty(globalThis, "ProgressEvent", { configurable: true, value: class extends Event {
        constructor(type: string, init: Record<string, unknown>) { super(type); Object.assign(this, init); }
    } });
    t.after(() => {
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    });
    assert.equal(THREE.Cache.enabled, false);
}

function modelResponse() {
    return new Response(modelBytes, { status: 200, headers: { "Content-Length": String(modelBytes.byteLength) } });
}

for (const first of ["atlas", "model"] as const) {
    test(`a cold ${first}-first warmup shares model bytes, progress, and warm atlas ownership`, async t => {
        browserFixtures(t);
        const requests: Request[] = [];
        t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
            requests.push(input instanceof Request ? input : new Request(input));
            return modelResponse();
        });
        const url = modelUrl();
        const progress: number[] = [];
        const model = () => new THREE.FileLoader().setResponseType("arraybuffer").loadAsync(url, event => progress.push(event.loaded));
        const pending = first === "atlas"
            ? [preloadPetGlbAtlas(url), model()] as const
            : [model(), preloadPetGlbAtlas(url)] as const;
        const results = await Promise.all(pending);
        const texture = results.find(result => result instanceof THREE.Texture);
        const buffer = results.find(result => result instanceof ArrayBuffer);
        assert.ok(texture instanceof THREE.Texture);
        assert.ok(buffer instanceof ArrayBuffer);
        assert.deepEqual(Buffer.from(buffer), modelBytes);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].credentials, "same-origin");
        assert.equal(progress.at(-1), modelBytes.byteLength);
        assert.equal(readPetGlbAtlas(url), texture);
        assert.equal(await preloadPetGlbAtlas(url), texture);
        assert.equal(requests.length, 1);
        assert.equal(texture.flipY, false);
        assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
        assert.equal(THREE.Cache.get(`file:${url}`), undefined, "raw GLBs must not be retained in a global cache");
        texture.dispose();
    });
}

test("a shared HTTP failure preserves atlas fallback and permits a later model retry", async t => {
    browserFixtures(t);
    let requests = 0;
    const errors = t.mock.method(console, "error", () => {});
    t.mock.method(globalThis, "fetch", async () => ++requests === 1
        ? new Response("unavailable", { status: 503 }) : modelResponse());
    const url = modelUrl();
    const atlas = preloadPetGlbAtlas(url);
    const model = new THREE.FileLoader().setResponseType("arraybuffer").loadAsync(url);
    await assert.rejects(model, /503/);
    assert.equal(await atlas, null);
    assert.equal(readPetGlbAtlas(url), null, "existing GLTF-material fallback remains available");
    assert.equal(requests, 1);
    assert.equal(errors.mock.callCount(), 1);
    const retry = await new THREE.FileLoader().setResponseType("arraybuffer").loadAsync(url);
    assert.ok(retry instanceof ArrayBuffer);
    assert.equal(requests, 2, "failed in-flight entries must be removed");
});

test("a shared abort settles both consumers and does not poison a subsequent model request", async t => {
    browserFixtures(t);
    let requests = 0;
    t.mock.method(console, "error", () => {});
    t.mock.method(globalThis, "fetch", (request: Request) => {
        if (++requests > 1) return Promise.resolve(modelResponse());
        return new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        });
    });
    const url = modelUrl();
    const loader = new THREE.FileLoader().setResponseType("arraybuffer");
    const model = loader.loadAsync(url);
    const atlas = preloadPetGlbAtlas(url);
    const failed = assert.rejects(model, { name: "AbortError" });
    loader.abort();
    await failed;
    assert.equal(await atlas, null);
    assert.equal(requests, 1);
    assert.ok(await new THREE.FileLoader().setResponseType("arraybuffer").loadAsync(url) instanceof ArrayBuffer);
    assert.equal(requests, 2);
});

test("distinct asset revisions are not deduplicated together", async t => {
    browserFixtures(t);
    const requests = t.mock.method(globalThis, "fetch", async () => modelResponse());
    const textures = await Promise.all([preloadPetGlbAtlas(modelUrl()), preloadPetGlbAtlas(modelUrl())]);
    assert.equal(requests.mock.callCount(), 2);
    assert.notEqual(textures[0], textures[1]);
    textures.forEach(texture => texture?.dispose());
});
