// ─────────────────────────────────────────────────────────────────────────────
// pet-duel-cinematic.ts — the REDESIGNED pet-coliseum combat engine.
//
// Owner mandate: the coliseum must feel like a Pokemon-anime / Legends-Z-A /
// Digimon-World battle — creatures that MOVE AROUND, reposition, kite, dodge and
// OUTMANEUVER each other, not two sprites bashing heads in place. The old
// `pet-duel-sim.ts` orbit-then-lunge model is REPLACED here for the casual path;
// this engine is built to be promoted to authoritative everywhere once proven.
//
// HOW THE MOVEMENT IS PRODUCED (the redesign, per docs research):
//   • CONTEXT STEERING — every fighter builds a 16-direction INTEREST map (where
//     it wants to go, from its optimal engagement range R*) and a DANGER map
//     (enemy kill-radius, telegraphed incoming attacks, walls, personal space),
//     then moves toward the best low-danger, high-interest direction. Kiting,
//     circle-strafing and repositioning EMERGE from this — one code path gives
//     the rusher (small R* → chases) and the kiter (big R* → holds range + orbits).
//   • UTILITY-LITE BRAIN — picks an intent per tick (ENGAGE / KITE / STRAFE /
//     DODGE / PUNISH / RETREAT / SUPPORT) that sets R* and whether to fire/dodge.
//   • FIGHTING STYLE — derived from the pet's ROLE / SUB-ROLE / ELEMENT-matchup /
//     raw STATS / TRAIT / equipped ITEMS, so pets read as individuals: a fast
//     glass fire-assassin RUSHES; a water sage KITES and counters; a type-
//     disadvantaged pet plays cautious and looks for openings.
//   • ACTIVE DODGE — telegraph-reactive and SPEED-gated: a fast pet reads the
//     wind-up and sidesteps; a slow one can't and eats it (Digimon "Speed = dodge",
//     Z-A "avoidance is positioning"). Items the pet holds bend its risk.
//
// DETERMINISM CONTRACT (identical to pet-duel-sim.ts — load-bearing for the
// eventual ranked promotion):
//   • Pure function of (pets…, seed). NO Math.random / Date / wall-clock. Trig is
//     BANNED (sin/cos/atan2/pow/exp/log vary across engines) — all directions come
//     from a BAKED 16-slot unit-vector LUT; only +,-,*,/,sqrt/min/max/round/floor/
//     abs plus a seeded LCG. State QUANTIZED to 1/256 each tick. Fixed iteration
//     order (player team first, by slot). Replays byte-identical.
//
// It emits the EXACT `DuelResult` snapshot+event contract the renderer already
// consumes (PetColiseum.tsx), so the whole visual/spectacle layer is reused
// unchanged. It does NOT touch pet-duel-sim.ts, so the authoritative engine, the
// server mirror (api/_pet-sim), the ladder hand-port, and the parity tests are
// all untouched.
// ─────────────────────────────────────────────────────────────────────────────
import type { Pet, PetJutsu } from "../types/pet";
import { WALK_MASK, WALK_COLS, WALK_ROWS } from "./pet-arena-walkmask";
import { petAccuracyEnabled } from "./pet-coliseum-flag";
import {
    applyPetPvpGear, petConsumableCharges, petGearStartShield, petGearExecuteMult,
    petGearLastStandMult, petGearDotOnHit, petGearLifestealHeal,
    PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT,
} from "../data/pet-config";
import {
    DUEL_TPS, ARENA_X, ARENA_Y, elementMult, terrainPetMult, KIND_ACCURACY,
    type DuelResult, type DuelSnapshot, type DuelActorSnap, type DuelProjSnap,
    type DuelEvent, type DuelState,
} from "./pet-duel-sim";

// ── Tunables (own copies; balance numbers mirror the shipped engine so outcomes
//    stay in the current bands — only the POSITIONING around them is new) ───────
const CAP_TICKS = DUEL_TPS * 75;            // ~75s cap; the sudden-death ramp guarantees a real KO before it
const TTK_HP = 3.0;                          // HP scale → long, meaty fights that show the kiting/repositioning (tune knob)
const LATE_T = DUEL_TPS * 50;                // sudden-death: past here damage ramps so fights END in a KO
const LATE_RAMP = DUEL_TPS * 20;             // dmg ×(1 + (t−LATE_T)/RAMP) → ×2.25 at cap
// STALL BREAKER — two same-role kiters (assassin/tracker mirror) can circle-strafe forever
// and never land a hit → a 0-damage stand-off that draws regardless of stats. When NO damage
// has been dealt by EITHER side for STALL_START_SECS, ramp a "force the exchange" pressure over
// STALL_RAMP_SECS that collapses R* to melee, suppresses dodging, and disables the clash so
// mutual dives LAND — the pets brawl it out and the stronger stats win. Gated on real no-damage
// (every normal fight lands hits within a couple seconds → pressure stays 0 → zero effect on the
// tuned archetype balance).
const STALL_START_SECS = 11;
const STALL_RAMP_SECS = 7;
const Q = 256;
const quant = (n: number) => Math.round(n * Q) / Q;
const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

const STAM_MAX = 100;
const STAM_REGEN = 22 / DUEL_TPS;
const COST_BASIC = 12;
const COST_DODGE = 20;
const CRIT_CHANCE = 0.12;
const DMG_SCALE = 1.5;
const BASIC_REACH = 1.2;                     // melee contact distance (basic attack)
const MIN_SEP = BASIC_REACH * 0.9;
const MELEE_RANGE = 1.6;
// Ranged range is DELIBERATELY WIDE so kiters hold a gap the camera can SEE — the
// renderer squishes field→world ~0.44×, so a 4-unit gap reads as sprites touching;
// an ~8-unit kite gap renders as a real, readable separation (≈1.5 sprite-widths).
const RANGED_RANGE = 8.0;

// LUNGE — a melee attack is a committed POUNCE, not a stand-and-resolve. The attacker
// launches from up to its style.lungeInit away and carries itself INTO the target; the
// hit resolves on contact. Tracking (style.lungeTrack) is deliberately low so a
// well-timed dodge SLIPS the pounce → the attacker overshoots, whiffs, and is left
// exposed to a counter. This is what turns "trading in place" into lunge/dodge/punish.
// The per-archetype dive numbers (init/mult/track/ticks) live in the MOTION table.
const CLASH_KB = 2.2;        // symmetric bounce-apart when two committed dives collide (the clash beat)
const CRIT_HP = 0.16;        // below this HP frac, aggressive archetypes go for a desperate last-stand
const KILL_HP = 0.18;        // foe below this HP frac → kill-shot: drop the in-out beat, go for the finish

// Context-steering constants.
const N = 16;
// Baked 16-slot unit-direction LUT (θ = i·22.5°). Literal constants → no runtime
// trig → cross-machine deterministic. slot 0 = +x, going counter-clockwise.
const SLOT_X = [1, 0.9238795, 0.7071068, 0.3826834, 0, -0.3826834, -0.7071068, -0.9238795, -1, -0.9238795, -0.7071068, -0.3826834, 0, 0.3826834, 0.7071068, 0.9238795];
const SLOT_Y = [0, 0.3826834, 0.7071068, 0.9238795, 1, 0.9238795, 0.7071068, 0.3826834, 0, -0.3826834, -0.7071068, -0.9238795, -1, -0.9238795, -0.7071068, -0.3826834];
const BAND_H = 0.9;          // half-width of the R* engagement band
const SLOW_RADIUS = 1.5;     // Arrive damping band → decelerate into R* (anti-overshoot)
const INT_CLOSE = 1.0;       // interest: too far → close in
const INT_BACK = 0.95;       // interest: too close → back off (strong so retreats read)
const INT_STRAFE = 0.85;     // interest: in-band → circle-strafe (wide circling reads as movement)
const CENTER_BIAS = 0.12;    // faint pull to arena center (anti-corner "racing line")
const DANGER_ENEMY = 0.6;    // enemy threat bubble
const DANGER_TELE = 1.0;     // telegraphed incoming attack
const DANGER_WALL = 0.85;    // arena edge / solid tiles
const DANGER_BUBBLE = 0.45;  // don't drift into melee during neutral (ranged)

// ── Walkability grid (own copy of the pet-duel-sim helpers; position-based so they
//    work with this engine's own fighter struct). Symmetrized L↔R for fairness. ──
const GCOLS = WALK_COLS, GROWS = WALK_ROWS;
const CELL_X = (ARENA_X * 2) / GCOLS;
const CELL_Y = (ARENA_Y * 2) / GROWS;
const cellCol = (x: number) => clamp(Math.floor((x + ARENA_X) / CELL_X), 0, GCOLS - 1);
const cellRow = (y: number) => clamp(Math.floor((y + ARENA_Y) / CELL_Y), 0, GROWS - 1);
const cellCenter = (c: number, r: number): [number, number] => [(c + 0.5) * CELL_X - ARENA_X, (r + 0.5) * CELL_Y - ARENA_Y];
const maskAt = (c: number, r: number) => WALK_MASK.charCodeAt(r * GCOLS + c) === 49;
// BARRIER EARTH WALLS — temporary solid obstacles a barrier cast raises between the two
// fighters. Blocks movement AND line-of-sight (hasLineOfSight samples walkableAt), so
// neither can attack through it for a beat — they buff/heal or path around. Module-level
// + reset each simulate() run → fully deterministic (barriers cast at deterministic ticks).
let SIM_WALLS: { x: number; y: number; r: number; expiry: number }[] = [];
// Stall-breaker state (reset per simulate() run, like SIM_WALLS → deterministic, no carry-over).
let _stallPressure = 0;    // 0 in every fight where damage lands; ramps only in a true no-damage stand-off
let _forcedEngage = false; // latched once a stand-off is confirmed → a decisive brawl to the finish
const WALL_TICKS = Math.round(DUEL_TPS * 0.85);   // how long a wall BLOCKS (short → a beat, not a big defensive advantage)
const WALL_PENALTY_TICKS = Math.round(DUEL_TPS * 3.0);   // caster's damage halved this long after raising a wall (the wall's cost)
const cellBlockedByWall = (c: number, r: number): boolean => {
    if (SIM_WALLS.length === 0) return false;
    const cx = (c + 0.5) * CELL_X - ARENA_X, cy = (r + 0.5) * CELL_Y - ARENA_Y;
    for (const w of SIM_WALLS) { const dx = cx - w.x, dy = cy - w.y; if (dx * dx + dy * dy < w.r * w.r) return true; }
    return false;
};
const cellWalkable = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < GCOLS && r < GROWS && (maskAt(c, r) || maskAt(GCOLS - 1 - c, r)) && !cellBlockedByWall(c, r);
function walkableAt(x: number, y: number): boolean {
    if (x < -ARENA_X || x > ARENA_X || y < -ARENA_Y || y > ARENA_Y) return false;
    return cellWalkable(cellCol(x), cellRow(y));
}
function snapPos(x: number, y: number): [number, number] {
    if (walkableAt(x, y)) return [x, y];
    const c0 = cellCol(x), r0 = cellRow(y);
    for (let rad = 1; rad <= GCOLS + GROWS; rad++) {
        for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
            if (cellWalkable(c0 + dc, r0 + dr)) return cellCenter(c0 + dc, r0 + dr);
        }
    }
    return [x, y];
}
function hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax, dy = by - ay;
    const d = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(d / (CELL_X * 0.6));
    for (let i = 1; i < steps; i++) {
        const tt = i / steps;
        if (!walkableAt(ax + dx * tt, ay + dy * tt)) return false;
    }
    return true;
}
// BFS pathfinding (copied from pet-duel-sim) — context steering handles LOCAL
// avoidance but can't route around a large solid; when line-of-sight to the foe
// is blocked, we seek the BFS next-cell waypoint instead (global route), then let
// the steering take over once the two can see each other.
const BFS_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function bfsNextStep(fc: number, fr: number, tc: number, tr: number): [number, number] | null {
    if (fc === tc && fr === tr) return null;
    const came = new Map<number, number>();
    const start = tr * GCOLS + tc;
    came.set(start, -1);
    const queue = [start]; let head = 0;
    while (head < queue.length) {
        const cur = queue[head++];
        const cc = cur % GCOLS, cr = (cur - cc) / GCOLS;
        if (cc === fc && cr === fr) { const nxt = came.get(cur); return nxt === undefined || nxt < 0 ? null : [nxt % GCOLS, (nxt - (nxt % GCOLS)) / GCOLS]; }
        for (const [dc, dr] of BFS_DIRS) {
            const nc = cc + dc, nr = cr + dr;
            if (!cellWalkable(nc, nr)) continue;
            if (dc !== 0 && dr !== 0 && (!cellWalkable(cc + dc, cr) || !cellWalkable(cc, cr + dr))) continue;
            const ni = nr * GCOLS + nc;
            if (!came.has(ni)) { came.set(ni, cur); queue.push(ni); }
        }
    }
    return null;
}

/** Deterministic LCG — same constants as the shipped engine. */
function makeRng(seed: number): () => number {
    let s = (Math.max(1, Math.floor(seed)) >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ── Abilities (PetJutsu → real-time ability; mirrors pet-duel-sim.buildAbility) ─
type AbilityClass = "melee" | "ranged" | "support";
function abilityClass(kind: PetJutsu["kind"]): AbilityClass {
    if (kind === "heal" || kind === "buff" || kind === "shield" || kind === "barrier" || kind === "absorb" || kind === "haste") return "support";
    if (kind === "damage" || kind === "crush" || kind === "lifesteal") return "melee";
    return "ranged";
}
interface Ability {
    name: string; kind: PetJutsu["kind"]; accuracy: number; cls: AbilityClass;
    power: number; signature: boolean; aoe: boolean; range: number;
    castTicks: number; cdTicks: number; cdLeft: number; cost: number;
    isMove: boolean;   // a kind:"move" ability (Dash/Rush/Lunge) — a REPOSITION, never an attack (see decide())
}
function buildAbility(j: PetJutsu): Ability {
    const cls = abilityClass(j.kind);
    const base = Math.max(Math.round(DUEL_TPS * 0.8), Math.round((j.cooldown || 0) * 1.2 * DUEL_TPS));
    return {
        name: j.name, kind: j.kind, accuracy: KIND_ACCURACY[j.kind] ?? 100, cls, isMove: j.kind === "move",
        power: Math.max(1, j.power || 1), signature: !!j.signature, aoe: !!j.aoe,
        range: cls === "support" ? 999 : cls === "ranged" ? RANGED_RANGE : MELEE_RANGE,
        castTicks: Math.round(DUEL_TPS * (j.signature ? 0.5 : cls === "support" ? 0.25 : 0.3)),
        cdTicks: base + (j.signature ? Math.round(DUEL_TPS * 1.5) : 0),
        cdLeft: j.signature ? Math.round(DUEL_TPS * 2.5) : Math.round(DUEL_TPS * 0.5),
        cost: j.signature ? 40 : cls === "support" ? 16 : 22,
    };
}
// The 4-move loadout the engine fights with (first 4 jutsu, signature guaranteed a slot).
function petCinematicAbilities(pet: Pet): Ability[] {
    const first4 = (pet.jutsus || []).slice(0, 4);
    const sigJ = (pet.jutsus || []).find((j) => j.signature);
    const jlist = sigJ && !first4.includes(sigJ) ? [...first4.slice(0, 3), sigJ] : first4;
    return jlist.map(buildAbility);
}
function statusTicks(ab: Ability, rounds?: number): number {
    return Math.round(DUEL_TPS * (rounds && rounds > 0 ? rounds * 0.8 : ab.signature ? 1.4 : 1.0));
}
// Self-buffs (damage-up / speed-up) and the damage-down debuff are tactical STANCES — spending
// a turn on one should pay off across a few exchanges, so they hold much longer than the quick
// DoT/CC riders (which stay on statusTicks). Tuned to 3.0s via the buff-duration harness sweep:
// long enough that a buff spans several exchanges instead of just the next hit, and it nudges
// balance the right way too — it lifts the buff-then-burst rusher and pulls the attrition
// defender down off the ceiling, with every archetype staying in the 35–65 band. A signature
// buff gets the usual 1.4× (≈4.2s). (Was 1.0s — too short to feel like anything.)
const BUFF_STANCE_SECS = 3.0;
function buffTicks(ab: Ability): number {
    return Math.round(DUEL_TPS * BUFF_STANCE_SECS * (ab.signature ? 1.4 : 1.0));
}

// ── Statuses (identical shape to pet-duel-sim so the formula ports verbatim) ────
interface Statuses {
    burnLeft: number; burnDmg: number; halfHeal: boolean; stunLeft: number;
    slowLeft: number; hasteLeft: number; rootLeft: number; shieldHp: number;
    buffLeft: number; buffMag: number; marked: boolean; tauntById: string | null;
    wallPenaltyLeft: number;   // after raising a BARRIER wall, the caster's own damage is halved for a beat (the wall's cost → keeps the defensive value from breaking balance)
}
const emptyStatuses = (): Statuses => ({ burnLeft: 0, burnDmg: 0, halfHeal: false, stunLeft: 0, slowLeft: 0, hasteLeft: 0, rootLeft: 0, shieldHp: 0, buffLeft: 0, buffMag: 0, marked: false, tauntById: null, wallPenaltyLeft: 0 });
function statusFlags(s: Statuses): string[] {
    const out: string[] = [];
    if (s.burnLeft > 0) out.push("burn");
    if (s.stunLeft > 0) out.push("stun");
    if (s.slowLeft > 0) out.push("slow");
    if (s.hasteLeft > 0) out.push("haste");
    if (s.rootLeft > 0) out.push("root");
    if (s.shieldHp > 0) out.push("shield");
    if (s.buffLeft > 0 && s.buffMag > 0) out.push("buff");
    if (s.buffLeft > 0 && s.buffMag < 0) out.push("debuff");
    if (s.marked) out.push("mark");
    return out;
}

// ── Fighting style — role / sub-role / element / stats / trait / items → knobs ──
export type Archetype = "rusher" | "brawler" | "kiter" | "defender" | "support" | "balanced";
interface Style {
    arche: Archetype;
    rangedPref: boolean;    // wants to fight at range (kiter/support)
    aggression: number;     // 0..1 — presses in (small R*, commits) vs waits (big R*, kites)
    retreatHp: number;      // HP frac below which it disengages/kites hard
    dodgeBias: number;      // added to the speed-driven dodge chance
    orbitStrong: boolean;   // strafes/kites more (reads as circling)
    // ── MOTION IDENTITY — how THIS archetype physically fights (so a glass rusher, a
    //    heavy brawler and a planted defender read as different fighters on screen). ──
    lungeInit: number;      // how far out it commits its pounce (long dive vs only-when-close)
    lungeMult: number;      // pounce speed × maxSpeed (explosive vs lumbering body-check)
    lungeTrack: number;     // per-tick re-aim during the dive (0.1 slips easily ↔ 0.3 tracks you down)
    lungeTicks: number;     // dive duration before it's a whiff
    turnMult: number;       // maneuverability (maxForce multiplier — agile vs lumbering)
    windMult: number;       // windup-time multiplier (snappy vs telegraphed heavy)
    recovMult: number;      // recovery-time multiplier (relentless vs long punish window)
    reposDur: number;       // post-attack reposition-beat length in SECONDS (planted vs dances out)
    reposBack: number;      // how far it backs out on the reposition beat (holds ground vs kites far)
}

// ── Fighter ────────────────────────────────────────────────────────────────────
interface Fighter {
    id: string; team: "player" | "enemy"; slot: number; pet: Pet; element?: string | null;
    x: number; y: number; vx: number; vy: number; faceX: number; faceY: number;
    hp: number; maxHp: number; reviveLeft: number;
    atk: number; def: number; spd: number;
    maxSpeed: number; maxForce: number;
    stamina: number;
    reach: number;
    state: DuelState; stateLeft: number;
    pendingIdx: number; pendingTargetId: string | null;
    basicCdLeft: number; basicCdT: number;
    windT: number; recovT: number; staggerT: number; dashT: number; dodgeT: number;
    critChance: number;
    style: Style;
    abilities: Ability[];
    statuses: Statuses;
    moveDx: number; moveDy: number;         // stored dir for dash/dodge states
    dodgeCd: number;                        // ticks until it can actively dodge again
    reposLeft: number;                      // post-attack reposition beat: strafe/kite, don't re-commit yet (the in-out cadence)
    commit: number;                         // anti-stall: rises while in-band with a ready move but not firing
    targetId: string | null;
    itemsOn: boolean;
    cDodge: number; cMitigatePct: number; cEndure: number; cThornsPct: number; cLifelinePct: number; cCleanse: number;
    basicRanged: boolean;
    lungeAbIdx: number;                     // >-2 while mid-pounce: which move resolves on contact (-1 = basic attack)
    lungeTgtId: string | null;
    lungeStuck: number;                     // consecutive pounce ticks with ~no progress (wall) → resolve early, don't phantom-whiff
}

// Classify a pet into a fighting ARCHETYPE from its DECLARED role/sub-role (the old
// engine ignored these — the headroom), falling back to stat/moveset shape. Standalone
// + exported (petCinematicArchetype) so the balance harness buckets from ONE source.
function classifyArchetype(pet: Pet, abilities: Ability[]): Archetype {
    const attack = Math.max(0, pet.attack || 0), defense = Math.max(0, pet.defense || 0), speed = Math.max(0, pet.speed || 0);
    const hasRanged = abilities.some((a) => a.cls === "ranged");
    const hasMelee = abilities.some((a) => a.cls === "melee");
    const hasSupport = abilities.some((a) => a.cls === "support");
    const glass = attack > defense * 1.35;
    const tanky = pet.trait === "Guardian" || defense > attack * 1.15 || abilities.some((a) => a.kind === "shield" || a.kind === "barrier" || a.kind === "absorb" || a.kind === "taunt");
    const fast = speed >= 90;
    const role = pet.role, sub = pet.subRole;
    if (sub === "support" || role === "sage" || (hasSupport && !glass)) return "support";
    if (sub === "kite" || (hasRanged && !hasMelee) || (hasRanged && fast && glass)) return "kiter";
    if (sub === "tank" || role === "defender" || tanky) return "defender";
    if (sub === "assassin" || role === "assassin" || (fast && glass && hasMelee)) return "rusher";
    if (sub === "striker" || sub === "bruiser" || role === "tracker") return "brawler";
    return "balanced";
}
// Per-archetype MOTION identity — the physical signature of each fighting style.
//  li lungeInit · lm lungeMult · lt lungeTrack · lk lungeTicks · tm turnMult
//  wm windMult · rm recovMult · rd reposDur(s) · rb reposBack
// Tuned against the harness per-archetype win-matrix: rushers dive far/fast/snappy and
// track well so their commitment PAYS (they were under-performing); brawlers are heavy
// relentless body-checks; defenders are PLANTED counter-punchers that only commit close
// and hold ground (they were dominating — this trims their proactive pressure); kiters/
// support dance far out.
const MOTION: Record<Archetype, { li: number; lm: number; lt: number; lk: number; tm: number; wm: number; rm: number; rd: number; rb: number }> = {
    // rb (reposBack) + rd (reposDur) bumped so even melee pets DISENGAGE visibly after an
    // exchange — break apart, circle, then re-commit — instead of staying meshed and trading.
    rusher:   { li: 5.2, lm: 4.8, lt: 0.16, lk: 18, tm: 1.20, wm: 0.80, rm: 0.85, rd: 0.36, rb: 2.0 },
    // brawler = a RELENTLESS body-check: lumbering turn + big committed dives that track
    // you down (high lt), but NORMAL attack tempo (slowing its wind/recover tanked its DPS).
    brawler:  { li: 4.4, lm: 3.4, lt: 0.28, lk: 20, tm: 0.82, wm: 1.00, rm: 1.05, rd: 0.48, rb: 2.1 },
    kiter:    { li: 3.4, lm: 3.6, lt: 0.12, lk: 14, tm: 1.10, wm: 1.00, rm: 1.00, rd: 0.80, rb: 3.2 },
    defender: { li: 2.8, lm: 3.2, lt: 0.18, lk: 12, tm: 0.85, wm: 1.10, rm: 1.00, rd: 0.40, rb: 1.7 },
    support:  { li: 3.0, lm: 3.4, lt: 0.14, lk: 14, tm: 1.00, wm: 1.00, rm: 1.00, rd: 0.90, rb: 3.4 },
    balanced: { li: 4.0, lm: 3.5, lt: 0.14, lk: 16, tm: 1.00, wm: 1.00, rm: 1.00, rd: 0.58, rb: 2.2 },
};
function deriveStyle(pet: Pet, abilities: Ability[], oppElement: string | null | undefined, itemsOn: boolean): Style {
    const trait = pet.trait;
    const hasRanged = abilities.some((a) => a.cls === "ranged");
    const hasMelee = abilities.some((a) => a.cls === "melee");
    const arche = classifyArchetype(pet, abilities);
    const m = MOTION[arche];

    // Base knobs per archetype.
    let aggression: number, retreatHp: number, dodgeBias: number, orbitStrong: boolean, rangedPref: boolean;
    switch (arche) {
        case "rusher":   aggression = 0.85; retreatHp = 0.18; dodgeBias = 0.06; orbitStrong = false; rangedPref = false; break;
        case "brawler":  aggression = 0.70; retreatHp = 0.22; dodgeBias = 0.04; orbitStrong = false; rangedPref = false; break;
        case "kiter":    aggression = 0.35; retreatHp = 0.40; dodgeBias = 0.14; orbitStrong = true;  rangedPref = true;  break;
        case "defender": aggression = 0.45; retreatHp = 0.15; dodgeBias = 0.10; orbitStrong = false; rangedPref = false; break;
        case "support":  aggression = 0.25; retreatHp = 0.55; dodgeBias = 0.16; orbitStrong = true;  rangedPref = true;  break;
        default:         aggression = 0.55; retreatHp = 0.28; dodgeBias = 0.08; orbitStrong = hasRanged; rangedPref = hasRanged && !hasMelee; break;
    }
    // ELEMENT matchup vs the opponent: an advantaged pet PRESSES; a disadvantaged
    // one plays cautious / kites / dodges more — visible in how it moves.
    const adv = elementMult(pet.element, oppElement);
    if (adv > 1) { aggression = clamp(aggression + 0.1, 0, 1); retreatHp = Math.max(0.1, retreatHp - 0.04); }
    else if (adv < 1) { aggression = clamp(aggression - 0.1, 0, 1); dodgeBias += 0.04; orbitStrong = true; }
    // TRAIT flavor.
    if (trait === "Aggressive") aggression = clamp(aggression + 0.12, 0, 1);
    if (trait === "Battleborn") aggression = clamp(aggression + 0.08, 0, 1);
    if (trait === "Guardian") { retreatHp = Math.max(0.1, retreatHp - 0.05); }
    if (trait === "Swift") { dodgeBias += 0.08; orbitStrong = true; }
    if (trait === "Lucky") dodgeBias += 0.03;
    // ITEMS the pet is CARRYING bend its risk: an endure charge lets it dive; a
    // dodge charge / thorns make trading safer → a touch more aggression.
    if (itemsOn) {
        const ch = petConsumableCharges(pet);
        if (ch.endure > 0) aggression = clamp(aggression + 0.1, 0, 1);
        if (ch.thorns > 0) aggression = clamp(aggression + 0.05, 0, 1);
        if (ch.dodge > 0) dodgeBias += 0.05;
    }
    return {
        arche, rangedPref, aggression, retreatHp, dodgeBias, orbitStrong,
        lungeInit: m.li, lungeMult: m.lm, lungeTrack: m.lt, lungeTicks: m.lk,
        turnMult: m.tm, windMult: m.wm, recovMult: m.rm, reposDur: m.rd, reposBack: m.rb,
    };
}

function buildFighter(pet: Pet, team: "player" | "enemy", slot: number, x: number, y: number, oppElement: string | null | undefined, atkMult: number, hpMult: number, reviveOnce: boolean, applyItems: boolean): Fighter {
    const gp = applyItems ? applyPetPvpGear(pet) : pet;
    const speed = Math.max(0, gp.speed || 0);
    const maxHp = Math.max(1, Math.round((gp.hp || 1) * hpMult * TTK_HP));
    const moveSpeed = clamp(2.8 + speed * 0.02, 2.8, 6.6) / DUEL_TPS;   // units/tick
    const abilities = petCinematicAbilities(gp);
    const sigAb = abilities.find((a) => a.signature);
    if (sigAb) { sigAb.cdTicks = Math.max(sigAb.cdTicks, Math.round(DUEL_TPS * 9)); sigAb.cdLeft = Math.round(DUEL_TPS * 4.5); }
    const style = deriveStyle(gp, abilities, oppElement, applyItems);
    const statuses = emptyStatuses();
    const ch = applyItems ? petConsumableCharges(gp) : null;
    if (applyItems) statuses.shieldHp = petGearStartShield(gp);
    return {
        id: `${team}-${slot}`, team, slot, pet: gp, element: gp.element,
        x, y, vx: 0, vy: 0, faceX: team === "player" ? 1 : -1, faceY: 0,
        hp: maxHp, maxHp, reviveLeft: reviveOnce ? 1 : 0,
        atk: Math.max(0, (gp.attack || 0) * atkMult), def: Math.max(0, gp.defense || 0), spd: speed,
        maxSpeed: moveSpeed, maxForce: moveSpeed * 0.34 * style.turnMult,   // agile vs lumbering
        stamina: STAM_MAX, reach: BASIC_REACH,
        state: "idle", stateLeft: 0, pendingIdx: -2, pendingTargetId: null,
        basicCdLeft: 0, basicCdT: Math.round(DUEL_TPS * 0.5),
        windT: Math.max(2, Math.round(DUEL_TPS * clamp(0.42 - speed * 0.0012, 0.16, 0.42) * style.windMult)),     // snappy vs telegraphed
        recovT: Math.max(2, Math.round(DUEL_TPS * clamp(0.46 - speed * 0.0010, 0.20, 0.46) * style.recovMult)),   // relentless vs long punish window
        staggerT: Math.round(DUEL_TPS * 0.35), dashT: 7, dodgeT: 6,
        critChance: CRIT_CHANCE + (gp.trait === "Lucky" ? 0.1 : 0),
        style, abilities, statuses,
        moveDx: 0, moveDy: 0, dodgeCd: 0, reposLeft: 0, commit: 0, targetId: null,
        itemsOn: applyItems,
        cDodge: ch ? ch.dodge : 0, cMitigatePct: ch ? ch.mitigate : 0, cEndure: ch ? ch.endure : 0,
        cThornsPct: ch ? ch.thorns : 0, cLifelinePct: ch ? ch.lifeline : 0, cCleanse: ch ? ch.cleanse : 0,
        basicRanged: abilities.some((a) => a.cls === "ranged"),
        lungeAbIdx: -2, lungeTgtId: null, lungeStuck: 0,
    };
}

// ── Projectiles ─────────────────────────────────────────────────────────────────
interface Projectile { id: number; ownerId: string; team: "player" | "enemy"; targetId: string; abilityIdx: number; x: number; y: number; speed: number; ttl: number; element?: string | null; kind: PetJutsu["kind"]; }

// ── Targeting ────────────────────────────────────────────────────────────────────
function pickTarget(f: Fighter, fighters: Fighter[]): Fighter | null {
    if (f.statuses.tauntById) { const t = fighters.find((g) => g.id === f.statuses.tauntById && g.hp > 0); if (t) return t; }
    const lane = fighters.find((g) => g.team !== f.team && g.slot === f.slot && g.hp > 0);
    if (lane) return lane;
    let best: Fighter | null = null, bestKey = Infinity;
    for (const g of fighters) {
        if (g.team === f.team || g.hp <= 0) continue;
        const dx = g.x - f.x, dy = g.y - f.y;
        const key = g.hp * 1e6 + dx * dx + dy * dy;
        if (key < bestKey || (key === bestKey && best && g.id < best.id)) { bestKey = key; best = g; }
    }
    return best;
}
function pickAlly(f: Fighter, fighters: Fighter[]): Fighter {
    let best = f, bestFrac = f.hp / f.maxHp;
    for (const g of fighters) {
        if (g.team !== f.team || g.hp <= 0) continue;
        const frac = g.hp / g.maxHp;
        if (frac < bestFrac || (frac === bestFrac && g.id < best.id)) { bestFrac = frac; best = g; }
    }
    return best;
}
const teamAlive = (fighters: Fighter[], team: "player" | "enemy") => fighters.some((f) => f.team === team && f.hp > 0);

// ── Damage (verbatim-equivalent to pet-duel-sim.applyDamage → balance-neutral) ───
function applyDamage(att: Fighter, tgt: Fighter, ab: Ability | null, rng: () => number, t: number, events: DuelEvent[], viaProjectile: boolean) {
    if (tgt.hp <= 0) return;
    const crit = rng() < att.critChance;
    if (tgt.itemsOn && tgt.cDodge > 0) { tgt.cDodge -= 1; events.push({ t, type: "dodge", side: tgt.team, actorId: tgt.id }); return; }
    const powerScale = ab ? ab.power / 100 : 1;
    const buff = att.statuses.buffLeft > 0 ? 1 + att.statuses.buffMag : 1;
    let mult = elementMult(att.element, tgt.element) * (crit ? 1.6 : 1) * Math.max(0.3, buff);
    if (att.statuses.wallPenaltyLeft > 0) mult *= 0.5;   // barrier caster's OFFENSE halved while its wall stands (the visible cost)
    if (tgt.statuses.wallPenaltyLeft > 0) mult *= 1.7;   // …and it's EXPOSED — takes extra damage — which is what actually offsets a tanky pet's outlast-via-wall advantage
    if (tgt.statuses.marked) { mult *= 1.4; tgt.statuses.marked = false; }
    if (att.itemsOn) mult *= petGearExecuteMult(att.pet, tgt.hp, tgt.maxHp);
    const mitigation = clamp(1 - tgt.def * 0.0012, 0.35, 1);
    if (t > LATE_T) mult *= 1 + (t - LATE_T) / LATE_RAMP;
    const base = att.atk * DMG_SCALE * powerScale;
    let dmg = Math.max(1, Math.round(base * mult * mitigation));
    if (tgt.itemsOn) {
        dmg = Math.max(1, Math.round(dmg * petGearLastStandMult(tgt.pet, tgt.hp, tgt.maxHp)));
        if (tgt.cMitigatePct > 0) { dmg = Math.max(1, Math.round(dmg * (1 - tgt.cMitigatePct / 100))); tgt.cMitigatePct = 0; }
    }
    if (tgt.statuses.shieldHp > 0) { const soak = Math.min(tgt.statuses.shieldHp, dmg); tgt.statuses.shieldHp = quant(tgt.statuses.shieldHp - soak); dmg -= soak; }
    if (tgt.itemsOn && tgt.cEndure > 0 && dmg >= tgt.hp && tgt.hp > 1) { dmg = tgt.hp - 1; tgt.cEndure -= 1; }
    tgt.hp -= dmg;
    events.push({ t, type: "hit", side: att.team, actorId: att.id, targetId: tgt.id, dmg, crit, element: att.element, kind: ab ? ab.kind : "damage", ranged: viaProjectile, move: ab ? ab.name : undefined, signature: ab ? ab.signature : undefined });
    if (ab) applyOnHit(att, tgt, ab);
    if (ab && ab.kind === "lifesteal" && att.hp > 0) att.hp = Math.min(att.maxHp, att.hp + Math.round(dmg * 0.5));
    if (dmg > 0) {
        if (tgt.itemsOn && tgt.cThornsPct > 0 && att.hp > 0) {
            const reflect = Math.max(1, Math.round(dmg * tgt.cThornsPct / 100));
            att.hp -= reflect; tgt.cThornsPct = 0;
            events.push({ t, type: "hit", side: tgt.team, actorId: tgt.id, targetId: att.id, dmg: reflect, element: tgt.element, kind: "damage" });
        }
        if (att.itemsOn && !ab) {
            const dot = petGearDotOnHit(att.pet);
            if (dot) { tgt.statuses.burnLeft = Math.max(tgt.statuses.burnLeft, Math.round(DUEL_TPS * dot.rounds * 0.8)); tgt.statuses.burnDmg = Math.max(tgt.statuses.burnDmg, dot.damage); }
            const heal = petGearLifestealHeal(att.pet, dmg);
            if (heal > 0 && att.hp > 0) att.hp = Math.min(att.maxHp, att.hp + heal);   // never heal a corpse alive (dead owner's in-flight poke)
        }
        if (tgt.itemsOn && tgt.cLifelinePct > 0 && tgt.hp > 0 && (tgt.hp / tgt.maxHp) * 100 < PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT) {
            const heal = Math.max(1, Math.round(tgt.maxHp * tgt.cLifelinePct / 100));
            tgt.hp = Math.min(tgt.maxHp, tgt.hp + heal); tgt.cLifelinePct = 0;
            events.push({ t, type: "heal", side: tgt.team, actorId: tgt.id, targetId: tgt.id, dmg: heal });
        }
    }
    // KNOCKBACK — bigger hits FLING the victim across the ring (small pokes nudge; a crit
    // / signature / heavy blow throws them several units), and a fling into the arena edge
    // SLAMS (a longer stagger + a "Slam" marker for the renderer). Making space a combatant:
    // one big blow relocates the whole fight, so the next beat is a fresh cross-ring approach.
    const dx = tgt.x - att.x, dy = tgt.y - att.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    // SIM knockback stays modest so spacing/balance is preserved (a bigger sim fling
    // disrupts kiters and snowballs the element/stat winner). The BIG-knockback FEEL is
    // delivered render-side: the renderer derives "heavy" from the hit event's crit /
    // signature / dmg and plays an exaggerated skid + a wall-slam when the victim is near
    // the edge — purely cosmetic, so it never touches the fight's balance.
    const surge = (crit || dmg >= tgt.maxHp * 0.18) ? 1.6 : 1;
    const kb = (crit ? 1.7 : 1.1) * (viaProjectile ? 0.4 : 1) * (ab && ab.kind === "push" ? 2 : 1) * surge;
    if (d > 1e-6) { const [nx, ny] = snapPos(tgt.x + (dx / d) * kb, tgt.y + (dy / d) * kb); tgt.x = nx; tgt.y = ny; }
    if (ab && ab.kind === "pull" && d > 1e-6) { const [nx, ny] = snapPos(tgt.x - (dx / d) * 1.2, tgt.y - (dy / d) * 1.2); tgt.x = nx; tgt.y = ny; }
    if ((tgt.state === "idle" || tgt.state === "dash" || tgt.state === "windup") && tgt.statuses.stunLeft <= 0) {
        if (tgt.lungeAbIdx > -2) clearLunge(tgt);   // staggered mid-pounce → drop the dive so it can't re-resolve for free on the next dash
        tgt.state = "stagger"; tgt.stateLeft = att.staggerT;
        events.push({ t, type: "stagger", side: tgt.team, actorId: tgt.id });
    }
}
function applyOnHit(att: Fighter, tgt: Fighter, ab: Ability) {
    const s = tgt.statuses; const dur = statusTicks(ab);
    switch (ab.kind) {
        case "burn": case "dot": s.burnLeft = Math.max(s.burnLeft, dur); s.burnDmg = Math.max(s.burnDmg, Math.max(1, Math.round(att.atk * 0.12 * (ab.power / 100)))); break;
        case "wound": s.burnLeft = Math.max(s.burnLeft, dur); s.burnDmg = Math.max(s.burnDmg, Math.max(1, Math.round(att.atk * 0.1))); s.halfHeal = true; break;
        case "freeze": case "stun": case "confuse": s.stunLeft = Math.max(s.stunLeft, ab.kind === "stun" ? dur : Math.round(dur * 0.7)); break;
        case "slow": s.slowLeft = Math.max(s.slowLeft, dur); break;
        case "mark": s.marked = true; break;
        case "crush": case "debuff": s.buffLeft = Math.max(s.buffLeft, buffTicks(ab)); s.buffMag = Math.min(s.buffMag, -0.25); break;
        case "movelock": s.rootLeft = Math.max(s.rootLeft, dur); break;
        case "taunt": s.tauntById = att.id; break;
        default: break;
    }
}
function castSupport(f: Fighter, ab: Ability, fighters: Fighter[], t: number, events: DuelEvent[]) {
    const ally = pickAlly(f, fighters);
    if (ab.kind === "heal") {
        const hasAlly = fighters.some((g) => g.team === f.team && g.id !== f.id && g.hp > 0);
        const healFrac = hasAlly ? 0.16 : 0.45;
        const heal = Math.round(f.maxHp * healFrac * (ab.power / 100)) * (ally.statuses.halfHeal ? 0.5 : 1);
        ally.hp = Math.min(ally.maxHp, ally.hp + Math.max(1, Math.round(heal)));
        events.push({ t, type: "heal", side: f.team, actorId: f.id, targetId: ally.id, dmg: Math.round(heal) });
    } else if (ab.kind === "shield" || ab.kind === "barrier" || ab.kind === "absorb") {
        ally.statuses.shieldHp = Math.max(ally.statuses.shieldHp, Math.round(ally.maxHp * 0.2 * (ab.power / 100)));
        events.push({ t, type: "shield", side: f.team, actorId: f.id, targetId: ally.id, kind: ab.kind });   // kind lets the renderer give BARRIER its earth-wall
        if (ab.kind === "barrier") {
            // Raise a solid EARTH WALL between the caster and the nearest foe — blocks LoS +
            // movement for WALL_TICKS, so the fight PAUSES (buff/heal or path around). Radius
            // scales with the gap so it never traps a fighter inside it in a close scrap.
            // COST: the caster's own damage is halved for a beat, so the defensive wall isn't
            // a free win (this is what keeps barrier pets from dominating — a real tradeoff).
            f.statuses.wallPenaltyLeft = WALL_PENALTY_TICKS;
            let foe: Fighter | null = null, bd = Infinity;
            for (const g of fighters) { if (g.team === f.team || g.hp <= 0) continue; const dd = (g.x - f.x) * (g.x - f.x) + (g.y - f.y) * (g.y - f.y); if (dd < bd) { bd = dd; foe = g; } }
            if (foe) {
                const gap = Math.sqrt(bd);
                SIM_WALLS.push({ x: f.x + (foe.x - f.x) * 0.5, y: f.y + (foe.y - f.y) * 0.5, r: clamp(gap * 0.28, 0.95, 1.7), expiry: t + WALL_TICKS });
            }
        }
    } else if (ab.kind === "buff") {
        f.statuses.buffLeft = buffTicks(ab); f.statuses.buffMag = Math.max(f.statuses.buffMag, 0.25);
        events.push({ t, type: "buff", side: f.team, actorId: f.id, targetId: f.id });
    } else if (ab.kind === "haste") {
        f.statuses.hasteLeft = buffTicks(ab);
        events.push({ t, type: "buff", side: f.team, actorId: f.id, targetId: f.id });
    }
}

// ── Casting ──────────────────────────────────────────────────────────────────────
function beginCast(f: Fighter, idx: number, targetId: string, t: number, events: DuelEvent[]) {
    f.pendingIdx = idx; f.pendingTargetId = targetId;
    f.state = "windup"; f.stateLeft = idx >= 0 ? f.abilities[idx].castTicks : f.windT;
    f.vx = 0; f.vy = 0;
    if (idx >= 0 && f.abilities[idx].signature) events.push({ t, type: "ultimate", side: f.team, actorId: f.id, move: f.abilities[idx].name, targetId });
    else if (idx >= 0 && f.abilities[idx].cls === "support") events.push({ t, type: "cast", side: f.team, actorId: f.id, kind: f.abilities[idx].kind, move: f.abilities[idx].name });
    else events.push({ t, type: "windup", side: f.team, actorId: f.id, kind: idx >= 0 ? f.abilities[idx].kind : "damage", move: idx >= 0 ? f.abilities[idx].name : undefined, targetId });
}
function payAbilityCost(f: Fighter, ab: Ability | null) {
    if (ab) { ab.cdLeft = ab.cdTicks; f.stamina -= ab.cost; } else { f.basicCdLeft = f.basicCdT; f.stamina -= COST_BASIC; }
}
// Reset the pounce bookkeeping. MUST be called on EVERY abnormal exit from a lunge
// (stagger/stun/death/anti-stall dash) or a stale lungeAbIdx makes the shared "dash"
// state re-resolve the move for free on the next dash. See bug: leaked lungeAbIdx.
function clearLunge(f: Fighter) { f.lungeAbIdx = -2; f.lungeTgtId = null; f.lungeStuck = 0; }
// Melee ability / basic resolved AT CONTACT (called by the lunge on connect, or by
// resolveCast for the non-lunge path). Cost is paid by the caller; this only rolls
// accuracy and applies damage to whatever is in reach around the pounce's landing.
function resolveMeleeContact(f: Fighter, ab: Ability | null, tgtId: string | null, fighters: Fighter[], rng: () => number, t: number, events: DuelEvent[], accuracyEnabled: boolean) {
    // Draw the accuracy roll for EVERY ability contact, independent of the (per-client,
    // localStorage) accuracy flag — else toggling the flag shifts the whole rng stream
    // and the same (pets, seed) diverges across clients. Basics (ab null) never roll.
    const accRoll = ab ? rng() : 1;
    if (accuracyEnabled && ab && accRoll >= ab.accuracy / 100) { events.push({ t, type: "whiff", side: f.team, actorId: f.id }); return; }
    const primary = fighters.find((g) => g.id === tgtId);
    const hitList = ab && ab.aoe ? fighters.filter((g) => g.team !== f.team && g.hp > 0) : primary ? [primary] : [];
    let landed = false;
    for (const tgt of hitList) {
        const dx = tgt.x - f.x, dy = tgt.y - f.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const facingOK = f.faceX * dx + f.faceY * dy > 0;
        const range = ab ? ab.range : f.reach + 0.35;
        if (tgt.hp > 0 && d <= range + 0.5 && facingOK) { applyDamage(f, tgt, ab, rng, t, events, false); landed = true; }
    }
    if (!landed) events.push({ t, type: "whiff", side: f.team, actorId: f.id });
}
// Only called for RANGED / SUPPORT now — melee goes through the lunge (see stepFighter).
function resolveCast(f: Fighter, fighters: Fighter[], projectiles: Projectile[], nextProjId: { n: number }, rng: () => number, t: number, events: DuelEvent[], accuracyEnabled: boolean) {
    const idx = f.pendingIdx;
    const ab = idx >= 0 ? f.abilities[idx] : null;
    payAbilityCost(f, ab);
    if (ab && ab.cls === "support") { castSupport(f, ab, fighters, t, events); return; }
    const accRoll = ab ? rng() : 1;   // always draw for abilities → rng stream is accuracy-flag-independent (see resolveMeleeContact)
    if (accuracyEnabled && ab && accRoll >= ab.accuracy / 100) { events.push({ t, type: "whiff", side: f.team, actorId: f.id }); return; }
    if (ab && ab.cls === "ranged") {
        const targets = ab.aoe ? fighters.filter((g) => g.team !== f.team && g.hp > 0) : [fighters.find((g) => g.id === f.pendingTargetId && g.hp > 0)].filter(Boolean) as Fighter[];
        for (const tgt of targets) projectiles.push({ id: nextProjId.n++, ownerId: f.id, team: f.team, targetId: tgt.id, abilityIdx: idx, x: f.x, y: f.y, speed: 0.34, ttl: Math.round(DUEL_TPS * 3), element: f.element, kind: ab.kind });
        events.push({ t, type: "cast", side: f.team, actorId: f.id, kind: ab.kind, move: ab.name });
        return;
    }
    if (!ab && f.basicRanged) {
        const tgt = fighters.find((g) => g.id === f.pendingTargetId && g.hp > 0);
        if (tgt) { projectiles.push({ id: nextProjId.n++, ownerId: f.id, team: f.team, targetId: tgt.id, abilityIdx: -1, x: f.x, y: f.y, speed: 0.34, ttl: Math.round(DUEL_TPS * 3), element: f.element, kind: "damage" }); events.push({ t, type: "cast", side: f.team, actorId: f.id, kind: "damage" }); }
        return;
    }
    // Fallback (melee via resolveCast — normally unreachable; the lunge handles melee).
    resolveMeleeContact(f, ab, f.pendingTargetId, fighters, rng, t, events, accuracyEnabled);
}
function stepProjectiles(fighters: Fighter[], projectiles: Projectile[], rng: () => number, t: number, events: DuelEvent[]) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        const owner = fighters.find((g) => g.id === p.ownerId)!;
        const tgt = fighters.find((g) => g.id === p.targetId && g.hp > 0);
        if (!tgt) { if (--p.ttl <= 0) { projectiles.splice(i, 1); continue; } }
        if (tgt) {
            const dx = tgt.x - p.x, dy = tgt.y - p.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            // A pet mid-DODGE can slip an incoming projectile too (not just melee) — a
            // fast evader weaves through the shot. Speed-gated; keeps ranged from being
            // un-missable vs mobile foes. Deterministic (state + positions, no flag).
            if (tgt.state === "dodge" && d <= 2.0) {
                const ev = clamp(0.10 + (tgt.spd - owner.spd) * 0.0020, 0, 0.6);
                if (rng() < ev) { events.push({ t, type: "dodge", side: tgt.team, actorId: tgt.id }); projectiles.splice(i, 1); continue; }
            }
            if (d <= 0.7) { const ab = owner.abilities[p.abilityIdx] ?? null; applyDamage(owner, tgt, ab, rng, t, events, true); projectiles.splice(i, 1); continue; }
            if (d > 1e-6) { p.x += (dx / d) * p.speed; p.y += (dy / d) * p.speed; }
        }
        p.x = quant(p.x); p.y = quant(p.y);
        if (--p.ttl <= 0) projectiles.splice(i, 1);
    }
}

// ── Movement: CONTEXT STEERING ────────────────────────────────────────────────
function effMoveSpeed(f: Fighter): number {
    let s = f.maxSpeed;
    if (f.statuses.slowLeft > 0) s *= 0.6;
    if (f.statuses.hasteLeft > 0) s *= 1.35;
    return s;
}
function writeMap(map: number[], dx: number, dy: number, value: number, sharp: boolean) {
    for (let i = 0; i < N; i++) {
        let w = SLOT_X[i] * dx + SLOT_Y[i] * dy;
        if (w <= 0) continue;
        if (w > 1) w = 1;
        if (sharp) w = w * w;
        const v = value * w;
        if (v > map[i]) map[i] = v;
    }
}
function blur(map: number[]) {
    const a = map[0];
    let prev = map[N - 1];
    for (let i = 0; i < N; i++) {
        const cur = map[i];
        const next = i === N - 1 ? a : map[i + 1];
        map[i] = 0.25 * prev + 0.5 * cur + 0.25 * next;
        prev = cur;
    }
}
const _interest = new Array(N).fill(0);
const _danger = new Array(N).fill(0);
/** Build interest+danger maps for f against its target, arbitrate to a heading +
 *  speed, and integrate through the Reynolds Arrive/max-force substrate. `rStar`
 *  is the desired engagement range (set by the decision layer). */
function steer(f: Fighter, e: Fighter, fighters: Fighter[], rStar: number, routeGoal?: [number, number]) {
    for (let i = 0; i < N; i++) { _interest[i] = 0; _danger[i] = 0; }
    const ex = e.x - f.x, ey = e.y - f.y;
    const d = Math.max(1e-4, Math.sqrt(ex * ex + ey * ey));
    const tx = ex / d, ty = ey / d;               // unit toward enemy
    // ROOT / movelock — planted: keep facing + firing (handled in decide) but no move.
    if (f.statuses.rootLeft > 0) { f.vx = 0; f.vy = 0; f.faceX = tx; f.faceY = ty; return; }
    // INTEREST. When line-of-sight to the foe is blocked, SEEK the BFS waypoint at
    // full interest (route around the terrain first); otherwise do R* spacing.
    if (routeGoal) {
        const gx = routeGoal[0] - f.x, gy = routeGoal[1] - f.y, gd = Math.max(1e-4, Math.sqrt(gx * gx + gy * gy));
        writeMap(_interest, gx / gd, gy / gd, INT_CLOSE, false);
    } else if (d > rStar + BAND_H) writeMap(_interest, tx, ty, INT_CLOSE, false);
    else if (d < rStar - BAND_H) writeMap(_interest, -tx, -ty, INT_BACK, false);
    else {
        const strafe = f.style.orbitStrong ? INT_STRAFE : INT_STRAFE * 0.7;
        const dir = ((f.slot & 1) === 0 ? 1 : -1) * (f.team === "player" ? 1 : -1);
        writeMap(_interest, -ty * dir, tx * dir, strafe, false);
        writeMap(_interest, tx * 0.2, ty * 0.2, 0.2, false);   // slight inward bias to hold the band
    }
    // Openness bias toward center (anti-corner "racing line").
    const cl = Math.sqrt(f.x * f.x + f.y * f.y);
    if (cl > 1e-3) writeMap(_interest, -f.x / cl, -f.y / cl, CENTER_BIAS, false);
    // DANGER — enemy threat bubble, telegraph, walls, personal space.
    const reach = e.state === "windup" ? 3.0 : 1.8;
    const prox = clamp(1 - (d - reach) / Math.max(1e-3, reach), 0, 1);
    writeMap(_danger, tx, ty, DANGER_ENEMY * prox, false);
    if (e.state === "windup" && e.pendingTargetId === f.id) {
        const sev = DANGER_TELE * clamp(1 - e.stateLeft / Math.max(1, e.windT), 0.3, 1);
        writeMap(_danger, tx, ty, sev, false);                 // moving toward the winder = into the blow
    }
    if (f.style.rangedPref && d < rStar - BAND_H) writeMap(_danger, tx, ty, DANGER_BUBBLE, false);
    // Arena-edge / wall danger: sample the 4 cardinal steps; if a step leaves the
    // walkable band, mark that heading dangerous so pets don't corner themselves.
    const probe = Math.max(CELL_X, CELL_Y) * 1.2;
    if (!walkableAt(f.x + probe, f.y)) writeMap(_danger, 1, 0, DANGER_WALL, false);
    if (!walkableAt(f.x - probe, f.y)) writeMap(_danger, -1, 0, DANGER_WALL, false);
    if (!walkableAt(f.x, f.y + probe)) writeMap(_danger, 0, 1, DANGER_WALL, false);
    if (!walkableAt(f.x, f.y - probe)) writeMap(_danger, 0, -1, DANGER_WALL, false);
    // Ally separation (2v2) — don't stack on a teammate.
    for (const g of fighters) {
        if (g === f || g.team !== f.team || g.hp <= 0) continue;
        const gx = g.x - f.x, gy = g.y - f.y, gd = Math.sqrt(gx * gx + gy * gy);
        if (gd < 2.0 && gd > 1e-3) writeMap(_danger, gx / gd, gy / gd, 0.5 * (1 - gd / 2.0), false);
    }
    blur(_interest); blur(_danger);
    // Arbitrate: mask to the lowest-danger slots, pick max interest; continuity
    // bonus to the current heading slot so it doesn't flip between equal options.
    let minD = _danger[0];
    for (let i = 1; i < N; i++) if (_danger[i] < minD) minD = _danger[i];
    const tol = 0.05;
    const vlen = Math.sqrt(f.vx * f.vx + f.vy * f.vy);
    let curSlot = -1;
    if (vlen > 1e-4) {
        let bestDot = -2;
        for (let i = 0; i < N; i++) { const dot = SLOT_X[i] * (f.vx / vlen) + SLOT_Y[i] * (f.vy / vlen); if (dot > bestDot) { bestDot = dot; curSlot = i; } }
    }
    let best = -1, bestScore = -1e9;
    for (let i = 0; i < N; i++) {
        if (_danger[i] > minD + tol) continue;
        const score = _interest[i] + (i === curSlot ? 0.05 : 0);
        if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) { best = 0; for (let i = 1; i < N; i++) if (_danger[i] < _danger[best]) best = i; }   // all dangerous → least-bad
    const hx = SLOT_X[best], hy = SLOT_Y[best];
    let spd = effMoveSpeed(f) * clamp(_interest[best], 0, 1);
    // Arrive: decelerate into the R* band so it doesn't overshoot + jitter. (Skip
    // while routing around terrain — there we want full speed to the waypoint.)
    if (!routeGoal) { const bandErr = Math.abs(d - rStar); if (bandErr < SLOW_RADIUS) spd *= Math.max(0.15, bandErr / SLOW_RADIUS); }
    // Steer the velocity toward desired with a max-force turn-rate limit (this is
    // the temporal smoothing — arcs, not twitches).
    const desVx = hx * spd, desVy = hy * spd;
    let sx = desVx - f.vx, sy = desVy - f.vy;
    const slen = Math.sqrt(sx * sx + sy * sy);
    if (slen > f.maxForce && slen > 1e-6) { sx = (sx / slen) * f.maxForce; sy = (sy / slen) * f.maxForce; }
    f.vx += sx; f.vy += sy;
    const vl = Math.sqrt(f.vx * f.vx + f.vy * f.vy);
    const cap = effMoveSpeed(f);
    if (vl > cap && vl > 1e-6) { f.vx = (f.vx / vl) * cap; f.vy = (f.vy / vl) * cap; }
    // Move (walkmask edge-slide) + always FACE the enemy (kiting = face + backpedal).
    const nx = f.x + f.vx, ny = f.y + f.vy;
    if (walkableAt(nx, ny)) { f.x = nx; f.y = ny; }
    else if (walkableAt(nx, f.y)) { f.x = nx; f.vy = 0; }
    else if (walkableAt(f.x, ny)) { f.y = ny; f.vx = 0; }
    else { f.vx = 0; f.vy = 0; }
    f.faceX = tx; f.faceY = ty;
}

// ── Decision — utility-lite brain. Sets R* and fires/dodges. ──────────────────────
function bestOffensive(f: Fighter, e: Fighter | null, forceSig: boolean): number {
    // Pick the best READY offensive move — but HOARD the signature for a moment it will
    // land AND matter (the renderer spends its marquee cut-in on it): a wounded/opened
    // foe, a last-stand/kill-shot (forceSig), or simply nothing else ready. Dumping it
    // the instant it's off cooldown wastes it on whiffs and cheapens the beat.
    let sigIdx = -1, best = -1, bestScore = -1, nonSigReady = false;
    for (let i = 0; i < f.abilities.length; i++) {
        const a = f.abilities[i];
        if (a.cls === "support" || a.isMove || a.cdLeft > 0 || f.stamina < a.cost) continue;   // a "move" ability is a reposition, never an attack
        if (a.signature) { sigIdx = i; continue; }
        nonSigReady = true;
        const score = a.power + (a.cls === "ranged" ? 4 : 0);
        if (score > bestScore) { bestScore = score; best = i; }
    }
    if (sigIdx >= 0) {
        const foeFrac = e ? e.hp / e.maxHp : 1;
        const foeOpen = e ? (e.state === "recover" || e.state === "stagger") : false;
        if (forceSig || foeFrac < 0.5 || foeOpen || !nonSigReady) return sigIdx;
    }
    return best;
}
function readySupport(f: Fighter, fighters: Fighter[]): number {
    const ally = pickAlly(f, fighters);
    for (let i = 0; i < f.abilities.length; i++) {
        const a = f.abilities[i];
        if (a.cls !== "support" || a.cdLeft > 0 || f.stamina < a.cost) continue;
        const hasAlly = fighters.some((g) => g.team === f.team && g.id !== f.id && g.hp > 0);
        const healThresh = hasAlly ? 0.55 : 0.42;
        if (a.kind === "heal" && ally.hp / ally.maxHp < healThresh) return i;
        if ((a.kind === "buff" || a.kind === "haste") && f.statuses.buffLeft <= 0 && f.statuses.hasteLeft <= 0) return i;
        if ((a.kind === "shield" || a.kind === "barrier" || a.kind === "absorb") && ally.statuses.shieldHp <= 0 && ally.hp / ally.maxHp < 0.72) return i;
    }
    return -1;
}
function decide(f: Fighter, fighters: Fighter[], projectiles: Projectile[], rng: () => number, t: number, events: DuelEvent[]) {
    const e = pickTarget(f, fighters);
    f.targetId = e ? e.id : null;
    if (!e) { f.vx *= 0.8; f.vy *= 0.8; return; }
    const dx = e.x - f.x, dy = e.y - f.y;
    const d = Math.max(1e-4, Math.sqrt(dx * dx + dy * dy));
    const hpFrac = f.hp / f.maxHp;
    // DESPERATION last-stand — a wounded AGGRESSIVE fighter (rusher/brawler, an Aggressive/
    // Battleborn trait, or an endure/lifeline charge in the tank) stops fleeing and gathers
    // for one committed strike: the anime last-ditch attack that sometimes reverses a fight.
    // Kiters/supports still flee (preserves style-contrast).
    const desperate = hpFrac < CRIT_HP && (f.style.arche === "rusher" || f.style.arche === "brawler"
        || f.pet.trait === "Aggressive" || f.pet.trait === "Battleborn" || f.cEndure > 0 || f.cLifelinePct > 0);
    // KILL-SHOT — the foe is nearly dead: drop the in-out reposition beat and go finish it.
    const killShot = e.hp / e.maxHp < KILL_HP;

    // 1) SUPPORT — highest priority when it applies.
    const sup = readySupport(f, fighters);
    if (sup >= 0) { beginCast(f, sup, f.id, t, events); return; }

    // 2) ACTIVE DODGE — the enemy is winding up a blow aimed at me and I can still
    // move out of it. SPEED-gated: a fast pet reacts + clears; a slow one can't.
    // A last-stand does NOT dodge — it commits.
    if (!desperate && f.dodgeCd <= 0 && f.stamina >= COST_DODGE && f.statuses.rootLeft <= 0
        && e.state === "windup" && e.pendingTargetId === f.id && e.stateLeft >= 2) {
        const eAb = e.pendingIdx >= 0 ? e.abilities[e.pendingIdx] : null;
        const eRange = eAb ? eAb.range : e.reach + 0.6;
        if (d <= eRange + 1.2) {
            const chance = clamp(0.14 + (f.spd - e.spd) * 0.0022 + f.style.dodgeBias, 0.05, 0.85) * (1 - (_forcedEngage ? 1 : _stallPressure));
            if (rng() < chance) {   // rng() always drawn (order preserved); stall just lowers the threshold → no dodge
                // Sidestep perpendicular to the incoming line (away from arena edge).
                let px = -dy / d, py = dx / d;
                if (!walkableAt(f.x + px * 1.6, f.y + py * 1.6)) { px = -px; py = -py; }
                f.moveDx = px; f.moveDy = py; f.state = "dodge"; f.stateLeft = f.dodgeT;
                f.stamina -= COST_DODGE; f.dodgeCd = Math.round(DUEL_TPS * 0.9); f.vx = 0; f.vy = 0;
                events.push({ t, type: "dodge", side: f.team, actorId: f.id, move: "Evade" });
                return;
            }
        }
    }

    // 3) Choose the move I want + the range I want to fight at (R*). The signature is
    // hoarded unless the foe is low/open or this is a last-stand/kill-shot (forceSig).
    const offIdx = bestOffensive(f, e, desperate || killShot);
    const offAb = offIdx >= 0 ? f.abilities[offIdx] : null;
    const useRanged = offAb ? offAb.cls === "ranged" : f.basicRanged;
    const moveRange = offAb ? offAb.range : (f.basicRanged ? RANGED_RANGE * 0.85 : f.reach);
    // Desperation drops the retreat penalty and presses ALL-IN.
    const aggr = desperate ? 1 : clamp(f.style.aggression - (hpFrac < f.style.retreatHp ? 0.3 : 0), 0, 1);
    // R* — the distance to fight at. CRITICAL for ranged: it must sit INSIDE firing
    // range (even at the far edge of the ±BAND_H band) so a kiter's pokes always
    // connect instead of parking just out of reach and stalling. Cautious pets edge
    // toward max range; aggressive ones press inward.
    let rStar: number;
    if (useRanged) {
        rStar = clamp(moveRange - BAND_H - 0.4 + (0.5 - aggr) * 0.7, MELEE_RANGE + 0.5, moveRange - 0.4);
    } else {
        rStar = MELEE_RANGE * clamp(1.1 - aggr * 0.3, 0.85, 1.15);
    }

    // 4) PUNISH — the enemy just whiffed / is recovering: press the opening HARD
    // (ignores the reposition beat — you don't wait when the foe is wide open).
    const enemyOpen = e.state === "recover" || e.state === "stagger";
    // Post-attack REPOSITION beat: back out + circle before re-committing, so the
    // fight has an in-out cadence and the movement is visible (not a trade every tick).
    // A wide-open enemy (PUNISH) or an interrupt-ready control move overrides it.
    if (f.reposLeft > 0) f.reposLeft--;
    const holdRepos = f.reposLeft > 0 && !enemyOpen && !killShot && !desperate;   // finishing / last-stand ignores the in-out beat
    // 5) FIRE if a move is ready and the target is in range. Melee commits from up to
    // LUNGE_INIT away — the pounce (see stepFighter "dash") covers the gap, so attacks
    // read as leaps across the arena, not head-bashing. LoS is required for any commit
    // from beyond melee range (ranged shot or far dive) so nobody lunges through a wall.
    const meleeOff = offAb != null && offAb.cls !== "ranged";
    const commitRange = offAb == null ? 0 : meleeOff ? Math.max(offAb.range, f.style.lungeInit) : offAb.range;
    const losForCommit = d <= MELEE_RANGE + 0.6 ? true : hasLineOfSight(f.x, f.y, e.x, e.y);
    const canFire = !holdRepos && offAb != null && d <= commitRange && losForCommit && (f.faceX * dx + f.faceY * dy) > -0.2;
    if (canFire) { f.commit = 0; beginCast(f, offIdx, e.id, t, events); return; }
    // Basic attack — melee basics also lunge (commit from LUNGE_INIT); ranged basics poke.
    if (!holdRepos && f.basicCdLeft <= 0 && f.stamina >= COST_BASIC) {
        const basicRange = f.basicRanged ? RANGED_RANGE * 0.85 : Math.max(f.reach + 0.05, f.style.lungeInit);
        const basicLos = f.basicRanged ? hasLineOfSight(f.x, f.y, e.x, e.y) : losForCommit;
        if (d <= basicRange && basicLos && (f.faceX * dx + f.faceY * dy) > -0.2) { f.commit = 0; beginCast(f, -1, e.id, t, events); return; }
    }

    // (A dedicated "move"-ability reposition DASH was prototyped here but destabilized the
    // tuned archetype balance — brawlers collapsed, defenders dominated — so it was dropped.
    // The move ability is simply no longer fired as a junk 1-dmg poke, above; movement and
    // repositioning come from the context-steering + the per-archetype reposition beat.)

    // 6) Nothing to fire → position via context steering. Anti-stall backstop: if I
    // sit with a ready move but can't get a shot off for too long, force the exchange
    // (melee dashes in; ranged presses into guaranteed range). With the R* fix above
    // this rarely trips, but it guarantees fights never waltz to the cap.
    if (offAb || f.basicCdLeft <= 0) f.commit++; else f.commit = Math.max(0, f.commit - 1);
    if (f.commit > Math.round(DUEL_TPS * 2.5)) {
        if (!useRanged) {
            clearLunge(f);   // a plain commit-break dash is NOT a pounce — ensure the dash handler doesn't misread a stale lungeAbIdx
            f.moveDx = dx / d; f.moveDy = dy / d; f.state = "dash"; f.stateLeft = f.dashT; f.commit = 0;
            events.push({ t, type: "dash", side: f.team, actorId: f.id });
            return;
        }
        rStar = Math.min(rStar, moveRange * 0.55); f.commit = Math.round(DUEL_TPS * 1.2);   // press into range
    }
    if ((enemyOpen || killShot) && !useRanged && d > moveRange) rStar = Math.min(rStar, moveRange * 0.9);   // press the opening / go for the kill
    if (holdRepos) rStar += f.style.reposBack;   // reposition beat: back out by the archetype's amount (kiter dances far, defender holds ground) then circle back in — the in-out cadence
    // STALL BREAKER: collapse R* toward melee so a no-damage kiter stand-off is forced to close
    // and trade (the stronger stats then win). p=0 in normal fights → no effect.
    { const p = _forcedEngage ? 1 : _stallPressure; if (p > 0) rStar *= 1 - 0.9 * p; }
    // Route around terrain (BFS waypoint) when the direct line to the foe is blocked.
    let routeGoal: [number, number] | undefined;
    if (!hasLineOfSight(f.x, f.y, e.x, e.y)) {
        const nxt = bfsNextStep(cellCol(f.x), cellRow(f.y), cellCol(e.x), cellRow(e.y));
        if (nxt) routeGoal = cellCenter(nxt[0], nxt[1]);
    }
    steer(f, e, fighters, rStar, routeGoal);
}

// ── Per-fighter tick ─────────────────────────────────────────────────────────────
function tickStatuses(f: Fighter) {
    const s = f.statuses;
    if (f.itemsOn && f.cCleanse > 0 && (s.burnLeft > 0 || s.stunLeft > 0 || s.slowLeft > 0 || s.rootLeft > 0)) {
        s.burnLeft = 0; s.burnDmg = 0; s.halfHeal = false; s.stunLeft = 0; s.slowLeft = 0; s.rootLeft = 0; f.cCleanse = 0;
    }
    if (s.burnLeft > 0) { if (s.burnLeft % Math.round(DUEL_TPS * 0.4) === 0) f.hp -= s.burnDmg; if (--s.burnLeft <= 0) { s.burnDmg = 0; s.halfHeal = false; } }
    if (s.stunLeft > 0) s.stunLeft--;
    if (s.slowLeft > 0) s.slowLeft--;
    if (s.hasteLeft > 0) s.hasteLeft--;
    if (s.rootLeft > 0) s.rootLeft--;
    if (s.wallPenaltyLeft > 0) s.wallPenaltyLeft--;
    if (s.buffLeft > 0 && --s.buffLeft <= 0) s.buffMag = 0;
}
function stepFighter(f: Fighter, fighters: Fighter[], projectiles: Projectile[], nextProjId: { n: number }, rng: () => number, t: number, events: DuelEvent[], accuracyEnabled: boolean) {
    if (f.state === "dead" || f.hp <= 0) return;
    if (f.basicCdLeft > 0) f.basicCdLeft--;
    for (const ab of f.abilities) if (ab.cdLeft > 0) ab.cdLeft--;
    if (f.dodgeCd > 0) f.dodgeCd--;
    if (f.stamina < STAM_MAX) f.stamina = Math.min(STAM_MAX, f.stamina + STAM_REGEN);
    if (f.statuses.stunLeft > 0) {
        // Hard CC interrupts a pounce: convert the mid-air dive to a stagger so the pose
        // is right during the stun and the stale lunge can't resume aimed at a ghost.
        if (f.state === "dash" && f.lungeAbIdx > -2) { f.state = "stagger"; f.stateLeft = f.staggerT; clearLunge(f); }
        f.vx = 0; f.vy = 0; f.x = clamp(f.x, -ARENA_X, ARENA_X); f.y = clamp(f.y, -ARENA_Y, ARENA_Y); return;
    }
    switch (f.state) {
        case "idle": decide(f, fighters, projectiles, rng, t, events); break;
        case "dash": {
            if (f.lungeAbIdx > -2) {
                // THE POUNCE — a committed melee dive. Carry into the target and resolve
                // on contact; if the foe slips it (a dodge), overshoot → whiff → exposed.
                const ab = f.lungeAbIdx >= 0 ? f.abilities[f.lungeAbIdx] : null;
                const tgt = f.lungeTgtId ? fighters.find((g) => g.id === f.lungeTgtId && g.hp > 0) : null;
                if (tgt) {
                    const ddx = tgt.x - f.x, ddy = tgt.y - f.y, dd = Math.sqrt(ddx * ddx + ddy * ddy);
                    if (dd > 1e-4) {
                        // Tracking is per-archetype (rusher/brawler track you down; a glass
                        // kiter's stray melee slips), PLUS a speed floor: a pet clearly faster
                        // than its prey corrects onto it so its commitment isn't wasted vs a
                        // walker — but a real dodge (a fast perpendicular hop) still slips it.
                        const trackEff = clamp(f.style.lungeTrack + (f.spd - tgt.spd) * 0.0015, f.style.lungeTrack, 0.34);
                        const mx = f.moveDx * (1 - trackEff) + (ddx / dd) * trackEff;
                        const my = f.moveDy * (1 - trackEff) + (ddy / dd) * trackEff;
                        const ml = Math.max(1e-4, Math.sqrt(mx * mx + my * my));
                        f.moveDx = mx / ml; f.moveDy = my / ml; f.faceX = f.moveDx; f.faceY = f.moveDy;
                    }
                    if (dd <= (ab ? ab.range : f.reach) + 0.45) {
                        // CLASH — the target is ALSO mid-pounce aimed back at me: two committed
                        // dives collide. Deflect symmetrically (both bounce apart + stagger, no
                        // damage) — the iconic anime collision, a pure tension beat. Tagged
                        // move:"Clash" on the paired staggers so the renderer can punctuate it
                        // (frozen-contract-safe — DuelEvent.move already exists).
                        const engaging = _forcedEngage || _stallPressure >= 0.5;   // stall breaker: let mutual dives LAND (no deflect) so a stand-off resolves
                        if (!engaging && tgt.state === "dash" && tgt.lungeAbIdx > -2 && (tgt.faceX * (f.x - tgt.x) + tgt.faceY * (f.y - tgt.y)) > 0) {
                            const cdx = f.x - tgt.x, cdy = f.y - tgt.y, cdd = Math.max(1e-4, Math.sqrt(cdx * cdx + cdy * cdy));
                            const [fx2, fy2] = snapPos(f.x + (cdx / cdd) * CLASH_KB, f.y + (cdy / cdd) * CLASH_KB);
                            const [tx2, ty2] = snapPos(tgt.x - (cdx / cdd) * CLASH_KB, tgt.y - (cdy / cdd) * CLASH_KB);
                            f.x = fx2; f.y = fy2; tgt.x = tx2; tgt.y = ty2;
                            clearLunge(f); clearLunge(tgt);
                            f.state = "stagger"; f.stateLeft = f.staggerT;
                            tgt.state = "stagger"; tgt.stateLeft = tgt.staggerT;
                            events.push({ t, type: "stagger", side: f.team, actorId: f.id, move: "Clash", targetId: tgt.id });
                            events.push({ t, type: "stagger", side: tgt.team, actorId: tgt.id, move: "Clash", targetId: f.id });
                            break;
                        }
                        resolveMeleeContact(f, ab, f.lungeTgtId, fighters, rng, t, events, accuracyEnabled);
                        clearLunge(f); f.state = "strike"; f.stateLeft = 2; break;
                    }
                }
                const px0 = f.x, py0 = f.y;
                const [lx, ly] = tryStep(f.x + f.moveDx * f.maxSpeed * f.style.lungeMult, f.y + f.moveDy * f.maxSpeed * f.style.lungeMult, f.x, f.y);
                f.x = lx; f.y = ly;
                f.lungeStuck = (Math.abs(lx - px0) + Math.abs(ly - py0) < 0.02) ? f.lungeStuck + 1 : 0;
                if (f.lungeStuck >= 3) {
                    // A wall/solid is blocking the dive — resolve NOW instead of burning the
                    // whole timer into a phantom whiff + long recovery (terrain, not a dodge).
                    const bt = f.lungeTgtId ? fighters.find((g) => g.id === f.lungeTgtId && g.hp > 0) : null;
                    const bd = bt ? Math.sqrt((bt.x - f.x) * (bt.x - f.x) + (bt.y - f.y) * (bt.y - f.y)) : 1e9;
                    if (bt && bd <= (ab ? ab.range : f.reach) + 0.45) { resolveMeleeContact(f, ab, f.lungeTgtId, fighters, rng, t, events, accuracyEnabled); clearLunge(f); f.state = "strike"; f.stateLeft = 2; }
                    else { clearLunge(f); f.state = "recover"; f.stateLeft = Math.max(1, f.recovT); }   // short recover — no dodge happened
                    break;
                }
                if (--f.stateLeft <= 0) {
                    // Overshot without landing → whiff, into a long exposed recovery so the
                    // foe who dodged gets a clean counter-punch (the payoff for slipping it).
                    events.push({ t, type: "whiff", side: f.team, actorId: f.id });
                    // Whiff refund: a miss costs TEMPO, not the whole cooldown/stamina, so an
                    // aggressive melee pet keeps pressuring. Signatures are EXEMPT — refunding
                    // the marquee move let it be spammed-and-whiffed on a loop (Wave D gates it).
                    if (ab && !ab.signature) ab.cdLeft = Math.min(ab.cdLeft, Math.round(ab.cdTicks * 0.35));
                    else if (!ab) f.basicCdLeft = Math.min(f.basicCdLeft, Math.round(f.basicCdT * 0.35));
                    f.stamina = Math.min(STAM_MAX, f.stamina + (ab ? ab.cost : COST_BASIC) * 0.5);
                    clearLunge(f); f.state = "recover"; f.stateLeft = Math.max(1, f.recovT + 4);
                }
                break;
            }
            const [nx, ny] = tryStep(f.x + f.moveDx * f.maxSpeed * 3.0, f.y + f.moveDy * f.maxSpeed * 3.0, f.x, f.y); f.x = nx; f.y = ny; f.faceX = f.moveDx; f.faceY = f.moveDy; if (--f.stateLeft <= 0) f.state = "idle"; break;
        }
        case "dodge": { const [nx, ny] = tryStep(f.x + f.moveDx * f.maxSpeed * 2.7, f.y + f.moveDy * f.maxSpeed * 2.7, f.x, f.y); f.x = nx; f.y = ny; if (--f.stateLeft <= 0) f.state = "idle"; break; }
        case "windup": if (--f.stateLeft <= 0) {
            const wab = f.pendingIdx >= 0 ? f.abilities[f.pendingIdx] : null;
            const isMelee = wab ? wab.cls === "melee" : !f.basicRanged;
            if (isMelee) {
                payAbilityCost(f, wab);
                if (f.statuses.rootLeft > 0) {
                    // Rooted → can't dive; resolve the strike in place (planted attack).
                    resolveMeleeContact(f, wab, f.pendingTargetId, fighters, rng, t, events, accuracyEnabled);
                    f.state = "strike"; f.stateLeft = 2;
                } else {
                    // Windup done → LAUNCH the pounce. Aim at the target and hand off to the
                    // "dash" state which carries the dive into contact.
                    const tgt = f.pendingTargetId ? fighters.find((g) => g.id === f.pendingTargetId) : null;
                    if (tgt) { const ddx = tgt.x - f.x, ddy = tgt.y - f.y, dd = Math.max(1e-4, Math.sqrt(ddx * ddx + ddy * ddy)); f.moveDx = ddx / dd; f.moveDy = ddy / dd; f.faceX = ddx / dd; f.faceY = ddy / dd; }
                    f.lungeAbIdx = f.pendingIdx; f.lungeTgtId = f.pendingTargetId; f.lungeStuck = 0;
                    f.state = "dash"; f.stateLeft = f.style.lungeTicks; f.vx = 0; f.vy = 0;
                }
            } else {
                resolveCast(f, fighters, projectiles, nextProjId, rng, t, events, accuracyEnabled);
                f.state = "strike"; f.stateLeft = 1;
            }
        } break;
        case "strike": if (--f.stateLeft <= 0) { f.state = "recover"; f.stateLeft = Math.max(1, f.recovT); } break;
        case "recover": if (--f.stateLeft <= 0) { f.state = "idle"; f.reposLeft = Math.round(DUEL_TPS * f.style.reposDur); } break;   // reposition beat: per-archetype (rusher stays on you, kiter dances out) — the anime in-out cadence
        case "stagger": if (--f.stateLeft <= 0) f.state = "idle"; break;
    }
    f.x = clamp(f.x, -ARENA_X, ARENA_X); f.y = clamp(f.y, -ARENA_Y, ARENA_Y);
}
function tryStep(nx: number, ny: number, ox: number, oy: number): [number, number] {
    if (walkableAt(nx, ny)) return [nx, ny];
    if (walkableAt(nx, oy)) return [nx, oy];
    if (walkableAt(ox, ny)) return [ox, ny];
    return [ox, oy];
}
function separateAll(fighters: Fighter[]) {
    for (let i = 0; i < fighters.length; i++) for (let j = i + 1; j < fighters.length; j++) {
        const a = fighters[i], b = fighters[j];
        if (a.hp <= 0 || b.hp <= 0) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d >= MIN_SEP) continue;
        const push = (MIN_SEP - d) / 2;
        if (d > 1e-6) { const ux = dx / d, uy = dy / d; const [ax, ay] = snapPos(a.x - ux * push, a.y - uy * push); a.x = ax; a.y = ay; const [bx, by] = snapPos(b.x + ux * push, b.y + uy * push); b.x = bx; b.y = by; }
        else { a.x -= push; b.x += push; }
    }
}
function quantizeFighter(f: Fighter) {
    f.x = quant(f.x); f.y = quant(f.y); f.vx = quant(f.vx); f.vy = quant(f.vy);
    f.stamina = quant(f.stamina); f.faceX = quant(f.faceX); f.faceY = quant(f.faceY);
    f.statuses.shieldHp = quant(f.statuses.shieldHp);
}
function snap(t: number, fighters: Fighter[], projectiles: Projectile[]): DuelSnapshot {
    return {
        t,
        actors: fighters.map((f): DuelActorSnap => ({ id: f.id, team: f.team, slot: f.slot, x: f.x, y: f.y, faceX: f.faceX, faceY: f.faceY, hp: Math.max(0, f.hp), maxHp: f.maxHp, stamina: f.stamina, state: f.state, statuses: statusFlags(f.statuses) })),
        projectiles: projectiles.map((p): DuelProjSnap => ({ id: p.id, x: p.x, y: p.y, team: p.team, kind: p.kind, element: p.element })),
    };
}

// ── Core loop ──────────────────────────────────────────────────────────────────
function simulate(fighters: Fighter[], seed: number, accuracyEnabled: boolean): DuelResult {
    const rng = makeRng(seed);
    const projectiles: Projectile[] = [];
    const nextProjId = { n: 0 };
    const snapshots: DuelSnapshot[] = [];
    const events: DuelEvent[] = [];
    let ticks = 0;
    let winner: "player" | "enemy" | null = null;
    SIM_WALLS = [];   // reset barrier walls per run → deterministic (no carry-over between fights)
    _stallPressure = 0; _forcedEngage = false;
    let lastDmgTick = 0, prevTotalHp = 0;
    for (const f of fighters) prevTotalHp += Math.max(0, f.hp);
    for (const f of fighters) { const [sx, sy] = snapPos(f.x, f.y); f.x = sx; f.y = sy; }
    for (let t = 0; t < CAP_TICKS; t++) {
        ticks = t + 1;
        if (SIM_WALLS.length) SIM_WALLS = SIM_WALLS.filter((w) => w.expiry > t);   // expire finished walls
        // Stall pressure: how long since ANY damage landed → ramps to force a decisive exchange.
        _stallPressure = clamp(((t - lastDmgTick) / DUEL_TPS - STALL_START_SECS) / STALL_RAMP_SECS, 0, 1);
        if (_stallPressure >= 1) _forcedEngage = true;   // latch a confirmed stand-off → brawl to a result
        // Alternate the per-tick step order by tick parity so neither side keeps a
        // persistent "second-mover" reaction edge (which skews mirror matches). The
        // pet that steps second sees the first's fresh wind-up and can react-dodge —
        // alternating averages it to ~50%. Deterministic (tick parity, no rng).
        if ((t & 1) === 1) { for (let i = fighters.length - 1; i >= 0; i--) stepFighter(fighters[i], fighters, projectiles, nextProjId, rng, t, events, accuracyEnabled); }
        else { for (const f of fighters) stepFighter(f, fighters, projectiles, nextProjId, rng, t, events, accuracyEnabled); }
        stepProjectiles(fighters, projectiles, rng, t, events);
        for (const f of fighters) tickStatuses(f);
        separateAll(fighters);
        for (const f of fighters) {
            if (f.hp <= 0 && f.state !== "dead" && f.reviveLeft > 0) { f.reviveLeft -= 1; f.hp = Math.max(1, Math.round(f.maxHp * 0.4)); clearLunge(f); }
            if (f.hp <= 0 && f.state !== "dead") { f.state = "dead"; clearLunge(f); }
            const [sx, sy] = snapPos(f.x, f.y); f.x = sx; f.y = sy;
            quantizeFighter(f);
        }
        // Any damage this tick (a landed hit OR a DoT) resets the stall timer → pressure only
        // builds in a genuine no-damage stand-off.
        { let totalHp = 0; for (const f of fighters) totalHp += Math.max(0, f.hp); if (totalHp < prevTotalHp - 0.5) lastDmgTick = t; prevTotalHp = totalHp; }
        snapshots.push(snap(t, fighters, projectiles));
        const pA = teamAlive(fighters, "player"), eA = teamAlive(fighters, "enemy");
        if (!pA || !eA) { winner = pA && !eA ? "player" : eA && !pA ? "enemy" : null; events.push({ t, type: "ko", side: winner === "player" ? "enemy" : "player", actorId: "" }); break; }
    }
    if (winner === null && teamAlive(fighters, "player") && teamAlive(fighters, "enemy")) {
        const frac = (team: "player" | "enemy") => { let hp = 0, max = 0; for (const f of fighters) if (f.team === team) { hp += Math.max(0, f.hp); max += f.maxHp; } return max > 0 ? hp / max : 0; };
        const pf = frac("player"), ef = frac("enemy");
        winner = Math.abs(pf - ef) < 1e-6 ? null : pf > ef ? "player" : "enemy";
    }
    const result: DuelResult["result"] = winner === "player" ? "win" : winner === "enemy" ? "loss" : "draw";
    return { result, winner, ticks, snapshots, events };
}

// ── Public entry points (drop-in for the casual coliseum call sites) ──────────────
/** 1v1 cinematic coliseum duel — result from the player pet's perspective.
 *  Deterministic in (pets, seed). Items ON by default so equipped gear/consumables
 *  matter (casual reward stays server-capped + keyed only off the result string). */
export function runPetDuelCinematic(
    playerPet: Pet, enemyPet: Pet, seed: number,
    playerDamageMult = 1, playerHpMult = 1, playerReviveOnce = false,
    applyItems = true, accuracyEnabled = petAccuracyEnabled(), terrain: string | null = null,
): DuelResult {
    const fighters = [
        buildFighter(playerPet, "player", 0, -5.6, 2.6, enemyPet.element, playerDamageMult * terrainPetMult(terrain, playerPet.element), playerHpMult, playerReviveOnce, applyItems),
        buildFighter(enemyPet, "enemy", 0, 5.6, 2.6, playerPet.element, terrainPetMult(terrain, enemyPet.element), 1, false, applyItems),
    ];
    return simulate(fighters, seed, accuracyEnabled);
}
/** 2v2 cinematic coliseum duel — player lead+reserve vs enemy lead+reserve. */
export function runPetPartyDuelCinematic(
    playerLead: Pet, playerReserve: Pet | null,
    enemyLead: Pet, enemyReserve: Pet | null,
    seed: number, playerDamageMult = 1, playerHpMult = 1, playerReviveOnce = false,
    applyItems = true, accuracyEnabled = petAccuracyEnabled(),
): DuelResult {
    const fighters: Fighter[] = [buildFighter(playerLead, "player", 0, -5.6, 2.6, enemyLead.element, playerDamageMult, playerHpMult, playerReviveOnce, applyItems)];
    if (playerReserve) fighters.push(buildFighter(playerReserve, "player", 1, -5.0, -3.2, enemyReserve?.element ?? enemyLead.element, playerDamageMult, playerHpMult, false, applyItems));
    fighters.push(buildFighter(enemyLead, "enemy", 0, 5.6, 2.6, playerLead.element, 1, 1, false, applyItems));
    if (enemyReserve) fighters.push(buildFighter(enemyReserve, "enemy", 1, 5.0, -3.2, playerReserve?.element ?? playerLead.element, 1, 1, false, applyItems));
    return simulate(fighters, seed, accuracyEnabled);
}
/** The fighting archetype the engine assigns a pet — exported for the balance harness
 *  so per-archetype win-rate is measured from the SAME classifier the sim uses. */
export function petCinematicArchetype(pet: Pet): Archetype {
    return classifyArchetype(pet, petCinematicAbilities(pet));
}
