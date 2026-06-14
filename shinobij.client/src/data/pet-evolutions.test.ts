import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet } from "../types/pet";
import {
    STARTER_EVOLUTIONS,
    EVOLUTION_LINES,
    evolutionLineFor,
    evolvePet,
    nextEvolution,
    petVisualId,
    currentStage,
} from "./pet-evolutions";
import { isWildSpawnable, rollPetEncounter } from "../lib/pet-balance";

function pet(over: Partial<Pet> = {}): Pet {
    return {
        id: "starter-fire",
        name: "Cinder Cub",
        rarity: "standard",
        level: 50,
        xp: 0,
        maxLevel: 100,
        hp: 300,
        attack: 46,
        defense: 24,
        speed: 32,
        moveRange: 3,
        element: "Fire",
        unlockedForPve: false,
        jutsus: [{ name: "Flame Burst", power: 56, cooldown: 3, currentCooldown: 0, kind: "damage", signature: true }],
        ...over,
    };
}

test("STARTER_EVOLUTIONS has 10 wild-locked templates (2 per starter)", () => {
    assert.equal(STARTER_EVOLUTIONS.length, 10);
    for (const t of STARTER_EVOLUTIONS) {
        assert.equal(t.wildSpawnable, false, `${t.id} must be wild-locked`);
        assert.ok(t.id.startsWith("starter-"), `${t.id} keeps the starter- prefix`);
        assert.ok(t.id.endsWith("-r") || t.id.endsWith("-l"), `${t.id} has a stage suffix`);
        assert.ok(t.rarity === "rare" || t.rarity === "legendary");
        assert.ok(t.element, `${t.id} keeps an element`);
    }
    // Rare + legendary per base, element carried from the base starter.
    const fireR = STARTER_EVOLUTIONS.find((t) => t.id === "starter-fire-r")!;
    const fireL = STARTER_EVOLUTIONS.find((t) => t.id === "starter-fire-l")!;
    assert.equal(fireR.element, "Fire");
    assert.equal(fireL.element, "Fire");
    assert.equal(fireR.rarity, "rare");
    assert.equal(fireL.rarity, "legendary");
    assert.equal(fireR.name, "Ember Wolf");
    assert.equal(fireL.name, "Inferno Fenrir");
});

test("isWildSpawnable locks starters AND their evolutions out of the wild", () => {
    assert.equal(isWildSpawnable(pet({ id: "starter-fire" })), false);
    for (const t of STARTER_EVOLUTIONS) assert.equal(isWildSpawnable(t), false);
    // A normal pool pet is spawnable.
    assert.equal(isWildSpawnable(pet({ id: "rare-12", rarity: "rare" })), true);
    // The explicit wildSpawnable:false flag also locks a non-starter id.
    assert.equal(isWildSpawnable(pet({ id: "event-boss-1", wildSpawnable: false })), false);
});

test("rollPetEncounter never returns a wild-locked evolution template", () => {
    const orig = Math.random;
    try {
        Math.random = () => 0.008; // forces the 'rare' encounter band
        // Pool of ONLY the wild-locked rare evolution templates → no eligible pet.
        const lockedOnly = STARTER_EVOLUTIONS.filter((t) => t.rarity === "rare");
        assert.equal(rollPetEncounter(lockedOnly), null);
        // Add a normal rare pet → that one (and only that one) can be rolled.
        const normal = pet({ id: "rare-7", rarity: "rare" });
        const got = rollPetEncounter([...lockedOnly, normal]);
        assert.ok(got, "a spawnable rare pet should be returned");
        assert.ok(got!.id.startsWith("rare-7"), "only the spawnable pet is eligible");
    } finally {
        Math.random = orig;
    }
});

test("evolvePet mirror: applies deltas, preserves id + element, advances stage", () => {
    const line = evolutionLineFor("starter-fire")!;
    const rare = evolvePet(pet({ level: 50 }), 1, line);
    assert.equal(rare.id, "starter-fire");
    assert.equal(rare.element, "Fire");
    assert.equal(rare.rarity, "rare");
    assert.equal(rare.evolutionStage, 1);
    assert.equal(rare.hp, 350);
    assert.equal(rare.attack, 54);
    assert.equal(rare.moveRange, 3);

    const legendary = evolvePet({ ...rare, level: 90 }, 2, line);
    assert.equal(legendary.rarity, "legendary");
    assert.equal(legendary.evolutionStage, 2);
    assert.equal(legendary.moveRange, 4); // +1 at legendary
});

test("nextEvolution + petVisualId track the stage", () => {
    assert.equal(nextEvolution(pet({ rarity: "standard" }))?.rarity, "rare");
    assert.equal(nextEvolution(pet({ rarity: "rare", evolutionStage: 1 }))?.rarity, "legendary");
    assert.equal(nextEvolution(pet({ rarity: "legendary", evolutionStage: 2 })), null);
    assert.equal(nextEvolution(pet({ id: "rare-3", rarity: "rare" })), null); // not a starter

    assert.equal(petVisualId(pet({ evolutionStage: 0 })), "starter-fire");
    assert.equal(petVisualId(pet({ evolutionStage: 1 })), "starter-fire-r");
    assert.equal(petVisualId(pet({ evolutionStage: 2 })), "starter-fire-l");
    assert.equal(petVisualId(pet({ id: "rare-3" })), "rare-3"); // non-starter unchanged

    assert.equal(currentStage(pet({ rarity: "rare" })), 1);
    assert.equal(Object.keys(EVOLUTION_LINES).length, 5);
});
