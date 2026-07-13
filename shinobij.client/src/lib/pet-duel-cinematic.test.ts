import { test } from "node:test";
import assert from "node:assert/strict";
import { runPetDuelCinematic, runPetPartyDuelCinematic } from "./pet-duel-cinematic";
import { DUEL_TPS } from "./pet-duel-sim";
import type { Pet, PetJutsu } from "../types/pet";

const j = (o: Partial<PetJutsu>): PetJutsu => ({ name: "m", power: 90, cooldown: 2, currentCooldown: 0, kind: "damage", ...o } as PetJutsu);
const mk = (o: Partial<Pet>): Pet => ({
    id: "x", name: "x", rarity: "rare", level: 20, xp: 0, maxLevel: 100,
    hp: 1000, attack: 100, defense: 50, speed: 90, element: "None",
    jutsus: [j({ name: "Strike", kind: "damage", power: 100 }), j({ name: "Bolt", kind: "burn", power: 90 })],
    ...o,
} as Pet);

const SEEDS = [1, 7, 42, 2024, 99999];

test("cinematic 1v1 is deterministic — same pets + seed → byte-identical result", () => {
    for (const seed of SEEDS) {
        const a = runPetDuelCinematic(mk({ id: "a", element: "Fire" }), mk({ id: "b", element: "Water", speed: 120 }), seed);
        const b = runPetDuelCinematic(mk({ id: "a", element: "Fire" }), mk({ id: "b", element: "Water", speed: 120 }), seed);
        assert.deepEqual(a, b, `seed ${seed} diverged`);
    }
});

test("cinematic 2v2 is deterministic", () => {
    for (const seed of SEEDS) {
        const run = () => runPetPartyDuelCinematic(
            mk({ id: "pl", element: "Fire" }), mk({ id: "pr", element: "Water", subRole: "kite" }),
            mk({ id: "el", element: "Wind" }), mk({ id: "er", element: "Earth" }), seed);
        assert.deepEqual(run(), run(), `2v2 seed ${seed} diverged`);
    }
});

test("cinematic fights are valid, finite, terminating, and mostly decisive KOs", () => {
    let ko = 0, n = 0;
    for (const seed of SEEDS) {
        const r = runPetDuelCinematic(mk({ id: "a", attack: 110 }), mk({ id: "b", element: "Wind" }), seed);
        n++;
        assert.ok(["win", "loss", "draw"].includes(r.result));
        assert.ok(r.ticks >= 1 && r.ticks <= DUEL_TPS * 75, `ticks out of range ${r.ticks}`);
        assert.ok(r.snapshots.length === r.ticks, "one snapshot per tick");
        for (const s of r.snapshots) for (const ac of s.actors) {
            assert.ok(Number.isFinite(ac.x) && Number.isFinite(ac.y), "non-finite position");
            assert.ok(ac.hp >= 0 && ac.hp <= ac.maxHp + 1, "hp out of range");
        }
        if (r.events.some((e) => e.type === "ko")) ko++;
    }
    assert.ok(ko >= n - 1, `expected nearly all fights to KO (${ko}/${n})`);
});

test("cinematic — a clearly stronger pet wins from either side", () => {
    const strong = mk({ id: "s", hp: 1400, attack: 170, defense: 90, speed: 120 });
    const weak = mk({ id: "w", hp: 480, attack: 45, defense: 25, speed: 55 });
    for (const seed of SEEDS) {
        assert.equal(runPetDuelCinematic(strong, weak, seed).result, "win", `strong should win as player (seed ${seed})`);
        assert.equal(runPetDuelCinematic(weak, strong, seed).result, "loss", `strong should win as enemy (seed ${seed})`);
    }
});

test("cinematic — the type-advantaged element wins more (elements matter)", () => {
    // Fire beats Wind; identical stats otherwise → the countering side should win a
    // clear majority (advantage is meaningful; the exact rate is a tunable knob).
    let fireWins = 0, total = 0;
    for (const seed of SEEDS) {
        if (runPetDuelCinematic(mk({ id: "a", element: "Fire" }), mk({ id: "b", element: "Wind" }), seed).result === "win") fireWins++;
        total++;
    }
    assert.ok(fireWins > total / 2, `Fire (beats Wind) should win the majority — got ${fireWins}/${total}`);
});
