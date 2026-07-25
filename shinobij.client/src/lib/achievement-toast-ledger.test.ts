import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { markAchievementsToasted, unseenAchievements } from "./achievement-toast-ledger.js";

// Minimal localStorage stand-in — the ledger only needs getItem/setItem.
function installStorage(impl?: Partial<Storage>) {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        ...impl,
    };
    return store;
}

beforeEach(() => { installStorage(); });

describe("achievement toast ledger", () => {
    it("treats every candidate as unseen for a fresh player", () => {
        assert.deepEqual(unseenAchievements("rill", ["a", "b"]), ["a", "b"]);
    });

    it("suppresses ids once they have been marked", () => {
        markAchievementsToasted("rill", ["a"]);
        assert.deepEqual(unseenAchievements("rill", ["a", "b"]), ["b"]);
    });

    it("persists across reads (the refresh case it exists for)", () => {
        markAchievementsToasted("rill", ["a", "b"]);
        assert.deepEqual(unseenAchievements("rill", ["a", "b"]), []);
    });

    it("is per-player and case-insensitive on the player name", () => {
        markAchievementsToasted("Rill", ["a"]);
        assert.deepEqual(unseenAchievements("rill", ["a"]), [], "same player, different casing");
        assert.deepEqual(unseenAchievements("other", ["a"]), ["a"], "a different player is unaffected");
    });

    it("no-ops on an empty id list or a missing player", () => {
        markAchievementsToasted("rill", []);
        assert.deepEqual(unseenAchievements("rill", ["a"]), ["a"]);
        // No player name (pre-login): nothing is suppressed and nothing throws.
        assert.deepEqual(unseenAchievements("", ["a"]), ["a"]);
    });

    it("degrades to 'everything unseen' when storage is unavailable", () => {
        installStorage({
            getItem: () => { throw new Error("private mode"); },
            setItem: () => { throw new Error("quota"); },
        });
        assert.doesNotThrow(() => markAchievementsToasted("rill", ["a"]));
        assert.deepEqual(unseenAchievements("rill", ["a"]), ["a"]);
    });

    it("ignores corrupt stored JSON instead of throwing", () => {
        const store = installStorage();
        store.set("ach:toasted:rill", "{not json");
        assert.deepEqual(unseenAchievements("rill", ["a"]), ["a"]);
    });
});
