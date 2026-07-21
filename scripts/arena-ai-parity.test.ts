import { test } from "node:test";
import assert from "node:assert/strict";
import { SERVER_ARENA_PETS } from "../api/pet/_arena-ai";
import { genericPetArenaOpponents } from "../shinobij.client/src/data/pet-arena-opponents";
import { runPetDuel } from "../shinobij.client/src/lib/pet-duel-sim";
import type { Pet } from "../shinobij.client/src/types/pet";

/*
 * The reward re-sim (api/pet/battle-start.ts and api/pet/warfront-start.ts)
 * resolves the vs-AI opponent from SERVER_ARENA_PETS, but the CLIENT plays with
 * genericPetArenaOpponents. They MUST match in every field the sims read —
 * especially `element`: the pet-duel element multiplier is a big damage lever,
 * and a stale/absent element flipped the re-sim winner ~10% of the time, denying
 * honest AI-battle wins their reward (the server sealed a loss the player never
 * saw). This asserts field parity AND winner parity so any future drift is caught.
 */
const player = (): Pet => ({
    id: "p", name: "P", rarity: "rare", element: "Water", level: 25, xp: 0, maxLevel: 90,
    hp: 700, attack: 95, defense: 55, speed: 80, moveRange: 3, unlockedForPve: true, trait: "Balanced",
    jutsus: [
        { name: "Strike", power: 90, cooldown: 1, currentCooldown: 0, kind: "damage" },
        { name: "Guard", power: 60, cooldown: 3, currentCooldown: 0, kind: "shield" },
    ],
} as unknown as Pet);

test("SERVER_ARENA_PETS matches client genericPetArenaOpponents (element + stats)", () => {
    for (const o of genericPetArenaOpponents) {
        const c = o.pet;
        const s = SERVER_ARENA_PETS[c.id];
        assert.ok(s, `server is missing AI pet ${c.id}`);
        assert.equal(s.element, c.element, `${c.id} element drift (breaks reward re-sim)`);
        assert.equal(s.hp, c.hp, `${c.id} hp drift`);
        assert.equal(s.attack, c.attack, `${c.id} attack drift`);
        assert.equal(s.defense, c.defense, `${c.id} defense drift`);
        assert.equal(s.speed, c.speed, `${c.id} speed drift`);
        assert.equal(s.level, c.level, `${c.id} level drift`);
        assert.equal(s.rarity, c.rarity, `${c.id} rarity drift`);
    }
});

test("reward re-sim winner === the client's fight for every AI opponent", () => {
    const p = player();
    for (const o of genericPetArenaOpponents) {
        const s = SERVER_ARENA_PETS[o.pet.id];
        for (let seed = 1; seed <= 60; seed++) {
            assert.equal(
                runPetDuel(p, s, seed, 1, 1, false, false, false).result,
                runPetDuel(p, o.pet, seed, 1, 1, false, false, false).result,
                `re-sim winner diverges from the client fight @ ${o.pet.id} seed ${seed}`,
            );
        }
    }
});
