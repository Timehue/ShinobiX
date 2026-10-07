import { beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { FRESH_REWARD_MS, resetWeeklyBossRewardSyncSession, syncWeeklyBossRewards, weeklyBossRewardKey } from "./weekly-boss-reward-sync";
import type { Character } from "../types/character";

const boss = { weekKey: "2026-W32", spawnId: "spawn-1", creditedPlayers: ["Rill", "Aya"], distributedAt: 1_000_000 };
const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, data }; };
const save = (name: string, version = 5) => async () => ({ ok: true, json: async () => ({ character: { name } as Character, _saveVersion: version }) }) as unknown as Response;

beforeEach(() => resetWeeklyBossRewardSyncSession());

describe("weekly boss reward sync", () => {
    it("only recognizes a player the server credited, whatever the name's case", () => {
        assert.equal(weeklyBossRewardKey(boss, "rill"), "spawn-1");
        assert.equal(weeklyBossRewardKey(boss, " AYA "), "spawn-1");
        assert.equal(weeklyBossRewardKey(boss, "someone"), null);
        assert.equal(weeklyBossRewardKey({ weekKey: "2026-W32", creditedPlayers: ["Rill"] }, "rill"), "2026-W32");
        assert.equal(weeklyBossRewardKey({ creditedPlayers: ["Rill"] }, "rill"), null, "no boss identity, nothing to remember");
        assert.equal(weeklyBossRewardKey({ spawnId: "s", creditedPlayers: "Rill" }, "rill"), null);
        assert.equal(weeklyBossRewardKey(null, "rill"), null);
    });

    it("adopts the save once, tells the player, and remembers it", async () => {
        const storage = memory(); const toasts: string[] = []; const commits: unknown[] = [];
        const options = { name: "rill", storage, toast: (m: string) => toasts.push(m), now: () => 1_000_000 + 1000,
            commit: (character: Character, version: unknown) => { commits.push([character.name, version]); return true; }, fetch: save("Rill") };
        assert.equal(await syncWeeklyBossRewards(boss, options), "adopted");
        assert.deepEqual(commits, [["Rill", 5]]);
        assert.equal(toasts.length, 1);
        assert.equal(storage.data.get("weekly-boss-rewards-synced:rill"), "spawn-1");
        assert.equal(await syncWeeklyBossRewards(boss, options), "skipped", "the second visit does nothing");
        assert.equal(commits.length, 1);
        resetWeeklyBossRewardSyncSession();
        assert.equal(await syncWeeklyBossRewards(boss, options), "skipped", "a new session still remembers through storage");
    });

    it("syncs again for the next boss", async () => {
        const storage = memory(); let commits = 0;
        const options = { name: "rill", storage, toast: () => undefined, commit: () => { commits += 1; return true; }, fetch: save("Rill") };
        await syncWeeklyBossRewards(boss, options);
        assert.equal(await syncWeeklyBossRewards({ ...boss, spawnId: "spawn-2" }, options), "adopted");
        assert.equal(commits, 2);
    });

    it("does not mark the payout done when the commit is refused, so it tries again", async () => {
        const storage = memory(); let accept = false; let commits = 0;
        const options = { name: "rill", storage, toast: () => undefined, commit: () => { commits += 1; return accept; }, fetch: save("Rill") };
        assert.equal(await syncWeeklyBossRewards(boss, options), "deferred");
        assert.equal(storage.data.size, 0);
        accept = true;
        assert.equal(await syncWeeklyBossRewards(boss, options), "adopted");
        assert.equal(commits, 2);
    });

    it("waits while the player has unsaved edits, and never fetches or commits then", async () => {
        let clean = false; let fetches = 0; let commits = 0;
        const options = { name: "rill", storage: memory(), toast: () => undefined, isSaveClean: () => clean,
            commit: () => { commits += 1; return true; }, fetch: async () => { fetches += 1; return save("Rill")(); } };
        assert.equal(await syncWeeklyBossRewards(boss, options), "deferred");
        assert.equal(fetches, 0);
        clean = true;
        assert.equal(await syncWeeklyBossRewards(boss, options), "adopted");
        assert.equal(commits, 1);
    });

    it("re-checks after the fetch, so an edit made while the save was in flight is not erased", async () => {
        let clean = true; let commits = 0;
        const options = { name: "rill", storage: memory(), toast: () => undefined, isSaveClean: () => clean,
            commit: () => { commits += 1; return true; },
            fetch: async () => { clean = false; return save("Rill")(); } };
        assert.equal(await syncWeeklyBossRewards(boss, options), "deferred");
        assert.equal(commits, 0);
    });

    it("shares one adoption between two callers at once: one fetch, one commit, one toast", async () => {
        let fetches = 0; let commits = 0; const toasts: string[] = [];
        let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
        const options = { name: "rill", storage: memory(), toast: (m: string) => toasts.push(m), now: () => 1_000_000 + 1000, commit: () => { commits += 1; return true; },
            fetch: async () => { fetches += 1; await held; return save("Rill")(); } };
        const first = syncWeeklyBossRewards(boss, options);
        const second = syncWeeklyBossRewards(boss, options);
        release();
        assert.deepEqual(await Promise.all([first, second]), ["adopted", "adopted"]);
        assert.equal(fetches, 1);
        assert.equal(commits, 1);
        assert.equal(toasts.length, 1);
    });

    it("refuses a save for another account, a failed request, and a stale session", async () => {
        const base = { name: "rill", storage: memory(), toast: () => undefined, commit: () => { throw new Error("must not commit"); } };
        assert.equal(await syncWeeklyBossRewards(boss, { ...base, fetch: save("SomeoneElse") }), "skipped");
        assert.equal(await syncWeeklyBossRewards(boss, { ...base, fetch: async () => ({ ok: false }) as Response }), "deferred");
        assert.equal(await syncWeeklyBossRewards(boss, { ...base, fetch: async () => { throw new Error("offline"); } }), "deferred");
        assert.equal(await syncWeeklyBossRewards(boss, { ...base, fetch: save("Rill"), isCurrent: () => false }), "skipped");
    });

    it("adopts an old payout silently, without a misleading toast", async () => {
        const toasts: string[] = [];
        const done = await syncWeeklyBossRewards(boss, { name: "rill", storage: memory(), toast: (m) => toasts.push(m), commit: () => true, fetch: save("Rill"), now: () => 1_000_000 + FRESH_REWARD_MS + 1 });
        assert.equal(done, "adopted");
        assert.deepEqual(toasts, []);
    });

    it("works with no usable storage", async () => {
        const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
        assert.equal(await syncWeeklyBossRewards(boss, { name: "rill", storage: broken, toast: () => undefined, commit: () => true, fetch: save("Rill") }), "adopted");
        assert.equal(await syncWeeklyBossRewards(boss, { name: "rill", storage: broken, toast: () => undefined, commit: () => true, fetch: save("Rill") }), "skipped");
    });
});
