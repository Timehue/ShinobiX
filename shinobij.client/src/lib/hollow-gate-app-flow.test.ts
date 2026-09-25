import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HollowGateShrineRun } from "../types/character";
import {
    hollowGateDescendUpdate,
    hollowGateRunAfterPetDefeat,
    hollowGateRunAfterUnresolvedFight,
    hollowGateShinobiFallback,
    isSameHollowGateFloor,
} from "./hollow-gate-app-flow";

/**
 * A post-boss descend generates the next floor behind an `await` on the
 * on-demand generator chunk. Everything the player can do during that window —
 * walk, Leave (which SETTLES the run token server-side), Emergency Forfeit —
 * used to be silently discarded by an unguarded full-replacement setRun.
 *
 * The worst case was not a lost step: a `leave()` that settled the token while
 * the late write installed floor N+1 got mirrored into character.hollowGateRun,
 * so the next boot resumed a phantom floor whose token the server had already
 * closed, and every step was rejected with no exit but Emergency Forfeit.
 *
 * These cover the guard as pure logic; the board lock (App's `descending`
 * early-return in moveHollowGatePlayer) is what stops the steps themselves.
 */

function run(overrides: Partial<HollowGateShrineRun> = {}): HollowGateShrineRun {
    return {
        width: 3,
        height: 3,
        playerX: 1,
        playerY: 1,
        tiles: [],
        floor: 2,
        threat: 10,
        torch: 5,
        keys: 2,
        completed: false,
        runToken: "token-a",
        serverSeed: 1234,
        entryCurrencies: { ryo: 50 },
        earnedXp: 7,
        earnedFragments: 3,
        earnedVeils: 1,
        secondWindArmed: true,
        ...overrides,
    } as HollowGateShrineRun;
}

describe("hollow gate descend — stale-write guard", () => {
    it("commits the next floor when the live run is still the floor it started from", () => {
        const from = run();
        const next = run({ floor: 3, keys: 0, torch: 10, runToken: undefined, serverSeed: undefined, playerX: 0, playerY: 0 });
        const result = hollowGateDescendUpdate(run(), from, next);

        assert.equal(result?.floor, 3);
        assert.equal(result?.playerX, 0);
        // Carried forward from the snapshot the descend started with.
        assert.equal(result?.keys, 2);
        assert.equal(result?.torch, 9);              // 5 + 4, capped at 10
        assert.equal(result?.runToken, "token-a");
        assert.equal(result?.serverSeed, 1234);
        assert.equal(result?.earnedXp, 7);
        assert.equal(result?.earnedFragments, 3);
        assert.equal(result?.earnedVeils, 1);
        assert.equal(result?.secondWindArmed, true);
        assert.deepEqual(result?.entryCurrencies, { ryo: 50 });
    });

    it("caps the descend torch refill at 10", () => {
        const from = run({ torch: 9 });
        const result = hollowGateDescendUpdate(run({ torch: 9 }), from, run({ floor: 3 }));
        assert.equal(result?.torch, 10);
    });

    it("drops the new floor when the run token changed (settled + a new run started)", () => {
        const from = run();
        const live = run({ runToken: "token-b" });
        assert.equal(hollowGateDescendUpdate(live, from, run({ floor: 3 })), live);
    });

    it("drops the new floor when the run already advanced", () => {
        const from = run();
        const live = run({ floor: 3 });
        assert.equal(hollowGateDescendUpdate(live, from, run({ floor: 3 })), live);
    });

    it("drops the new floor when the player left the run entirely", () => {
        assert.equal(hollowGateDescendUpdate(null, run(), run({ floor: 3 })), null);
    });

    it("re-points only an open pet duel at a shinobi fight for the same node", () => {
        const petDuel = { runId: "hgcombat-pet", nodeId: "floor:2:tile:40", floor: 2, kind: "battle" as const, mode: "pet" as const };
        const fallback = hollowGateShinobiFallback(run({ activeCombat: petDuel }));
        assert.deepEqual(fallback?.activeCombat, { ...petDuel, mode: "pve" });
        assert.equal(fallback?.floor, 2, "only the encounter's mode changes");

        const shinobi = run({ activeCombat: { ...petDuel, mode: "pve" } });
        assert.equal(hollowGateShinobiFallback(shinobi), shinobi);
        const idle = run();
        assert.equal(hollowGateShinobiFallback(idle), idle);
        assert.equal(hollowGateShinobiFallback(null), null);
    });

    it("never resurrects a run from a null live state, even with a matching token", () => {
        assert.equal(isSameHollowGateFloor(null, { runToken: "token-a", floor: 2 }), false);
        assert.equal(isSameHollowGateFloor(undefined, { runToken: "token-a", floor: 2 }), false);
        assert.equal(isSameHollowGateFloor(run(), { runToken: "token-a", floor: 2 }), true);
        assert.equal(isSameHollowGateFloor(run(), { runToken: "token-a", floor: 3 }), false);
        assert.equal(isSameHollowGateFloor(run(), { runToken: undefined, floor: 2 }), false);
    });
});

describe("hollow gate pet defeat — the run the shrine keeps", () => {
    const petDuel = { runId: "hgcombat-pet", nodeId: "floor:2:tile:4", floor: 2, kind: "battle" as const, mode: "pet" as const };
    const board = [{ kind: "empty", terrain: "room_floor" }, { kind: "battle", terrain: "room_floor" }] as HollowGateShrineRun["tiles"];

    it("keeps the live board when the settle reply carries only the server's projection", () => {
        // What combat-settle returns mid-run: the save's projection, no board.
        const saved = { floor: 2, runToken: "token-a", keys: 2, torch: 5, threat: 0, playerX: 1, playerY: 1 } as unknown as HollowGateShrineRun;
        const kept = hollowGateRunAfterPetDefeat(run({ tiles: board, activeCombat: petDuel }), saved);
        assert.equal(kept?.tiles, board, "the shrine still has a board to draw");
        assert.equal(kept?.width, 3);
        assert.equal(kept?.activeCombat, undefined);
        assert.equal(kept?.threat, 0);
    });

    it("still adopts a complete saved board, as before", () => {
        const saved = run({ tiles: board, playerX: 2, activeCombat: petDuel });
        const kept = hollowGateRunAfterPetDefeat(run({ activeCombat: petDuel }), saved);
        assert.equal(kept?.tiles, board);
        assert.equal(kept?.playerX, 2);
        assert.equal(kept?.activeCombat, undefined);
        assert.equal(kept?.threat, 0);
    });

    it("falls back to the live board when the reply has no run, and never invents one", () => {
        assert.equal(hollowGateRunAfterPetDefeat(run({ tiles: board }), undefined)?.tiles, board);
        assert.equal(hollowGateRunAfterPetDefeat(null, { floor: 2, runToken: "token-a" } as unknown as HollowGateShrineRun), null);
        assert.equal(hollowGateRunAfterPetDefeat(null, null), null);
    });
});

describe("hollow gate shinobi escape and Second Wind — the run the shrine keeps", () => {
    // A shinobi fight settles through the same combat-settle reply, so a fled
    // fight or a Second Wind revival adopted the same board-less projection.
    const shinobiFight = { runId: "hgcombat-pve", nodeId: "floor:2:tile:4", floor: 2, kind: "battle" as const, mode: "pve" as const };
    const board = [{ kind: "empty", terrain: "room_floor" }, { kind: "battle", terrain: "room_floor" }] as HollowGateShrineRun["tiles"];
    const projection = { floor: 2, runToken: "token-a", keys: 2, torch: 5, threat: 40, playerX: 1, playerY: 1 } as unknown as HollowGateShrineRun;

    it("an escape keeps the live board and resets Threat", () => {
        const kept = hollowGateRunAfterUnresolvedFight(run({ tiles: board, activeCombat: shinobiFight, threat: 40 }), projection);
        assert.equal(kept?.tiles, board, "the shrine still has a board to draw");
        assert.equal(kept?.activeCombat, undefined);
        assert.equal(kept?.threat, 0);
        assert.equal(kept?.secondWindArmed, true, "an escape spends no ward");
    });

    it("a Second Wind revival keeps the live board and spends the ward", () => {
        const kept = hollowGateRunAfterUnresolvedFight(run({ tiles: board, activeCombat: shinobiFight }), projection, { secondWindArmed: false });
        assert.equal(kept?.tiles, board);
        assert.equal(kept?.activeCombat, undefined);
        assert.equal(kept?.threat, 0);
        assert.equal(kept?.secondWindArmed, false);
    });

    it("App adopts a settle reply's run only through the board guard", () => {
        const app = readFileSync(join(process.cwd(), "shinobij.client", "src", "App.tsx"), "utf8");
        assert.doesNotMatch(app, /hollowGateRun \?\? previous/, "a board-less saved run crashes the shrine");
        assert.equal((app.match(/hollowGateRunAfterUnresolvedFight\(previous, result\.character\?\.hollowGateRun/g) ?? []).length, 2,
            "the escape and Second Wind branches both use the guard");
    });
});
