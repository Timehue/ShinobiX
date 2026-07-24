import { test } from "node:test";
import assert from "node:assert/strict";
import { unseenAchievements, markAchievementsToasted } from "./achievement-toast-ledger.ts";

// Minimal in-memory localStorage stub so the ledger can run under node:test.
function installStorage() {
    const map = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => { map.set(k, v); },
        removeItem: (k: string) => { map.delete(k); },
        clear: () => { map.clear(); },
    };
    return map;
}

test("a toasted achievement is suppressed on the next load (the refresh/login fix)", () => {
    installStorage();
    const player = "kaze";
    const eligible = ["honor-100", "secret-packrat"];

    // First load: both are unseen -> both would toast.
    assert.deepEqual(unseenAchievements(player, eligible), ["honor-100", "secret-packrat"]);
    markAchievementsToasted(player, eligible);

    // Every subsequent load (refresh/login): nothing left to toast.
    assert.deepEqual(unseenAchievements(player, eligible), []);
});

test("only genuinely-new achievements toast; already-seen ones stay suppressed", () => {
    installStorage();
    const player = "kaze";
    markAchievementsToasted(player, ["honor-100"]);

    // honor-100 already seen; level-10 is new -> only level-10 surfaces.
    assert.deepEqual(unseenAchievements(player, ["honor-100", "level-10"]), ["level-10"]);
});

test("the ledger is scoped per player", () => {
    installStorage();
    markAchievementsToasted("kaze", ["honor-100"]);
    // A different player has not seen it yet.
    assert.deepEqual(unseenAchievements("rin", ["honor-100"]), ["honor-100"]);
});

test("empty player name never persists (no-op) and never filters", () => {
    installStorage();
    markAchievementsToasted("", ["honor-100"]);
    assert.deepEqual(unseenAchievements("", ["honor-100"]), ["honor-100"]);
});
