/*
 * The World Map's half of the road beast rule. A tester met a "Stray Oni-Hound"
 * wearing a fox portrait and fought a Desert Lizard: the name, the art and the
 * opponent came from three unrelated places. The map now dresses each beast in
 * the species the server will field against the player's rival.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { roadBeastIdentity, roadBeastReadyPets, withRoadBeastIdentity } from "./road-beast";
import { rawPetPool } from "../data/pet-pool";
import type { Wanderer } from "./wanderers";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import { wandererBeastRival, wandererBeastSpecies } from "../../../shared/wanderer-beast";

function beast(id: string, overrides: Partial<Wanderer> = {}): Wanderer {
    return {
        id, name: "Stray Beast", archetype: "beast", verb: "petDuel", level: 40,
        homeTile: 30, waypoints: [30], movement: "patrol",
        greeting: "It locks eyes with your pet. It wants a fight.", tellTint: "#9bf0a6", avatarKey: "beast",
        ...overrides,
    };
}

function owned(id: string, rarity: Pet["rarity"], level: number, extra: Partial<Pet> = {}): Pet {
    const template = rawPetPool.find((tpl) => tpl.rarity === rarity)!;
    return { ...template, id, name: `Pal ${id}`, level, ...extra };
}

const PETS = [owned("a", "standard", 12), owned("b", "rare", 31), owned("c", "legendary", 58)];
const CHARACTER = { name: "beastqa", pets: PETS, activePetId: "a" } as unknown as Character;
const IDS = Array.from({ length: 30 }, (_, i) => `w-${1 + i}-81234-${i % 2}`);

describe("road beast identity", () => {
    it("names the beast after the species of its rival's rarity", () => {
        for (const id of IDS) {
            const identity = roadBeastIdentity(beast(id), PETS)!;
            assert.equal(identity.rival.id, wandererBeastRival(id, PETS)!.id);
            assert.equal(identity.species.rarity, identity.rival.rarity);
            assert.equal(identity.species.id, wandererBeastSpecies(id, identity.rival.rarity, rawPetPool)!.id);
            assert.equal(identity.name, `Stray ${identity.species.name}`);
        }
    });

    it("dresses the billboard, dialog and level in that identity", () => {
        for (const id of IDS) {
            const identity = roadBeastIdentity(beast(id), PETS)!;
            const dressed = withRoadBeastIdentity(beast(id), PETS);
            assert.equal(dressed.name, identity.name);
            assert.equal(dressed.level, identity.rival.level, "the beast's lead is levelled to its rival");
            assert.match(dressed.greeting, new RegExp(`${identity.rival.name}\\.$`));
            assert.equal(dressed.id, id, "the server is still asked for the same wanderer");
            if (dressed.avatarImage) assert.doesNotMatch(dressed.avatarImage, /demo-emberfox/);
        }
    });

    it("prefers published species art for the portrait", () => {
        const id = IDS[0];
        const identity = roadBeastIdentity(beast(id), PETS)!;
        const art = `/api/img?id=pet:${identity.species.id}`;
        const dressed = withRoadBeastIdentity(beast(id), PETS, { [`pet:${identity.species.id}`]: art });
        assert.ok(dressed.avatarImage?.startsWith(art), dressed.avatarImage);
    });

    it("leaves a beast neutral when no pet can answer it", () => {
        assert.deepEqual(withRoadBeastIdentity(beast(IDS[0]), []), beast(IDS[0]));
    });

    it("never touches anything that is not a beast", () => {
        const bandit = beast(IDS[0], { archetype: "bandit", verb: "attack", name: "Kano Two-Blades" });
        assert.equal(withRoadBeastIdentity(bandit, PETS), bandit);
    });
});

describe("roadBeastReadyPets", () => {
    it("matches the server: carried pets only, minus expeditions and the hatchery", () => {
        const now = Date.now();
        const away = owned("away", "rare", 20, { expedition: { endsAt: now + 60_000 } as Pet["expedition"] });
        const breeding = owned("nest", "rare", 60);
        const character = {
            name: "beastqa", activePetId: "away",
            pets: [away, breeding, ...PETS],
            petBreeding: { state: "breeding", readyAt: now + 60_000, parentIds: ["nest"] },
        } as unknown as Character;
        const ready = roadBeastReadyPets(character, now).map((pet) => pet.id);
        assert.ok(!ready.includes("away"), "a pet on an expedition cannot be challenged");
        assert.ok(!ready.includes("nest"), "a pet in the hatchery cannot be challenged");
    });

    it("only counts carried pets", () => {
        const many = Array.from({ length: 12 }, (_, i) => owned(`p${i}`, "standard", 5));
        const ready = roadBeastReadyPets({ ...CHARACTER, pets: many } as unknown as Character);
        assert.ok(ready.length < many.length, "pets left in the Sanctuary must not be picked");
    });
});
