import { test } from "node:test";
import assert from "node:assert/strict";
import { runPetDuel as serverRun } from "../api/_pet-sim/pet-duel-sim";
import { runPetDuel as clientRun } from "../shinobij.client/src/lib/pet-duel-sim";
import type { Pet, PetJutsu } from "../shinobij.client/src/types/pet";

/*
 * Pet-sim parity. api/pet-sim/pet-duel-sim.ts is a GENERATED server copy of the
 * client engine (scripts/gen-pet-sim.mjs) so Pet sector-wars resolve with the EXACT
 * battle the client shows. If the copy ever drifts, the client would show one winner
 * and the server would record another — a desync that flips territory wrong. This
 * asserts byte-identical results; re-run `node scripts/gen-pet-sim.mjs` if it fails.
 *
 * Lives in scripts/ (excluded from both tsc projects) so it can import the client
 * engine, whose internal no-extension imports don't satisfy the server's Node16
 * resolution. Run via tsx like the other cross-build parity tests.
 */
const J = (over: Partial<PetJutsu> & Pick<PetJutsu, "name" | "kind">): PetJutsu => ({ power: 90, cooldown: 0, currentCooldown: 0, ...over });
function makePet(over: Partial<Pet> = {}): Pet {
    return {
        id: "pet", name: "Tester", rarity: "rare", level: 25, xp: 0, maxLevel: 50,
        hp: 900, attack: 130, defense: 70, speed: 95, unlockedForPve: true,
        element: "Fire", trait: "Aggressive", moveRange: 2,
        jutsus: [J({ name: "Strike", kind: "damage", power: 110 })],
        ...over,
    };
}

test("server pet-duel-sim is byte-identical to the client original (sector-war path: items off, both accuracy modes)", () => {
    const A = makePet({ id: "a", element: "Fire", jutsus: [J({ name: "Strike", kind: "damage", power: 110 }), J({ name: "Frost", kind: "freeze", power: 80, rounds: 1 })] });
    const B = makePet({ id: "b", element: "Water", attack: 120, defense: 80, speed: 100, jutsus: [J({ name: "Strike", kind: "damage", power: 100 }), J({ name: "Frost", kind: "freeze", power: 70, rounds: 1 })] });
    for (const seed of [1, 7, 12345, 98765, 2024]) {
        for (const acc of [false, true]) {
            const s = serverRun(A, B, seed, 1, 1, false, false, acc);
            const c = clientRun(A, B, seed, 1, 1, false, false, acc);
            assert.deepEqual(s, c, `pet-duel parity drift at seed ${seed}, accuracy=${acc}`);
        }
    }
});
