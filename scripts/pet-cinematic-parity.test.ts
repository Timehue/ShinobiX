import { test } from "node:test";
import assert from "node:assert/strict";
import { runPetDuelCinematic as serverRun } from "../api/_pet-sim/pet-duel-cinematic";
import { runPetDuelCinematic as clientRun } from "../shinobij.client/src/lib/pet-duel-cinematic";
import { genericPetArenaOpponents as OPP } from "../shinobij.client/src/data/pet-arena-opponents";
import type { Pet } from "../shinobij.client/src/types/pet";

/*
 * Pet-CINEMATIC-sim parity. api/_pet-sim/pet-duel-cinematic.ts is a GENERATED server copy
 * of the client cinematic coliseum engine (scripts/gen-pet-sim.mjs) so that the
 * promoted-authoritative pet fights — the Pet Ladder 1v1 and the Pet Arena ranked result —
 * resolve with the EXACT battle the client renders. If the copy drifts, the client would
 * show one winner and the server would record another: a desync that flips a ranked result
 * or a captured sector wrong. Asserts byte-identical results; re-run
 * `node scripts/gen-pet-sim.mjs` if it fails.
 *
 * IMPORTANT: use REAL, DISTINCT arena pets — they engage and trade damage. A degenerate
 * synthetic fixture (e.g. two identical high-speed pets) can kite forever and end 0-hit
 * scoreless draws, which makes a parity check pass vacuously without ever exercising the
 * damage / terrain path. The decisiveness + terrain assertions below guard against that.
 * Lives in scripts/ (excluded from both tsc projects) so it can import the client engine.
 */
const clone = (p: Pet): Pet => JSON.parse(JSON.stringify(p));
const pets: Pet[] = OPP.map((o) => o.pet as Pet);
const pairs: Array<[Pet, Pet]> = [];
for (let i = 0; i + 1 < pets.length; i += 2) pairs.push([pets[i], pets[i + 1]]);

test("server pet-duel-cinematic is byte-identical to the client original (real arena pets, both accuracy modes)", () => {
    assert.ok(pairs.length > 0, "expected at least one real opponent pair");
    let decisive = 0, total = 0;
    for (const [a, b] of pairs) {
        for (const seed of [1, 7, 42, 12345, 2024]) {
            for (const acc of [false, true]) {
                total++;
                // (playerPet, enemyPet, seed, dmgMult, hpMult, reviveOnce, applyItems, accuracy)
                const s = serverRun(clone(a), clone(b), seed, 1, 1, false, true, acc);
                const c = clientRun(clone(a), clone(b), seed, 1, 1, false, true, acc);
                assert.deepEqual(s, c, `cinematic parity drift: ${a.name} vs ${b.name} seed ${seed} acc ${acc}`);
                if (c.result !== "draw") decisive++;
            }
        }
    }
    // Guard against a vacuous test: the fixtures must actually FIGHT, or parity proves nothing.
    assert.ok(decisive >= total * 0.5, `real-pet fixtures should mostly reach a decision (got ${decisive}/${total})`);
});

test("server pet-duel-cinematic parity holds across sector-war terrains (and terrain is honored)", () => {
    // Real fighting pets, but with explicit opposing elements so a home terrain can matter.
    const fire: Pet = { ...clone(pets[0]), element: "Fire" as Pet["element"] };
    const water: Pet = { ...clone(pets[1] ?? pets[0]), id: "water", element: "Water" as Pet["element"] };
    for (const terrain of ["volcano", "snow", "forest", "shadow", "central", null]) {
        for (const seed of [1, 7, 12345, 2024]) {
            const s = serverRun(clone(fire), clone(water), seed, 1, 1, false, true, false, terrain);
            const c = clientRun(clone(fire), clone(water), seed, 1, 1, false, true, false, terrain);
            assert.deepEqual(s, c, `cinematic terrain parity drift: seed ${seed} terrain ${terrain}`);
        }
    }
    // Terrain IS functional in the cinematic engine (terrainPetMult feeds atkMult → f.atk →
    // damage). Prove the +10% home bonus is NOT silently dropped: some seed must differ.
    let terrainChangedSomeFight = false;
    for (const seed of [1, 7, 42, 123, 777, 2024, 9999, 31415]) {
        const withHome = JSON.stringify(serverRun(clone(fire), clone(water), seed, 1, 1, false, true, false, "volcano"));
        const neutral = JSON.stringify(serverRun(clone(fire), clone(water), seed, 1, 1, false, true, false, "central"));
        if (withHome !== neutral) { terrainChangedSomeFight = true; break; }
    }
    assert.ok(terrainChangedSomeFight, "a Fire pet on volcano should change at least one cinematic fight (terrain must be honored)");
    assert.deepEqual(
        serverRun(clone(fire), clone(water), 7, 1, 1, false, true, false, null),
        serverRun(clone(fire), clone(water), 7, 1, 1, false, true, false, "central"),
        "null terrain must be identical to central (both neutral)",
    );
});
