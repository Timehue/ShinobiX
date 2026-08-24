import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

/**
 * The Hollow Gate generator + tile resolver are deferred out of the entry graph
 * with import(). Both loaders MUST go through retryDynamicImport
 * (./lazyWithRetry) rather than a bare import(), because both are awaited on
 * run-critical paths where the two classic chunk failures are unrecoverable:
 *
 *  • A HUNG fetch never settles. The tile loader is awaited inside the move-fx
 *    drain, whose promise chain then never settles either — no move is drained
 *    again for the life of the page, so the player walks and nothing seals or
 *    resolves. retryDynamicImport's per-attempt timeout turns that into a
 *    retryable failure.
 *  • A one-shot rejection can be memoized. The warm-up swallows its rejection
 *    on purpose; if it handed the SAME promise to the later awaited call, the
 *    real call site would re-throw the warm-up's error instead of trying again.
 *    The wrapper re-issues import() per call, so it cannot.
 *
 * A source check, because the failure it guards is the absence of a wrapper —
 * exactly what a mocked-module test would paper over.
 */
const SOURCE = readFileSync(new URL("./hollow-gate-generator-loader.ts", import.meta.url), "utf8");

describe("hollow gate on-demand loaders", () => {
    it("routes every dynamic import through retryDynamicImport", () => {
        assert.match(SOURCE, /import \{ retryDynamicImport \} from "\.\/lazyWithRetry";/);
        assert.match(SOURCE, /return retryDynamicImport\(\(\) => import\("\.\/hollow-gate-dungeon"\)\);/);
        assert.match(SOURCE, /return retryDynamicImport\(\(\) => import\("\.\/hollow-gate-tile"\)\);/);
    });

    it("leaves no bare import() behind (a bare one has no retry and no timeout)", () => {
        // Comments discuss bare import() at length; only code counts.
        const code = SOURCE
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:])\/\/.*$/gm, "$1");
        const bare = code.split(/\r?\n/).filter((line) =>
            /(^|[^a-zA-Z_$.])import\(/.test(line) && !line.includes("retryDynamicImport("),
        );
        assert.deepEqual(bare, []);
    });

    it("still resolves the generator through the wrapper", async () => {
        // retryDynamicImport arms its per-attempt timeout with window.setTimeout.
        const previousWindow = globalThis.window;
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: { setTimeout: setTimeout.bind(globalThis), clearTimeout: clearTimeout.bind(globalThis) },
        });
        try {
            const { loadHollowGateGenerator } = await import("./hollow-gate-generator-loader");
            const mod = await loadHollowGateGenerator();
            assert.equal(typeof mod.generateHollowGateShrineRun, "function");
        } finally {
            if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
        }
    });
});
