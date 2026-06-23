/*
 * Pet Gauntlet BOARD resolver — coverage. Load-bearing invariants: deterministic
 * from (teams, seed), holds a FULL squad (5v5), terminates, front-targets, and
 * the stronger lineup wins.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { Pet } from "../types/pet";
import { runPetBoardBattle, runPetGridBattle, BOARD_SQUAD_MAX } from "./pet-board-sim";

let n = 0;
function mk(over: Partial<Pet>): Pet {
    return {
        id: `b-${n++}`, name: "Unit", rarity: "standard", level: 1, xp: 0, maxLevel: 100,
        hp: 300, attack: 50, defense: 25, speed: 30, unlockedForPve: true,
        jutsus: [{ name: "Strike", power: 60, cooldown: 3, currentCooldown: 0, kind: "damage" }],
        ...over,
    } as Pet;
}
const team = (size: number, over: Partial<Pet> = {}) => Array.from({ length: size }, (_, i) => mk({ id: `u${n}-${i}`, ...over }));

describe("runPetBoardBattle — determinism", () => {
    it("same teams + seed → byte-identical result + events", () => {
        const p = team(3), e = team(3);
        const a = runPetBoardBattle(p, e, 777);
        const b = runPetBoardBattle(p, e, 777);
        assert.equal(a.result, b.result);
        assert.equal(a.events.length, b.events.length);
        assert.deepEqual(a.events.map((e) => `${e.t}:${e.type}:${e.dmg ?? ""}`), b.events.map((e) => `${e.t}:${e.type}:${e.dmg ?? ""}`));
    });
});

describe("runPetBoardBattle — holds a full squad", () => {
    it("resolves a 5v5 to a decisive winner and terminates", () => {
        const r = runPetBoardBattle(team(BOARD_SQUAD_MAX), team(BOARD_SQUAD_MAX), 4242);
        assert.equal(r.roster.length, BOARD_SQUAD_MAX * 2, "all 10 units are on the board");
        assert.ok(r.rounds >= 1 && r.rounds <= 40, "terminates within the round cap");
        assert.ok(["win", "loss", "draw"].includes(r.result));
        // The final snapshot reflects every unit.
        assert.equal(r.snapshots[r.snapshots.length - 1].units.length, BOARD_SQUAD_MAX * 2);
    });

    it("supports uneven lineups (3 vs 5)", () => {
        const r = runPetBoardBattle(team(3), team(5), 9);
        assert.equal(r.roster.length, 8);
        assert.ok(r.result);
    });
});

describe("runPetBoardBattle — outcomes", () => {
    it("a clearly stronger lineup wins", () => {
        const strong = team(3, { hp: 800, attack: 120, defense: 60, speed: 60 });
        const weak = team(3, { hp: 200, attack: 20, defense: 5, speed: 20 });
        assert.equal(runPetBoardBattle(strong, weak, 11).result, "win");
        assert.equal(runPetBoardBattle(weak, strong, 11).result, "loss");
    });

    it("fainted units emit a faint event and stop acting", () => {
        const r = runPetBoardBattle(
            team(2, { hp: 900, attack: 140, defense: 50 }),
            team(2, { hp: 120, attack: 10, defense: 0 }),
            5,
        );
        assert.ok(r.events.some((e) => e.type === "faint"), "a unit faints");
        assert.equal(r.result, "win");
    });

    it("the FRONT row shields the BACK row from melee (placement matters)", () => {
        const tank = mk({ id: "tank", role: "defender", hp: 1400, defense: 70 });
        const carry = mk({ id: "carry", role: "assassin", hp: 150, defense: 0, attack: 30 });
        const foe = mk({ id: "foe", role: "defender", hp: 600, attack: 70 });
        const r = runPetGridBattle(
            [{ pet: tank, row: 0, col: 0 }, { pet: carry, row: 1, col: 0 }],
            [{ pet: foe, row: 0, col: 0 }],
            5,
        );
        const firstFoeHit = r.events.find((e) => e.type === "hit" && e.actorId === "foe");
        assert.equal(firstFoeHit?.targetId, "tank", "the melee foe hits the front tank, not the protected back carry");
    });

    it("an assassin dives past the front to the enemy BACK row", () => {
        const front = mk({ id: "front", role: "defender", hp: 900, defense: 40 });
        const back = mk({ id: "back", role: "sage", hp: 350, defense: 10 });
        const assassin = mk({ id: "assassin", role: "assassin", attack: 90, hp: 500 });
        const r = runPetGridBattle(
            [{ pet: assassin, row: 0, col: 0 }],
            [{ pet: front, row: 0, col: 0 }, { pet: back, row: 1, col: 0 }],
            9,
        );
        const firstHit = r.events.find((e) => e.type === "hit" && e.actorId === "assassin");
        assert.equal(firstHit?.targetId, "back", "the assassin reaches the back carry, ignoring the front");
        assert.ok(r.roster.find((u) => u.id === "back")?.row === 1, "roster carries grid positions");
    });

    it("front unit (slot 0) takes the first hits", () => {
        const r = runPetBoardBattle(team(2), team(2), 3);
        const firstHit = r.events.find((e) => e.type === "hit" && e.targetId);
        assert.ok(firstHit, "someone gets hit");
        // The first damaged enemy should be a slot-0 unit on its side.
        const target = r.roster.find((u) => u.id === firstHit!.targetId);
        assert.equal(target?.slot, 0, "the lineup front is targeted first");
    });
});
