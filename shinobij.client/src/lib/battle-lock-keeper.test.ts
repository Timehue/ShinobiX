import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { battleLockKeeperTransition, type BattleLockKeeperDeps, type BattleLockKeeperState } from "./battle-lock-keeper";
import { BATTLE_LOCK_ID_KEY, BATTLE_LOCK_RESOLVED_KEY } from "./battle-save";

/*
 * 2026-11-06, live: a player finished a rift card ambush and the client never
 * sent the battle-lock resolve. The server marker then held them "in battle"
 * (no travel) after the dive ended, until its one-hour expiry. The keeper kept
 * the battle id ONLY in localStorage, so a write the browser refused left
 * nothing to resolve with.
 */

function memoryStorage(opts: { refuseWrites?: boolean; refuseAll?: boolean } = {}) {
    const values = new Map<string, string>();
    return {
        values,
        getItem(key: string) {
            if (opts.refuseAll) throw new Error("SecurityError: storage blocked");
            return values.get(key) ?? null;
        },
        setItem(key: string, value: string) {
            if (opts.refuseAll || opts.refuseWrites) throw new Error("QuotaExceededError");
            values.set(key, value);
        },
        removeItem(key: string) {
            if (opts.refuseAll) throw new Error("SecurityError: storage blocked");
            values.delete(key);
        },
    };
}

function harness(storage: BattleLockKeeperDeps["storage"]) {
    const posts: Array<Record<string, unknown>> = [];
    const deps: BattleLockKeeperDeps = {
        storage, mint: () => "minted-1", post: (body) => { posts.push(body); },
        playerName: "caius", kind: "hollowGateTiles", screen: "hollowGateTiles",
    };
    let state: BattleLockKeeperState = { locked: false, battleId: "" };
    const step = (active: boolean) => { state = battleLockKeeperTransition(state, active, deps); };
    return { posts, step, state: () => state };
}

describe("battle lock keeper", () => {
    it("locks on active and resolves the same id on inactive", () => {
        const storage = memoryStorage();
        const { posts, step } = harness(storage);
        step(true);
        step(false);
        assert.deepEqual(posts.map((p) => [p.action, p.battleId]), [["start", "minted-1"], ["resolve", "minted-1"]]);
        assert.equal(storage.values.get(BATTLE_LOCK_ID_KEY), undefined);
        assert.equal(storage.values.get(BATTLE_LOCK_RESOLVED_KEY), "minted-1");
    });

    it("still resolves when localStorage refused to store the id", () => {
        const { posts, step } = harness(memoryStorage({ refuseWrites: true }));
        step(true);
        step(false);
        assert.deepEqual(posts.map((p) => [p.action, p.battleId]), [["start", "minted-1"], ["resolve", "minted-1"]]);
    });

    it("still resolves when storage is blocked outright", () => {
        const { posts, step } = harness(memoryStorage({ refuseAll: true }));
        step(true);
        step(false);
        assert.deepEqual(posts.map((p) => p.action), ["start", "resolve"]);
    });

    it("adopts an id a previous page left behind, and fires once per transition", () => {
        const storage = memoryStorage();
        storage.values.set(BATTLE_LOCK_ID_KEY, "from-boot");
        const { posts, step } = harness(storage);
        step(true);
        step(true);
        step(false);
        step(false);
        assert.deepEqual(posts.map((p) => [p.action, p.battleId]), [["start", "from-boot"], ["resolve", "from-boot"]]);
    });

    // The real 2026-11-06 cause. Inside `<ScreenErrorBoundary key={screen}>`
    // the keeper remounted on every screen change. Ending a card match turns
    // the flag off AND changes screen in one render, so the keeper that had
    // locked was unmounted and a fresh one mounted already inactive: the
    // resolve never fired, twice in a row for the same player.
    it("App mounts the rift card keeper outside the screen-keyed boundary", () => {
        const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "App.tsx"), "utf8");
        const keeper = app.indexOf("<BattleLockKeeper");
        const boundaryOpen = app.indexOf("<ScreenErrorBoundary key={screen}>");
        const boundaryClose = app.indexOf("</ScreenErrorBoundary>", boundaryOpen);
        assert.ok(keeper > 0 && boundaryOpen > 0 && boundaryClose > boundaryOpen, "markers must still exist");
        assert.ok(keeper < boundaryOpen || keeper > boundaryClose, "BattleLockKeeper must not remount on screen changes");
        assert.equal(app.indexOf("<BattleLockKeeper", keeper + 1), -1, "one App keeper");
    });

    it("the component delegates to it, and resolves a held lock on unmount", () => {
        const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "components", "BattleLockKeeper.tsx"), "utf8");
        assert.match(source, /battleLockKeeperTransition\(stateRef\.current, active, depsRef\.current\)/);
        // StoryBoss's Forfeit changes screen with the fight still live, so the
        // keeper unmounts while locked; without this the lock stayed for an hour.
        assert.match(source, /useEffect\(\(\) => \(\) => \{\s*stateRef\.current = battleLockKeeperTransition\(stateRef\.current, false, depsRef\.current\);\s*\}, \[\]\);/);
    });
});
