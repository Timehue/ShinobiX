import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import * as THREE from "../shinobij.client/node_modules/three/build/three.module.js";
import { preloadPetGlbAtlas } from "../shinobij.client/src/lib/pet-glb-atlas.ts";

// Bounded local transport microbenchmark. The sibling FileLoader is the exact
// byte-loading path used by the installed GLTFLoader. This measures requests and
// HTTP body bytes, not browser image decode, parsed-model readiness, or GPU work.
const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/measure-pet-model-preload.mts <output.json> (Node 24+)");
const bytes = await readFile(new URL("../shinobij.client/public/pet-models/roster/mythic-4.glb", import.meta.url));
const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
const originalProgress = Object.getOwnPropertyDescriptor(globalThis, "ProgressEvent");
Object.defineProperty(globalThis, "Image", { configurable: true, value: class {
    onload?: () => void;
    decoding = "";
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
} });
Object.defineProperty(globalThis, "ProgressEvent", { configurable: true, value: class extends Event {
    constructor(type: string, init: Record<string, unknown>) { super(type); Object.assign(this, init); }
} });

let requests = 0;
let responseBodyBytes = 0;
const server = createServer((_request, response) => {
    requests++;
    responseBodyBytes += bytes.byteLength;
    response.writeHead(200, { "Content-Type": "model/gltf-binary", "Content-Length": bytes.byteLength, "Cache-Control": "no-store" });
    response.end(bytes);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address === "object");
const samples: Array<{ sample: number; requests: number; responseBodyBytes: number; durationMs: number }> = [];
try {
    assert.equal(THREE.Cache.enabled, false, "the benchmark must not enable a global raw-file cache");
    for (let sample = 0; sample < 5; sample++) {
        const url = `http://127.0.0.1:${address.port}/pet-models/roster/mythic-4.glb?sample=${sample}`;
        const previousRequests = requests;
        const previousBytes = responseBodyBytes;
        const start = performance.now();
        const atlas = preloadPetGlbAtlas(url);
        const model = new THREE.FileLoader().setResponseType("arraybuffer").loadAsync(url);
        const [texture, buffer] = await Promise.all([atlas, model]);
        assert.ok(texture);
        assert.ok(buffer instanceof ArrayBuffer);
        assert.equal(buffer.byteLength, bytes.byteLength);
        const coldRequests = requests - previousRequests;
        assert.equal(await preloadPetGlbAtlas(url), texture, "warm atlas entries should be reused");
        assert.equal(requests - previousRequests, coldRequests);
        samples.push({ sample, requests: coldRequests, responseBodyBytes: responseBodyBytes - previousBytes, durationMs: performance.now() - start });
        texture.dispose();
    }
    const metric = (key: "requests" | "responseBodyBytes" | "durationMs") => {
        const values = samples.map(sample => sample[key]).sort((a, b) => a - b);
        return { median: values[2], min: values[0], max: values[4] };
    };
    const result = {
        scenario: "pet atlas preload plus concurrent GLTF FileLoader byte acquisition",
        scope: "LOCAL TRANSPORT MICROBENCHMARK; browser decode, production serving, game readiness, frame timing, and GPU UNMEASURED",
        node: process.version, platform: process.platform, arch: process.arch,
        sampleCount: 5, concurrency: 2, target: "ephemeral 127.0.0.1 HTTP server", cache: "unique URL per cold sample; no browser HTTP cache; THREE.Cache disabled; warm atlas identity checked",
        imageDecoder: "stubbed HTMLImageElement load completion; no decode-timing claim",
        asset: "pet-models/roster/mythic-4.glb", assetBytes: bytes.byteLength,
        assetSha256: createHash("sha256").update(bytes).digest("hex"),
        samples, metrics: { requests: metric("requests"), responseBodyBytes: metric("responseBodyBytes"), durationMs: metric("durationMs") },
    };
    await writeFile(output, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({ output, metrics: result.metrics }));
} finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (originalImage) Object.defineProperty(globalThis, "Image", originalImage); else Reflect.deleteProperty(globalThis, "Image");
    if (originalProgress) Object.defineProperty(globalThis, "ProgressEvent", originalProgress); else Reflect.deleteProperty(globalThis, "ProgressEvent");
}
