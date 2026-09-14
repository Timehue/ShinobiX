import assert from "node:assert/strict";
import test from "node:test";
import { createWarfrontImageCache, loadWarfrontImage, WARFRONT_IMAGE_LOAD_TIMEOUT_MS } from "./pet-warfront-image-cache";

test("a stalled battle image times out, releases handlers and aborts its source", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    let removed = "";
    const image = { onload: null, onerror: null, decode: async () => {}, removeAttribute: (name: string) => { removed = name; } } as unknown as HTMLImageElement;
    const pending = loadWarfrontImage("/stalled-atlas.webp", () => image);
    const failed = assert.rejects(pending, /timed out/);
    context.mock.timers.tick(WARFRONT_IMAGE_LOAD_TIMEOUT_MS);
    await failed;
    assert.equal(image.onload, null);
    assert.equal(image.onerror, null);
    assert.equal(removed, "src");
});

test("a decoded battle image cancels its deadline and preserves its usable source", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    let removed = false;
    const image = { onload: null, onerror: null, decode: async () => {}, removeAttribute: () => { removed = true; } } as unknown as HTMLImageElement;
    const pending = loadWarfrontImage("/ready-atlas.webp", () => image);
    image.onload?.call(image, new Event("load"));
    assert.equal(await pending, image);
    context.mock.timers.tick(WARFRONT_IMAGE_LOAD_TIMEOUT_MS * 2);
    assert.equal(image.onload, null);
    assert.equal(image.onerror, null);
    assert.equal(removed, false);
});

test("atlas warmup deduplicates mirrors and bounds concurrent decodes", async () => {
    let active = 0, peak = 0;
    const loaded: string[] = [];
    const cache = createWarfrontImageCache(async (url) => {
        loaded.push(url);
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return url;
    });
    await cache.warm(["hawk", "fox", "bear", "hawk", "crane", "wolf", "fox", "eel"]);
    assert.equal(peak, 3);
    assert.equal(loaded.length, 6);
    await cache.get("hawk");
    assert.equal(loaded.length, 6, "mounting a warmed actor must not decode again");
});

test("LRU atlas eviction releases cache ownership while mounted images stay usable", async () => {
    const loaded: string[] = [];
    const cache = createWarfrontImageCache(async (url) => { loaded.push(url); return { url }; }, 2);
    const mountedHawk = await cache.get("hawk");
    await cache.get("fox");
    assert.equal(await cache.get("hawk"), mountedHawk);
    await cache.get("bear");
    assert.equal(cache.size, 2);
    assert.equal(await cache.get("hawk"), mountedHawk, "recently used actor remains hot");
    await cache.get("fox");
    assert.equal(loaded.filter((url) => url === "fox").length, 2);
    assert.equal(mountedHawk.url, "hawk");
});

test("failed atlas loads can retry without a stale rejection evicting the replacement", async () => {
    let attempts = 0;
    let rejectFirst!: (reason: Error) => void;
    const cache = createWarfrontImageCache((url) => {
        if (url === "hawk" && ++attempts === 1) return new Promise<string>((_, reject) => { rejectFirst = reject; });
        return Promise.resolve(url);
    }, 1);
    const first = cache.get("hawk");
    const failed = assert.rejects(first, /missing/);
    await Promise.resolve();
    await cache.get("fox");
    const replacement = cache.get("hawk");
    rejectFirst(new Error("missing"));
    await failed;
    assert.equal(await replacement, "hawk");
    assert.equal(cache.get("hawk"), replacement);
});
