/*
 * pet-gauntlet-stats — team aggregation for the Gauntlet stat columns.
 * Invariants: pooled stats + per-pet averages are correct, the element spread is
 * ordered + skips "None", and the elemental edge mirrors the board sim's cycle.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { Pet } from "../types/pet";
import { teamStatTotals, elementalEdge } from "./pet-gauntlet-stats";

let n = 0;
const mk = (over: Partial<Pet>): Pet =>
    ({ id: `s-${n++}`, name: "U", rarity: "standard", hp: 100, attack: 40, defense: 20, speed: 10, ...over } as Pet);

describe("teamStatTotals", () => {
    it("pools stats, averages defense/speed, and orders the element spread", () => {
        const t = teamStatTotals([
            mk({ hp: 100, attack: 40, defense: 20, speed: 10, element: "Fire" }),
            mk({ hp: 300, attack: 60, defense: 40, speed: 30, element: "Fire" }),
            mk({ hp: 200, attack: 50, defense: 30, speed: 20, element: "Water" }),
        ]);
        assert.equal(t.count, 3);
        assert.equal(t.hp, 600, "HP pooled");
        assert.equal(t.attack, 150, "attack pooled");
        assert.equal(t.defense, 90);
        assert.equal(t.defenseAvg, 30, "defense averaged per pet");
        assert.equal(t.speedAvg, 20, "speed averaged per pet");
        assert.deepEqual(t.elements, [{ element: "Fire", count: 2 }, { element: "Water", count: 1 }], "biggest element group first");
    });

    it("skips null / None elements and is empty-safe", () => {
        const t = teamStatTotals([mk({ element: "None" }), mk({ element: undefined })]);
        assert.deepEqual(t.elements, []);
        const empty = teamStatTotals([]);
        assert.equal(empty.count, 0);
        assert.equal(empty.defenseAvg, 0, "no divide-by-zero on an empty squad");
    });
});

describe("elementalEdge", () => {
    it(">1 when your elements counter theirs, <1 when countered, 1 when neutral", () => {
        // Cycle: Fire > Wind > Lightning > Earth > Water > Fire (board sim).
        assert.ok(elementalEdge([mk({ element: "Fire" })], [mk({ element: "Wind" })]) > 1, "Fire beats Wind → edge");
        assert.ok(elementalEdge([mk({ element: "Wind" })], [mk({ element: "Fire" })]) < 1, "Wind loses to Fire → disadvantage");
        assert.equal(elementalEdge([mk({ element: "Fire" })], [mk({ element: "Fire" })]), 1, "mirror match is neutral");
    });

    it("averages across all pairings and is empty-safe", () => {
        // Fire vs [Wind (1.25), Fire (1.0)] → mean 1.125.
        assert.equal(elementalEdge([mk({ element: "Fire" })], [mk({ element: "Wind" }), mk({ element: "Fire" })]), 1.125);
        assert.equal(elementalEdge([], [mk({ element: "Fire" })]), 1, "empty attackers → neutral");
        assert.equal(elementalEdge([mk({ element: "Fire" })], []), 1, "empty defenders → neutral");
    });
});
