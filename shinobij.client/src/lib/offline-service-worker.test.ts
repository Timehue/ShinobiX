import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

/*
 * Navigation handling in public/sw.js — the offline fallback.
 *
 * The property under test that matters most is NEGATIVE: while the network
 * works, a navigation must be an untouched passthrough. A service worker that
 * ever answers a navigation from cache can shadow a deploy, and this app
 * self-builds on every push to main.
 */

type FakeResponse = { name: string; ok: boolean; status: number };

const response = (name: string, options?: Partial<FakeResponse>): FakeResponse =>
    ({ name, ok: true, status: 200, ...options });

function harness(fetchImpl: (request: { url: string }) => Promise<FakeResponse>) {
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const stored = new Map<string, FakeResponse>();
    const deletedCaches = new Set<string>();
    let cacheReads = 0;

    const cache = {
        match: async (key: string) => { cacheReads += 1; return stored.get(key); },
        put: async (key: string, value: FakeResponse) => { stored.set(key, value); },
        add: async (request: { url: string }) => {
            const fetched = await fetchImpl({ url: request.url });
            stored.set(request.url, fetched);
        },
        keys: async () => [...stored.keys()],
        delete: async (key: string) => stored.delete(key),
    };
    const worker = {
        location: { origin: "https://shinobijourney.com" },
        addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => listeners.set(type, listener),
        skipWaiting: () => undefined,
        clients: { claim: async () => undefined },
    };

    class FakeRequest {
        url: string;
        constructor(url: string) { this.url = url; }
    }

    const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    runInNewContext(source, {
        self: worker,
        caches: {
            open: async () => cache,
            keys: async () => ["sj-hashed-assets-v0", "sj-app-shell-v1", "sj-game-images-v1"],
            delete: async (name: string) => { deletedCaches.add(name); return true; },
        },
        fetch: fetchImpl,
        URL, Set, Promise, Request: FakeRequest,
    });

    async function install() {
        const background: Promise<unknown>[] = [];
        listeners.get("install")?.({
            waitUntil: (pending: Promise<unknown>) => { background.push(Promise.resolve(pending)); },
        });
        await Promise.all(background);
    }

    async function activate() {
        const background: Promise<unknown>[] = [];
        listeners.get("activate")?.({
            waitUntil: (pending: Promise<unknown>) => { background.push(Promise.resolve(pending)); },
        });
        await Promise.all(background);
    }

    async function navigate(url = "https://shinobijourney.com/") {
        let delivered: Promise<FakeResponse> | undefined;
        listeners.get("fetch")?.({
            request: { method: "GET", url, mode: "navigate", destination: "document" },
            respondWith: (pending: Promise<FakeResponse>) => { delivered = Promise.resolve(pending); },
            waitUntil: () => undefined,
        });
        return delivered ? await delivered : undefined;
    }

    /** A non-navigation request, to prove the new branch didn't widen. */
    function apiCall(url = "https://shinobijourney.com/api/player/heartbeat") {
        let responded = false;
        listeners.get("fetch")?.({
            request: { method: "GET", url, mode: "cors", destination: "" },
            respondWith: () => { responded = true; },
            waitUntil: () => undefined,
        });
        return responded;
    }

    return { install, activate, navigate, apiCall, stored, deletedCaches, reads: () => cacheReads };
}

describe("service worker offline fallback", () => {
    it("precaches the offline page on install", async () => {
        const h = harness(async (req) => response(`fetched:${req.url}`));
        await h.install();
        assert.equal(h.stored.get("/offline.html")?.name, "fetched:/offline.html");
    });

    it("installing while offline is non-fatal — the SW still installs", async () => {
        const h = harness(async () => { throw new Error("offline"); });
        await assert.doesNotReject(h.install());
        assert.equal(h.stored.has("/offline.html"), false);
    });

    it("keeps the shell cache when purging old caches", async () => {
        const h = harness(async (req) => response(`fetched:${req.url}`));
        await h.activate();
        assert.equal(h.deletedCaches.has("sj-app-shell-v1"), false, "the offline page must survive activation");
        assert.equal(h.deletedCaches.has("sj-hashed-assets-v0"), true, "stale caches are still purged");
    });

    it("⛔ an online navigation is a plain passthrough and never reads cache", async () => {
        // The deploy-shadowing guard. If this ever starts consulting the cache,
        // a released build can be masked by a stale shell.
        const h = harness(async (req) => response(`network:${req.url}`));
        await h.install();
        const before = h.reads();
        const result = await h.navigate();
        assert.equal(result?.name, "network:https://shinobijourney.com/");
        assert.equal(h.reads(), before, "an online navigation must not touch the cache");
    });

    it("a server error passes through instead of being mislabelled as offline", async () => {
        // 5xx does not throw, so it is a real response and must be shown as one.
        const h = harness(async (req) => response(`error:${req.url}`, { ok: false, status: 500 }));
        await h.install();
        const result = await h.navigate();
        assert.equal(result?.status, 500);
        assert.equal(result?.name, "error:https://shinobijourney.com/");
    });

    it("serves the offline page when the network actually fails", async () => {
        let online = true;
        const h = harness(async (req) => {
            if (!online) throw new TypeError("Failed to fetch");
            return response(`fetched:${req.url}`);
        });
        await h.install();
        online = false;
        const result = await h.navigate();
        assert.equal(result?.name, "fetched:/offline.html");
    });

    it("rethrows the real failure when nothing was precached", async () => {
        // Never swallow the error into an empty response — a blank page is
        // harder to diagnose than the browser's own network error.
        const h = harness(async () => { throw new TypeError("Failed to fetch"); });
        await h.install();   // fails to precache, by design
        await assert.rejects(h.navigate(), /Failed to fetch/);
    });

    it("non-navigation requests are still not intercepted", async () => {
        const h = harness(async (req) => response(`fetched:${req.url}`));
        assert.equal(h.apiCall(), false, "API calls must remain untouched by the SW");
    });
});
