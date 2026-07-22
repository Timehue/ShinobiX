import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

type FakeResponse = {
    name: string;
    ok: boolean;
    status: number;
    type: string;
    headers: { get: (name: string) => string | null };
    clone: () => FakeResponse;
};

const response = (name: string, options?: Partial<FakeResponse>): FakeResponse => {
    const value: FakeResponse = {
        name,
        ok: true,
        status: 200,
        type: "basic",
        headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/webp" : "public, max-age=300" },
        clone: () => value,
        ...options,
    };
    return value;
};

function serviceWorkerHarness(fetchImage: (request: { url: string }) => Promise<FakeResponse>) {
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const stored = new Map<string, FakeResponse>();
    const deletedCaches = new Set<string>();
    const cache = {
        match: async (key: string) => stored.get(key),
        put: async (key: string, value: FakeResponse) => { stored.set(key, value); },
        keys: async () => [...stored.keys()],
        delete: async (key: string) => stored.delete(key),
    };
    const worker = {
        location: { origin: "https://shinobijourney.com" },
        addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => listeners.set(type, listener),
        skipWaiting: () => undefined,
        clients: { claim: async () => undefined },
    };
    const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    runInNewContext(source, {
        self: worker,
        caches: {
            open: async () => cache,
            keys: async () => ["other-feature-cache", "sj-hashed-assets-v0", "sj-hashed-assets-v1", "sj-game-images-v1"],
            delete: async (name: string) => { deletedCaches.add(name); return true; },
        },
        fetch: fetchImage,
        URL,
        Set,
        Promise,
    });

    async function request(url: string, destination = "image") {
        let delivered: Promise<FakeResponse> | undefined;
        const background: Promise<unknown>[] = [];
        listeners.get("fetch")?.({
            request: { method: "GET", url, destination },
            respondWith: (pending: Promise<FakeResponse>) => { delivered = Promise.resolve(pending); },
            waitUntil: (pending: Promise<unknown>) => { background.push(Promise.resolve(pending)); },
        });
        const result = delivered ? await delivered : undefined;
        await Promise.all(background);
        return result;
    }

    async function activate() {
        const background: Promise<unknown>[] = [];
        listeners.get("activate")?.({
            waitUntil: (pending: Promise<unknown>) => { background.push(Promise.resolve(pending)); },
        });
        await Promise.all(background);
    }

    return { activate, deletedCaches, request, stored };
}

describe("game image service worker", () => {
    it("retires only old Shinobi Journey caches", async () => {
        const harness = serviceWorkerHarness(async () => response("unused"));
        await harness.activate();
        assert.deepEqual([...harness.deletedCaches], ["sj-hashed-assets-v0"]);
    });

    it("serves the last good image through an outage and ignores retry cache-busters", async () => {
        const harness = serviceWorkerHarness(async () => { throw new Error("temporary outage"); });
        const good = response("last-good");
        harness.stored.set("https://shinobijourney.com/api/img?id=ai%3Akakashi", good);

        const result = await harness.request("https://shinobijourney.com/api/img?id=ai%3Akakashi&__img_retry=2");
        assert.equal(result, good);
    });

    it("refreshes cached fixed-name art in the background", async () => {
        const fresh = response("fresh");
        const harness = serviceWorkerHarness(async () => fresh);
        const key = "https://shinobijourney.com/scenes/intro.webp";
        const old = response("old");
        harness.stored.set(key, old);

        assert.equal(await harness.request(key), old);
        assert.equal(harness.stored.get(key), fresh);
    });

    it("stores the first successful image for later outage recovery", async () => {
        const fresh = response("first-load");
        const harness = serviceWorkerHarness(async () => fresh);
        const key = "https://shinobijourney.com/landing-hero.webp";

        assert.equal(await harness.request(key), fresh);
        assert.equal(harness.stored.get(key), fresh);
    });

    it("evicts a cached image after the origin confirms it was deleted", async () => {
        const gone = response("gone", { ok: false, status: 404 });
        const harness = serviceWorkerHarness(async () => gone);
        const key = "https://shinobijourney.com/api/img?id=event%3Aretired";
        const old = response("old");
        harness.stored.set(key, old);

        assert.equal(await harness.request(key), old);
        assert.equal(harness.stored.has(key), false);
    });

    it("does not intercept non-image requests", async () => {
        const harness = serviceWorkerHarness(async () => response("unused"));
        assert.equal(await harness.request("https://shinobijourney.com/api/game-state", ""), undefined);
    });

    it("never makes an accidental HTML or private response durable", async () => {
        const html = response("spa-fallback", {
            headers: { get: (name) => name.toLowerCase() === "content-type" ? "text/html" : "no-cache" },
        });
        const harness = serviceWorkerHarness(async () => html);
        const key = "https://shinobijourney.com/missing-art.webp";

        assert.equal(await harness.request(key), html);
        assert.equal(harness.stored.has(key), false);
    });
});
