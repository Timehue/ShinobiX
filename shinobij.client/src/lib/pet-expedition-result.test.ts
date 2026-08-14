import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Pet } from "../types/pet";
import { petXpNeeded } from "./pet-balance";
import { authoritativePetExpeditionGains } from "./pet-expedition-result";

function pet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: "pet-1",
    name: "Ember Fox",
    element: "Fire",
    rarity: "standard",
    level: 20,
    maxLevel: 100,
    xp: 25,
    hp: 100,
    attack: 20,
    defense: 18,
    speed: 16,
    happiness: 80,
    jutsus: [],
    ...overrides,
  } as Pet;
}

describe("authoritative expedition reward presentation", () => {
  it("derives exact stat deltas from the returned server pet", () => {
    const result = authoritativePetExpeditionGains(
      pet(),
      pet({ xp: 145, hp: 110, attack: 22, defense: 21, speed: 17 }),
    );
    assert.deepEqual(result, {
      xp: 120,
      leveledUp: false,
      statSummary: "+2 ATK · +3 DEF · +1 SPD · +10 HP",
    });
  });

  it("counts XP correctly across a level boundary", () => {
    const needed = petXpNeeded(20);
    const result = authoritativePetExpeditionGains(
      pet({ level: 20, xp: needed - 10 }),
      pet({ level: 21, xp: 35 }),
    );
    assert.equal(result.xp, 45);
    assert.equal(result.leveledUp, true);
  });

  it("never presents negative progress when authority returns a correction", () => {
    const result = authoritativePetExpeditionGains(pet({ xp: 500 }), pet({ xp: 100 }));
    assert.equal(result.xp, 0);
    assert.equal(result.statSummary, "");
  });
});
