/*
 * Pet Gauntlet synergy resolver — coverage for the team-composition layer.
 * Load-bearing invariants: tiers activate at the right counts, bonuses aggregate
 * additively across element + role, and applying them buffs COPIES (the source
 * squad is never mutated → the player's roster / run state stays intact).
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { Pet } from "../types/pet";
import { resolveSynergies, aggregateSynergyBonus, applySynergiesToSquad } from "./pet-synergies";
import type { PetRole } from "./pet-roles";

let n = 0;
function mk(over: Partial<Pet> & { element?: Pet["element"]; role?: PetRole }): Pet {
    return {
        id: `t-${n++}`, name: "Test Pet", rarity: "standard", level: 1, xp: 0, maxLevel: 100,
        hp: 200, attack: 50, defense: 30, speed: 20, unlockedForPve: true, jutsus: [],
        ...over,
    } as Pet;
}

describe("resolveSynergies — element tiers", () => {
    it("2 Fire pets activate Ember Pack tier 1 (+12% attack)", () => {
        const squad = [mk({ element: "Fire", role: "assassin" }), mk({ element: "Fire", role: "tracker" })];
        const active = resolveSynergies(squad);
        const fire = active.find((a) => a.def.key === "element:Fire");
        assert.ok(fire, "Fire synergy should be active");
        assert.equal(fire!.count, 2);
        assert.equal(fire!.tierIndex, 0);
        assert.equal(fire!.tier.bonus.attack, 0.12);
    });

    it("4 Fire pets reach Ember Pack tier 2 (+28% attack)", () => {
        const squad = Array.from({ length: 4 }, () => mk({ element: "Fire", role: "assassin" }));
        const fire = resolveSynergies(squad).find((a) => a.def.key === "element:Fire");
        assert.equal(fire!.tierIndex, 1);
        assert.equal(fire!.tier.bonus.attack, 0.28);
    });

    it("1 Fire pet activates nothing", () => {
        const active = resolveSynergies([mk({ element: "Fire", role: "assassin" })]);
        assert.equal(active.find((a) => a.def.key === "element:Fire"), undefined);
    });

    it("null / None element counts toward no element synergy", () => {
        const squad = [mk({ element: null, role: "sage" }), mk({ element: "None" as Pet["element"], role: "sage" })];
        assert.equal(resolveSynergies(squad).some((a) => a.def.kind === "element"), false);
    });
});

describe("resolveSynergies — role tiers", () => {
    it("2 defenders activate Phalanx", () => {
        const squad = [mk({ element: "Earth", role: "defender" }), mk({ element: "Water", role: "defender" })];
        const phalanx = resolveSynergies(squad).find((a) => a.def.key === "role:defender");
        assert.ok(phalanx);
        assert.equal(phalanx!.tier.bonus.defense, 0.15);
        assert.equal(phalanx!.tier.bonus.hp, 0.10);
    });
});

describe("aggregateSynergyBonus — stacks element + role", () => {
    it("two Fire assassins stack Ember Pack (+12% atk) with Ambush (+16% atk)", () => {
        const squad = [mk({ element: "Fire", role: "assassin" }), mk({ element: "Fire", role: "assassin" })];
        const total = aggregateSynergyBonus(resolveSynergies(squad));
        assert.ok(Math.abs(total.attack - 0.28) < 1e-9, `expected +28% attack, got ${total.attack}`);
        assert.equal(total.hp, 0);
    });
});

describe("applySynergiesToSquad — buffs copies, never mutates", () => {
    it("scales stats by the aggregate bonus and leaves originals untouched", () => {
        const squad = [mk({ element: "Fire", role: "assassin", attack: 100 }), mk({ element: "Fire", role: "assassin", attack: 100 })];
        const buffed = applySynergiesToSquad(squad);
        // +12% (Ember) +16% (Ambush) = +28% → 128
        assert.equal(buffed[0].attack, 128);
        assert.equal(squad[0].attack, 100, "source squad must not be mutated");
        assert.notEqual(buffed[0], squad[0], "must return new objects");
    });

    it("no active synergies → stats unchanged", () => {
        const squad = [mk({ element: "Fire", role: "assassin", attack: 100, hp: 200 })];
        const buffed = applySynergiesToSquad(squad);
        assert.equal(buffed[0].attack, 100);
        assert.equal(buffed[0].hp, 200);
    });
});
