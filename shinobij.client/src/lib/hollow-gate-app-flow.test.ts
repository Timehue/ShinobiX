import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { HollowGateShrineRun } from "../types/character";
import { hollowGateDescendUpdate, isSameHollowGateFloor } from "./hollow-gate-app-flow";

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

    it("never resurrects a run from a null live state, even with a matching token", () => {
        assert.equal(isSameHollowGateFloor(null, { runToken: "token-a", floor: 2 }), false);
        assert.equal(isSameHollowGateFloor(undefined, { runToken: "token-a", floor: 2 }), false);
        assert.equal(isSameHollowGateFloor(run(), { runToken: "token-a", floor: 2 }), true);
        assert.equal(isSameHollowGateFloor(run(), { runToken: "token-a", floor: 3 }), false);
        assert.equal(isSameHollowGateFloor(run(), { runToken: undefined, floor: 2 }), false);
    });
});
