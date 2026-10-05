import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

type ResponseValue = { ok: boolean; status: number; type: string; headers: { get: () => string }; clone: () => ResponseValue };
type StorageFailure = "open" | "match" | "put" | "keys" | "delete";

function harness(failure: StorageFailure, networkFailure?: Error) {
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    let fetches = 0;
    let claimed = false;
    const fresh: ResponseValue = {
        ok: true, status: 200, type: "basic",
        headers: { get: () => "image/webp" }, clone: () => fresh,
    };
    const fail = async (operation: StorageFailure) => {
        if (operation === failure) throw new Error(`CacheStorage ${operation} unavailable`);
    };
    const cache = {
        match: async () => { await fail("match"); return undefined; },
        put: async () => { await fail("put"); },
        keys: async () => { await fail("keys"); return []; },
        delete: async () => true,
    };
    runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), {
        self: {
            location: { origin: "https://shinobijourney.com" },
            addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => listeners.set(type, listener),
            skipWaiting: () => undefined,
            clients: { claim: async () => { claimed = true; } },
        },
        caches: {
            open: async () => { await fail("open"); return cache; },
            keys: async () => { await fail("keys"); return ["sj-hashed-assets-v0"]; },
            delete: async () => { await fail("delete"); return true; },
        },
        fetch: async () => { fetches += 1; if (networkFailure) throw networkFailure; return fresh; },
        URL, Set, Promise,
    });
    return {
        fresh, fetches: () => fetches, claimed: () => claimed,
        async request(path: string, destination: string, mode?: string) {
            let delivered: Promise<ResponseValue> | undefined;
            const background: Promise<unknown>[] = [];
            listeners.get("fetch")?.({
                request: { method: "GET", url: `https://shinobijourney.com${path}`, destination, mode },
                respondWith: (pending: Promise<ResponseValue>) => { delivered = pending; },
                waitUntil: (pending: Promise<unknown>) => background.push(pending),
            });
            const result = await delivered;
            await Promise.all(background);
            return result;
        },
        async activate() {
            const background: Promise<unknown>[] = [];
            listeners.get("activate")?.({ waitUntil: (pending: Promise<unknown>) => background.push(pending) });
            await Promise.all(background);
        },
    };
}

describe("service worker with unavailable browser storage", () => {
    for (const failure of ["open", "match", "put", "keys"] as const) {
        for (const [path, destination] of [
            ["/assets/c-abcdefgh.js", "script"],
            ["/pet-models/roster/standard-5.glb?v=20260927", ""],
            ["/api/img?id=ai%3ARaiko", "image"],
        ]) {
            it(`delivers the live response when ${failure} fails for ${path}`, async () => {
                const h = harness(failure);
                assert.equal(await h.request(path, destination), h.fresh);
                assert.equal(h.fetches(), 1, "cache failure must not duplicate the origin request");
            });
        }
    }
    for (const failure of ["keys", "delete"] as const) {
        it(`claims clients even when old-cache cleanup ${failure} fails`, async () => {
            const h = harness(failure);
            await h.activate();
            assert.equal(h.claimed(), true);
        });
    }
    for (const failure of ["open", "match"] as const) {
        it(`preserves the navigation network error when offline storage ${failure} also fails`, async () => {
            const offline = new TypeError("The network is offline");
            const h = harness(failure, offline);
            await assert.rejects(h.request("/", "document", "navigate"), (error: unknown) => error === offline);
        });
    }
});
