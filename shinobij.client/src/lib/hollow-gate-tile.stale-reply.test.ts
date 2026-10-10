import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { HollowGateShrineRun } from "../types/character";
import { resolveHollowGateTile, type HollowGateEventModal } from "./hollow-gate-tile";

// A player's writes are stored in order, but their replies can land in any
// order. When a later write's save version is adopted first, an earlier reply's
// commit is refused as stale and returns false, yet the server has already
// resolved the event (lib/player-save-coordinator reads the stored save back).
// The Hollow Gate run lives in the screen, not in that save, so the screen must
// still record what the server did.

async function resolveChest(commitAccepted: boolean) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
        ok: true, reward: { currencies: { ryo: 5 } }, character: { name: "shinobi" }, _saveVersion: 4,
        runState: { keys: 0, torch: 5, threat: 0, secondWindArmed: false },
    }), { status: 200 })) as typeof fetch;
    try {
        const tile = { kind: "chest", terrain: "room_floor" } as HollowGateShrineRun["tiles"][number];
        // A later tile event already set these counters before this reply landed.
        let run = { floor: 1, width: 15, height: 11, playerX: 2, playerY: 1,
            runToken: "token", keys: 1, torch: 3, tiles: Array.from({ length: 165 }, () => tile),
        } as HollowGateShrineRun;
        let modal: HollowGateEventModal = null;
        const commits: number[] = [];
        await resolveHollowGateTile(tile, 2, 1, {
            character: { name: "shinobi" } as never,
            hollowGateRun: run,
            setHollowGateRun: (value) => { run = typeof value === "function" ? value(run)! : value!; },
            setHollowGateEvent: (value) => { modal = typeof value === "function" ? value(modal) : value; },
            setHollowGateHiddenChamber: () => undefined,
            onVersionedCharacter: (_character, version) => { commits.push(Number(version)); return commitAccepted; },
            pushHollowGateLog: () => undefined,
            buildHollowGateRunSummary: () => "",
            startHollowGateBattle: () => undefined,
            leaveHollowGateShrine: () => undefined,
        });
        return { run, modal: modal as HollowGateEventModal, commits };
    } finally {
        globalThis.fetch = originalFetch;
    }
}

test("a tile event whose reply is refused as stale is still resolved and still opens", async () => {
    const { run, modal, commits } = await resolveChest(false);
    assert.deepEqual(commits, [4]);
    assert.equal(run.tiles[1 * 15 + 2].resolved, true, "the tile must not stay live to fire again");
    assert.equal(modal?.title, "Shrine Offering Chest");
    // The refused reply's counters are older than the ones already shown.
    assert.equal(run.keys, 1);
    assert.equal(run.torch, 3);
});

test("an accepted tile event reply sets the server's run counters", async () => {
    const { run, modal } = await resolveChest(true);
    assert.equal(run.tiles[1 * 15 + 2].resolved, true);
    assert.equal(modal?.title, "Shrine Offering Chest");
    assert.equal(run.keys, 0);
    assert.equal(run.torch, 5);
});

test("the shrine relic bar, befriend, dungeon and rift-card settles finish on a stale refusal", () => {
    const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
    const bar = read("../components/HollowGateShardBar.tsx");
    // The relic's effect is shown whatever the commit returns, applied to the run
    // as last rendered so a step taken meanwhile is kept.
    assert.match(bar, /onVersionedCharacter\(\{ \.\.\.result\.character, hollowGateRun: nextRun \}, result\._saveVersion\);\s*setRun\(nextRun\);/);
    assert.match(bar, /const latest = latestRunRef\.current\.runToken === run\.runToken \? latestRunRef\.current : run;/);
    const tile = read("./hollow-gate-tile.ts");
    assert.match(tile, /onVersionedCharacter\(befriended\.character, befriended\.saveVersion\);\s*pushHollowGateLog\(/);
    assert.doesNotMatch(tile, /if \(!adoptServerEvent\(/);
    const dungeon = read("../screens/Dungeon.tsx");
    assert.doesNotMatch(dungeon, /no-longer-active save session/);
    assert.match(dungeon, /onVersionedCharacter\(settled\.character, settled\.saveVersion\);\s*setSettlementStatus\("settled"\);/);
    const app = read("../App.tsx");
    assert.match(app, /const result = await mutateDungeonRunServer\(character\.name, "start", '', event\.id\);\s*commitVersionedCharacter\(result\.character, result\._saveVersion\);[^\n]*\n\s*setActiveDungeonRunToken\(result\.token\);/);
    assert.match(app, /if \(!settled\.ok \|\| !settled\.character\) throw new Error\([^\n]*\n\s*commitVersionedCharacter\(settled\.character, settled\._saveVersion\);/);
});
