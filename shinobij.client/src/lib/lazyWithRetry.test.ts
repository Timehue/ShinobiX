import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { cacheDynamicImport, retryDynamicImport } from "./lazyWithRetry";
import { isChunkLoadError } from "./chunk-load-recovery";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
before(() => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
});
after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

describe("lazy screen import recovery", () => {
    it("shares a pending warm-up with activation and repeated entry", async () => {
        let attempts = 0;
        let complete!: (value: string) => void;
        const load = cacheDynamicImport(() => {
            attempts += 1;
            return new Promise<string>(resolve => { complete = resolve; });
        });
        const warm = load();
        assert.equal(load(), warm);
        complete("ready");
        assert.equal(await retryDynamicImport(load), "ready");
        assert.equal(await load(), "ready");
        assert.equal(attempts, 1);
    });

    it("retains a failed CSS warm-up so activation cannot skip its stylesheet", async () => {
        let attempts = 0;
        const load = cacheDynamicImport(async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("Unable to preload CSS for /assets/optional.css");
            return "unstyled feature";
        });
        await assert.rejects(load());
        await assert.rejects(retryDynamicImport(load, 3, 0, 1000), /Unable to preload CSS/);
        assert.equal(attempts, 1);
    });

    it("fails into reload recovery before Vite can skip a failed screen stylesheet", async () => {
        let attempts = 0;
        await assert.rejects(retryDynamicImport(async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("Unable to preload CSS for /assets/bank-abcdefgh.css");
            return { default: "screen without stylesheet" };
        }, 3, 0, 1000), (error: unknown) => {
            assert.equal(isChunkLoadError(error), true);
            assert.match(String(error), /Unable to preload CSS/);
            return true;
        });
        assert.equal(attempts, 1, "Vite remembers the failed CSS URL, so another factory call would silently omit it");
    });

    it("still accepts a later successful module attempt", async () => {
        let attempts = 0;
        const loaded = { default: "screen with all dependencies" };
        assert.equal(await retryDynamicImport(async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("Temporary module failure");
            return loaded;
        }, 3, 0, 1000), loaded);
        assert.equal(attempts, 2);
    });

    it("bounds a persistent module failure and keeps the reload detector contract", async () => {
        let attempts = 0;
        await assert.rejects(retryDynamicImport(async () => {
            attempts += 1;
            throw new Error("Failed to fetch dynamically imported module");
        }, 2, 0, 1000), (error: unknown) => {
            assert.equal(isChunkLoadError(error), true);
            assert.match(String(error), /after 3 attempts/);
            return true;
        });
        assert.equal(attempts, 3);
    });
});
