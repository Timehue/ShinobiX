import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet, PetJutsu } from "../types/pet";
import { runPetDuel, runPetPartyDuel, DUEL_TPS, type DuelSnapshot } from "./pet-duel-sim";

/*
 * Coverage for the continuous-duel engine (pet-duel-sim.ts), Phases A+B. The
 * load-bearing invariant is DETERMINISM (ranked replays — see the redesign plan
 * §0/§6): the same (pets…, seed) must yield byte-identical snapshots + events on
 * any machine. We also guard numeric safety, clean termination, real interaction
 * (the pets move + trade hits), stronger-pet-wins, and that the Phase-B layer
 * (abilities, elements, statuses, ultimates) actually fires — in BOTH 1v1 and 2v2.
 */

const J = (over: Partial<PetJutsu> & Pick<PetJutsu, "name" | "kind">): PetJutsu => ({
    power: 90, cooldown: 0, currentCooldown: 0, ...over,
});

function makePet(over: Partial<Pet> = {}): Pet {
    return {
        id: "pet", name: "Tester", rarity: "rare", level: 25, xp: 0, maxLevel: 50,
        hp: 900, attack: 130, defense: 70, speed: 95, unlockedForPve: true,
        element: "Fire", trait: "Aggressive", moveRange: 2,
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
const CAP = DUEL_TPS * 30;
const actor = (s: DuelSnapshot, team: "player" | "enemy", slot = 0) => s.actors.find((a) => a.team === team && a.slot === slot)!;

// ── 1v1 ──────────────────────────────────────────────────────────────────────

test("1v1 is deterministic — same seed yields byte-identical snapshots + events", () => {
    for (const seed of SEEDS) {
        const a = runPetDuel(makePet({ id: "a", element: "Fire" }), makePet({ id: "b", element: "Wind", trait: "Swift", speed: 140 }), seed);
        const b = runPetDuel(makePet({ id: "a", element: "Fire" }), makePet({ id: "b", element: "Wind", trait: "Swift", speed: 140 }), seed);
        assert.deepEqual(a, b, `seed ${seed} diverged`);
    }
});

test("1v1 produces a valid, numerically-safe, terminating result for every seed", () => {
    for (const seed of SEEDS) {
        const r = runPetDuel(makePet({ id: "a" }), makePet({ id: "b", element: "Water", speed: 110 }), seed);
        assert.ok(["win", "loss", "draw"].includes(r.result), `unexpected result "${r.result}"`);
        assert.ok(r.ticks >= 1 && r.ticks <= CAP, `ticks out of range: ${r.ticks}`);
        assert.equal(r.snapshots.length, r.ticks, "one snapshot per tick");
        for (const s of r.snapshots) assert.equal(s.actors.length, 2, "1v1 has two actors");
        assertAllNumbersFinite(r, `1v1.seed${seed}`);
    }
});

test("the pets actually fight — they close the gap and trade hits", () => {
    const r = runPetDuel(makePet({ id: "a" }), makePet({ id: "b", element: "Water" }), 7);
    const first = r.snapshots[0];
    assert.ok(Math.abs(actor(first, "player").x) > 4 && Math.abs(actor(first, "enemy").x) > 4, "should spawn at the edges");
    assert.ok(r.snapshots.some((s) => Math.abs(actor(s, "enemy").x - actor(s, "player").x) < 1.6), "never closed to melee");
    assert.ok(r.events.some((e) => e.type === "windup"), "no telegraphed wind-ups");
    assert.ok(r.events.some((e) => e.type === "hit"), "no hits landed");
    assert.ok(r.events.some((e) => e.type === "ko"), "fight should end in a KO");
});

test("the fighters keep spacing — they don't permanently pile up", () => {
    // The engagement bubble: pets should spend real time apart at a neutral
    // distance (circling / between exchanges), not glued together in a scrum.
    const r = runPetDuel(makePet({ id: "a" }), makePet({ id: "b", element: "Water" }), 7);
    const apart = r.snapshots.filter((s) => Math.abs(actor(s, "enemy").x - actor(s, "player").x) + Math.abs(actor(s, "enemy").y - actor(s, "player").y) > 2.2).length;
    assert.ok(apart > r.snapshots.length * 0.25, `pets stayed piled up (${apart}/${r.snapshots.length} frames apart)`);
});

test("a clearly stronger pet wins (1v1)", () => {
    assert.equal(runPetDuel(makePet({ id: "a", hp: 1400, attack: 220 }), makePet({ id: "b", hp: 500, attack: 60 }), 2024).result, "win");
    assert.equal(runPetDuel(makePet({ id: "a", hp: 500, attack: 60 }), makePet({ id: "b", hp: 1400, attack: 220 }), 2024).result, "loss");
});

test("degenerate pets never crash or emit non-finite numbers", () => {
    const r = runPetDuel(
        makePet({ id: "a", hp: 0, attack: 0, speed: 0, defense: 0, jutsus: [] }),
        makePet({ id: "b", hp: 1, attack: 0, speed: 0, defense: 0, jutsus: [] }),
        1,
    );
    assert.ok(["win", "loss", "draw"].includes(r.result));
    assertAllNumbersFinite(r, "degenerate");
});

test("state is quantized — positions land on the 1/256 grid", () => {
    const r = runPetDuel(makePet({ id: "a" }), makePet({ id: "b" }), 12345);
    for (const s of r.snapshots) for (const a of s.actors) {
        assert.equal(a.x, Math.round(a.x * 256) / 256, "x off-grid");
        assert.equal(a.y, Math.round(a.y * 256) / 256, "y off-grid");
    }
});

// ── Phase B: abilities / elements / statuses / ultimates ─────────────────────

test("a burn jutsu lands a DoT status on the enemy", () => {
    const burner = makePet({ id: "a", element: "Fire", jutsus: [J({ name: "Strike", kind: "damage", power: 100 }), J({ name: "Cinder", kind: "burn", power: 80, cooldown: 2, rounds: 3 })] });
    const got = SEEDS.some((seed) => {
        const r = runPetDuel(burner, makePet({ id: "b", element: "Earth" }), seed);
        return r.snapshots.some((s) => s.actors.some((a) => a.team === "enemy" && a.statuses.includes("burn")));
    });
    assert.ok(got, "no enemy was ever burning despite a burn jutsu");
});

test("hit events carry the attacker's element", () => {
    const r = runPetDuel(makePet({ id: "a", element: "Lightning" }), makePet({ id: "b", element: "Earth" }), 7);
    const hit = r.events.find((e) => e.type === "hit");
    assert.ok(hit && hit.element === "Lightning", "hit should record the attacker's element");
});

test("a signature jutsu fires an ultimate event", () => {
    const ult = makePet({ id: "a", jutsus: [J({ name: "Strike", kind: "damage", power: 100 }), J({ name: "Finisher", kind: "lifesteal", power: 160, cooldown: 4, signature: true })] });
    const got = SEEDS.some((seed) => runPetDuel(ult, makePet({ id: "b" }), seed).events.some((e) => e.type === "ultimate"));
    assert.ok(got, "no ultimate event despite a signature jutsu");
});

// ── 2v2 ──────────────────────────────────────────────────────────────────────

test("2v2 is deterministic — same seed yields byte-identical results", () => {
    for (const seed of SEEDS) {
        const mk = () => runPetPartyDuel(
            makePet({ id: "pl", element: "Fire" }), makePet({ id: "pr", element: "Water", jutsus: [J({ name: "Mend", kind: "heal", power: 120, cooldown: 3 })] }),
            makePet({ id: "el", element: "Wind" }), makePet({ id: "er", element: "Earth", speed: 120 }),
            seed,
        );
        assert.deepEqual(mk(), mk(), `2v2 seed ${seed} diverged`);
    }
});

test("2v2 is valid, numerically-safe, terminating, with four actors", () => {
    for (const seed of SEEDS) {
        const r = runPetPartyDuel(
            makePet({ id: "pl" }), makePet({ id: "pr", element: "Water" }),
            makePet({ id: "el", element: "Wind" }), makePet({ id: "er", element: "Earth" }),
            seed,
        );
        assert.ok(["win", "loss", "draw"].includes(r.result));
        assert.ok(r.ticks >= 1 && r.ticks <= CAP);
        assert.equal(r.snapshots.length, r.ticks);
        for (const s of r.snapshots) assert.equal(s.actors.length, 4, "2v2 has four actors");
        assertAllNumbersFinite(r, `2v2.seed${seed}`);
    }
});

test("2v2 ends by eliminating a whole team", () => {
    // Strong player team vs weak enemy team → player wins, both enemies down.
    const r = runPetPartyDuel(
        makePet({ id: "pl", hp: 1200, attack: 200 }), makePet({ id: "pr", hp: 1200, attack: 200 }),
        makePet({ id: "el", hp: 400, attack: 50 }), makePet({ id: "er", hp: 400, attack: 50 }),
        2024,
    );
    assert.equal(r.result, "win");
    const last = r.snapshots[r.snapshots.length - 1];
    assert.ok(last.actors.filter((a) => a.team === "enemy").every((a) => a.hp <= 0), "both enemies should be down");
});

test("a 2v2 healer keeps a fragile ally alive longer (heal events fire)", () => {
    const healer = makePet({ id: "pr", hp: 700, attack: 80, jutsus: [J({ name: "Mend", kind: "heal", power: 140, cooldown: 2 })] });
    const fragile = makePet({ id: "pl", hp: 360, attack: 110 });
    const got = SEEDS.some((seed) => runPetPartyDuel(
        fragile, healer,
        makePet({ id: "el", attack: 170 }), makePet({ id: "er", attack: 170 }),
        seed,
    ).events.some((e) => e.type === "heal"));
    assert.ok(got, "a heal jutsu never fired for a hurt ally");
});

test("2v1 works when a reserve is missing", () => {
    const r = runPetPartyDuel(makePet({ id: "pl" }), makePet({ id: "pr" }), makePet({ id: "el" }), null, 7);
    assert.ok(["win", "loss", "draw"].includes(r.result));
    for (const s of r.snapshots) assert.equal(s.actors.length, 3, "2v1 has three actors");
    assertAllNumbersFinite(r, "2v1");
});
