import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet, PetJutsu } from "../types/pet";
import { runPetDuel, DUEL_TPS } from "./pet-duel-sim";

/*
 * Phase A coverage for the new continuous-duel engine (pet-duel-sim.ts). The
 * load-bearing invariant is DETERMINISM (ranked replays — see the redesign plan
 * §0/§6): the same (playerPet, enemyPet, seed) must yield byte-identical
 * snapshots + events on any machine. We also guard numeric safety, clean
 * termination, real interaction (the pets actually move + trade hits), and that
 * a clearly stronger pet wins.
 */

const J = (over: Partial<PetJutsu> & Pick<PetJutsu, "name" | "kind">): PetJutsu => ({
    power: 90, cooldown: 0, currentCooldown: 0, ...over,
});

function makePet(over: Partial<Pet> = {}): Pet {
    return {
        id: "pet",
        name: "Tester",
        rarity: "rare",
        level: 25,
        xp: 0,
        maxLevel: 50,
        hp: 900,
        attack: 130,
        defense: 70,
        speed: 95,
        unlockedForPve: true,
        element: "Fire",
        trait: "Aggressive",
        moveRange: 2,
        jutsus: [J({ name: "Strike", kind: "damage", power: 110 })],
        ...over,
    };
}

function assertAllNumbersFinite(value: unknown, path = "result"): void {
    if (typeof value === "number") {
        assert.ok(Number.isFinite(value), `non-finite number at ${path}: ${String(value)}`);
        return;
    }
    if (Array.isArray(value)) { value.forEach((v, i) => assertAllNumbersFinite(v, `${path}[${i}]`)); return; }
    if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) assertAllNumbersFinite(v, `${path}.${k}`);
    }
}

const SEEDS = [1, 7, 12345, 98765, 2024];
const CAP = DUEL_TPS * 25;

test("duel is deterministic — same seed yields byte-identical snapshots + events", () => {
    for (const seed of SEEDS) {
        const a = runPetDuel(
            makePet({ id: "a", name: "Aka", element: "Fire" }),
            makePet({ id: "b", name: "Boku", element: "Wind", trait: "Swift", speed: 140 }),
            seed,
        );
        const b = runPetDuel(
            makePet({ id: "a", name: "Aka", element: "Fire" }),
            makePet({ id: "b", name: "Boku", element: "Wind", trait: "Swift", speed: 140 }),
            seed,
        );
        assert.deepEqual(a, b, `seed ${seed} diverged between identical runs`);
    }
});

test("duel produces a valid, numerically-safe, terminating result for every seed", () => {
    for (const seed of SEEDS) {
        const r = runPetDuel(makePet({ id: "a" }), makePet({ id: "b", element: "Water", speed: 110 }), seed);
        assert.ok(["win", "loss", "draw"].includes(r.result), `unexpected result "${r.result}"`);
        assert.ok(r.ticks >= 1 && r.ticks <= CAP, `ticks out of range: ${r.ticks}`);
        assert.equal(r.snapshots.length, r.ticks, "one snapshot per tick");
        assertAllNumbersFinite(r, `duel.seed${seed}`);
    }
});

test("the pets actually fight — they close the gap and trade hits", () => {
    const r = runPetDuel(makePet({ id: "a" }), makePet({ id: "b", element: "Water" }), 7);
    // Both started at the spawn edges; by mid-fight at least one has crossed in.
    const first = r.snapshots[0];
    assert.ok(Math.abs(first.player.x) > 4 && Math.abs(first.enemy.x) > 4, "should spawn at the edges");
    const closed = r.snapshots.some((s) => Math.abs(s.enemy.x - s.player.x) < 1.6);
    assert.ok(closed, "the pets never closed into melee range");
    // Real exchanges happened: wind-ups landed as hits.
    assert.ok(r.events.some((e) => e.type === "windup"), "no telegraphed wind-ups");
    assert.ok(r.events.some((e) => e.type === "hit"), "no hits landed");
    assert.ok(r.events.some((e) => e.type === "ko"), "fight should end in a KO at these stats");
});

test("a clearly stronger pet wins", () => {
    // Same seed, big stat gap → the strong side should take it.
    const strong = runPetDuel(
        makePet({ id: "a", hp: 1400, attack: 220 }),
        makePet({ id: "b", hp: 500, attack: 60 }),
        2024,
    );
    assert.equal(strong.result, "win", "the much stronger player pet should win");
    const weak = runPetDuel(
        makePet({ id: "a", hp: 500, attack: 60 }),
        makePet({ id: "b", hp: 1400, attack: 220 }),
        2024,
    );
    assert.equal(weak.result, "loss", "the much weaker player pet should lose");
});

test("degenerate pets never crash or emit non-finite numbers", () => {
    const r = runPetDuel(
        makePet({ id: "a", hp: 0, attack: 0, speed: 0, defense: 0 }),
        makePet({ id: "b", hp: 1, attack: 0, speed: 0, defense: 0 }),
        1,
    );
    assert.ok(["win", "loss", "draw"].includes(r.result));
    assertAllNumbersFinite(r, "degenerate");
});

test("state is quantized — positions land on the 1/256 grid", () => {
    const r = runPetDuel(makePet({ id: "a" }), makePet({ id: "b" }), 12345);
    for (const s of r.snapshots) {
        for (const a of [s.player, s.enemy]) {
            assert.equal(a.x, Math.round(a.x * 256) / 256, "x off the quantization grid");
            assert.equal(a.y, Math.round(a.y * 256) / 256, "y off the quantization grid");
        }
    }
});
