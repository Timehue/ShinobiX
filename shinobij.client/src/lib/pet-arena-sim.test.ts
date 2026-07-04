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

// ── Neutral boss (Arena Warden) + carry teeth ──────────────────────────────────
test("the Warden telegraphs every slam with a wind-up before the AoE lands", () => {
    // Each slam is now preceded by a `bosswindup` (the rear-up telegraph), and the AoE
    // `bossslam` resolves only after the wind-up — so every slam has a matching earlier
    // wind-up. Guards the dodge-window contract the renderer's telegraph relies on.
    const seeds = Array.from({ length: 10 }, (_, i) => i * 41 + 3);
    let sawSlam = false;
    for (const seed of seeds) {
        const r = runPetArenaMatch(roster(COMP, { attack: 100 }), roster(COMP), seed);
        const windups = r.events.filter((e) => e.type === "bosswindup").map((e) => e.t);
        for (const e of r.events) {
            if (e.type !== "bossslam") continue;
            sawSlam = true;
            assert.ok(windups.some((wt) => wt < e.t && e.t - wt <= ARENA_TPS), `slam at t=${e.t} had no preceding wind-up (seed ${seed})`);
        }
    }
    assert.ok(sawSlam, "the Warden never slammed in any even match");
});

test("the Warden deals real damage — a short-range swipe chips meleeing pets", () => {
    // The Warden now has TWO moves: a slow telegraphed slam (dodge-able) and a fast
    // short-range SWIPE with no wind-up (the reliable chip). Across even matches it both
    // swipes and lands boss-sourced damage on pets (actorId "boss").
    const seeds = Array.from({ length: 10 }, (_, i) => i * 41 + 3);
    let sawSwipe = false, sawBossDmg = false;
    for (const seed of seeds) {
        const r = runPetArenaMatch(roster(COMP, { attack: 100 }), roster(COMP), seed);
        if (r.events.some((e) => e.type === "bossswipe")) sawSwipe = true;
        if (r.events.some((e) => e.type === "hit" && e.actorId === "boss")) sawBossDmg = true;
    }
    assert.ok(sawSwipe, "the Warden never swiped (its short-range basic move)");
    assert.ok(sawBossDmg, "the Warden never dealt damage to a pet");
});

test("the Warden lunges to close on kiting pets", () => {
    // The short-lunge gap-closer fires when the nearest pet hovers beyond slam reach — so a
    // ranged squad can't infinitely chip from range. Across a spread of even matches it
    // should leap at least once.
    const seeds = Array.from({ length: 12 }, (_, i) => i * 37 + 1);
    const lunged = seeds.some((seed) =>
        runPetArenaMatch(roster(COMP, { attack: 100 }), roster(COMP), seed).events.some((e) => e.type === "bosslunge"));
    assert.ok(lunged, "the Warden never lunged at a kiting pet");
});

test("shrines rotate in, get claimed, and pay out (power buff / mend heal) — never score", () => {
    // The rotating buff shrine replaces the old zone: it spawns, is claimed by a short
    // channel, and grants a tactical edge (power = team attack buff, mend = heal + shield).
    // It must NOT score — the win condition stays scroll caps + the Warden. Flavours
    // alternate, so across a spread both a power buff and a mend heal show up.
    const seeds = Array.from({ length: 12 }, (_, i) => i * 29 + 5);
    let sawSpawn = false, sawClaim = false, sawPowerBuff = false, sawMendHeal = false;
    for (const seed of seeds) {
        const r = runPetArenaMatch(roster(COMP, { attack: 100 }), roster(COMP), seed);
        for (const s of r.snapshots) {
            assert.ok(s.shrine && (s.shrine.kind === "power" || s.shrine.kind === "mend"), "missing shrine readout");
            assert.ok(s.shrine.channelFrac >= 0 && s.shrine.channelFrac <= 1.0001, `bad shrine channelFrac ${s.shrine?.channelFrac}`);
        }
        for (const e of r.events) {
            if (e.type === "shrinespawn") sawSpawn = true;
            if (e.type === "shrineclaim") {
                sawClaim = true;
                if (e.kind === "power") {
                    // a power claim BEFORE the Warden can spawn (32 s) isolates the shrine buff from the boss-kill buff
                    const after = r.snapshots[Math.min(r.snapshots.length - 1, e.t + 1)];
                    if (e.t < ARENA_TPS * 30 && after.actors.some((a) => a.team === e.team && a.statuses.includes("buff"))) sawPowerBuff = true;
                } else if (e.kind === "mend") {
                    if (r.events.some((h) => h.type === "heal" && h.t === e.t)) sawMendHeal = true;   // applyShrine heals on the claim tick
                }
            }
        }
    }
    assert.ok(sawSpawn, "no shrine ever spawned");
    assert.ok(sawClaim, "no shrine was ever claimed");
    assert.ok(sawPowerBuff, "a power shrine never granted a team attack buff");
    assert.ok(sawMendHeal, "a mend shrine never healed its team");
});

test("the neutral boss spawns mid-match and can be slain for a reward", () => {
    // The boss spawns after its timer in any full-length match; across a spread of even
    // matchups (which run long enough for a team to commit to it) at least one resolves
    // the kill. A lopsided stomp ends before the pit matters, so use even teams here.
    const seeds = Array.from({ length: 10 }, (_, i) => i * 41 + 3);
    let slain = false, spawned = false;
    for (const seed of seeds) {
        const r = runPetArenaMatch(roster(COMP, { attack: 100 }), roster(COMP), seed);
        if (r.events.some((e) => e.type === "bossspawn")) spawned = true;
        for (const s of r.snapshots) assert.ok(s.boss && s.boss.hpFrac >= 0 && s.boss.hpFrac <= 1.0001, "bad boss hpFrac");
        if (r.events.some((e) => e.type === "bosskill")) slain = true;
    }
    assert.ok(spawned, "the boss never spawned in any even match");
    assert.ok(slain, "no even match ever resolved the boss kill");
});

test("B1 — a pet deals no damage while carrying the scroll", () => {
    // The carry-teeth rule: a carrier can't basic-attack/ability (it must run + rely on
    // escorts). Exclude the single pickup tick (the pet attacks BEFORE stepScroll flips
    // carrying on that tick) by requiring the actor to have been carrying last tick too.
    const r = runPetArenaMatch(roster(COMP, { hp: 1200, attack: 150 }), roster(COMP, { hp: 320, attack: 30 }), 2024);
    for (const e of r.events) {
        if (e.type !== "hit" || !e.actorId) continue;
        const now = r.snapshots[e.t]?.actors.find((a) => a.id === e.actorId);
        const prev = r.snapshots[e.t - 1]?.actors.find((a) => a.id === e.actorId);
        if (now?.carrying && prev?.carrying) assert.fail(`${e.actorId} dealt damage while carrying at t=${e.t}`);
    }
});

// ── PvP-ladder items (applyItems flag — PVP gear stat-mods/procs + consumables) ──
// The ladder equips both teams' gear + consumables; casual/preview leave applyItems off.
test("items: deterministic with gear + consumables equipped", () => {
    for (const seed of SEEDS) {
        const blue = roster(COMP, { loadout: { pvp: "pvp-spiked-war-harness", consumable: "consum-second-wind" } });
        const red = roster(COMP, { loadout: { pvp: "pvp-ironhide-barding" } });
        assert.deepEqual(runPetArenaMatch(blue, red, seed, true), runPetArenaMatch(blue, red, seed, true), `items seed ${seed} diverged`);
    }
});

test("items off: an equipped loadout has zero effect (back-compat)", () => {
    for (const seed of SEEDS) {
        const geared = runPetArenaMatch(roster(COMP, { loadout: { pvp: "pvp-arena-champion-regalia" } }), roster(COMP), seed);
        const bare = runPetArenaMatch(roster(COMP), roster(COMP), seed);
        assert.deepEqual(geared, bare, `loadout leaked into the items-off path (seed ${seed})`);
    }
});

test("items: a start-shield gear opens the match with a shield on its wearers only", () => {
    const r = runPetArenaMatch(roster(COMP, { loadout: { pvp: "pvp-aegis-pendant" } }), roster(COMP), 7, true);
    const t0 = r.snapshots[0].actors;
    assert.ok(t0.filter((a) => a.team === "blue").every((a) => a.statuses.includes("shield")), "geared blue team should open shielded");
    assert.ok(t0.filter((a) => a.team === "red").every((a) => !a.statuses.includes("shield")), "the un-geared red team should not");
});

test("items: equipping gear changes the deterministic match", () => {
    const withGear = runPetArenaMatch(roster(COMP, { loadout: { pvp: "pvp-berserkers-muzzle" } }), roster(COMP), 7, true);
    const without = runPetArenaMatch(roster(COMP), roster(COMP), 7, true);
    assert.notDeepEqual(withGear, without, "equipping attack gear should change the match");
});

// ── Arena V2 (petArenaV2.v1) ────────────────────────────────────────────────────
// The 5th arg (v2=true) opts into the excitement ruleset. Load-bearing: v2 stays
// DETERMINISTic, and v2=false is byte-identical to the default call (instant rollback).
const V2SEEDS = [1, 7, 2024, 99999];
const spread = (n: number, m = 41, b = 3) => Array.from({ length: n }, (_, i) => i * m + b);

test("v2 — deterministic replays (same roster + seed + v2)", () => {
    for (const seed of V2SEEDS) {
        const a = runPetArenaMatch(roster(COMP), roster(COMP, { attack: 110 }), seed, false, true);
        const b = runPetArenaMatch(roster(COMP), roster(COMP, { attack: 110 }), seed, false, true);
        assert.deepEqual(a, b, `v2 seed ${seed} diverged`);
    }
});

test("v2 off — the default call is byte-identical to an explicit v2=false (rollback safety)", () => {
    for (const seed of V2SEEDS) {
        const def = runPetArenaMatch(roster(COMP), roster(COMP, { attack: 110 }), seed);
        const off = runPetArenaMatch(roster(COMP), roster(COMP, { attack: 110 }), seed, false, false);
        assert.deepEqual(def, off, `off parity diverged at seed ${seed}`);
    }
});

test("v2 — valid terminating matches with bounded Overdrive/ring/stage readouts", () => {
    for (const seed of V2SEEDS) {
        const r = runPetArenaMatch(roster(COMP, { attack: 100 }), roster(COMP), seed, false, true);
        assert.ok(["blue", "red", "draw"].includes(r.winner));
        assert.ok(r.ticks >= 1 && r.ticks <= ARENA_TPS * MAX_SECONDS, `ticks ${r.ticks}`);
        assert.equal(r.v2, true);
        assert.ok([5, 6].includes(r.winScore), `unexpected winScore ${r.winScore}`);
        assert.ok(["standard", "warden-fury", "scroll-frenzy", "blood-ritual"].includes(r.modifier), `unexpected modifier ${r.modifier}`);
        for (const s of r.snapshots) {
            assert.ok(s.momBlue >= 0 && s.momBlue <= 100 && s.momRed >= 0 && s.momRed <= 100, `momentum out of range`);
            assert.ok(s.ringR >= 0 && s.ringR <= 9.01, `ringR out of range ${s.ringR}`);
            assert.ok(s.boss.stage >= 0 && s.boss.stage <= 2, `boss stage out of range ${s.boss.stage}`);
        }
    }
});

test("v2 — the Warden enrages (reaches stage 2) and lands damage", () => {
    let enraged = false, bossDmg = false, stage2 = false;
    for (const seed of spread(10)) {
        const r = runPetArenaMatch(roster(COMP, { attack: 100 }), roster(COMP), seed, false, true);
        if (r.events.some((e) => e.type === "bossenrage")) enraged = true;
        if (r.events.some((e) => e.type === "hit" && e.actorId === "boss")) bossDmg = true;
        if (r.snapshots.some((s) => s.boss.stage >= 2)) stage2 = true;
    }
    assert.ok(enraged, "the Warden never enraged");
    assert.ok(bossDmg, "the Warden never dealt damage");
    assert.ok(stage2, "the Warden never reached stage 2");
});

test("v2 — Overdrive charges from combat and fires a spike", () => {
    const fired = spread(10).some((seed) =>
        runPetArenaMatch(roster(COMP, { attack: 100 }), roster(COMP), seed, false, true).events.some((e) => e.type === "overdrive"));
    assert.ok(fired, "Overdrive never fired across the spread");
});

test("v2 — captures (and the Warden) are the ONLY score source; combat charges Overdrive, not points", () => {
    // Every scoreboard increment must be explained by a capture or bosskill event on that tick —
    // proving combat feeds Overdrive (a meter), never the score directly.
    const r = runPetArenaMatch(roster(COMP, { attack: 120 }), roster(COMP, { hp: 400 }), 7, false, true);
    let prevB = 0, prevR = 0;
    for (const s of r.snapshots) {
        if (s.scoreBlue > prevB || s.scoreRed > prevR) {
            const team = s.scoreBlue > prevB ? "blue" : "red";
            const explained = r.events.some((e) => e.t === s.t && (e.type === "capture" || e.type === "bosskill") && e.team === team);
            assert.ok(explained, `${team} score moved at t=${s.t} with no capture/bosskill`);
        }
        prevB = s.scoreBlue; prevR = s.scoreRed;
    }
});

test("v2 — carry-as-fight-through: a carrier can deal damage (the v1 B1 lockout is lifted)", () => {
    let found = false;
    for (const seed of V2SEEDS) {
        const r = runPetArenaMatch(roster(COMP, { hp: 1200, attack: 150 }), roster(COMP, { hp: 340, attack: 30 }), seed, false, true);
        for (const e of r.events) {
            if (e.type !== "hit" || !e.actorId || e.actorId === "boss") continue;
            const now = r.snapshots[e.t]?.actors.find((a) => a.id === e.actorId);
            const prev = r.snapshots[e.t - 1]?.actors.find((a) => a.id === e.actorId);
            if (now?.carrying && prev?.carrying) { found = true; break; }
        }
        if (found) break;
    }
    assert.ok(found, "no carrier ever dealt damage in v2 — carry-as-fight-through isn't working");
});

test("v2 — the shrine draws from the relic pool (never the v1 power/mend alternation)", () => {
    const kinds = new Set<string>();
    for (const seed of spread(12, 29, 5)) {
        const r = runPetArenaMatch(roster(COMP, { attack: 100 }), roster(COMP), seed, false, true);
        for (const e of r.events) if (e.type === "shrineclaim" && e.kind) kinds.add(e.kind);
    }
    assert.ok(kinds.size > 0, "no shrine was claimed in v2");
    assert.ok(!kinds.has("power"), "v2 shrine must not use the v1 'power' flavour");
    for (const k of kinds) assert.ok(["berserk", "bulwark", "edge", "mend", "favor"].includes(k), `unexpected relic kind ${k}`);
});

test("v2 — the closing ring engages in a long match", () => {
    let sawRing = false;
    for (const seed of spread(14, 53, 3)) {
        const r = runPetArenaMatch(roster(COMP, { attack: 100 }), roster(COMP), seed, false, true);
        if (r.events.some((e) => e.type === "ringclose") && r.snapshots.some((s) => s.ringR > 0 && s.ringR < 9)) { sawRing = true; break; }
    }
    assert.ok(sawRing, "the closing ring never engaged in any long match");
});

test("v2 — balance sanity across a mixed spread (decisive, rarely capped, Warden neither absent nor omnipresent)", () => {
    const seeds = spread(24, 67, 5);
    const matchups: Array<[Partial<Pet>, Partial<Pet>]> = [[{ attack: 100 }, {}], [{ attack: 120 }, {}], [{ hp: 1000, attack: 130 }, { hp: 500 }]];
    let total = 0, capped = 0, decisive = 0, warden = 0;
    for (const [b, rd] of matchups) for (const seed of seeds) {
        const r = runPetArenaMatch(roster(COMP, b), roster(COMP, rd), seed, false, true);
        total++;
        if (r.ticks >= ARENA_TPS * MAX_SECONDS) capped++;
        if (r.winner !== "draw") decisive++;
        if (r.events.some((e) => e.type === "bosskill")) warden++;
    }
    assert.ok(capped <= total * 0.15, `${capped}/${total} matches hit the cap — anti-stalemate too weak`);
    assert.ok(decisive >= total * 0.9, `only ${decisive}/${total} matches were decisive`);
    const wr = warden / total;
    assert.ok(wr >= 0.35 && wr <= 0.98, `Warden resolve ${(wr * 100).toFixed(0)}% outside the sane band (35–98%)`);
});
