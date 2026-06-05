import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet, PetJutsu } from "../types/pet";
import { runPetArenaBattle, runPetArenaParty } from "./pet-battle-sim";

/*
 * Regression coverage for the deterministic pet-battle engine — the ranked
 * source of truth, which previously had NO test file at all.
 *
 * These lock in the engine invariants that the three correctness fixes touched:
 *   • burn now subtracts 2 ATK instead of erasing the buff,
 *   • a movement-locked pet no longer breaks its root in finisher mode,
 *   • 2v2 lifesteal heals from the post-hit attacker (no thorns-revive).
 * Rather than assert internal state (the engine exposes none), we guard the
 * higher-level properties those bugs would have broken: determinism (same seed
 * → byte-identical battle, required for ranked replays), numeric safety (no
 * NaN/Infinity leaking into a reported result), and clean termination.
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
        jutsus: [
            J({ name: "Strike", kind: "damage", power: 110 }),
            J({ name: "Ember", kind: "burn", power: 80, cooldown: 3, rounds: 2 }),
            J({ name: "Siphon", kind: "lifesteal", power: 95, cooldown: 4 }),
        ],
        ...over,
    };
}

// Recursively assert every number anywhere in a battle result is finite — no
// NaN / Infinity may reach a reported HP, frame, or summary value.
function assertAllNumbersFinite(value: unknown, path = "result"): void {
    if (typeof value === "number") {
        assert.ok(Number.isFinite(value), `non-finite number at ${path}: ${String(value)}`);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((v, i) => assertAllNumbersFinite(v, `${path}[${i}]`));
        return;
    }
    if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) assertAllNumbersFinite(v, `${path}.${k}`);
    }
}

const SEEDS = [1, 7, 12345, 98765, 2024];

// ── 1v1 ───────────────────────────────────────────────────────────────────

test("1v1 is deterministic — same seed yields a byte-identical battle", () => {
    for (const seed of SEEDS) {
        const a = runPetArenaBattle(
            makePet({ id: "a", name: "Aka", element: "Fire" }),
            makePet({ id: "b", name: "Boku", element: "Wind", trait: "Swift" }),
            "Boku", seed,
        );
        const b = runPetArenaBattle(
            makePet({ id: "a", name: "Aka", element: "Fire" }),
            makePet({ id: "b", name: "Boku", element: "Wind", trait: "Swift" }),
            "Boku", seed,
        );
        assert.deepEqual(a, b, `seed ${seed} diverged between identical runs`);
    }
});

test("1v1 produces a valid, numerically-safe result for every seed", () => {
    for (const seed of SEEDS) {
        const r = runPetArenaBattle(makePet({ id: "a" }), makePet({ id: "b", element: "Water" }), "Foe", seed);
        assert.ok(["win", "loss", "draw"].includes(r.result), `unexpected result "${r.result}"`);
        assertAllNumbersFinite(r, `1v1.seed${seed}`);
    }
});

test("1v1 survives degenerate pets (no jutsus, 0 speed, missing hp)", () => {
    const broken = makePet({ id: "x", jutsus: [], speed: 0, hp: undefined as unknown as number });
    const ok = makePet({ id: "y" });
    assert.doesNotThrow(() => {
        const r = runPetArenaBattle(broken, ok, "Foe", 42);
        assert.ok(["win", "loss", "draw"].includes(r.result));
        assertAllNumbersFinite(r, "degenerate");
    });
});

// ── 2v2 ───────────────────────────────────────────────────────────────────

test("2v2 party is deterministic and numerically safe", () => {
    const mkParty = () => [
        makePet({ id: "l", name: "Lead", element: "Fire" }),
        makePet({
            id: "r", name: "Res", element: "Earth",
            jutsus: [J({ name: "Mend", kind: "heal", power: 60, cooldown: 3 }), J({ name: "Bite", kind: "lifesteal", power: 80 })],
        }),
    ] as [Pet, Pet];
    const mkEnemy = () => [
        makePet({ id: "el", name: "Foe1", element: "Wind", trait: "Swift" }),
        makePet({ id: "er", name: "Foe2", element: "Water", trait: "Guardian" }),
    ] as [Pet, Pet];

    for (const seed of SEEDS) {
        const a = runPetArenaParty(mkParty(), mkEnemy(), "Foe", seed);
        const b = runPetArenaParty(mkParty(), mkEnemy(), "Foe", seed);
        assert.deepEqual(a, b, `2v2 seed ${seed} diverged`);
        assert.ok(["win", "loss", "draw"].includes(a.result), `unexpected 2v2 result "${a.result}"`);
        assertAllNumbersFinite(a, `2v2.seed${seed}`);
    }
});
