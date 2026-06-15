import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet } from "../types/pet";
import { runPetArenaMatch, ARENA_TPS, MAX_SECONDS, WIN_SCORE, SCROLL_FIRST_SPAWN, type ArenaSlot, type ArenaRole } from "./pet-arena-sim";

/*
 * Coverage for the Tactical Pet Arena match sim. Load-bearing invariant is
 * DETERMINISM (same roster + seed → byte-identical snapshots/events). We also
 * guard a valid terminating match, scoring (kills + the win condition), the 3-life
 * respawn/elimination, the center-scroll lifecycle, and that roles act (sage heals).
 */
function mkPet(over: Partial<Pet> = {}): Pet {
    return { id: "p", name: "T", rarity: "rare", level: 25, xp: 0, maxLevel: 50, hp: 700, attack: 90, defense: 40, speed: 70, unlockedForPve: true, element: "Fire", trait: "Aggressive", moveRange: 2, jutsus: [], ...over } as Pet;
}
function roster(roles: ArenaRole[], over: Partial<Pet> = {}): ArenaSlot[] {
    return roles.map((role, i) => ({ pet: mkPet({ id: `${role}-${i}`, ...over }), role }));
}
const COMP: ArenaRole[] = ["defender", "tracker", "assassin", "sage"];
const SEEDS = [1, 7, 2024, 99999];

function assertFinite(v: unknown, path = "result"): void {
    if (typeof v === "number") { assert.ok(Number.isFinite(v), `non-finite at ${path}: ${v}`); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => assertFinite(x, `${path}[${i}]`)); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) assertFinite(x, `${path}.${k}`);
}

test("deterministic — same roster + seed yields byte-identical results", () => {
    for (const seed of SEEDS) {
        const a = runPetArenaMatch(roster(COMP), roster(COMP, { attack: 110 }), seed);
        const b = runPetArenaMatch(roster(COMP), roster(COMP, { attack: 110 }), seed);
        assert.deepEqual(a, b, `seed ${seed} diverged`);
    }
});

test("a valid, numerically-safe, terminating match for every seed (4v4 + 2v2)", () => {
    for (const seed of SEEDS) {
        for (const comp of [COMP, ["defender", "sage"] as ArenaRole[]]) {
            const r = runPetArenaMatch(roster(comp), roster(comp), seed);
            assert.ok(["blue", "red", "draw"].includes(r.winner));
            assert.ok(r.ticks >= 1 && r.ticks <= ARENA_TPS * MAX_SECONDS, `ticks ${r.ticks}`);
            assert.equal(r.snapshots.length, r.ticks);
            for (const s of r.snapshots) assert.equal(s.actors.length, comp.length * 2);
            assertFinite({ scoreBlue: r.scoreBlue, scoreRed: r.scoreRed, ticks: r.ticks }, `seed${seed}`);
        }
    }
});

test("a clearly stronger team wins — from EITHER side", () => {
    // The map/spawns aren't perfectly mirror-symmetric, so a side-lean exists for
    // stat-IDENTICAL teams; but pet QUALITY must dominate side. A hard stat edge
    // wins every seed whether it's Blue or Red — so real matches (player vs AI,
    // never identical) are decided by the pets, not the spawn corner.
    const strong = { hp: 1200, attack: 150 }, weak = { hp: 350, attack: 35 };
    const blueWins = SEEDS.map((seed) => runPetArenaMatch(roster(COMP, strong), roster(COMP, weak), seed).winner);
    assert.ok(blueWins.every((w) => w === "blue"), `strong Blue should sweep, got ${blueWins.join(",")}`);
    const redWins = SEEDS.map((seed) => runPetArenaMatch(roster(COMP, weak), roster(COMP, strong), seed).winner);
    assert.ok(redWins.every((w) => w === "red"), `strong Red should sweep, got ${redWins.join(",")}`);
});

test("the match reaches the win score OR a full team elimination", () => {
    const r = runPetArenaMatch(roster(COMP, { hp: 1200, attack: 150 }), roster(COMP, { hp: 350, attack: 35 }), 7);
    const last = r.snapshots[r.snapshots.length - 1];
    const reached = last.scoreBlue >= WIN_SCORE || last.scoreRed >= WIN_SCORE;
    const wipe = ["blue", "red"].some((tm) => last.actors.filter((a) => a.team === tm).every((a) => a.lives <= 0));
    assert.ok(reached || wipe, `neither win-score nor wipe (scores ${last.scoreBlue}-${last.scoreRed})`);
});

test("pets have 3 lives — deaths award points + respawns happen", () => {
    const r = runPetArenaMatch(roster(COMP, { hp: 1200, attack: 150 }), roster(COMP, { hp: 300, attack: 30 }), 7);
    assert.ok(r.events.some((e) => e.type === "kill"), "no kills scored");
    assert.ok(r.events.some((e) => e.type === "respawn"), "no respawns happened");
    // The weak team should lose lives over the match.
    const last = r.snapshots[r.snapshots.length - 1];
    assert.ok(last.actors.some((a) => a.team === "red" && a.lives < 3), "red never lost a life");
});

test("the center scroll spawns (fixed, after the timer) and is contestable", () => {
    const r = runPetArenaMatch(roster(COMP), roster(COMP), 2024);
    const spawn = r.events.find((e) => e.type === "scrollspawn");
    assert.ok(spawn, "scroll never spawned");
    assert.ok(spawn!.t >= SCROLL_FIRST_SPAWN - 2, `scroll spawned too early (t=${spawn!.t})`);
    // it spawns at the fixed center (same as result.center)
    const at = r.snapshots[spawn!.t]?.scroll;
    assert.ok(at && Math.abs(at.x - r.center[0]) < 0.01 && Math.abs(at.y - r.center[1]) < 0.01, "scroll not at center");
});

test("respawned pets are never frozen — they walk out of spawn (or get reached)", () => {
    // Regression for the "stuck on spawn" bug: the old respawn offset could snapPoint a
    // pet into a path tile that's DISCONNECTED from the centre region, leaving it frozen
    // for the rest of the match (it can't path to the fight, and no enemy can path to it).
    // After every respawn the pet must, within 3 s, either move meaningfully OR take damage
    // OR cycle again — all of which prove it is reachable / mobile, never a dead pocket.
    const r = runPetArenaMatch(roster(COMP, { hp: 1200, attack: 150 }), roster(COMP, { hp: 320, attack: 30 }), 7);
    const respawns = r.events.filter((e) => e.type === "respawn") as Array<{ t: number; actorId: string }>;
    assert.ok(respawns.length >= 3, `expected several respawns, got ${respawns.length}`);
    const last = r.snapshots.length - 1;
    for (const ev of respawns) {
        const a0 = r.snapshots[ev.t]?.actors.find((a) => a.id === ev.actorId);
        if (!a0) continue;
        let freed = false;
        for (let t = ev.t + 1; t <= Math.min(ev.t + ARENA_TPS * 3, last); t++) {
            const a = r.snapshots[t].actors.find((x) => x.id === ev.actorId);
            if (!a) { freed = true; break; }
            const moved = Math.abs(a.x - a0.x) + Math.abs(a.y - a0.y) > 1.2;
            if (moved || a.hp < a.maxHp || a.state === "respawning" || a.state === "dead") { freed = true; break; }
        }
        assert.ok(freed, `${ev.actorId} respawned at t=${ev.t} and never moved/was-reached (frozen in a pocket)`);
    }
});

test("a sage heals a hurt ally (role abilities fire)", () => {
    const got = SEEDS.some((seed) =>
        runPetArenaMatch(roster(["defender", "sage"], { hp: 600 }), roster(["tracker", "assassin"], { attack: 120 }), seed)
            .events.some((e) => e.type === "heal"));
    assert.ok(got, "a sage never healed an ally");
});

// ── R1: team blackboard (call-target focus + assigned peels) ───────────────────
test("R1 — deterministic across many seeds + comps (the blackboard is pure)", () => {
    // The blackboard (pickCallTarget / assignPeels) runs every tick off the frozen
    // board. It must stay a pure function of (roster, seed). The double-defender comp
    // exercises assignPeels' no-double-assignment path (2 defenders, shared threats).
    const seeds = Array.from({ length: 8 }, (_, i) => i * 911 + 5);
    const comps: ArenaRole[][] = [COMP, ["defender", "defender", "assassin", "sage"], ["tracker", "assassin"]];
    for (const comp of comps) for (const seed of seeds) {
        const a = runPetArenaMatch(roster(comp), roster(comp, { attack: 120 }), seed);
        const b = runPetArenaMatch(roster(comp), roster(comp, { attack: 120 }), seed);
        assert.deepEqual(a, b, `comp ${comp.join("/")} seed ${seed} diverged`);
    }
});

// ── R3: commander layer (board-standing posture + influence rally) ─────────────
test("R3 — the commander layer stays pure (byte-identical replays through press/regroup/comp paths)", () => {
    // The commander runs every tick off the frozen board: team standing → posture
    // (press/even/regroup), composition bias, and an influence-picked rally point whose
    // math (centroid averages, localPower, snapMain) is the new determinism surface. A
    // STAT GAP drives one team into sustained "press" and the other into "regroup"; the
    // double-assassin comp exercises compBias. All must replay byte-identical.
    const seeds = Array.from({ length: 8 }, (_, i) => i * 617 + 11);
    const comps: ArenaRole[][] = [COMP, ["assassin", "assassin", "tracker", "sage"], ["defender", "sage"]];
    for (const comp of comps) for (const seed of seeds) {
        const a = runPetArenaMatch(roster(comp, { attack: 130 }), roster(comp, { hp: 360 }), seed);
        const b = runPetArenaMatch(roster(comp, { attack: 130 }), roster(comp, { hp: 360 }), seed);
        assert.deepEqual(a, b, `comp ${comp.join("/")} seed ${seed} diverged`);
    }
});

test("R3 — a board-losing team regroups without turtling the match to the cap", () => {
    // The commander amplifies the SELF-LIMITING local-outnumber regroup (and never forces
    // a team-wide fallback), so a clearly stronger team must still close out the large
    // majority of matches before the 5-min cap — the regroup posture buys the loser smarter
    // defense, not an indefinite turtle. (Guards the R3-prototype turtle regression.)
    const seeds = Array.from({ length: 24 }, (_, i) => i * 67 + 5);
    let capped = 0;
    for (const seed of seeds) {
        const r = runPetArenaMatch(roster(COMP, { attack: 130 }), roster(COMP, { hp: 360 }), seed);
        if (r.ticks >= ARENA_TPS * MAX_SECONDS) capped++;
    }
    assert.ok(capped <= seeds.length * 0.35, `${capped}/${seeds.length} matches hit the cap — the commander is over-regrouping`);
});

test("R1 — the blackboard never turtles a near-even match into a stalemate", () => {
    // Captures are the ONLY score, so over-defending never closes a match. A prototype
    // team-wide "fall back when out-powered" cascade was cut precisely because it dragged
    // near-even matches to the 5-min cap (draws ~doubled). Guard: a modest-edge matchup
    // must RESOLVE before the cap the large majority of the time.
    const seeds = Array.from({ length: 24 }, (_, i) => i * 53 + 3);
    let capped = 0;
    for (const seed of seeds) {
        const r = runPetArenaMatch(roster(COMP, { attack: 115 }), roster(COMP), seed);
        if (r.ticks >= ARENA_TPS * MAX_SECONDS) capped++;
    }
    assert.ok(capped <= seeds.length * 0.35, `${capped}/${seeds.length} matches hit the time cap — the AI is over-defending`);
});
