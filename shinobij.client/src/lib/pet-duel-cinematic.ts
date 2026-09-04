// ─────────────────────────────────────────────────────────────────────────────
// pet-duel-cinematic.ts — the REDESIGNED pet-coliseum combat engine.
//
// Owner mandate: the coliseum must feel like a modern creature-battler /
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
import { WALK_COLS, WALK_ROWS } from "./pet-arena-walkmask";
import { petAccuracyEnabled } from "./pet-coliseum-flag";
import {
    applyPetPvpGear, petConsumableCharges, petGearStartShield, petGearExecuteMult,
    petGearLastStandMult, petGearDotOnHit, petGearLifestealHeal,
    PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT,
} from "../data/pet-config";
import {
    DUEL_TPS, ARENA_X, ARENA_Y, elementMult, terrainPetMult, KIND_ACCURACY,
    type DuelResult, type DuelSnapshot, type DuelActorSnap, type DuelProjSnap, type DuelObjectiveSnap,
    type DuelEvent, type DuelState, type DuelAiState, type DuelPerfectRole,
} from "./pet-duel-sim";

// ── Tunables (own copies; balance numbers mirror the shipped engine so outcomes
//    stay in the current bands — only the POSITIONING around them is new) ───────
const CAP_TICKS = DUEL_TPS * 75;             // one complete cinematic fight, decided by one KO
// Restore the original single-life durability budget. The failed three-life
// experiment reduced each bar to 0.95x base HP; one life needs the full 3x bar so
// the movement, power-up and ultimate phases all have time to develop.
const TTK_HP = 3.0;
const LATE_T = DUEL_TPS * 34;                // final act: preserve the full bar, but prevent defensive score decisions
const LATE_RAMP = DUEL_TPS * 7;
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
/** Live-only tactical resource. A full meter buys one guaranteed technique call. */
export const DUEL_COMMAND_FULL = 420;
const DUEL_COMMAND_START = 60;
const DUEL_COMMAND_HIT_GAIN = 45;
const DUEL_COMMAND_HURT_GAIN = 26;
const DUEL_COMMAND_DODGE_GAIN = 65;
const CRIT_CHANCE = 0.12;
const DMG_SCALE = 1.5;
const TARGET_LOCK_TICKS = Math.round(DUEL_TPS * 1.4);
const PARTY_TARGET_LOCK_TICKS = Math.round(DUEL_TPS * 6);
/** A Warfront order is a squad decision, not a per-frame nearest-enemy query.
 * Five seconds is long enough for the audience to understand an assignment;
 * death/taunt still invalidate it immediately. */
const WARFRONT_ORDER_LOCK_TICKS = Math.round(DUEL_TPS * 5.2);
const BASIC_REACH = 1.2;                     // melee contact distance (basic attack)
// Creature bodies are substantially wider than a hit point. Keep their simulation
// centres far enough apart that a melee contact reads as a collision, not two meshes
// occupying the same space while they trade attacks.
const MIN_SEP = BASIC_REACH * 2.0;
const MELEE_RANGE = 1.6;
const SUPPORT_CAST_CLEARANCE = 6.2;
// Full reset beats create screen-space for a new engagement, but are intentionally
// periodic rather than mandatory after every attack.
const DUEL_REPOSITION_RANGE = 4.6;
const PARTY_REPOSITION_RANGE = 4.1;
const PARTY_ALLY_SEPARATION = 4.4;
const DUEL_ROUTE_CADENCE = 3;
const PARTY_ROUTE_CADENCE = 2;
// The labyrinth makes exits meaningful cover choices. One reset every two
// exchanges keeps the action travelling without turning the match into jogging.
const WARFRONT_ROUTE_CADENCE = 2;
/** Beastbound Warfront is a compact formation board. Movement is cell-authoritative:
 * these dimensions are presentation bounds, never a free-physics play space. */
export const WARFRONT_ARENA_X = 11.4;
export const WARFRONT_ARENA_Y = 7.2;
export const WARFRONT_GRID_COLS = 7;
export const WARFRONT_GRID_ROWS = 5;
export const WARFRONT_CELL_X = 3.2;
export const WARFRONT_CELL_Y = 3.0;
export const WARFRONT_SIGIL_RADIUS = 2.75;
/** Legacy replay constants retained so older non-Kage transcripts still load. */
export const WARFRONT_RELIC_HOME_X = 26;
export const WARFRONT_RELIC_HOME_Y = 0;
export const WARFRONT_RELIC_PICKUP_RADIUS = 2.15;
export const WARFRONT_RELIC_CAPTURE_RADIUS = 2.35;
export const WARFRONT_RELIC_TAG_RADIUS = 3.35;
const WARFRONT_RELIC_TAG_GRACE_TICKS = Math.round(DUEL_TPS * 1.65);
const WARFRONT_SEAL_CAPTURE_TICKS = Math.round(DUEL_TPS * 2.4);
/** Legacy objective coordinates retained for old replay deserialization only. */
export const WARFRONT_OBJECTIVE_Y = Object.freeze([-10.5, 0, 10.5] as const);
/** Legacy objective coordinates retained for old replay deserialization only. */
export const WARFRONT_SEAL_POSITIONS = Object.freeze([
    { id: "seal-veil", x: 0, y: -10.5 },
    { id: "seal-tide", x: -11, y: 0 },
    { id: "seal-cinder", x: 11, y: 0 },
] as const);
/** Player-side fallback posts for pre-formation saved replays. */
export const WARFRONT_POSTS = Object.freeze([
    [9.6, 0], [6.4, -3], [6.4, 3], [9.6, 6],
] as const);
/** Ten legal formation cells on each side: two ranks by five files. Any pet can
 * take any cell; the kit it brings, not a placement restriction, determines how
 * that choice plays. */
export const WARFRONT_DEPLOYMENT_NODES = Object.freeze([
    [9.6, -6], [6.4, -6],
    [9.6, -3], [6.4, -3],
    [9.6, 0], [6.4, 0],
    [9.6, 3], [6.4, 3],
    [9.6, 6], [6.4, 6],
] as const);
/** Roster-indexed fallback used by legacy replays which pre-date free deploy. */
export const WARFRONT_DEFAULT_DEPLOYMENT = Object.freeze([3, 4, 7, 8] as const);
export const WARFRONT_ANCHOR_SLOT = 3;
/** Beastbound Warfront has no invisible collision. These shoji cells are shared by the
 * simulation, renderer and deployment legend. */
export const WARFRONT_WARD_Y = Object.freeze([] as const);
export type WarfrontMazeWall = Readonly<{ x: number; y: number; halfX: number; halfY: number; variant: number }>;
export const WARFRONT_MAZE_WALLS: readonly WarfrontMazeWall[] = Object.freeze([
    Object.freeze({ x: 0, y: -3, halfX: 1.18, halfY: 0.38, variant: 0 }),
    Object.freeze({ x: 0, y: 3, halfX: 1.18, halfY: 0.38, variant: 1 }),
]);
const WARFRONT_COVER_NODES = Object.freeze(WARFRONT_MAZE_WALLS.map((wall) => Object.freeze({
    x: wall.x,
    y: wall.y,
    // Route destinations sit off the nearest long edge. Collision and
    // projectile tests still use the authoritative rectangle above.
    radius: Math.max(wall.halfX, wall.halfY),
})));
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
// ── LIVE-COLISEUM BRAWL PROFILE ────────────────────────────────────────────────
// Multipliers applied by applyLiveBrawlProfile() to melee-identity fighters on the
// PLAYER-CONTROLLED path only (see that function for the measurements behind them).
// runPetDuelCinematic never touches these, so ranked / ladder / sector-war outcomes
// and the parity test stay byte-identical.
const LIVE_BRAWL_LUNGE_TICKS = 1.55;   // dive duration — the whiffs were timer expiries
const LIVE_BRAWL_LUNGE_SPEED = 1.18;   // dive speed
const LIVE_BRAWL_LUNGE_TRACK = 0.3;    // per-tick re-aim floor (a real dodge still slips it)
const LIVE_BRAWL_REPOS_BACK = 0.62;    // shorter post-exchange break-off — stay in the pocket
const LIVE_BRAWL_REPOS_DUR = 0.8;      // …and get back to it sooner
const BRAWL_GRAZE = 0.6;               // extra reach a timed-out dive gets when the target did not dodge

// ── CLASH — the committed-dive collision that stops the fight dead ─────────────
// Two fighters meet in a bind, the duel FREEZES, and the player calls the read:
// Strike / Guard / Dodge. It is a rock-paper-scissors triangle, so the answer is a
// prediction rather than a reflex, and the payoff is a momentum swing — the winner
// gets a free heavy blow and the loser eats an extended stagger.
//
//   Guard  beats Strike  — brace, and the diver bounces off it
//   Strike beats Dodge   — they try to slip the bind, you follow through
//   Dodge  beats Guard   — they turtle up, you take the angle for free
//
// Budgeted to stay PUNCTUATION (the owner asked for 1–2 a fight), not a QTE loop.
// Live-coliseum only: the trigger is gated on `f.brawl`, which no authoritative
// caller ever sets, so ranked / ladder / sector-war stay byte-identical.
const CLASH_MAX_PER_DUEL = 2;
const CLASH_MIN_TICK = Math.round(DUEL_TPS * 6);     // let the fight establish itself first
const CLASH_COOLDOWN = Math.round(DUEL_TPS * 11);    // spacing between binds
const CLASH_CHANCE = 0.85;                           // roll at an eligible dive contact
const CLASH_WINDOW = Math.round(DUEL_TPS * 1.6);     // ticks the bind holds while awaiting a call
/** The bind's length in ticks, exported so the lockstep controller can prove its
 *  input delay fits inside it — a scheduled PvP call that lands after the window
 *  has closed is simply refused, which is safe but silently costs a player their
 *  read. See the budget assertion in pet-duel-lockstep.ts. */
export const CLASH_WINDOW_TICKS = CLASH_WINDOW;
const CLASH_MIN_HP = 0.22;                           // never bind a pet that is about to die
const CLASH_WIN_POWER = 165;                         // the winner's payoff blow
const CLASH_LOSER_STAGGER = Math.round(DUEL_TPS * 1.15);

/** Strike 0 · Guard 1 · Dodge 2 — the call each side makes inside a bind. */
export const CLASH_PICKS = ["strike", "guard", "dodge"] as const;
export type ClashPick = 0 | 1 | 2;
/** Guard→Strike→Dodge→Guard. True when `x` beats `y`. */
const clashBeats = (x: number, y: number) =>
    (x === 1 && y === 0) || (x === 0 && y === 2) || (x === 2 && y === 1);

/** A live bind: two fighters locked together, waiting on their calls. */
export interface ClashBind {
    aId: string;            // the diving attacker
    bId: string;            // the fighter it collided with
    startT: number;
    until: number;          // tick the bind resolves on regardless of input
    picks: Record<string, number>;
}

/** A well-mixed roll in [0,1) for ONE fighter's clash read.
 *
 *  Why this exists instead of two plain rng() calls: the engine's generator is a
 *  plain LCG, and consecutive draws off an LCG sit on a lattice. Comparing two
 *  back-to-back draws through a rock-paper-scissors table is exactly the case that
 *  structure breaks — measured over 1182 binds with dives split dead even (591/591),
 *  it still handed one side 60.8% of the clash wins. Hashing a single shared salt
 *  together with each fighter's own id decorrelates the two rolls, so the outcome is
 *  the fair 1/3 it is supposed to be. Integer-only and deterministic. */
function clashRoll(salt: number, id: string, t: number): number {
    let h = (salt ^ 0x9e3779b9) >>> 0;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (t + 0x165667b1), 0xc2b2ae35) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2545f491) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

/** The AI's call. Deterministic and readable as personality: a bloodied pet braces,
 *  a glass kiter slips out, a heavy brawler swings through. */
function clashAiPick(f: Fighter, r: number): ClashPick {
    if (f.hp / f.maxHp < 0.4) return r < 0.5 ? 1 : r < 0.8 ? 2 : 0;
    switch (f.style.arche) {
        case "rusher": return r < 0.55 ? 0 : r < 0.85 ? 2 : 1;
        case "brawler": return r < 0.6 ? 0 : r < 0.8 ? 1 : 2;
        case "defender": return r < 0.55 ? 1 : r < 0.8 ? 0 : 2;
        case "kiter": case "support": return r < 0.5 ? 2 : r < 0.8 ? 1 : 0;
        default: return r < 0.4 ? 0 : r < 0.7 ? 1 : 2;
    }
}

/** The synthetic heavy blow the clash winner lands. Not a real ability: it costs
 *  nothing, has no cooldown, and never enters an ability slot. */
const CLASH_PAYOFF: Ability = Object.freeze({
    name: "Clash Break", kind: "damage" as PetJutsu["kind"], accuracy: 100, cls: "melee" as AbilityClass,
    power: CLASH_WIN_POWER, signature: false, aoe: false, range: MELEE_RANGE,
    castTicks: 0, cdTicks: 0, cdLeft: 0, cost: 0, isMove: false,
});
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
const EDGE_RETURN_BIAS = 0.24; // only pull inward at the actual boundary; the outer lanes belong to the fight
const DANGER_ENEMY = 0.6;    // enemy threat bubble
const DANGER_TELE = 1.0;     // telegraphed incoming attack
const DANGER_WALL = 0.85;    // arena edge / solid tiles
const DANGER_BUBBLE = 0.45;  // don't drift into melee during neutral (ranged)

// ── Walkability grid (own copy of the pet-duel-sim helpers; position-based so they
//    work with this engine's own fighter struct). Symmetrized L↔R for fairness. ──
const GCOLS = WALK_COLS, GROWS = WALK_ROWS;
const DUEL_CELL_X = (ARENA_X * 2) / GCOLS;
const DUEL_CELL_Y = (ARENA_Y * 2) / GROWS;
const activeArenaX = () => _warfrontMode ? WARFRONT_ARENA_X : ARENA_X;
const activeArenaY = () => _warfrontMode ? WARFRONT_ARENA_Y : ARENA_Y;
const activeCellX = () => (activeArenaX() * 2) / GCOLS;
const activeCellY = () => (activeArenaY() * 2) / GROWS;
const cellCol = (x: number) => clamp(Math.floor((x + activeArenaX()) / activeCellX()), 0, GCOLS - 1);
const cellRow = (y: number) => clamp(Math.floor((y + activeArenaY()) / activeCellY()), 0, GROWS - 1);
const cellCenter = (c: number, r: number): [number, number] => [(c + 0.5) * activeCellX() - activeArenaX(), (r + 0.5) * activeCellY() - activeArenaY()];
// Cinematic battles happen on the visible OPEN coliseum floor. The old tactics-
// diorama mask created invisible corridors that did not match this arena and
// could be sealed by a visible prop. Keep only a soft octagonal boundary here.
const arenaFloorCell = (c: number, r: number): boolean => {
    if (c < 0 || r < 0 || c >= GCOLS || r >= GROWS) return false;
    const [x, y] = cellCenter(c, r), ax = Math.abs(x), ay = Math.abs(y);
    const halfX = activeArenaX(), halfY = activeArenaY();
    return ax <= halfX - 0.35 && ay <= halfY - 0.35 && !(ax > halfX - 2.1 && ay > halfY - 1.65);
};
/** The cinematic 1v1 floor stays physically open. Earlier permanent pylons
 * became things pets stood on rather than readable tactical choices. Temporary
 * ability-created walls still participate in navigation and line of sight. */
export const DUEL_COVER_NODES: readonly Readonly<{ x: number; y: number; radius: number; variant: number }>[] = Object.freeze([]);
const DUEL_COVER_MASK = (() => {
    const blocked = new Uint8Array(GCOLS * GROWS);
    for (let r = 0; r < GROWS; r++) for (let c = 0; c < GCOLS; c++) {
        // This mask belongs to the unchanged duel floor and is constructed at
        // module load, before any simulation profile is active.
        const cx = (c + 0.5) * DUEL_CELL_X - ARENA_X, cy = (r + 0.5) * DUEL_CELL_Y - ARENA_Y;
        for (const cover of DUEL_COVER_NODES) {
            const dx = cx - cover.x, dy = cy - cover.y;
            if (dx * dx + dy * dy < cover.radius * cover.radius) { blocked[r * GCOLS + c] = 1; break; }
        }
    }
    return blocked;
})();
// Independent arena destinations. Repositioning runs to these coordinates—not
// to another point on a circle around the opponent—so exchanges use the whole
// floor: corner-to-corner crossings, cover wraps, retreats and re-entries.
const ROUTE_ANCHORS: readonly (readonly [number, number])[] = [
    [-10.8, -4.9], [-10.4, 4.9], [-5.4, 6.0], [2.8, 6.0],
    [10.5, 4.8], [10.8, -4.8], [5.5, -5.9], [-3.8, -5.9],
];
/** Three persistent Warfront routes, each with its own left/right reset marks. */
const WARFRONT_ROUTE_ANCHORS: readonly (readonly [number, number])[] = [
    [-16, 7], [-8, 7], [8, 7], [16, 7],
    [-16, 0], [-8, 0], [8, 0], [16, 0],
    [-16, -7], [-8, -7], [8, -7], [16, -7],
];
const activeRouteAnchors = () => _warfrontMode ? WARFRONT_ROUTE_ANCHORS : ROUTE_ANCHORS;
// BARRIER EARTH WALLS — temporary solid obstacles a barrier cast raises between the two
// fighters. Blocks movement AND line-of-sight (hasLineOfSight samples walkableAt), so
// neither can attack through it for a beat — they buff/heal or path around. Module-level
// + reset each simulate() run → fully deterministic (barriers cast at deterministic ticks).
let SIM_WALLS: { x: number; y: number; r: number; expiry: number; ownerId: string }[] = [];
// Stall-breaker state (reset per simulate() run, like SIM_WALLS → deterministic, no carry-over).
let _stallPressure = 0;    // 0 in every fight where damage lands; ramps only in a true no-damage stand-off
let _forcedEngage = false; // latched once a stand-off is confirmed → a decisive brawl to the finish
let _partyMode = false;
// A 2v2 still uses the compact party profile. Only a true squad clash (normally
// four a side) receives the larger Warfront topology and reservation layer.
let _warfrontMode = false;
let _warfrontAssignments = new Map<string, string>();
type WarfrontRelicState = DuelObjectiveSnap;
let _warfrontRelics: WarfrontRelicState[] = [];
/** Warfront routing asks for the same next grid step for many consecutive
 * simulation ticks. Cache those static-grid answers; Earth walls invalidate the
 * cache through their cell signature, so correctness remains unchanged. */
const _warfrontPathCache = new Map<number, [number, number] | null>();
let _warfrontPathWallSignature = "";
// Live-coliseum CLASH scratch. Mirrored to/from CinematicDuelState every tick like
// the wall/stall globals, so a paused duel can never be corrupted by another one
// simulating in between (a preview harness, the server replay).
let _clash: ClashBind | null = null;
let _clashCount = 0;
let _lastClashTick = -CLASH_COOLDOWN;
let _clashOn = true;
// One team owns neutral pressure at a time. The other team may still read a
// telegraph, dodge, and punish recovery, but it does not mirror the attacker's
// locomotion. This turns a continuous mutual chase into authored-looking beats:
// pressure → evade/impact → exit → counter-pressure.
let _cinematicInitiativeTeam: "player" | "enemy" = "player";
type LaneInitiative = [
    "player" | "enemy", "player" | "enemy",
    "player" | "enemy", "player" | "enemy",
];
let _laneInitiativeTeam: LaneInitiative = ["player", "enemy", "enemy", "player"];
const laneIndex = (slot: number) => clamp(Math.round(slot), 0, 3);
const WALL_TICKS = Math.round(DUEL_TPS * 0.85);   // how long a wall BLOCKS (short → a beat, not a big defensive advantage)
const WALL_PENALTY_TICKS = Math.round(DUEL_TPS * 3.0);   // caster's damage halved this long after raising a wall (the wall's cost)
const cellBlockedByWall = (c: number, r: number): boolean => {
    if (SIM_WALLS.length === 0) return false;
    const [cx, cy] = cellCenter(c, r);
    for (const w of SIM_WALLS) { const dx = cx - w.x, dy = cy - w.y; if (dx * dx + dy * dy < w.r * w.r) return true; }
    return false;
};
const cellBlockedByArenaCover = (c: number, r: number): boolean => DUEL_COVER_MASK[r * GCOLS + c] === 1;
const warfrontMazeAt = (x: number, y: number, padding = 0): boolean => {
    if (!_warfrontMode) return false;
    for (const wall of WARFRONT_MAZE_WALLS) {
        if (Math.abs(x - wall.x) <= wall.halfX + padding
            && Math.abs(y - wall.y) <= wall.halfY + padding) return true;
    }
    return false;
};
const cellBlockedByWarfrontMaze = (c: number, r: number, padding = 0.65): boolean => {
    const [x, y] = cellCenter(c, r);
    return warfrontMazeAt(x, y, padding);
};
const cellBlockedByWarfrontSigil = (c: number, r: number): boolean => {
    if (!_warfrontMode) return false;
    const [x, y] = cellCenter(c, r);
    for (const wardY of WARFRONT_WARD_Y) {
        const dy = y - wardY;
        if (x * x + dy * dy < WARFRONT_SIGIL_RADIUS * WARFRONT_SIGIL_RADIUS) return true;
    }
    return false;
};
const cellWalkable = (c: number, r: number) =>
    arenaFloorCell(c, r)
    && !cellBlockedByArenaCover(c, r) && !cellBlockedByWall(c, r)
    && !cellBlockedByWarfrontMaze(c, r) && !cellBlockedByWarfrontSigil(c, r);
function walkableAt(x: number, y: number): boolean {
    const halfX = activeArenaX(), halfY = activeArenaY();
    if (x < -halfX || x > halfX || y < -halfY || y > halfY) return false;
    return cellWalkable(cellCol(x), cellRow(y));
}
function sightWalkableAt(x: number, y: number): boolean {
    const halfX = activeArenaX(), halfY = activeArenaY();
    if (x < -halfX || x > halfX || y < -halfY || y > halfY) return false;
    const c = cellCol(x), r = cellRow(y);
    // Warfront ruins and centre seals are waist-high movement islands. Shots arc
    // over them; only tall duel cover and temporary Earth walls break sight.
    return arenaFloorCell(c, r) && !cellBlockedByArenaCover(c, r) && !cellBlockedByWall(c, r);
}
function arenaCoverAt(x: number, y: number, padding = 0): boolean {
    for (const cover of DUEL_COVER_NODES) {
        const dx = x - cover.x, dy = y - cover.y, radius = cover.radius + padding;
        if (dx * dx + dy * dy <= radius * radius) return true;
    }
    return false;
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
    const steps = Math.ceil(d / (activeCellX() * 0.6));
    for (let i = 1; i < steps; i++) {
        const tt = i / steps;
        if (!sightWalkableAt(ax + dx * tt, ay + dy * tt)) return false;
    }
    return true;
}
function hasWalkableRoute(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax, dy = by - ay;
    const d = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(d / (Math.max(activeCellX(), activeCellY()) * 1.35)));
    for (let i = 1; i <= steps; i++) {
        const tt = i / steps;
        if (!walkableAt(ax + dx * tt, ay + dy * tt)) return false;
    }
    return true;
}
function segmentCrossesMazeWall(
    ax: number, ay: number, bx: number, by: number,
    wall: (typeof WARFRONT_MAZE_WALLS)[number],
): boolean {
    const dx = bx - ax, dy = by - ay;
    // Match cellWalkable's body-centre clearance. Testing only the visible stone
    // rectangle misses a pet whose centre line skims the cap while its collision
    // radius is still blocked, so no corner route is ever issued.
    const bodyClearance = 0.7;
    let lo = 0, hi = 1;
    const axes: readonly (readonly [number, number, number, number])[] = [
        [ax, dx, wall.x - wall.halfX - bodyClearance, wall.x + wall.halfX + bodyClearance],
        [ay, dy, wall.y - wall.halfY - bodyClearance, wall.y + wall.halfY + bodyClearance],
    ];
    for (const [origin, delta, min, max] of axes) {
        if (Math.abs(delta) < 1e-6) {
            if (origin < min || origin > max) return false;
            continue;
        }
        let enter = (min - origin) / delta;
        let exit = (max - origin) / delta;
        if (enter > exit) [enter, exit] = [exit, enter];
        lo = Math.max(lo, enter);
        hi = Math.min(hi, exit);
        if (lo > hi) return false;
    }
    return hi >= 0 && lo <= 1;
}

/** Route to a visible outer corner of the first ruin blocking this sightline.
 * A committed corner is a better maze move than recomputing adjacent grid cells
 * every tick: it clears the whole silhouette pad, reads as a deliberate flank,
 * and hands ordinary steering a clean line on the other side. */
function warfrontMazeDetour(f: Fighter, e: Fighter): [number, number] | null {
    if (!_warfrontMode) return null;
    const ax = f.x, ay = f.y, bx = e.x, by = e.y;
    const preferredY = warfrontCellAnchor(f, e)[1];
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    let bestCanonicalTie = Infinity;
    for (const wall of WARFRONT_MAZE_WALLS) {
        if (!segmentCrossesMazeWall(ax, ay, bx, by, wall)) continue;
        const clearX = wall.halfX + 1.05;
        const clearY = wall.halfY + 1.05;
        const corners: readonly (readonly [number, number])[] = [
            [wall.x - clearX, wall.y - clearY],
            [wall.x - clearX, wall.y + clearY],
            [wall.x + clearX, wall.y - clearY],
            [wall.x + clearX, wall.y + clearY],
        ];
        for (const corner of corners) {
            const candidate = snapPos(corner[0], corner[1]);
            if (!hasWalkableRoute(ax, ay, candidate[0], candidate[1])) continue;
            const first = Math.hypot(candidate[0] - ax, candidate[1] - ay);
            if (first < 0.55) continue;
            const second = Math.hypot(bx - candidate[0], by - candidate[1]);
            const clearsTargetSide = hasWalkableRoute(candidate[0], candidate[1], bx, by);
            // Detours remain inside this assignment's authored battle cell. Two
            // pressure partners may share an edge; the screen's other skirmish
            // does not choose the same globally-shortest corner and create a knot.
            const score = first + second + Math.abs(candidate[1] - preferredY) * 0.82
                + (clearsTargetSide ? 0 : 6);
            // Resolve equal corners in team space, not world space. Negating both
            // enemy axes makes a mirrored red state select the 180-degree mirror
            // of blue instead of giving one seat the globally first array entry.
            const teamSign = f.team === "player" ? 1 : -1;
            const canonicalTie = (candidate[0] * teamSign + WARFRONT_ARENA_X) * 100
                + candidate[1] * teamSign + WARFRONT_ARENA_Y;
            if (score < bestScore - 1e-8 || (Math.abs(score - bestScore) <= 1e-8 && canonicalTie < bestCanonicalTie)) {
                bestScore = score;
                bestCanonicalTie = canonicalTie;
                best = candidate;
            }
        }
    }
    return best;
}
// BFS pathfinding (copied from pet-duel-sim) — context steering handles LOCAL
// avoidance but can't route around a large solid; when line-of-sight to the foe
// is blocked, we seek the BFS next-cell waypoint instead (global route), then let
// the steering take over once the two can see each other.
const BFS_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const BFS_DIRS_MIRRORED = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
const BFS_CELL_COUNT = GCOLS * GROWS;
const BFS_QUEUE = new Int32Array(BFS_CELL_COUNT);
const BFS_CAME = new Int32Array(BFS_CELL_COUNT);
const BFS_VISIT = new Uint32Array(BFS_CELL_COUNT);
const BFS_DEPTH = new Uint16Array(BFS_CELL_COUNT);
let BFS_GENERATION = 0;
const bfsPriority = (node: number, tc: number, tr: number): number => {
    const nc = node % GCOLS, nr = (node - nc) / GCOLS;
    const dx = Math.abs(tc - nc), dy = Math.abs(tr - nr);
    return Math.max(dx, dy) + Math.min(dx, dy) * 0.4142 + BFS_DEPTH[node] * 0.08;
};
const bfsCanonicalId = (node: number, mirrored: boolean): number => {
    if (!mirrored) return node;
    const c = node % GCOLS, r = (node - c) / GCOLS;
    return (GROWS - 1 - r) * GCOLS + (GCOLS - 1 - c);
};
const bfsHeapLess = (a: number, b: number, tc: number, tr: number, mirrored: boolean): boolean => {
    const ap = bfsPriority(a, tc, tr), bp = bfsPriority(b, tc, tr);
    return ap < bp || (ap === bp && bfsCanonicalId(a, mirrored) < bfsCanonicalId(b, mirrored));
};
function legacyBfsNextStep(fc: number, fr: number, tc: number, tr: number): [number, number] | null {
    const came = new Map<number, number>();
    const start = tr * GCOLS + tc;
    came.set(start, -1);
    const queue = [start]; let head = 0;
    while (head < queue.length) {
        const cur = queue[head++];
        const cc = cur % GCOLS, cr = (cur - cc) / GCOLS;
        if (cc === fc && cr === fr) {
            const next = came.get(cur);
            return next === undefined || next < 0 ? null : [next % GCOLS, (next - (next % GCOLS)) / GCOLS];
        }
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
function bfsNextStep(fc: number, fr: number, tc: number, tr: number, team?: Fighter["team"]): [number, number] | null {
    if (fc === tc && fr === tr) return null;
    // Ranked duels and the live Coliseum retain their byte-identical route
    // search. Only a true 4v4 Warfront clash uses the mobile-oriented planner.
    if (!_warfrontMode) return legacyBfsNextStep(fc, fr, tc, tr);
    const wallSignature = SIM_WALLS
        .map((wall) => `${Math.round(wall.x * Q)},${Math.round(wall.y * Q)},${Math.round(wall.r * Q)}`)
        .sort()
        .join("|");
    if (wallSignature !== _warfrontPathWallSignature) {
        _warfrontPathWallSignature = wallSignature;
        _warfrontPathCache.clear();
    }
    const mirrored = team === "enemy";
    const cacheKey = ((fr * GCOLS + fc) * BFS_CELL_COUNT + (tr * GCOLS + tc)) * 2 + (mirrored ? 1 : 0);
    if (_warfrontPathCache.has(cacheKey)) return _warfrontPathCache.get(cacheKey) ?? null;
    const start = fr * GCOLS + fc;
    const goal = tr * GCOLS + tc;
    // This used to allocate a Map plus thousands of boxed entries for every
    // breadth-first request, and the wave explored most of the arena even though
    // Warfront routes are broad and mostly open. A generation-stamped,
    // heuristic frontier stays aimed at the destination and allocates nothing.
    BFS_GENERATION = (BFS_GENERATION + 1) >>> 0;
    if (BFS_GENERATION === 0) { BFS_VISIT.fill(0); BFS_GENERATION = 1; }
    const generation = BFS_GENERATION;
    BFS_VISIT[start] = generation;
    BFS_CAME[start] = -1;
    BFS_DEPTH[start] = 0;
    BFS_QUEUE[0] = start;
    let frontier = 1;
    while (frontier > 0) {
        // Real maze walls make the frontier wide. The former linear best-node
        // scan became O(n²) and turned route planning into visible frame stalls.
        // This typed-array binary heap keeps the same deterministic priority and
        // tie-break without allocating objects or scanning the whole frontier.
        const cur = BFS_QUEUE[0];
        const last = BFS_QUEUE[--frontier];
        if (frontier > 0) {
            let at = 0;
            while (true) {
                const left = at * 2 + 1;
                if (left >= frontier) break;
                const right = left + 1;
                let child = left;
                if (right < frontier && bfsHeapLess(BFS_QUEUE[right], BFS_QUEUE[left], tc, tr, mirrored)) child = right;
                if (!bfsHeapLess(BFS_QUEUE[child], last, tc, tr, mirrored)) break;
                BFS_QUEUE[at] = BFS_QUEUE[child];
                at = child;
            }
            BFS_QUEUE[at] = last;
        }
        const cc = cur % GCOLS, cr = (cur - cc) / GCOLS;
        if (cur === goal) {
            let next = cur;
            while (BFS_CAME[next] >= 0 && BFS_CAME[next] !== start) next = BFS_CAME[next];
            const answer: [number, number] | null = next === start ? null : [next % GCOLS, (next - (next % GCOLS)) / GCOLS];
            _warfrontPathCache.set(cacheKey, answer);
            return answer;
        }
        const directions = mirrored ? BFS_DIRS_MIRRORED : BFS_DIRS;
        for (const [dc, dr] of directions) {
            const nc = cc + dc, nr = cr + dr;
            if (!cellWalkable(nc, nr)) continue;
            if (dc !== 0 && dr !== 0 && (!cellWalkable(cc + dc, cr) || !cellWalkable(cc, cr + dr))) continue;
            const ni = nr * GCOLS + nc;
            if (BFS_VISIT[ni] !== generation) {
                BFS_VISIT[ni] = generation;
                BFS_CAME[ni] = cur;
                BFS_DEPTH[ni] = BFS_DEPTH[cur] + 1;
                let at = frontier++;
                while (at > 0) {
                    const parent = (at - 1) >> 1;
                    const parentNode = BFS_QUEUE[parent];
                    if (!bfsHeapLess(ni, parentNode, tc, tr, mirrored)) break;
                    BFS_QUEUE[at] = parentNode;
                    at = parent;
                }
                BFS_QUEUE[at] = ni;
            }
        }
    }
    _warfrontPathCache.set(cacheKey, null);
    return null;
}

/** Deterministic LCG — same constants as the shipped engine.
 *  The cursor lives in an EXTERNAL cell (RngState) rather than a closure so the
 *  live/player-controlled path can checkpoint and rewind it (see pet-duel-live.ts).
 *  The arithmetic is unchanged, so every existing caller draws the same stream. */
export interface RngState { s: number }
function makeRngFrom(state: RngState): () => number {
    return () => { state.s = (Math.imul(state.s, 1664525) + 1013904223) >>> 0; return state.s / 4294967296; };
}
function newRngState(seed: number): RngState {
    return { s: (Math.max(1, Math.floor(seed)) >>> 0) || 1 };
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
const COUNTER_KINDS = new Set<PetJutsu["kind"]>(["stun", "freeze", "confuse", "movelock", "slow", "debuff", "crush", "push", "pull", "mark", "taunt"]);
export function duelPerfectRoleForMove(move: Pick<PetJutsu, "kind">): DuelPerfectRole {
    if (move.kind === "move") return "shift";
    if (abilityClass(move.kind) === "support") return "rally";
    if (COUNTER_KINDS.has(move.kind)) return "counter";
    return "punish";
}

function buildAbility(j: PetJutsu): Ability {
    const cls = abilityClass(j.kind);
    const base = Math.max(Math.round(DUEL_TPS * 0.8), Math.round((j.cooldown || 0) * 1.2 * DUEL_TPS));
    return {
        name: j.name, kind: j.kind, accuracy: KIND_ACCURACY[j.kind] ?? 100, cls, isMove: j.kind === "move",
        power: Math.max(1, j.power || 1), signature: !!j.signature, aoe: !!j.aoe,
        range: cls === "support" ? 999 : cls === "ranged" ? RANGED_RANGE : MELEE_RANGE,
        castTicks: Math.max(4, Math.round(DUEL_TPS * (j.signature ? 0.34 : cls === "support" ? 0.21 : 0.2))),
        cdTicks: base + (j.signature ? Math.round(DUEL_TPS * 1.5) : 0),
        cdLeft: j.signature
            ? Math.round(DUEL_TPS * 2.5)
            : (j.kind === "buff" || j.kind === "haste")
                // Comes online just after the first attack tell. A mobile pet can
                // evade that read and convert it into dodge -> retreat -> power-up;
                // it is not available for an unearned frame-zero opening buff.
                ? Math.round(DUEL_TPS * 0.36)
                : Math.round(DUEL_TPS * 0.5),
        cost: j.kind === "move" ? 6 : j.signature ? 40 : cls === "support" ? 16 : 22,
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
    if (rounds && rounds > 0) return Math.round(DUEL_TPS * rounds * 0.8);
    // Setup statuses must survive the reposition/cooldown beat long enough for
    // their owner (or an ally) to create a deliberate payoff, not expire while
    // both pets are still leaving the first exchange.
    const setup = ab.kind === "burn" || ab.kind === "dot" || ab.kind === "wound" || ab.kind === "mark" || ab.kind === "slow";
    return Math.round(DUEL_TPS * (setup ? 2.6 : 1.0) * (ab.signature ? 1.4 : 1));
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
    rangeBias: number;      // elemental preferred-range adjustment
    speedMult: number;      // elemental movement identity
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

/** Neutral-game identity in data, separate from individual move scripts. */
export const CINEMATIC_ELEMENT_PROFILES = Object.freeze({
    Fire:      { aggression: 0.09, retreat: -0.02, dodge: 0.00, rangeBias: -0.20, speedMult: 1.02 },
    Water:     { aggression: -0.03, retreat: 0.03, dodge: 0.04, rangeBias: 0.35, speedMult: 0.98 },
    Lightning: { aggression: 0.06, retreat: 0.00, dodge: 0.08, rangeBias: -0.10, speedMult: 1.12 },
    Earth:     { aggression: -0.04, retreat: -0.04, dodge: 0.00, rangeBias: 0.10, speedMult: 0.90 },
    Wind:      { aggression: 0.00, retreat: 0.02, dodge: 0.10, rangeBias: 0.55, speedMult: 1.10 },
    None:      { aggression: 0.00, retreat: 0.00, dodge: 0.00, rangeBias: 0.00, speedMult: 1.00 },
});
function elementProfile(element?: string | null) {
    const key = String(element ?? "None").toLowerCase();
    if (key === "fire") return CINEMATIC_ELEMENT_PROFILES.Fire;
    if (key === "water") return CINEMATIC_ELEMENT_PROFILES.Water;
    if (key === "lightning") return CINEMATIC_ELEMENT_PROFILES.Lightning;
    if (key === "earth") return CINEMATIC_ELEMENT_PROFILES.Earth;
    if (key === "wind") return CINEMATIC_ELEMENT_PROFILES.Wind;
    return CINEMATIC_ELEMENT_PROFILES.None;
}

// ── Fighter ────────────────────────────────────────────────────────────────────
type RouteIntent = "cover" | "flank" | "retreat" | "cross";

interface Fighter {
    id: string; team: "player" | "enemy"; slot: number; pet: Pet; element?: string | null;
    x: number; y: number; vx: number; vy: number; faceX: number; faceY: number;
    homeX: number; homeY: number;               // stable tactical post; unused by 1v1
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
    orbitDir: -1 | 1;                       // stable lane choice; opponents use the same LOCAL turn so they split to opposite world-space flanks
    reposManeuverUsed: boolean;             // at most one named traversal skill per exchange exit
    maneuverLeft: number;                   // curved traversal beat; intentionally not the attack/pounce dash state
    maneuverTotal: number;
    maneuverGoalX: number; maneuverGoalY: number; // crossfield destination—never an opponent-centric orbit
    guardLeft: number;                      // brief planted read after a traversal pivot
    spacingBeat: number;                    // cycles through close/mid/wide destinations instead of one permanent radius
    spacingOffset: number;
    routeX: number; routeY: number; routeActive: boolean; // independent post-exchange arena destination
    routeStuck: number;                      // blocked route ticks; Warfront aborts instead of freezing against maze clearance
    routeIntent: RouteIntent;                 // why this lane was chosen; drives cover-side vs flank-side routing
    exchangesSinceRoute: number;              // full-floor resets are punctuation, not every attack
    supportResetDone: boolean;                 // one showcase exit per fighter; later support beats stay compact
    postDodgeSupport: boolean;                // dodge -> retreat lane -> planted self-buff chain
    supportCastLocked: boolean;               // one setup cast must be converted into a landed offensive exchange before another
    commit: number;                         // anti-stall: rises while in-band with a ready move but not firing
    targetId: string | null; targetLockLeft: number;
    aiState: DuelAiState; desiredRange: number; aiPlan: string; aiReason: string;
    itemsOn: boolean;
    cDodge: number; cMitigatePct: number; cEndure: number; cThornsPct: number; cLifelinePct: number; cCleanse: number;
    basicRanged: boolean;
    /** Live-coliseum brawl profile is active on this fighter (applyLiveBrawlProfile).
     *  false for every authoritative caller, which is what keeps ranked byte-identical. */
    brawl: boolean;
    /** The call this fighter has made inside an active clash bind: -1 none yet,
     *  else a ClashPick. Reset when a bind opens. */
    clashPick: number;
    lungeAbIdx: number;                     // >-2 while mid-pounce: which move resolves on contact (-1 = basic attack)
    lungeTgtId: string | null;
    lungeStuck: number;                     // consecutive pounce ticks with ~no progress (wall) → resolve early, don't phantom-whiff
    // ── PLAYER CONTROL (docs/pet-coliseum-player-control-plan.md) ──────────────
    // All four are inert unless `controlled` is true, and `controlled` is only ever
    // set by the live/commanded path (pet-duel-live.ts). Every existing entry point
    // leaves them at these defaults, so runPetDuelCinematic stays byte-identical and
    // the server mirror / ladder / sector-war outcomes are untouched.
    controlled: boolean;                    // this fighter accepts player commands
    cmdIdx: number;                         // ordered move: >=0 ability index, -1 basic, -2 none
    cmdLeft: number;                        // ticks the order stays queued before it lapses
    cmdBreak: boolean;                      // Bond Break pending — unleash the signature now
    cmdTechnique: boolean;                  // earned command-window call; owns the next combat beat
    perfectRole: DuelPerfectRole | null;    // authoritative payoff carried from the call to contact
    perfectEvadeLeft: number;               // Shift's brief invulnerable reposition window
    perfectDamageBoost: boolean;            // Shift empowers the next landed attack
    commandCharge: number;                  // 0..DUEL_COMMAND_FULL, live path only
    stance: number;                         // 0 aggressive · 1 balanced · 2 guarded
}

/** Stance knobs — the zero-APM strategic dial. Balanced (1) is exactly the shipped
 *  AI behaviour, so an uncontrolled or un-dialled fighter fights as it always has. */
const STANCES: readonly { aggression: number; retreatHp: number; dodgeBias: number }[] = [
    { aggression: 0.28, retreatHp: -0.10, dodgeBias: -0.04 },   // 0 aggressive — press, commit, ignore the retreat threshold
    { aggression: 0.00, retreatHp: 0.00, dodgeBias: 0.00 },     // 1 balanced   — the shipped brain, unchanged
    { aggression: -0.26, retreatHp: 0.12, dodgeBias: 0.10 },    // 2 guarded    — hold range, read telegraphs, disengage early
];
const stanceOf = (f: Fighter) => STANCES[f.controlled ? clamp(Math.round(f.stance), 0, 2) : 1];

// Classify a pet into a fighting ARCHETYPE from its DECLARED role/sub-role (the old
// engine ignored these — the headroom), falling back to stat/moveset shape. Standalone
// + exported (petCinematicArchetype) so the balance harness buckets from ONE source.
function classifyArchetype(pet: Pet, abilities: Ability[]): Archetype {
    const attack = Math.max(0, pet.attack || 0), defense = Math.max(0, pet.defense || 0), speed = Math.max(0, pet.speed || 0);
    const hasRanged = abilities.some((a) => a.cls === "ranged" && !a.isMove);
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
    rusher:   { li: 5.2, lm: 4.8, lt: 0.16, lk: 18, tm: 1.20, wm: 0.80, rm: 0.85, rd: 1.00, rb: 4.8 },
    // brawler = a RELENTLESS body-check: lumbering turn + big committed dives that track
    // you down (high lt), but NORMAL attack tempo (slowing its wind/recover tanked its DPS).
    brawler:  { li: 4.4, lm: 3.4, lt: 0.28, lk: 20, tm: 0.82, wm: 1.00, rm: 1.05, rd: 1.05, rb: 4.6 },
    kiter:    { li: 3.4, lm: 3.6, lt: 0.12, lk: 14, tm: 1.10, wm: 1.00, rm: 1.00, rd: 1.10, rb: 4.8 },
    defender: { li: 2.8, lm: 3.2, lt: 0.18, lk: 12, tm: 0.85, wm: 1.10, rm: 1.00, rd: 1.00, rb: 4.4 },
    support:  { li: 3.0, lm: 3.4, lt: 0.14, lk: 14, tm: 1.00, wm: 1.00, rm: 1.00, rd: 1.45, rb: 6.2 },
    balanced: { li: 4.0, lm: 3.5, lt: 0.14, lk: 16, tm: 1.00, wm: 1.00, rm: 1.00, rd: 1.10, rb: 4.8 },
};
function deriveStyle(pet: Pet, abilities: Ability[], oppElement: string | null | undefined, itemsOn: boolean): Style {
    const trait = pet.trait;
    const hasRanged = abilities.some((a) => a.cls === "ranged" && !a.isMove);
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
    if (trait === "Hollowborn") aggression = clamp(aggression + 0.12, 0, 1);
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
    const ep = elementProfile(pet.element);
    aggression = clamp(aggression + ep.aggression, 0, 1);
    retreatHp = clamp(retreatHp + ep.retreat, 0.08, 0.75);
    dodgeBias += ep.dodge;
    if (String(pet.element ?? "").toLowerCase() === "wind") orbitStrong = true;
    return {
        arche, rangedPref, aggression, retreatHp, dodgeBias, orbitStrong, rangeBias: ep.rangeBias, speedMult: ep.speedMult,
        lungeInit: m.li, lungeMult: m.lm, lungeTrack: m.lt, lungeTicks: m.lk,
        turnMult: m.tm, windMult: m.wm, recovMult: m.rm, reposDur: m.rd, reposBack: m.rb,
    };
}

/**
 * Shrine-exclusive combat rules shared by fighter construction and hit
 * resolution. Keeping the package explicit prevents the cinematic Coliseum
 * from drifting away from the tactical and legacy duel engines.
 */
export function petCinematicTraitCombat(trait: Pet["trait"]): {
    critBonus: number;
    dodgeChance: number;
    damageMult: number;
    drainPct: number;
    immuneFreezeConfuse: boolean;
} {
    if (trait === "Fateweaver") {
        return { critBonus: 0.16, dodgeChance: 0.18, damageMult: 1, drainPct: 0, immuneFreezeConfuse: true };
    }
    if (trait === "Hollowborn") {
        return { critBonus: 0.16, dodgeChance: 0, damageMult: 1.12, drainPct: 0.12, immuneFreezeConfuse: false };
    }
    return { critBonus: 0, dodgeChance: 0, damageMult: 1, drainPct: 0, immuneFreezeConfuse: false };
}

function buildFighter(pet: Pet, team: "player" | "enemy", slot: number, x: number, y: number, oppElement: string | null | undefined, atkMult: number, hpMult: number, reviveOnce: boolean, applyItems: boolean): Fighter {
    const gp = applyItems ? applyPetPvpGear(pet) : pet;
    const speed = Math.max(0, gp.speed || 0);
    const maxHp = Math.max(1, Math.round((gp.hp || 1) * hpMult * TTK_HP));
    const baseMoveSpeed = clamp(4.35 + speed * 0.035, 4.35, 9.4) / DUEL_TPS;
    const abilities = petCinematicAbilities(gp);
    const sigAb = abilities.find((a) => a.signature);
    if (sigAb) { sigAb.cdTicks = Math.max(sigAb.cdTicks, Math.round(DUEL_TPS * 9)); sigAb.cdLeft = Math.round(DUEL_TPS * 4.5); }
    const style = deriveStyle(gp, abilities, oppElement, applyItems);
    const moveSpeed = baseMoveSpeed * style.speedMult;   // brisk anime traversal with element identity, units/tick
    const statuses = emptyStatuses();
    const ch = applyItems ? petConsumableCharges(gp) : null;
    if (applyItems) statuses.shieldHp = petGearStartShield(gp);
    return {
        id: `${team}-${slot}`, team, slot, pet: gp, element: gp.element,
        x, y, vx: 0, vy: 0, faceX: team === "player" ? 1 : -1, faceY: 0,
        homeX: x, homeY: y,
        hp: maxHp, maxHp, reviveLeft: reviveOnce ? 1 : 0,
        atk: Math.max(0, (gp.attack || 0) * atkMult), def: Math.max(0, gp.defense || 0), spd: speed,
        maxSpeed: moveSpeed, maxForce: moveSpeed * 0.34 * style.turnMult,   // agile vs lumbering
        stamina: STAM_MAX, reach: BASIC_REACH,
        state: "idle", stateLeft: 0, pendingIdx: -2, pendingTargetId: null,
        basicCdLeft: 0, basicCdT: Math.round(DUEL_TPS * 0.5),
        windT: Math.max(2, Math.round(DUEL_TPS * clamp(0.42 - speed * 0.0012, 0.16, 0.42) * style.windMult)),     // snappy vs telegraphed
        recovT: Math.max(2, Math.round(DUEL_TPS * clamp(0.46 - speed * 0.0010, 0.20, 0.46) * style.recovMult)),   // relentless vs long punish window
        staggerT: Math.round(DUEL_TPS * 0.35), dashT: 7, dodgeT: 6,
        critChance: CRIT_CHANCE + (gp.trait === "Lucky" ? 0.1 : 0) + petCinematicTraitCombat(gp.trait).critBonus,
        style, abilities, statuses,
        moveDx: 0, moveDy: 0, dodgeCd: 0, reposLeft: 0,
        orbitDir: (slot & 1) === 0 ? 1 : -1, reposManeuverUsed: false,
        maneuverLeft: 0, maneuverTotal: 0, maneuverGoalX: x, maneuverGoalY: y, guardLeft: 0,
        spacingBeat: team === "player" ? 0 : 2, spacingOffset: 0,
        routeX: x, routeY: y, routeActive: false, routeStuck: 0, routeIntent: "cross", postDodgeSupport: false,
        exchangesSinceRoute: 0,
        supportResetDone: false,
        supportCastLocked: false,
        commit: 0, targetId: null, targetLockLeft: 0,
        aiState: "hold position", desiredRange: 0, aiPlan: "size up", aiReason: "opening evaluation",
        itemsOn: applyItems,
        cDodge: ch ? ch.dodge : 0, cMitigatePct: ch ? ch.mitigate : 0, cEndure: ch ? ch.endure : 0,
        cThornsPct: ch ? ch.thorns : 0, cLifelinePct: ch ? ch.lifeline : 0, cCleanse: ch ? ch.cleanse : 0,
        basicRanged: abilities.some((a) => a.cls === "ranged" && !a.isMove),
        brawl: false, clashPick: -1,
        lungeAbIdx: -2, lungeTgtId: null, lungeStuck: 0,
        // Player control defaults OFF — every existing caller gets the shipped AI.
        controlled: false, cmdIdx: -2, cmdLeft: 0, cmdBreak: false,
        cmdTechnique: false, perfectRole: null, perfectEvadeLeft: 0, perfectDamageBoost: false,
        commandCharge: DUEL_COMMAND_START, stance: 1,
    };
}

// ── Projectiles ─────────────────────────────────────────────────────────────────
interface Projectile { id: number; ownerId: string; team: "player" | "enemy"; targetId: string; abilityIdx: number; x: number; y: number; speed: number; ttl: number; element?: string | null; kind: PetJutsu["kind"]; perfectRole?: DuelPerfectRole; }

// ── Targeting ────────────────────────────────────────────────────────────────────
type WarfrontRole = "raider" | "escort" | "guardian";
/** Placement, not species, assigns the job. The closest post to midfield raids;
 * the deepest living post guards; everyone between escorts. */
function warfrontRoleMap(fighters: Fighter[], team: Fighter["team"]): Map<string, WarfrontRole> {
    const ordered = fighters.filter((fighter) => fighter.team === team && fighter.hp > 0).sort((a, b) => (
        Math.abs(a.homeX) - Math.abs(b.homeX)
        || a.slot - b.slot
        || a.id.localeCompare(b.id)
    ));
    const roles = new Map<string, WarfrontRole>();
    ordered.forEach((fighter, index) => roles.set(
        fighter.id,
        index === 0 ? "raider" : index === ordered.length - 1 ? "guardian" : "escort",
    ));
    return roles;
}

const nearestFighter = (origin: Fighter, candidates: Fighter[]): Fighter | null => [...candidates].sort((a, b) => (
    Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y)
    || a.slot - b.slot
    || a.id.localeCompare(b.id)
))[0] ?? null;

const warfrontSeals = () => _warfrontRelics.filter((objective) => objective.kind === "seal");
const warfrontScroll = () => _warfrontRelics.find((objective) => objective.kind === "scroll") ?? null;

/** Placement chooses a route, while the formation depth chooses who travels
 * together. Raider + Escort overload the Raider's court; Guardian opens the
 * opposite court and then rotates. That yields 2v2 pressure and rotations, not
 * three permanently paired 1v1 lanes. */
function preferredWarfrontSeal(f: Fighter, fighters: Fighter[]): WarfrontRelicState | null {
    const open = warfrontSeals().filter((seal) => seal.owner !== f.team);
    if (!open.length) return null;
    const allies = fighters.filter((ally) => ally.team === f.team && ally.hp > 0);
    const roles = warfrontRoleMap(fighters, f.team);
    const raider = allies.find((ally) => roles.get(ally.id) === "raider") ?? allies[0] ?? f;
    const homeId = f.team === "player" ? "seal-tide" : "seal-cinder";
    const preferredId = roles.get(f.id) === "guardian" || raider.homeY < -4
        ? "seal-veil"
        : homeId;
    return [...open].sort((a, b) => (
        (a.id === preferredId ? -1 : 0) - (b.id === preferredId ? -1 : 0)
        || Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y)
        || a.id.localeCompare(b.id)
    ))[0] ?? null;
}

/** Combat assignments now support the relay: screen a friendly carrier or tag
 * the opposing one. Before the vault opens, only rivals contesting the same
 * seal become targets, so pets do not cross the board merely to find a fight. */
function buildWarfrontAssignments(fighters: Fighter[]): Map<string, string> {
    const assignments = new Map<string, string>();
    const blue = fighters.filter((fighter) => fighter.team === "player" && fighter.hp > 0);
    const red = fighters.filter((fighter) => fighter.team === "enemy" && fighter.hp > 0);
    if (!blue.length || !red.length) return assignments;
    const scroll = warfrontScroll();
    const carrier = scroll?.carrierId ? fighters.find((fighter) => fighter.id === scroll.carrierId) ?? null : null;
    const assignTeam = (allies: Fighter[], enemies: Fighter[]) => {
        const reservations = new Map<string, number>();
        for (const fighter of allies) {
            let candidates = enemies;
            if (carrier) {
                candidates = carrier.team !== fighter.team
                    ? [carrier]
                    : enemies.filter((enemy) => Math.hypot(enemy.x - carrier.x, enemy.y - carrier.y) <= 9.5);
            } else if (scroll?.state === "sealed") {
                const seal = preferredWarfrontSeal(fighter, fighters);
                candidates = seal
                    ? enemies.filter((enemy) => Math.hypot(enemy.x - seal.x, enemy.y - seal.y) <= WARFRONT_SIGIL_RADIUS + 3.5)
                    : enemies;
            }
            let target = nearestFighter(fighter, candidates.length ? candidates : enemies);
            if (target && (reservations.get(target.id) ?? 0) >= 2) {
                target = nearestFighter(fighter, enemies.filter((enemy) => (reservations.get(enemy.id) ?? 0) < 2));
            }
            if (target) {
                assignments.set(fighter.id, target.id);
                reservations.set(target.id, (reservations.get(target.id) ?? 0) + 1);
            }
        }
    };
    assignTeam(blue, red);
    assignTeam(red, blue);
    return assignments;
}

function pickTarget(f: Fighter, fighters: Fighter[]): Fighter | null {
    if (f.statuses.tauntById) {
        const t = fighters.find((g) => g.id === f.statuses.tauntById && g.hp > 0);
        if (t) { f.targetId = t.id; f.targetLockLeft = TARGET_LOCK_TICKS; return t; }
    }
    // 2v2 reads best as two stable lanes, not four solo brains repeatedly choosing
    // whichever transient recover/stagger score happens to be lowest this tick.
    // Hold the opposite slot until it is eliminated; only then collapse into the
    // remaining lane. Taunts above remain the explicit authored override.
    if (_partyMode && !_warfrontMode) {
        const laneTarget = fighters.find((g) => g.team !== f.team && g.slot === f.slot && g.hp > 0);
        if (laneTarget) {
            f.targetId = laneTarget.id;
            f.targetLockLeft = PARTY_TARGET_LOCK_TICKS;
            return laneTarget;
        }
    }
    if (_warfrontMode) {
        let assigned = fighters.find((candidate) => candidate.id === _warfrontAssignments.get(f.id) && candidate.hp > 0) ?? null;
        // A knockout may occur midway through the alternating fighter step. The
        // next actor should collapse immediately rather than spending one tick on
        // the now-dead order computed at the start of this frame.
        if (!assigned) {
            _warfrontAssignments = buildWarfrontAssignments(fighters);
            assigned = fighters.find((candidate) => candidate.id === _warfrontAssignments.get(f.id) && candidate.hp > 0) ?? null;
        }
        if (assigned) {
            if (assigned.id !== f.targetId) {
                f.targetId = assigned.id;
                f.targetLockLeft = WARFRONT_ORDER_LOCK_TICKS;
            }
            return assigned;
        }
    }
    const locked = f.targetId ? fighters.find((g) => g.id === f.targetId && g.team !== f.team && g.hp > 0) : null;
    if (locked && f.targetLockLeft > 0) return locked;
    let best: Fighter | null = null, bestKey = Infinity;
    for (const g of fighters) {
        if (g.team === f.team || g.hp <= 0) continue;
        const dx = g.x - f.x, dy = g.y - f.y;
        const distance = Math.hypot(dx, dy), hpFrac = g.hp / g.maxHp;
        const attackingAlly = (g.pendingTargetId != null && fighters.some((ally) => ally.team === f.team && ally.id === g.pendingTargetId))
            || (g.lungeTgtId != null && fighters.some((ally) => ally.team === f.team && ally.id === g.lungeTgtId));
        const open = g.state === "recover" || g.state === "stagger";
        let key = distance * 0.08 + hpFrac * 0.55;
        if (f.style.arche === "rusher") key = distance * 0.045 + hpFrac * 1.2 - (open ? 0.65 : 0);
        else if (f.style.arche === "defender") key = distance * 0.13 + hpFrac * 0.25 - (attackingAlly ? 0.85 : 0);
        else if (f.style.arche === "support") key = distance * 0.1 + hpFrac * 0.35 - (attackingAlly ? 0.65 : 0);
        else if (f.style.arche === "kiter") key = distance * 0.06 + hpFrac * 0.75 - (open ? 0.25 : 0);
        if (g.slot === f.slot) key -= 0.16;
        if (g.id === f.targetId) key -= 0.22;
        const matchup = elementMult(f.element, g.element);
        if (matchup > 1) key -= 0.12;
        else if (matchup < 1) key += 0.08;
        if (key < bestKey || (key === bestKey && best && g.id < best.id)) { bestKey = key; best = g; }
    }
    if (best && best.id !== f.targetId) {
        f.targetId = best.id;
        f.targetLockLeft = TARGET_LOCK_TICKS;
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

function setIntent(f: Fighter, state: DuelAiState, desiredRange: number, plan: string, reason: string) {
    f.aiState = state;
    f.desiredRange = quant(Math.max(0, desiredRange));
    f.aiPlan = plan;
    f.aiReason = reason;
}

// ── Damage (verbatim-equivalent to pet-duel-sim.applyDamage → balance-neutral) ───
function elementalPayoff(att: Fighter, tgt: Fighter): { mult: number; combo?: string } {
    const el = String(att.element ?? "").toLowerCase();
    if (el === "fire") {
        if (tgt.statuses.burnLeft > 0) return { mult: 1.12, combo: "Inferno Pressure" };
        if (tgt.statuses.rootLeft > 0 || tgt.statuses.slowLeft > 0) return { mult: 1.08, combo: "Ignition Trap" };
    }
    if (el === "water" && (tgt.statuses.slowLeft > 0 || tgt.statuses.stunLeft > 0)) return { mult: 1.08, combo: "Undertow Punish" };
    if (el === "lightning") {
        if (tgt.statuses.marked) return { mult: 1, combo: "Charged Burst" };
        if (tgt.statuses.slowLeft > 0 || tgt.statuses.stunLeft > 0) return { mult: 1.18, combo: "Conductive Surge" };
    }
    if (el === "earth" && (att.statuses.shieldHp > 0 || att.statuses.wallPenaltyLeft > 0)) return { mult: 1.08, combo: "Fortified Counter" };
    if (el === "wind") {
        if (tgt.statuses.burnLeft > 0) return { mult: 1.10, combo: "Firestorm Chain" };
        if (tgt.statuses.rootLeft > 0 || tgt.statuses.slowLeft > 0) return { mult: 1.10, combo: "Gale Extension" };
    }
    return { mult: 1 };
}

function applyDamage(att: Fighter, tgt: Fighter, ab: Ability | null, rng: () => number, t: number, events: DuelEvent[], viaProjectile: boolean, perfectRole?: DuelPerfectRole) {
    if (tgt.hp <= 0) return;
    const critRoll = rng();
    const crit = perfectRole === "punish" || critRoll < att.critChance;
    if (tgt.perfectEvadeLeft > 0) {
        events.push({ t, type: "dodge", side: tgt.team, actorId: tgt.id, targetId: att.id, perfect: "shift", verdict: "PHASE SHIFT" });
        return;
    }
    if (!perfectRole && tgt.itemsOn && tgt.cDodge > 0) { tgt.cDodge -= 1; events.push({ t, type: "dodge", side: tgt.team, actorId: tgt.id }); return; }
    const targetTrait = petCinematicTraitCombat(tgt.pet.trait);
    if (!perfectRole && targetTrait.dodgeChance > 0 && rng() < targetTrait.dodgeChance) {
        events.push({ t, type: "dodge", side: tgt.team, actorId: tgt.id, targetId: att.id });
        return;
    }
    const attackerTrait = petCinematicTraitCombat(att.pet.trait);
    const powerScale = ab ? ab.power / 100 : 1;
    const buff = att.statuses.buffLeft > 0 ? 1 + att.statuses.buffMag : 1;
    const matchup = elementMult(att.element, tgt.element);
    // Cinematic fights make the type story legible: the advantaged pet presses
    // harder and its clean openings matter, while resisted hits feel resisted.
    const matchupRead = matchup > 1 ? 1.45 : matchup < 1 ? 0.55 : 1;
    let mult = matchup * matchupRead * (crit ? 1.6 : 1) * Math.max(0.3, buff) * attackerTrait.damageMult;
    if (perfectRole === "punish") mult *= 1.12;
    if (att.perfectDamageBoost) mult *= 1.2;
    const elemental = elementalPayoff(att, tgt);
    mult *= elemental.mult;
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
    const damageDealt = Math.max(0, Math.min(tgt.hp, dmg));
    tgt.hp -= dmg;
    att.supportCastLocked = false;
    const verdict = perfectRole === "punish" ? "GUARD BROKEN" : perfectRole === "counter" ? "ACTION BROKEN" : undefined;
    events.push({ t, type: "hit", side: att.team, actorId: att.id, targetId: tgt.id, dmg, crit, element: att.element, kind: ab ? ab.kind : "damage", ranged: viaProjectile, move: ab ? ab.name : undefined, signature: ab ? ab.signature : undefined, combo: elemental.combo, perfect: perfectRole, verdict });
    if (att.perfectDamageBoost) att.perfectDamageBoost = false;
    if (ab) applyOnHit(att, tgt, ab);
    if (perfectRole === "punish") {
        tgt.statuses.buffLeft = Math.max(tgt.statuses.buffLeft, Math.round(DUEL_TPS * 2));
        tgt.statuses.buffMag = Math.min(tgt.statuses.buffMag, -0.18);
    } else if (perfectRole === "counter") {
        clearLunge(tgt);
        tgt.pendingIdx = -2; tgt.pendingTargetId = null;
        tgt.vx = 0; tgt.vy = 0;
        tgt.statuses.stunLeft = Math.max(tgt.statuses.stunLeft, Math.round(DUEL_TPS * 0.7));
        tgt.state = "stagger"; tgt.stateLeft = Math.max(tgt.stateLeft, Math.round(DUEL_TPS * 0.7));
    }
    if (ab && ab.kind === "lifesteal" && att.hp > 0) att.hp = Math.min(att.maxHp, att.hp + Math.round(dmg * 0.5));
    if (damageDealt > 0 && attackerTrait.drainPct > 0 && att.hp > 0) {
        const beforeHeal = att.hp;
        att.hp = Math.min(att.maxHp, att.hp + Math.max(1, Math.round(damageDealt * attackerTrait.drainPct)));
        const healed = att.hp - beforeHeal;
        if (healed > 0) events.push({ t, type: "heal", side: att.team, actorId: att.id, targetId: att.id, dmg: healed });
    }
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
    if (petCinematicTraitCombat(tgt.pet.trait).immuneFreezeConfuse && (ab.kind === "freeze" || ab.kind === "confuse")) return;
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
    // A support beat is a setup, not a loop. The lock clears when this fighter
    // next lands damage, forcing pets with deep defensive kits (notably Eclipse
    // Kitsune) to convert their power-up/ward into visible offensive pressure.
    f.supportCastLocked = true;
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
            // A barrier is the defensive answer for this beat. Do not let its
            // caster stack an immediate perfect evade as soon as the wall drops;
            // the shield can absorb the readable counter and combat resumes.
            f.dodgeCd = Math.max(f.dodgeCd, WALL_TICKS + Math.round(DUEL_TPS * 0.45));
            let foe: Fighter | null = null, bd = Infinity;
            for (const g of fighters) { if (g.team === f.team || g.hp <= 0) continue; const dd = (g.x - f.x) * (g.x - f.x) + (g.y - f.y) * (g.y - f.y); if (dd < bd) { bd = dd; foe = g; } }
            if (foe) {
                const gap = Math.sqrt(bd);
                SIM_WALLS.push({ x: f.x + (foe.x - f.x) * 0.5, y: f.y + (foe.y - f.y) * 0.5, r: clamp(gap * 0.28, 0.95, 1.7), expiry: t + WALL_TICKS, ownerId: f.id });
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
    // The player's order is spent the moment the pet actually commits to it, so the
    // HUD can flip the button from "ordered" back to ready on the same tick.
    if (f.controlled) {
        if (f.cmdBreak && idx >= 0 && f.abilities[idx].signature) f.cmdBreak = false;
        if (f.cmdIdx === idx) { f.cmdIdx = -2; f.cmdLeft = 0; f.cmdTechnique = false; }
    }
    f.pendingIdx = idx; f.pendingTargetId = targetId;
    f.state = "windup"; f.stateLeft = idx >= 0 ? f.abilities[idx].castTicks : f.windT;
    f.vx = 0; f.vy = 0;
    if (idx >= 0 && f.abilities[idx].signature) events.push({ t, type: "ultimate", side: f.team, actorId: f.id, move: f.abilities[idx].name, targetId, perfect: f.perfectRole ?? undefined });
    else if (idx >= 0 && f.abilities[idx].cls === "support") events.push({ t, type: "cast", side: f.team, actorId: f.id, kind: f.abilities[idx].kind, move: f.abilities[idx].name, perfect: f.perfectRole ?? undefined });
    else events.push({ t, type: "windup", side: f.team, actorId: f.id, kind: idx >= 0 ? f.abilities[idx].kind : "damage", move: idx >= 0 ? f.abilities[idx].name : undefined, targetId, perfect: f.perfectRole ?? undefined });
}
function payAbilityCost(f: Fighter, ab: Ability | null) {
    if (ab) { ab.cdLeft = ab.cdTicks; f.stamina -= ab.cost; } else { f.basicCdLeft = f.basicCdT; f.stamina -= COST_BASIC; }
}
// Reset the pounce bookkeeping. MUST be called on EVERY abnormal exit from a lunge
// (stagger/stun/death/anti-stall dash) or a stale lungeAbIdx makes the shared "dash"
// state re-resolve the move for free on the next dash. See bug: leaked lungeAbIdx.
function clearLunge(f: Fighter) { f.lungeAbIdx = -2; f.lungeTgtId = null; f.lungeStuck = 0; }
function routeTravelSq(f: Fighter, goal: readonly [number, number]): number {
    const dx = goal[0] - f.x, dy = goal[1] - f.y;
    return dx * dx + dy * dy;
}
const routeMinTravel = () => _partyMode ? 3.8 : 4.6;
const minRepositionRange = () => _partyMode ? PARTY_REPOSITION_RANGE : DUEL_REPOSITION_RANGE;
function belongsToPartyLane(f: Fighter, goal: readonly [number, number]): boolean {
    if (!_partyMode) return true;
    // Warfront has four persistent world-space quadrants, not the old binary
    // top/bottom split. Reset routes stay in the fighter's own row until a
    // target change deliberately asks it to rotate.
    if (_warfrontMode) return Math.abs(goal[1] - f.homeY) <= 0.8;
    return Math.sign(goal[1] || f.homeY) === Math.sign(f.homeY);
}

const WARFRONT_CELL_RADIUS = 5.1;

function warfrontCellAnchor(f: Fighter, e: Fighter): [number, number] {
    const midpointY = (f.homeY + e.homeY) * 0.5;
    let routeY: number = WARFRONT_OBJECTIVE_Y[0] ?? 0;
    let routeDelta = Math.abs(routeY - midpointY);
    for (let index = 1; index < WARFRONT_OBJECTIVE_Y.length; index += 1) {
        const candidate = WARFRONT_OBJECTIVE_Y[index] ?? 0;
        const candidateDelta = Math.abs(candidate - midpointY);
        const ownsMidpointSide = Math.sign(candidate) === Math.sign(midpointY) && Math.sign(routeY) !== Math.sign(midpointY);
        if (candidateDelta < routeDelta || (candidateDelta === routeDelta && ownsMidpointSide)) {
            routeY = candidate;
            routeDelta = candidateDelta;
        }
    }
    return [clamp((f.homeX + e.homeX) * 0.5, -4.5, 4.5), routeY];
}

function containWarfrontSocket(f: Fighter, e: Fighter, x: number, y: number): [number, number] {
    const [anchorX, anchorY] = warfrontCellAnchor(f, e);
    const dx = x - anchorX, dy = y - anchorY;
    const distance = Math.hypot(dx, dy);
    if (distance <= WARFRONT_CELL_RADIUS) return [x, y];
    return [
        anchorX + (dx / Math.max(1e-4, distance)) * WARFRONT_CELL_RADIUS,
        anchorY + (dy / Math.max(1e-4, distance)) * WARFRONT_CELL_RADIUS,
    ];
}

/** A target-relative Smart-Object-style reservation. No mutable reservation
 *  registry is required: target id + stable fighter order deterministically
 *  derive one unique socket every tick, which also makes replay/rewind free.
 *  The preferred side starts toward the attacker's own half of the floor; extra
 *  claimants alternate flanks instead of seeking the target centre. */
function reservedEngagementGoal(f: Fighter, e: Fighter, fighters: Fighter[], rStar: number): [number, number] {
    const claimants = fighters
        .filter((ally) => ally.team === f.team && ally.hp > 0 && (ally === f || ally.targetId === e.id))
        .sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id));
    const ordinal = Math.max(0, claimants.indexOf(f));
    // The pressure partner arrives from a full 90-degree flank—not the old
    // 45-degree wedge that was narrower than two rendered silhouettes. The
    // screen owns the other skirmish, so no third ally can join this target
    // before the opposing formation actually loses a fighter.
    const playerOrder = [8, 4, 12, 0] as const;
    const enemyOrder = [0, 12, 4, 8] as const;
    const order = f.team === "player" ? playerOrder : enemyOrder;
    const radius = f.style.rangedPref || f.style.arche === "support"
        ? clamp(rStar, 6.2, 8.4)
        : clamp(rStar, MIN_SEP + 1.05, MIN_SEP + 1.15);

    const base = order[ordinal % order.length];
    const probes = [0, 1, -1, 2, -2, 3, -3] as const;
    const initial = containWarfrontSocket(f, e, e.x + SLOT_X[base] * radius, e.y + SLOT_Y[base] * radius);
    let fallback: [number, number] = snapPos(initial[0], initial[1]);
    for (const probe of probes) {
        const dir = (base + probe + N) % N;
        const rawX = e.x + SLOT_X[dir] * radius;
        const rawY = e.y + SLOT_Y[dir] * radius;
        const contained = containWarfrontSocket(f, e, rawX, rawY);
        if (!walkableAt(contained[0], contained[1])) continue;
        return contained;
    }
    return fallback;
}
function outerArenaDestination(f: Fighter, e: Fighter | null, retreat: boolean): [number, number] {
    const lead = f.team === "player" ? 0 : 4;
    let fallback = snapPos(-f.x * 0.72, _partyMode ? f.homeY : -f.y * 0.72);
    let fallbackScore = -1e9;
    const minTravel = routeMinTravel();
    const anchors = activeRouteAnchors();
    for (let attempt = 0; attempt < anchors.length; attempt++) {
        const idx = (f.spacingBeat + lead + f.slot * 2 + attempt) % anchors.length;
        const raw = anchors[idx];
        if (!belongsToPartyLane(f, raw)) continue;
        const candidate = snapPos(raw[0], raw[1]);
        const travelSq = routeTravelSq(f, candidate);
        const enemySq = e ? (candidate[0] - e.x) * (candidate[0] - e.x) + (candidate[1] - e.y) * (candidate[1] - e.y) : 0;
        const score = retreat ? enemySq + travelSq * 0.35 : travelSq - attempt * 1.5;
        if (score > fallbackScore) { fallback = candidate; fallbackScore = score; }
        // Crosses rotate through several valid long lanes instead of always choosing
        // the mathematically farthest corner. Retreats still take the safest corner.
        if (!retreat && travelSq >= minTravel * minTravel) return candidate;
    }
    return fallback;
}
function coverArenaDestination(f: Fighter, e: Fighter, flank: boolean): [number, number] {
    const lead = _warfrontMode ? 0 : f.team === "player" ? 0 : 1;
    let best = outerArenaDestination(f, e, false);
    let bestScore = -1e9;
    const battleY = _warfrontMode ? warfrontCellAnchor(f, e)[1] : 0;
    const covers: readonly Readonly<{ x: number; y: number; radius: number }>[] = _warfrontMode
        ? WARFRONT_COVER_NODES
        : DUEL_COVER_NODES;
    for (let attempt = 0; attempt < covers.length; attempt++) {
        const baseIndex = (f.spacingBeat + lead + attempt) % covers.length;
        // WARFRONT_MAZE_WALLS stores rotational pairs adjacently (0↔1, 2↔3).
        // Enemy lookup flips the low bit so equal mirrored states consume the
        // mirrored ruin while retaining the same attempt/tie penalty.
        const coverIndex = _warfrontMode && f.team === "enemy" ? baseIndex ^ 1 : baseIndex;
        const cover = covers[coverIndex];
        if (_warfrontMode && Math.abs(cover.y - battleY) > 5.2) continue;
        let nx = cover.x - e.x, ny = cover.y - e.y;
        const nl = Math.sqrt(nx * nx + ny * ny);
        if (nl > 1e-4) { nx /= nl; ny /= nl; }
        else { nx = f.team === "player" ? -1 : 1; ny = 0; }
        let rawX: number, rawY: number;
        if (flank) {
            // Melee wraps a side edge. Its team-local orbit direction alternates each
            // exchange, so repeated pursuits attack from opposite angles.
            const tx = -ny * f.orbitDir, ty = nx * f.orbitDir;
            rawX = cover.x + tx * (cover.radius + 1.65) + nx * 0.45;
            rawY = cover.y + ty * (cover.radius + 1.65) + ny * 0.45;
        } else {
            // Ranged/support/wounded pets take the protected side, then naturally
            // BFS around the nearest edge to peek once their reset beat ends.
            rawX = cover.x + nx * (cover.radius + 1.7);
            rawY = cover.y + ny * (cover.radius + 1.7);
        }
        const candidate = snapPos(rawX, rawY);
        const travelSq = routeTravelSq(f, candidate);
        const enemySq = (candidate[0] - e.x) * (candidate[0] - e.x) + (candidate[1] - e.y) * (candidate[1] - e.y);
        const minTravel = routeMinTravel();
        const tooShort = travelSq < minTravel * minTravel ? 80 : 0;
        const score = flank ? travelSq * 0.7 - enemySq * 0.08 - tooShort - attempt : enemySq * 0.55 + travelSq * 0.3 - tooShort - attempt;
        if (score > bestScore) { best = candidate; bestScore = score; }
    }
    return best;
}
function assignArenaDestination(f: Fighter, e: Fighter | null) {
    const spacingPhrase = [-0.6, 1.25, 0.15, 1.85] as const;
    const nextBeat = f.spacingBeat + 1;
    const wounded = f.hp / f.maxHp < f.style.retreatHp;
    let intent: RouteIntent;
    if (wounded && f.style.arche !== "rusher" && f.style.arche !== "brawler") intent = "retreat";
    else if (f.style.rangedPref || f.style.arche === "support") intent = nextBeat % 4 === 1 ? "cross" : nextBeat % 4 === 3 ? "flank" : "cover";
    else intent = nextBeat % 3 === 0 ? "cross" : "flank";

    let chosen: [number, number];
    if (!e) chosen = outerArenaDestination(f, null, false);
    else if (intent === "cover") chosen = coverArenaDestination(f, e, false);
    else if (intent === "flank") chosen = coverArenaDestination(f, e, true);
    else chosen = outerArenaDestination(f, e, intent === "retreat");
    const minTravel = routeMinTravel();
    if (routeTravelSq(f, chosen) < minTravel * minTravel) chosen = outerArenaDestination(f, e, intent === "retreat");

    f.spacingBeat = nextBeat;
    f.routeIntent = intent;
    f.routeX = chosen[0]; f.routeY = chosen[1]; f.routeActive = true;
    f.spacingOffset = spacingPhrase[f.spacingBeat % spacingPhrase.length];
}
function waypointToward(f: Fighter, goalX: number, goalY: number): [number, number] {
    const next = bfsNextStep(cellCol(f.x), cellRow(f.y), cellCol(goalX), cellRow(goalY), f.team);
    return next ? cellCenter(next[0], next[1]) : [goalX, goalY];
}
function routeWaypoint(f: Fighter): [number, number] {
    return waypointToward(f, f.routeX, f.routeY);
}
function beginReposition(f: Fighter, ticks: number, e: Fighter | null = null) {
    // Pick one tactical destination per beat: protected side for range/support,
    // an obstacle-side flank for melee, or a long outer-ring cross/retreat.
    if (f.reposLeft <= 0) {
        f.orbitDir = f.orbitDir === 1 ? -1 : 1;
        f.reposManeuverUsed = false;
        assignArenaDestination(f, e);
        const travel = Math.sqrt(routeTravelSq(f, [f.routeX, f.routeY]));
        // The beat lasts long enough to actually arrive. The old fixed one-second
        // timer expired halfway across the floor and made every route look like a
        // small shuffle around center.
        const travelTicks = clamp(Math.round(travel / Math.max(1e-4, f.maxSpeed * 0.86)), Math.round(DUEL_TPS * 1.15), Math.round(DUEL_TPS * 3.0));
        ticks = Math.max(ticks, travelTicks);
    }
    f.reposLeft = Math.max(f.reposLeft, Math.max(1, ticks));
}
function beginDodgeRetreat(f: Fighter, e: Fighter | null) {
    if (!e) { beginReposition(f, Math.round(DUEL_TPS * 0.8), null); return; }
    const ex = f.x - e.x, ey = f.y - e.y, ed = Math.max(1e-4, Math.hypot(ex, ey));
    const awayX = ex / ed, awayY = ey / ed;
    // Score several backward/sideways lanes. Near an arena edge, blindly clamping
    // the straight-away vector can collapse it to a tiny move; an arbitrary outer
    // fallback can be even worse and point back toward the foe. This candidate read
    // keeps or increases separation while preserving the direction of the side-hop.
    const sideX = f.moveDx, sideY = f.moveDy;
    const directions: readonly (readonly [number, number])[] = [
        [awayX * 5.2 + sideX * 2.7, awayY * 5.2 + sideY * 2.7],
        [awayX * 3.2 + sideX * 5.1, awayY * 3.2 + sideY * 5.1],
        [awayX * 3.2 - sideX * 5.1, awayY * 3.2 - sideY * 5.1],
        [sideX * 5.8, sideY * 5.8],
        [-sideX * 5.8, -sideY * 5.8],
    ];
    let goal: [number, number] | null = null;
    let bestScore = -Infinity;
    for (const [gx, gy] of directions) {
        const candidate = snapPos(f.x + gx, f.y + gy);
        const travel = Math.sqrt(routeTravelSq(f, candidate));
        if (travel < 2.8) continue;
        const enemyGap = Math.hypot(candidate[0] - e.x, candidate[1] - e.y);
        const awayProgress = (candidate[0] - f.x) * awayX + (candidate[1] - f.y) * awayY;
        const dodgeContinuity = (candidate[0] - f.x) * sideX + (candidate[1] - f.y) * sideY;
        const score = enemyGap * 3 + travel * 0.35 + awayProgress * 0.9 + dodgeContinuity * 0.18;
        if (score > bestScore) { bestScore = score; goal = candidate; }
    }
    if (!goal) goal = outerArenaDestination(f, e, true);
    f.spacingBeat++;
    f.spacingOffset = 1.85;
    f.routeX = goal[0]; f.routeY = goal[1];
    f.routeActive = true; f.routeIntent = "retreat";
    // Reserve the mobility move: this sequence should read dodge -> run back ->
    // plant, not dodge -> unrelated named dash -> buff.
    f.reposManeuverUsed = true;
    const travel = Math.sqrt(routeTravelSq(f, goal));
    f.reposLeft = Math.max(f.reposLeft, clamp(Math.round(travel / Math.max(1e-4, f.maxSpeed)), Math.round(DUEL_TPS * 0.72), Math.round(DUEL_TPS * 1.45)));
}
// Melee ability / basic resolved AT CONTACT (called by the lunge on connect, or by
// resolveCast for the non-lunge path). Cost is paid by the caller; this only rolls
// accuracy and applies damage to whatever is in reach around the pounce's landing.
/** `slack` widens the contact tolerance. It is passed ONLY by the live-coliseum
 *  grazing-blow path (see the dive-expiry branch in stepFighter); every
 *  authoritative caller leaves it at 0, so their reach test is unchanged. */
function resolveMeleeContact(f: Fighter, ab: Ability | null, tgtId: string | null, fighters: Fighter[], rng: () => number, t: number, events: DuelEvent[], accuracyEnabled: boolean, slack = 0) {
    // Draw the accuracy roll for EVERY ability contact, independent of the (per-client,
    // localStorage) accuracy flag — else toggling the flag shifts the whole rng stream
    // and the same (pets, seed) diverges across clients. Basics (ab null) never roll.
    const accRoll = ab ? rng() : 1;
    const perfectRole = f.perfectRole ?? undefined;
    if (!perfectRole && accuracyEnabled && ab && accRoll >= ab.accuracy / 100) { events.push({ t, type: "whiff", side: f.team, actorId: f.id }); return; }
    const primary = fighters.find((g) => g.id === tgtId);
    const hitList = ab && ab.aoe ? fighters.filter((g) => g.team !== f.team && g.hp > 0) : primary ? [primary] : [];
    let landed = false;
    for (const tgt of hitList) {
        const dx = tgt.x - f.x, dy = tgt.y - f.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const facingOK = f.faceX * dx + f.faceY * dy > 0;
        const range = ab ? ab.range : f.reach + 0.35;
        if (tgt.hp > 0 && (perfectRole || (d <= range + 0.5 + slack && facingOK))) { applyDamage(f, tgt, ab, rng, t, events, false, perfectRole); landed = true; }
    }
    if (landed && perfectRole) f.perfectRole = null;
    if (!landed) events.push({ t, type: "whiff", side: f.team, actorId: f.id });
}
// Only called for RANGED / SUPPORT now — melee goes through the lunge (see stepFighter).
function resolveCast(f: Fighter, fighters: Fighter[], projectiles: Projectile[], nextProjId: { n: number }, rng: () => number, t: number, events: DuelEvent[], accuracyEnabled: boolean) {
    const idx = f.pendingIdx;
    const ab = idx >= 0 ? f.abilities[idx] : null;
    payAbilityCost(f, ab);
    if (ab && ab.cls === "support") {
        castSupport(f, ab, fighters, t, events);
        if (f.perfectRole === "rally") {
            const beneficiary = pickAlly(f, fighters);
            const s = beneficiary.statuses;
            s.burnLeft = 0; s.burnDmg = 0; s.halfHeal = false;
            s.stunLeft = 0; s.slowLeft = 0; s.rootLeft = 0;
            s.marked = false; s.tauntById = null;
            if (s.buffMag < 0) { s.buffLeft = 0; s.buffMag = 0; }
            const aegis = Math.max(1, Math.round(beneficiary.maxHp * 0.12));
            s.shieldHp = quant(s.shieldHp + aegis);
            events.push({ t, type: "shield", side: f.team, actorId: f.id, targetId: beneficiary.id, dmg: aegis, perfect: "rally", verdict: "CLEANSE + AEGIS" });
            f.perfectRole = null;
        }
        return;
    }
    const accRoll = ab ? rng() : 1;   // always draw for abilities → rng stream is accuracy-flag-independent (see resolveMeleeContact)
    const perfectRole = f.perfectRole ?? undefined;
    if (!perfectRole && accuracyEnabled && ab && accRoll >= ab.accuracy / 100) { events.push({ t, type: "whiff", side: f.team, actorId: f.id }); return; }
    if (ab && ab.cls === "ranged") {
        const targets = ab.aoe ? fighters.filter((g) => g.team !== f.team && g.hp > 0) : [fighters.find((g) => g.id === f.pendingTargetId && g.hp > 0)].filter(Boolean) as Fighter[];
        for (const tgt of targets) projectiles.push({ id: nextProjId.n++, ownerId: f.id, team: f.team, targetId: tgt.id, abilityIdx: idx, x: f.x, y: f.y, speed: perfectRole ? 0.72 : 0.56, ttl: Math.round(DUEL_TPS * 3), element: f.element, kind: ab.kind, perfectRole });
        events.push({ t, type: "cast", side: f.team, actorId: f.id, kind: ab.kind, move: ab.name, perfect: perfectRole });
        if (perfectRole) f.perfectRole = null;
        return;
    }
    if (!ab && f.basicRanged) {
        const tgt = fighters.find((g) => g.id === f.pendingTargetId && g.hp > 0);
        if (tgt) { projectiles.push({ id: nextProjId.n++, ownerId: f.id, team: f.team, targetId: tgt.id, abilityIdx: -1, x: f.x, y: f.y, speed: 0.56, ttl: Math.round(DUEL_TPS * 3), element: f.element, kind: "damage" }); events.push({ t, type: "cast", side: f.team, actorId: f.id, kind: "damage" }); }
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
            if (!p.perfectRole && tgt.state === "dodge" && d <= 2.0) {
                const ev = clamp(0.10 + (tgt.spd - owner.spd) * 0.0020, 0, 0.6);
                if (rng() < ev) { events.push({ t, type: "dodge", side: tgt.team, actorId: tgt.id }); projectiles.splice(i, 1); continue; }
            }
            if (d <= 0.7) { const ab = owner.abilities[p.abilityIdx] ?? null; applyDamage(owner, tgt, ab, rng, t, events, true, p.perfectRole); projectiles.splice(i, 1); continue; }
            if (d > 1e-6) {
                const nextX = p.x + (dx / d) * p.speed, nextY = p.y + (dy / d) * p.speed;
                // A target that reaches cover after the shot was fired can still break
                // the homing line. The projectile visibly dies on the prop instead of
                // ghosting through it and invalidating the tactical retreat.
                if (!p.perfectRole && arenaCoverAt(nextX, nextY, 0.12)) {
                    events.push({ t, type: "dodge", side: tgt.team, actorId: tgt.id, targetId: owner.id, move: "Cover" });
                    projectiles.splice(i, 1);
                    continue;
                }
                p.x = nextX; p.y = nextY;
            }
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
function followRouteWaypoint(f: Fighter, e: Fighter, goal: readonly [number, number], sprint = false) {
    const startX = f.x, startY = f.y;
    const gx = goal[0] - f.x, gy = goal[1] - f.y;
    const gd = Math.max(1e-4, Math.sqrt(gx * gx + gy * gy));
    const tx = gx / gd, ty = gy / gd;
    // Authored routes are action beats, so a sprint receives a real burst cap.
    // Ordinary steering remains readable and controlled between those beats.
    const sprintMult = sprint ? 1.24 : 1;
    const speed = effMoveSpeed(f) * sprintMult * (sprint ? 1 : clamp(gd / Math.max(activeCellX(), activeCellY()), 0.35, 1));
    const desiredX = tx * speed, desiredY = ty * speed;
    let sx = desiredX - f.vx, sy = desiredY - f.vy;
    const sl = Math.sqrt(sx * sx + sy * sy);
    // Pathfinding already selected a safe cell, so turns can be more decisive
    // than free steering while still preserving a rounded running line.
    const routeForce = f.maxForce * 1.55;
    if (sl > routeForce && sl > 1e-6) { sx = (sx / sl) * routeForce; sy = (sy / sl) * routeForce; }
    f.vx += sx; f.vy += sy;
    const vl = Math.sqrt(f.vx * f.vx + f.vy * f.vy), cap = effMoveSpeed(f) * sprintMult;
    if (vl > cap && vl > 1e-6) { f.vx = (f.vx / vl) * cap; f.vy = (f.vy / vl) * cap; }
    const [nx, ny] = tryStep(f.x + f.vx, f.y + f.vy, f.x, f.y);
    f.x = nx; f.y = ny;
    const routeProgress = Math.hypot(f.x - startX, f.y - startY);
    if (_warfrontMode && f.routeActive && vl > 0.02 && routeProgress < 0.012) {
        f.routeStuck++;
        if (f.routeStuck >= 5) {
            // A padded maze cell can leave a knocked-back body just outside the
            // planner's next cell. Abandon this optional exit after five blocked
            // frames so the next decision chooses a fresh corner or attacks;
            // never leave a pet jogging in place for the rest of the beat.
            f.routeActive = false; f.reposLeft = 0; f.routeStuck = 0;
            f.vx = 0; f.vy = 0;
        }
    } else f.routeStuck = 0;
    // A sprint reads as a real run only when the body commits to its travel lane.
    // Facing the opponent throughout a long route made quadrupeds backpedal,
    // rotate continuously and look as if they were sliding. At the destination
    // the route branch plants the feet and performs the turn back to the rival.
    if (sprint && vl > 0.02) {
        f.faceX = f.vx / vl; f.faceY = f.vy / vl;
    } else {
        const ex = e.x - f.x, ey = e.y - f.y, ed = Math.max(1e-4, Math.sqrt(ex * ex + ey * ey));
        f.faceX = ex / ed; f.faceY = ey / ed;
    }
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
function steer(f: Fighter, e: Fighter, fighters: Fighter[], rStar: number, routeGoal?: [number, number], repositioning = false) {
    for (let i = 0; i < N; i++) { _interest[i] = 0; _danger[i] = 0; }
    const ex = e.x - f.x, ey = e.y - f.y;
    const d = Math.max(1e-4, Math.sqrt(ex * ex + ey * ey));
    const tx = ex / d, ty = ey / d;               // unit toward enemy
    // ROOT / movelock — planted: keep facing + firing (handled in decide) but no move.
    if (f.statuses.rootLeft > 0) { f.vx = 0; f.vy = 0; f.faceX = tx; f.faceY = ty; return; }
    // PLANTED GUARD. During cooldowns, fighters that have already reached their
    // chosen range should watch and breathe instead of orbiting forever. They break
    // the stance for a telegraph, opening, route, forced-engage, or committed
    // reposition. Residual velocity eases out so the stop has weight rather than
    // looking like a network snap.
    // A reposition has a DESTINATION. Once it is reached, plant there until the
    // beat expires instead of tracing another lap at the same radius.
    const settledReposition = !routeGoal && repositioning && Math.abs(d - rStar) <= BAND_H;
    if (settledReposition) {
        f.vx *= 0.48; f.vy *= 0.48;
        if (Math.hypot(f.vx, f.vy) < 0.012) { f.vx = 0; f.vy = 0; }
        const nx = f.x + f.vx, ny = f.y + f.vy;
        if (walkableAt(nx, ny)) { f.x = nx; f.y = ny; }
        else { f.vx = 0; f.vy = 0; }
        f.faceX = tx; f.faceY = ty;
        return;
    }
    const settledInBand = !routeGoal && !repositioning && Math.abs(d - rStar) <= BAND_H;
    // Once range is established, hold it. Warfront breaks this pose after every
    // exchange via WARFRONT_ROUTE_CADENCE: its neutral reads happen behind real
    // maze cover rather than as a long dead pause in an empty firing pocket.
    const holdNeutral = settledInBand && !_forcedEngage && _stallPressure <= 0;
    if (holdNeutral) {
        f.vx *= 0.56; f.vy *= 0.56;
        if (Math.hypot(f.vx, f.vy) < 0.012) { f.vx = 0; f.vy = 0; }
        const nx = f.x + f.vx, ny = f.y + f.vy;
        if (walkableAt(nx, ny)) { f.x = nx; f.y = ny; }
        else { f.vx = 0; f.vy = 0; }
        f.faceX = tx; f.faceY = ty;
        return;
    }
    // INTEREST. When line-of-sight to the foe is blocked, SEEK the BFS waypoint at
    // full interest (route around the terrain first); otherwise do R* spacing.
    if (routeGoal) {
        const gx = routeGoal[0] - f.x, gy = routeGoal[1] - f.y, gd = Math.max(1e-4, Math.sqrt(gx * gx + gy * gy));
        writeMap(_interest, gx / gd, gy / gd, INT_CLOSE, false);
    } else if (repositioning) {
        const dir = f.orbitDir;
        const tangentX = -ty * dir, tangentY = tx * dir;
        if (d < rStar - BAND_H) {
            // One decisive diagonal racing line. Separate max-blended away/strafe
            // interests used to collapse to a plain backpedal; this vector guarantees
            // the exit changes both distance AND camera angle.
            const exitX = -tx * 0.72 + tangentX * 0.69;
            const exitY = -ty * 0.72 + tangentY * 0.69;
            const exitLen = Math.max(1e-4, Math.hypot(exitX, exitY));
            writeMap(_interest, exitX / exitLen, exitY / exitLen, INT_CLOSE, false);
        } else {
            // If an earlier exchange put us beyond this beat's chosen destination,
            // run a shallow inward arc. The in-band case plants above.
            const returnX = tx * 0.72 + tangentX * 0.42;
            const returnY = ty * 0.72 + tangentY * 0.42;
            const returnLen = Math.max(1e-4, Math.hypot(returnX, returnY));
            writeMap(_interest, returnX / returnLen, returnY / returnLen, INT_CLOSE * 0.9, false);
        }
    } else if (d > rStar + BAND_H) {
        const ev = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
        if (ev > 0.025) {
            // Offset pursuit, not seek: predict where the moving target is going
            // and claim a side of that future pocket. This produces a cutoff line
            // instead of the visible leader/follower train caused by seeking e.x/y.
            const leadTicks = clamp(Math.round(d / Math.max(1e-4, effMoveSpeed(f) + ev) * 0.42), 4, 18);
            const px = e.x + e.vx * leadTicks, py = e.y + e.vy * leadTicks;
            const hx = e.vx / ev, hy = e.vy / ev;
            const side = f.team === "player" ? 1 : -1;
            const offset = clamp(rStar * 0.42, 1.0, 3.0);
            const goalX = px - hy * offset * side, goalY = py + hx * offset * side;
            const gx = goalX - f.x, gy = goalY - f.y, gd = Math.max(1e-4, Math.sqrt(gx * gx + gy * gy));
            writeMap(_interest, gx / gd, gy / gd, INT_CLOSE, false);
        } else writeMap(_interest, tx, ty, INT_CLOSE, false);
    }
    else if (d < rStar - BAND_H) {
        writeMap(_interest, -tx, -ty, INT_BACK, false);
    }
    else writeMap(_interest, tx, ty, 0.28, false);
    // The old constant center pull quietly undid every outer-ring destination.
    // Only recover inward when actually grazing the boundary; otherwise pets own
    // the whole floor and may hold an outside lane or use cover there.
    const cl = Math.sqrt(f.x * f.x + f.y * f.y);
    const edge = Math.max(Math.abs(f.x) / activeArenaX(), Math.abs(f.y) / activeArenaY());
    if (cl > 1e-3 && edge > 0.84) writeMap(_interest, -f.x / cl, -f.y / cl, EDGE_RETURN_BIAS * clamp((edge - 0.84) / 0.16, 0, 1), false);
    if (_partyMode) {
        const laneY = _warfrontMode ? e.homeY : f.homeY;
        const laneDelta = laneY - f.y;
        const threshold = _warfrontMode ? 0.7 : 1.1;
        const strength = _warfrontMode ? 0.72 : 0.38;
        if (Math.abs(laneDelta) > threshold) writeMap(_interest, 0, Math.sign(laneDelta), strength * clamp(Math.abs(laneDelta) / 5.2, 0.25, 1), false);
    }
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
    const probe = Math.max(activeCellX(), activeCellY()) * 1.2;
    if (!walkableAt(f.x + probe, f.y)) writeMap(_danger, 1, 0, DANGER_WALL, false);
    if (!walkableAt(f.x - probe, f.y)) writeMap(_danger, -1, 0, DANGER_WALL, false);
    if (!walkableAt(f.x, f.y + probe)) writeMap(_danger, 0, 1, DANGER_WALL, false);
    if (!walkableAt(f.x, f.y - probe)) writeMap(_danger, 0, -1, DANGER_WALL, false);
    // Ally separation (2v2) — preserve two readable lanes. The former 2-unit
    // bubble was smaller than the rendered creature bodies, so teammates could be
    // numerically separated while still appearing as one tangled silhouette.
    for (const g of fighters) {
        if (g === f || g.team !== f.team || g.hp <= 0) continue;
        const gx = g.x - f.x, gy = g.y - f.y, gd = Math.sqrt(gx * gx + gy * gy);
        const allyRadius = _partyMode ? PARTY_ALLY_SEPARATION : 2.0;
        if (gd < allyRadius && gd > 1e-3) writeMap(_danger, gx / gd, gy / gd, 0.78 * (1 - gd / allyRadius), false);
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
    // A melee pursuer needs a short closing gear or an equally fast kiter can
    // preserve the same gap forever. This is locomotion—not a teleport/dash—and
    // drops away inside the attack approach, preserving the in/out rhythm.
    const pursuitMult = !repositioning && !f.style.rangedPref && d > rStar + BAND_H + 1 ? 1.22 : 1;
    let spd = effMoveSpeed(f) * pursuitMult * clamp(_interest[best], 0, 1);
    // Exit beats are sprints, not hesitant backpedals. The speed floor also makes
    // the renderer select the full run cycle for a sustained, readable interval.
    if (repositioning) spd = Math.max(spd, effMoveSpeed(f) * 0.86);
    // Arrive: decelerate into the R* band so it doesn't overshoot + jitter. (Skip
    // while routing around terrain — there we want full speed to the waypoint.)
    if (!routeGoal && !repositioning) { const bandErr = Math.abs(d - rStar); if (bandErr < SLOW_RADIUS) spd *= Math.max(0.15, bandErr / SLOW_RADIUS); }
    // Steer the velocity toward desired with a max-force turn-rate limit (this is
    // the temporal smoothing — arcs, not twitches).
    const desVx = hx * spd, desVy = hy * spd;
    let sx = desVx - f.vx, sy = desVy - f.vy;
    const slen = Math.sqrt(sx * sx + sy * sy);
    if (slen > f.maxForce && slen > 1e-6) { sx = (sx / slen) * f.maxForce; sy = (sy / slen) * f.maxForce; }
    f.vx += sx; f.vy += sy;
    const vl = Math.sqrt(f.vx * f.vx + f.vy * f.vy);
    const cap = effMoveSpeed(f) * pursuitMult;
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
function readyMobility(f: Fighter): number {
    for (let i = 0; i < f.abilities.length; i++) {
        const a = f.abilities[i];
        if (a.isMove && a.cdLeft <= 0 && f.stamina >= a.cost) return i;
    }
    return -1;
}
function maneuverName(f: Fighter): string {
    switch (String(f.element ?? "")) {
        case "Fire": return "Blazing Crescent";
        case "Water": return "Undertow Circuit";
        case "Wind": return "Gale Spiral";
        case "Lightning": return "Volt Switchback";
        case "Earth": return "Stonebound Pivot";
        default: return "Crossfield Arc";
    }
}
function beginManeuver(f: Fighter, e: Fighter, idx: number, t: number, events: DuelEvent[]) {
    const ab = f.abilities[idx];
    const perfectShift = f.perfectRole === "shift";
    if (!f.routeActive || Math.hypot(f.routeX - f.x, f.routeY - f.y) < 3.2) assignArenaDestination(f, e);
    const dx = f.routeX - f.x, dy = f.routeY - f.y;
    const d = Math.max(1e-4, Math.hypot(dx, dy));
    const tx = dx / d, ty = dy / d;
    let tangentX = -ty * f.orbitDir, tangentY = tx * f.orbitDir;
    // The move launches down a crossfield racing line with a small lateral hook.
    // Its reference is a real arena destination, never the opponent's radius.
    let mx = tx * 0.99 + tangentX * 0.12;
    let my = ty * 0.99 + tangentY * 0.12;
    let ml = Math.max(1e-4, Math.hypot(mx, my));
    mx /= ml; my /= ml;
    const probe = 3.2;
    if (!walkableAt(f.x + mx * probe, f.y + my * probe)) {
        tangentX = -tangentX; tangentY = -tangentY;
        f.orbitDir = f.orbitDir === 1 ? -1 : 1;
        mx = tx * 0.99 + tangentX * 0.12;
        my = ty * 0.99 + tangentY * 0.12;
        ml = Math.max(1e-4, Math.hypot(mx, my));
        mx /= ml; my /= ml;
    }
    payAbilityCost(f, ab);
    clearLunge(f);
    f.moveDx = mx; f.moveDy = my;
    f.maneuverGoalX = f.routeX; f.maneuverGoalY = f.routeY;
    f.faceX = mx; f.faceY = my;
    f.vx = 0; f.vy = 0;
    // A movement skill is a short anime range-shift, not a second walk cycle.
    // It covers a meaningful pocket, pivots, and returns control quickly.
    f.maneuverTotal = clamp(Math.round(d / Math.max(1e-4, f.maxSpeed * (perfectShift ? 3.25 : 2.55))), Math.round(DUEL_TPS * 0.34), Math.round(DUEL_TPS * 0.6));
    f.maneuverLeft = f.maneuverTotal;
    f.reposManeuverUsed = true;
    f.reposLeft = 0;
    f.commit = 0;
    if (perfectShift) {
        f.perfectEvadeLeft = Math.max(f.perfectEvadeLeft, Math.round(DUEL_TPS * 0.8));
        f.perfectDamageBoost = true;
    }
    events.push({ t, type: "maneuver", side: f.team, actorId: f.id, targetId: e.id, kind: "move", move: ab.name || maneuverName(f), perfect: perfectShift ? "shift" : undefined, verdict: perfectShift ? "PHASE SHIFT" : undefined });
    if (f.controlled && f.cmdIdx === idx) { f.cmdIdx = -2; f.cmdLeft = 0; f.cmdTechnique = false; }
    if (perfectShift) f.perfectRole = null;
}
function beginEngageManeuver(f: Fighter, e: Fighter, idx: number, desiredRange: number, t: number, events: DuelEvent[]): boolean {
    const dx = e.x - f.x, dy = e.y - f.y;
    const d = Math.max(1e-4, Math.hypot(dx, dy));
    const tx = dx / d, ty = dy / d;
    const side = f.team === "player" ? 1 : -1;
    const targetSpeed = Math.hypot(e.vx, e.vy);
    const futureX = e.x + (targetSpeed > 0.02 ? e.vx * 7 : 0);
    const futureY = e.y + (targetSpeed > 0.02 ? e.vy * 7 : 0);
    const lateral = clamp(desiredRange * 0.28, 1.25, 2.15);
    const pocket = snapPos(
        futureX - tx * desiredRange - ty * lateral * side,
        futureY - ty * desiredRange + tx * lateral * side,
    );
    if (routeTravelSq(f, pocket) < 2.4 * 2.4) return false;
    f.routeX = pocket[0]; f.routeY = pocket[1];
    f.routeActive = true; f.routeIntent = "flank";
    beginManeuver(f, e, idx, t, events);
    return true;
}
/** The move the player has ordered this fighter to use, or -2 for "no order".
 *  A pending Bond Break resolves to the signature slot. Always -2 when the fighter
 *  is not under player control, which is every non-live call site. */
function orderedIdx(f: Fighter): number {
    if (!f.controlled) return -2;
    if (f.cmdBreak) {
        for (let i = 0; i < f.abilities.length; i++) if (f.abilities[i].signature) return i;
    }
    return f.cmdIdx >= f.abilities.length ? -2 : f.cmdIdx;
}
const hasOrder = (f: Fighter) => f.controlled && (f.cmdBreak || f.cmdIdx !== -2);
/** Offensive pick with the player's order taking precedence over the AI's choice.
 *  An ordered move that is on cooldown or unaffordable does NOT lapse: the pet keeps
 *  poking with basics and fires the order the moment it comes up. */
function commandedOffensive(f: Fighter, e: Fighter | null, forceSig: boolean): number {
    const idx = orderedIdx(f);
    if (idx === -1) return -1;                       // ordered a plain basic attack
    if (idx >= 0) {
        const a = f.abilities[idx];
        if (a.cls !== "support" && !a.isMove) {
            // Bond Break is paid for by the meter, so it bypasses the cooldown the AI
            // otherwise hoards the signature behind — that is the whole point of the meter.
            if (f.cmdBreak && a.signature) { a.cdLeft = 0; return idx; }
            return a.cdLeft <= 0 && f.stamina >= a.cost ? idx : -1;
        }
    }
    return bestOffensive(f, e, forceSig);
}
function readySupport(f: Fighter, fighters: Fighter[]): number {
    // An explicit order owns the decision: a commanded support move is cast when it
    // is ready, and a commanded ATTACK is never pre-empted by an AI support pick.
    const ord = orderedIdx(f);
    if (ord !== -2) {
        if (ord < 0) return -1;
        const a = f.abilities[ord];
        if (a.cls !== "support") return -1;
        return a.cdLeft <= 0 && f.stamina >= a.cost ? ord : -1;
    }
    if (f.supportCastLocked) return -1;
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

type WarfrontTravelOrder = {
    goal: readonly [number, number];
    plan: string;
    reason: string;
    arrive: number;
};

/** Decide whether this tick is about the scrolls rather than trading damage.
 * Combat still interrupts travel when a defender physically contests the route;
 * otherwise the squad advances, escorts, or guards instead of seeking contact. */
function legacyWarfrontTravelOrder(f: Fighter, fighters: Fighter[]): WarfrontTravelOrder | null {
    if (!_warfrontMode || _warfrontRelics.length !== 2) return null;
    const allies = fighters.filter((ally) => ally.team === f.team && ally.hp > 0);
    const enemies = fighters.filter((enemy) => enemy.team !== f.team && enemy.hp > 0);
    const roles = warfrontRoleMap(fighters, f.team);
    const role = roles.get(f.id) ?? "escort";
    const ownScroll = _warfrontRelics.find((scroll) => scroll.owner === f.team);
    const enemyScroll = _warfrontRelics.find((scroll) => scroll.owner !== f.team);
    if (!ownScroll || !enemyScroll) return null;

    const carriedScroll = _warfrontRelics.find((scroll) => scroll.carrierId === f.id);
    if (carriedScroll) {
        const homeDx = ownScroll.homeX - f.x, homeDy = ownScroll.homeY - f.y;
        const homeDistance = Math.max(1e-4, Math.hypot(homeDx, homeDy));
        const travelX = homeDx / homeDistance, travelY = homeDy / homeDistance;
        const blocker = nearestFighter(f, enemies.filter((enemy) => {
            const bx = enemy.x - f.x, by = enemy.y - f.y;
            const gap = Math.hypot(bx, by);
            return gap < 5.4 && bx * travelX + by * travelY > 0.45;
        }));
        if (blocker) {
            // Both carriers (or a carrier and Guardian) can meet head-on in a
            // one-cell corridor. Always take the same local right-hand juke;
            // opposite travel directions make the world-space lanes mirror.
            const passX = f.x + travelX * 3.2 + travelY * 4.4;
            const passY = f.y + travelY * 3.2 - travelX * 4.4;
            return {
                goal: snapPos(passX, passY),
                plan: "juke past the interception line",
                reason: "a defender blocks the carrier's return corridor",
                arrive: 1.1,
            };
        }
        if ((ownScroll.state as string) !== "home") {
            // Classic CTF cannot score while the team's own scroll is missing.
            // Parking the carrier on the altar created a static 1v1 on each end
            // after simultaneous steals. Run a two-point extraction loop instead:
            // the carrier stays readable on its own half, while Guardian + Escort
            // get a moving interception problem that must resolve the deadlock.
            const homeSign = Math.sign(ownScroll.homeX) || (f.team === "player" ? -1 : 1);
            const loopX = ownScroll.homeX - homeSign * 5.8;
            const priorLoopY = Math.abs(f.routeY) >= 4.8 ? f.routeY : 0;
            const loopY = f.routeActive && priorLoopY
                ? priorLoopY
                : priorLoopY
                    ? -priorLoopY
                    : (f.slot % 2 === 0 ? 1 : -1) * 6.8;
            return {
                goal: snapPos(loopX, loopY),
                plan: "evade with the stolen scroll",
                reason: "our missing scroll must be recovered before capture",
                arrive: 1.35,
            };
        }
        return {
            goal: [ownScroll.homeX, ownScroll.homeY],
            plan: "extract the stolen scroll",
            reason: "returning the enemy scroll wins the clash",
            arrive: WARFRONT_RELIC_CAPTURE_RADIUS * 0.72,
        };
    }

    const teamCarrier = enemyScroll.carrierId
        ? allies.find((ally) => ally.id === enemyScroll.carrierId) ?? null
        : null;
    const enemyCarrier = ownScroll.carrierId
        ? enemies.find((enemy) => enemy.id === ownScroll.carrierId) ?? null
        : null;
    const raider = allies.find((ally) => roles.get(ally.id) === "raider") ?? allies[0];

    if (role === "guardian") {
        if (enemyCarrier) {
            if (Math.hypot(enemyCarrier.x - f.x, enemyCarrier.y - f.y) <= 5.2) return null;
            return { goal: [enemyCarrier.x, enemyCarrier.y], plan: "hunt our scroll carrier", reason: "recover the stolen clan scroll", arrive: 3.6 };
        }
        if (ownScroll.state === "dropped") {
            return { goal: [ownScroll.x, ownScroll.y], plan: "recover our fallen scroll", reason: "a clan touch returns it to the altar", arrive: WARFRONT_RELIC_PICKUP_RADIUS * 0.65 };
        }
        const shrineThreat = enemies.some((enemy) => Math.hypot(enemy.x - ownScroll.homeX, enemy.y - ownScroll.homeY) <= 7.6);
        if (shrineThreat) return null;
        return {
            goal: [ownScroll.homeX - Math.sign(ownScroll.homeX) * 6.2, ownScroll.homeY],
            plan: "patrol the scroll gate",
            reason: "the rear post protects the clan scroll",
            arrive: 2.4,
        };
    }

    const protectedRunner = teamCarrier ?? raider;
    if (role === "escort" && protectedRunner && protectedRunner.id !== f.id) {
        if (enemyCarrier) {
            if (Math.hypot(enemyCarrier.x - f.x, enemyCarrier.y - f.y) <= 4.8) return null;
            return { goal: [enemyCarrier.x, enemyCarrier.y], plan: "collapse on the scroll thief", reason: "two interceptors break a double-steal deadlock", arrive: 3.2 };
        }
        const personalThreat = enemies.some((enemy) => Math.hypot(enemy.x - f.x, enemy.y - f.y) <= 3.8);
        if (personalThreat) return null;
        // Slot offsets live in team space. Red's world-space Y must rotate with
        // its X or matching formations stop being 180-degree mirrors and one
        // clan inherits the cleaner escort lane.
        const teamMirror = f.team === "player" ? 1 : -1;
        const side = (f.slot % 2 === 0 ? 1 : -1) * teamMirror;
        const teamSign = f.team === "player" ? -1 : 1;
        const escortX = protectedRunner.x + teamSign * 3.8;
        const escortY = protectedRunner.y + side * 3.4;
        return { goal: snapPos(escortX, escortY), plan: teamCarrier ? "screen the stolen scroll" : "escort the infiltrator", reason: "hold a separate flanking pocket", arrive: 1.55 };
    }

    // If a teammate already has the scroll, the forward post becomes a second
    // escort instead of running to an empty shrine.
    if (teamCarrier) {
        const threat = enemies.some((enemy) => Math.hypot(enemy.x - teamCarrier.x, enemy.y - teamCarrier.y) <= 5.8);
        if (threat) return null;
        return { goal: [teamCarrier.x, teamCarrier.y], plan: "clear the scroll carrier's return route", reason: "the enemy scroll is in friendly hands", arrive: 2.8 };
    }

    const nearestThreat = nearestFighter(f, enemies);
    const threatDistance = nearestThreat ? Math.hypot(nearestThreat.x - f.x, nearestThreat.y - f.y) : Infinity;
    // A lone survivor must keep playing the objective. Otherwise two last pets
    // can stare each other down at midfield until the 75-second cap.
    if (allies.length === 1 && nearestThreat && threatDistance < 5.4) {
        const relicDx = enemyScroll.x - f.x, relicDy = enemyScroll.y - f.y;
        const relicDistance = Math.max(1e-4, Math.hypot(relicDx, relicDy));
        const travelX = relicDx / relicDistance, travelY = relicDy / relicDistance;
        const blockX = nearestThreat.x - f.x, blockY = nearestThreat.y - f.y;
        if (blockX * travelX + blockY * travelY > 0.45) {
            return {
                goal: snapPos(f.x + travelX * 3.2 + travelY * 4.4, f.y + travelY * 3.2 - travelX * 4.4),
                plan: "slip the last defender",
                reason: "the lone survivor must keep infiltrating",
                arrive: 1.1,
            };
        }
    }
    // Raiders do not abandon the heist merely because a defender is nearby.
    // That proximity fallback was the archive-deathmatch bug: both Raiders
    // stopped on first contact and traded until somebody died. Escorts own the
    // screen fight; the Raider keeps pathing to the scroll and then runs it home.
    return {
        goal: [enemyScroll.x, enemyScroll.y],
        plan: enemyScroll.state === "dropped" ? "secure the fallen enemy scroll" : "infiltrate the enemy archive",
        reason: "the Raider must breach the opposing shrine",
        arrive: WARFRONT_RELIC_PICKUP_RADIUS * 0.68,
    };
}

/** Shadow Relay has three distinct acts: split to cipher seals, breach the
 * neutral vault, then screen or intercept one visible carrier. Damage is a tool
 * for disrupting those jobs; it is never the neutral destination. */
function warfrontTravelOrder(f: Fighter, fighters: Fighter[]): WarfrontTravelOrder | null {
    if (!_warfrontMode) return null;
    // Saved legacy replays may still contain the retired pair of clan scrolls.
    if (_warfrontRelics.length === 2) return legacyWarfrontTravelOrder(f, fighters);
    const scroll = warfrontScroll();
    if (!scroll) return null;
    const allies = fighters.filter((ally) => ally.team === f.team && ally.hp > 0);
    const enemies = fighters.filter((enemy) => enemy.team !== f.team && enemy.hp > 0);
    const roles = warfrontRoleMap(fighters, f.team);
    const role = roles.get(f.id) ?? "escort";
    const carrier = scroll.carrierId ? fighters.find((fighter) => fighter.id === scroll.carrierId) ?? null : null;

    if (carrier) {
        const gateX = carrier.team === "player" ? -WARFRONT_RELIC_HOME_X : WARFRONT_RELIC_HOME_X;
        const travelSign = Math.sign(gateX - carrier.x) || (carrier.team === "player" ? -1 : 1);
        if (carrier.id === f.id) {
            const blocker = nearestFighter(f, enemies.filter((enemy) => {
                const ahead = (enemy.x - f.x) * travelSign;
                return ahead > -0.5 && ahead < 7 && Math.abs(enemy.y - f.y) < 5.2;
            }));
            if (blocker) {
                const passY = clamp(f.y + (f.slot % 2 === 0 ? 1 : -1) * 5.4, -WARFRONT_ARENA_Y + 2, WARFRONT_ARENA_Y - 2);
                return { goal: snapPos(f.x + travelSign * 4.2, passY), plan: "shadow-step around the interception", reason: "a hunter blocks the extraction line", arrive: 1.15 };
            }
            return { goal: [gateX, 0], plan: "extract the Forbidden Scroll", reason: "cross the revealed clan gate to score", arrive: WARFRONT_RELIC_CAPTURE_RADIUS * 0.72 };
        }

        if (carrier.team === f.team) {
            const personalThreat = nearestFighter(f, enemies.filter((enemy) => Math.hypot(enemy.x - f.x, enemy.y - f.y) <= 4.4));
            if (personalThreat) return null;
            const side = (f.slot % 2 === 0 ? 1 : -1) * 4.2;
            return {
                goal: snapPos(carrier.x - travelSign * 3.8, clamp(carrier.y + side, -WARFRONT_ARENA_Y + 2, WARFRONT_ARENA_Y - 2)),
                plan: role === "guardian" ? "seal the rear pursuit" : "screen the scroll runner",
                reason: "the carrier needs a moving protection triangle",
                arrive: 1.7,
            };
        }

        const interceptX = clamp(carrier.x + travelSign * (role === "guardian" ? 7.5 : 5.2), -WARFRONT_ARENA_X + 2, WARFRONT_ARENA_X - 2);
        const interceptY = clamp(carrier.y + (f.slot % 2 === 0 ? 1 : -1) * (role === "escort" ? 3.6 : 1.8), -WARFRONT_ARENA_Y + 2, WARFRONT_ARENA_Y - 2);
        if (Math.hypot(carrier.x - f.x, carrier.y - f.y) <= 5.3) return null;
        return { goal: snapPos(interceptX, interceptY), plan: "cut off the scroll carrier", reason: "one clean tag forces a scroll drop", arrive: 2.2 };
    }

    if (scroll.state === "available" || scroll.state === "dropped") {
        const raider = allies.find((ally) => roles.get(ally.id) === "raider") ?? allies[0];
        if (f.id === raider?.id) {
            return { goal: [scroll.x, scroll.y], plan: scroll.state === "dropped" ? "reclaim the dropped scroll" : "breach the opened vault", reason: "the forward post becomes the runner", arrive: WARFRONT_RELIC_PICKUP_RADIUS * 0.68 };
        }
        const closeThreat = nearestFighter(f, enemies.filter((enemy) => Math.hypot(enemy.x - f.x, enemy.y - f.y) <= 4.2));
        if (closeThreat) return null;
        const teamSign = f.team === "player" ? -1 : 1;
        const screenY = (f.slot % 2 === 0 ? 1 : -1) * 5.6;
        return { goal: snapPos(scroll.x + teamSign * 5.4, scroll.y + screenY), plan: "hold the vault screen", reason: "deny the rival runner a clean approach", arrive: 1.8 };
    }

    const seal = preferredWarfrontSeal(f, fighters);
    if (!seal) return { goal: [0, f.homeY * 0.35], plan: "rotate toward the sealed archive", reason: "our cipher pair is complete", arrive: 2.1 };
    const blocker = nearestFighter(f, enemies.filter((enemy) => (
        Math.hypot(enemy.x - seal.x, enemy.y - seal.y) <= WARFRONT_SIGIL_RADIUS + 2.2
        && Math.hypot(enemy.x - f.x, enemy.y - f.y) <= 4.8
    )));
    if (blocker && Math.hypot(f.x - seal.x, f.y - seal.y) <= WARFRONT_SIGIL_RADIUS + 1.8) return null;
    const approachX = seal.x + (f.team === "player" ? -1 : 1) * 0.9;
    // Alternating channel notches keep the pressure pair readable without
    // changing the capture race's mirror-fair timing.
    const approachY = seal.y + (f.slot % 2 === 0 ? 0.8 : -0.8);
    return {
        goal: snapPos(approachX, approachY),
        plan: seal.state === "contested" ? "reinforce the contested cipher" : `channel ${seal.id.replace("seal-", "")} cipher`,
        reason: "two claimed seals open the Forbidden Scroll vault",
        arrive: WARFRONT_SIGIL_RADIUS * 0.55,
    };
}

function decide(f: Fighter, fighters: Fighter[], projectiles: Projectile[], rng: () => number, t: number, events: DuelEvent[]) {
    const e = pickTarget(f, fighters);
    f.targetId = e ? e.id : null;
    if (!e) {
        setIntent(f, "regroup", 0, "scan for next target", "no active opponent remains");
        f.vx *= 0.8; f.vy *= 0.8; return;
    }
    const dx = e.x - f.x, dy = e.y - f.y;
    const d = Math.max(1e-4, Math.sqrt(dx * dx + dy * dy));
    const hpFrac = f.hp / f.maxHp;
    // EARNED COMMAND WINDOW — this sits ahead of the normal AI reads on purpose.
    // The meter bought the right to seize this beat, so cooldown, stamina, spacing
    // resets and an incoming telegraph cannot silently turn the call into a basic.
    if (f.cmdTechnique && f.cmdIdx >= 0 && f.cmdIdx < f.abilities.length) {
        const idx = f.cmdIdx;
        const ab = f.abilities[idx];
        ab.cdLeft = 0;
        f.stamina = Math.max(f.stamina, ab.cost);
        f.reposLeft = 0;
        f.routeActive = false;
        f.maneuverLeft = 0;
        f.guardLeft = 0;
        f.postDodgeSupport = false;
        setIntent(
            f,
            ab.cls === "support" ? "prepare combo" : ab.isMove ? "reposition" : "burst",
            d,
            `command window: ${ab.name}`,
            "the player spent a full command meter",
        );
        if (ab.isMove) {
            beginManeuver(f, e, idx, t, events);
            f.cmdIdx = -2;
            f.cmdLeft = 0;
            f.cmdTechnique = false;
        } else {
            beginCast(f, idx, ab.cls === "support" ? f.id : e.id, t, events);
        }
        return;
    }
    // STANCE — the player's zero-APM strategic dial, folded into the same three knobs
    // the AI already reasons with. Balanced (and every uncontrolled fighter) reads the
    // style values unchanged, and both clamps are no-ops there because deriveStyle
    // already clamped to these bounds → byte-identical on the authoritative path.
    const st = stanceOf(f);
    const styleAggression = clamp(f.style.aggression + st.aggression, 0, 1);
    const styleRetreatHp = clamp(f.style.retreatHp + st.retreatHp, 0.08, 0.75);
    const styleDodgeBias = f.style.dodgeBias + st.dodgeBias;
    // DESPERATION last-stand — a wounded AGGRESSIVE fighter (rusher/brawler, an Aggressive/
    // Battleborn trait, or an endure/lifeline charge in the tank) stops fleeing and gathers
    // for one committed strike: the anime last-ditch attack that sometimes reverses a fight.
    // Kiters/supports still flee (preserves style-contrast).
    const desperateHp = Math.max(CRIT_HP, 0.28);
    const desperate = hpFrac < desperateHp && (f.style.arche === "rusher" || f.style.arche === "brawler"
        || f.pet.trait === "Aggressive" || f.pet.trait === "Battleborn" || f.cEndure > 0 || f.cLifelinePct > 0);
    // KILL-SHOT — the foe is nearly dead: drop the in-out reposition beat and go finish it.
    const enemyHpFrac = e.hp / e.maxHp;
    const killShot = enemyHpFrac < Math.max(KILL_HP, 0.22);

    // Cache support readiness before the defensive read. A ready buff no longer
    // steals priority from an incoming telegraph; the pet evades first, then earns
    // room and powers up as one readable anime phrase.
    const sup = readySupport(f, fighters);
    // 1) ACTIVE DODGE — the enemy is winding up a blow aimed at me and I can still
    // move out of it. SPEED-gated: a fast pet reacts + clears; a slow one can't.
    // A last-stand does NOT dodge — it commits.
    const incomingWindup = e.state === "windup" && e.pendingTargetId === f.id && e.stateLeft >= 2;
    const incomingPounce = e.state === "dash" && e.lungeAbIdx > -2 && e.lungeTgtId === f.id && e.stateLeft >= 3;
    if (!desperate && f.dodgeCd <= 0 && f.stamina >= COST_DODGE && f.statuses.rootLeft <= 0
        && (incomingWindup || incomingPounce)) {
        const eAb = incomingPounce
            ? (e.lungeAbIdx >= 0 ? e.abilities[e.lungeAbIdx] : null)
            : (e.pendingIdx >= 0 ? e.abilities[e.pendingIdx] : null);
        const meleeTell = eAb ? eAb.cls === "melee" : !e.basicRanged;
        const threatRange = meleeTell ? MELEE_RANGE + 0.9 : (eAb ? eAb.range : RANGED_RANGE * 0.85);
        if (d <= threatRange) {
            // Controlled-stance disposition: Guard READS and evades far more, Press
            // eats the hit to keep trading. Balanced/uncontrolled = ×1 (byte-identical).
            const stanceDodge = f.controlled ? (f.stance === 2 ? 1.9 : f.stance === 0 ? 0.45 : 1) : 1;
            const chance = Math.min(0.9, clamp(0.22 + (f.spd - e.spd) * 0.0022 + styleDodgeBias, 0.05, 0.85) * stanceDodge) * (1 - (_forcedEngage ? 1 : _stallPressure));
            if (rng() < chance) {   // rng() always drawn (order preserved); stall just lowers the threshold → no dodge
                // Sidestep perpendicular to the incoming line (away from arena edge).
                let px = -dy / d, py = dx / d;
                if (!walkableAt(f.x + px * 1.6, f.y + py * 1.6)) { px = -px; py = -py; }
                f.moveDx = px; f.moveDy = py; f.state = "dodge"; f.stateLeft = f.dodgeT;
                f.postDodgeSupport = sup >= 0;
                // A successful read breaks the lock of the ranged attack that was
                // visibly telegraphed. Otherwise it releases after the hop and homes
                // into the pet during its buff, making the dodge look fake.
                const rangedTell = eAb ? eAb.cls === "ranged" : e.basicRanged;
                if (incomingWindup && rangedTell) e.pendingTargetId = null;
                f.stamina -= COST_DODGE; f.dodgeCd = Math.round(DUEL_TPS * 1.8); f.vx = 0; f.vy = 0;
                setIntent(f, "escape danger", Math.max(4.5, d + 2), f.postDodgeSupport ? "sidestep, disengage, then power up" : "sidestep and reset", incomingPounce ? "incoming committed pounce" : "incoming attack telegraph");
                events.push({ t, type: "dodge", side: f.team, actorId: f.id, move: "Evade" });
                return;
            }
            // One read per telegraph. Without this short failed-read lockout, the
            // defender rerolled every pounce tick and eventually dodged nearly every hit.
            f.dodgeCd = Math.max(f.dodgeCd, Math.round(DUEL_TPS * 0.4));
        }
    }

    // 2) DODGE FOLLOW-THROUGH — continue the side-hop into a diagonal backward
    // lane, reach the destination, plant, then self-buff. This is deliberately
    // serialized so the pet never jitters between flee/cast decisions every tick.
    if (f.postDodgeSupport) {
        const postSup = readySupport(f, fighters);
        if (postSup < 0) f.postDodgeSupport = false;
        else {
            const remaining = Math.hypot(f.routeX - f.x, f.routeY - f.y);
            const routeDx = f.routeX - f.x, routeDy = f.routeY - f.y;
            const targetBlocksRoute = d < SUPPORT_CAST_CLEARANCE - 0.35
                && routeDx * dx + routeDy * dy > 0;
            if (f.routeActive && remaining > 1.15 && !targetBlocksRoute) {
                f.reposLeft = Math.max(1, f.reposLeft);
                setIntent(f, "retreat", Math.max(SUPPORT_CAST_CLEARANCE, d + 1), "open a safe casting pocket", "successful dodge created a buff window");
                followRouteWaypoint(f, e, routeWaypoint(f), true);
                return;
            }
            if (targetBlocksRoute) {
                // The pursuer owns the destination side. Continuing toward the
                // same point makes separation push both pets down one lane at a
                // near-zero crawl forever. Give up the luxury buff and fight.
                f.postDodgeSupport = false;
                f.reposLeft = 0; f.routeActive = false;
                f.vx = 0; f.vy = 0;
                setIntent(f, "engage", d, "abort the cut-off support lane", "opponent reached the escape destination first");
            } else {
            // Re-read the live gap at the destination. A pursuer may have cut the
            // retreat lane while we were travelling; casting here would turn the
            // earned dodge/buff phrase back into a point-blank power-up. Extend the
            // disengage once, along a newly scored escape lane, until the pocket is
            // genuinely safe.
            if (d < SUPPORT_CAST_CLEARANCE) {
                beginDodgeRetreat(f, e);
                setIntent(f, "retreat", SUPPORT_CAST_CLEARANCE, "extend the escape lane before powering up", "pursuer closed the original buff pocket");
                followRouteWaypoint(f, e, routeWaypoint(f), true);
                return;
            }
            f.postDodgeSupport = false;
            f.reposLeft = 0; f.routeActive = false;
            f.vx = 0; f.vy = 0;
            setIntent(f, "prepare combo", SUPPORT_CAST_CLEARANCE, f.abilities[postSup]?.name ?? "self buff", "safe after dodge and disengage");
            beginCast(f, postSup, f.id, t, events);
            return;
            }
        }
    }

    // SCROLL RUN owns neutral travel. A pet only falls through to the combat
    // brain when an opponent contests its job at readable engagement distance.
    // This is the mode change: crossing the board is now progress, not downtime.
    const objectiveOrder = warfrontTravelOrder(f, fighters);
    if (objectiveOrder) {
        const gx = objectiveOrder.goal[0] - f.x, gy = objectiveOrder.goal[1] - f.y;
        const remaining = Math.hypot(gx, gy);
        f.routeX = objectiveOrder.goal[0]; f.routeY = objectiveOrder.goal[1];
        f.reposLeft = 0;
        if (remaining <= objectiveOrder.arrive) {
            f.routeActive = false; f.routeStuck = 0;
            f.vx *= 0.36; f.vy *= 0.36;
            if (Math.hypot(f.vx, f.vy) < 0.012) { f.vx = 0; f.vy = 0; }
            f.faceX = dx / d; f.faceY = dy / d;
            setIntent(f, "hold position", objectiveOrder.arrive, objectiveOrder.plan, objectiveOrder.reason);
            return;
        }
        f.routeActive = true;
        f.routeIntent = "cross";
        setIntent(f, f.id === _warfrontRelics.find((relic) => relic.carrierId === f.id)?.carrierId ? "retreat" : "flank", objectiveOrder.arrive, objectiveOrder.plan, objectiveOrder.reason);
        const routeGoal = hasWalkableRoute(f.x, f.y, objectiveOrder.goal[0], objectiveOrder.goal[1])
            ? objectiveOrder.goal
            : waypointToward(f, objectiveOrder.goal[0], objectiveOrder.goal[1]);
        followRouteWaypoint(f, e, routeGoal, true);
        if (_warfrontRelics.some((relic) => relic.carrierId === f.id)) {
            // The scroll is a readable burden: a runner needs an escort and an
            // interception has time to develop instead of becoming a teleporting
            // seven-second sprint from centre to shrine.
            f.vx *= 0.7;
            f.vy *= 0.7;
        }
        return;
    }

    // CINEMATIC INITIATIVE — only one side drives neutral movement. The rival is
    // not a leash partner: it plants, tracks the pressure pet, and waits for a
    // telegraph/recovery opening. Active dodges above and punish windows below
    // still break the hold, so this remains an autobattle rather than a turn lock.
    // A live ORDER also claims the beat. Without this the initiative hold would
    // swallow the player's command until the AI happened to hand the beat over,
    // which reads as an unresponsive button.
    const ownsBeat = (_warfrontMode
        ? true
        : _partyMode
            ? f.team === _laneInitiativeTeam[laneIndex(f.slot)]
            : f.team === _cinematicInitiativeTeam) || _forcedEngage || hasOrder(f);
    const counterWindow = e.state === "recover" || e.state === "stagger" || e.state === "strike";
    const finishingExit = f.reposLeft > 0 && f.routeActive;
    if (!ownsBeat && !counterWindow && !finishingExit) {
        f.vx = 0; f.vy = 0;
        f.faceX = dx / d; f.faceY = dy / d;
        setIntent(f, "hold position", f.desiredRange, "plant and read the next attack", "opponent owns the current pressure beat");
        return;
    }

    // 3) SUPPORT — outside an active defensive read, support pets still earn room
    // before healing or raising a ward. Opening buff/haste is held briefly: it is
    // available as the payoff for an early successful dodge, but pets that were not
    // pressured do not both stand still and power up at the first possible tick.
    const supportAbility = sup >= 0 ? f.abilities[sup] : null;
    // An explicit order is never held back by the AI's opening-buff restraint.
    const holdOpeningPower = t < Math.round(DUEL_TPS * 2.2) && orderedIdx(f) === -2
        && (supportAbility?.kind === "buff" || supportAbility?.kind === "haste");
    // A commanded MOBILITY move (Dash/Rush/Lunge) is a reposition, not an attack, so
    // it never reaches the offensive picker — fire it here while it is ready.
    const orderedMobility = orderedIdx(f);
    if (orderedMobility >= 0 && f.abilities[orderedMobility].isMove
        && f.abilities[orderedMobility].cdLeft <= 0 && f.stamina >= f.abilities[orderedMobility].cost
        && f.statuses.rootLeft <= 0) {
        setIntent(f, "reposition", Math.max(MELEE_RANGE, d), `commanded ${f.abilities[orderedMobility].name}`, "player ordered a repositioning move");
        beginManeuver(f, e, orderedMobility, t, events);
        f.cmdIdx = -2; f.cmdLeft = 0;
        return;
    }
    if (sup >= 0 && !holdOpeningPower) {
        // "Make room" is a luxury: a support pet backs off to cast a buff/heal safely.
        // But a mutual spacing preference can deadlock — B retreats to make room while
        // A holds to counter B's disengage, so neither closes and the fight freezes at
        // the clearance boundary (observed: two Wind pets frozen 5.05 apart for 60 s).
        // Once a stand-off is CONFIRMED (forcedEngage — only after ~10 s of zero damage),
        // stop making room and just cast where you stand, breaking the limit cycle.
        if (!desperate && !_forcedEngage && d < SUPPORT_CAST_CLEARANCE) {
            setIntent(f, "retreat", SUPPORT_CAST_CLEARANCE, `make room for ${supportAbility?.name ?? "support"}`, "enemy is inside support cast clearance");
            if (!f.routeActive) beginReposition(f, Math.round(DUEL_TPS * 0.9), e);
            else if (f.reposLeft > 0) f.reposLeft--;
            const remaining = Math.hypot(f.routeX - f.x, f.routeY - f.y);
            const routeDx = f.routeX - f.x, routeDy = f.routeY - f.y;
            const targetBlocksRoute = d < SUPPORT_CAST_CLEARANCE - 0.35
                && routeDx * dx + routeDy * dy > 0;
            // This setup is a short escape beat, not a permanent route. The old
            // branch returned before the shared reposition timer could decrement,
            // leaving a blocked support planted at its destination for 16 seconds.
            if (remaining <= 1.15 || f.reposLeft <= 0 || targetBlocksRoute) {
                f.routeActive = false; f.reposLeft = 0;
                f.vx = 0; f.vy = 0;
                setIntent(f, "prepare combo", SUPPORT_CAST_CLEARANCE, supportAbility?.name ?? "support action", "the casting pocket is ready");
                beginCast(f, sup, f.id, t, events);
                return;
            }
            const supportShift = readyMobility(f);
            if (supportShift >= 0 && f.routeActive && f.statuses.rootLeft <= 0) {
                beginManeuver(f, e, supportShift, t, events);
                return;
            }
            followRouteWaypoint(f, e, routeWaypoint(f), true);
            return;
        }
        setIntent(f, "prepare combo", SUPPORT_CAST_CLEARANCE, supportAbility?.name ?? "support action", "support window is safe and ready");
        beginCast(f, sup, f.id, t, events); return;
    }

    // 4) Choose the move I want + the range I want to fight at (R*). The signature is
    // hoarded unless the foe is low/open or this is a last-stand/kill-shot (forceSig).
    const offIdx = commandedOffensive(f, e, desperate || killShot);
    const offAb = offIdx >= 0 ? f.abilities[offIdx] : null;
    const useRanged = offAb ? offAb.cls === "ranged" : f.basicRanged;
    const moveRange = offAb ? offAb.range : (f.basicRanged ? RANGED_RANGE * 0.85 : f.reach);
    // Desperation drops the retreat penalty and presses ALL-IN.
    const aggr = desperate ? 1 : clamp(styleAggression - (hpFrac < styleRetreatHp ? 0.3 : 0), 0, 1);
    // R* — the distance to fight at. CRITICAL for ranged: it must sit INSIDE firing
    // range (even at the far edge of the ±BAND_H band) so a kiter's pokes always
    // connect instead of parking just out of reach and stalling. Cautious pets edge
    // toward max range; aggressive ones press inward.
    let rStar: number;
    if (useRanged) {
        // Ranged exchanges deliberately change depth. Each fighter enters this
        // four-beat phrase at a different point, so the pair alternates close
        // pressure, midrange volleys, and long-range resets instead of preserving
        // one constant leash distance for the entire fight.
        // Keep a genuine ranged identity even on its closest pressure beat. The old
        // 0.58 slot dragged kiters into melee, making each exit look like panic.
        const rangePhrase = [0.58, 0.94, 0.72, 0.86] as const;
        const phraseRange = moveRange * rangePhrase[f.spacingBeat % rangePhrase.length];
        rStar = clamp(phraseRange + (0.5 - aggr) * 0.35 + f.style.rangeBias, MELEE_RANGE + 0.5, moveRange - 0.4);
    } else {
        rStar = MELEE_RANGE * clamp(1.1 - aggr * 0.3, 0.85, 1.15) + f.style.rangeBias * 0.2;
    }
    // STANCE is the player's headline dial, so give it TEETH beyond the small nudge
    // it makes to aggression inside the clamps above: Press pulls the engagement range
    // IN so the pet closes and trades; Guard pushes it OUT so the pet holds spacing and
    // reads. Controlled-only and a no-op for Balance (stance 1), so every uncontrolled
    // fighter and the whole authoritative path stay byte-identical — only a deliberate
    // Press/Guard order from the player moves this.
    if (f.controlled) {
        if (f.stance === 0) rStar = Math.max(MELEE_RANGE * 0.92, rStar * 0.62);                                    // Press: close the distance
        else if (f.stance === 2) rStar = Math.min((useRanged ? moveRange - 0.4 : MELEE_RANGE * 2.2), rStar * 1.45); // Guard: hold range
    }

    // 4) PUNISH — the enemy just whiffed / is recovering: press the opening HARD
    // (ignores the reposition beat — you don't wait when the foe is wide open).
    const enemyOpen = e.state === "recover" || e.state === "stagger";
    // Post-attack REPOSITION beat: back out + circle before re-committing, so the
    // fight has an in-out cadence and the movement is visible (not a trade every tick).
    // A wide-open enemy (PUNISH) or an interrupt-ready control move overrides it.
    if (f.reposLeft > 0) f.reposLeft--;
    // Once a fighter has committed, it must finish the exit beat before attacking
    // again. An open enemy is still pursued after the reset; it no longer cancels the
    // reset and turns the exchange into repeated point-blank smacks.
    // A standing player order also cancels the exit beat: being told to do something
    // must beat the choreography, or the pet dances out for a second before obeying.
    const holdRepos = f.reposLeft > 0 && !killShot && !desperate && !hasOrder(f);
    if (!holdRepos) f.routeActive = false;
    // A loadout's movement slot now caps the running exit with a CURVED elemental
    // traversal. It is not the pounce/dash state: the pet runs a crescent lane,
    // pivots, plants, and only then re-engages.
    const mobilityIdx = readyMobility(f);
    if (holdRepos && !f.reposManeuverUsed && mobilityIdx >= 0 && f.routeActive
        && f.statuses.rootLeft <= 0) {
        setIntent(f, hpFrac < f.style.retreatHp ? "retreat" : "reposition", Math.max(rStar, minRepositionRange()), `use ${f.abilities[mobilityIdx].name} to change lanes`, hpFrac < f.style.retreatHp ? "low health disengage" : "post-attack spacing reset");
        beginManeuver(f, e, mobilityIdx, t, events);
        return;
    }
    // 5) FIRE if a move is ready and the target is genuinely in range. Melee no longer
    // receives a hidden dash-in allowance: it must earn contact through locomotion,
    // while ranged attacks still require a clear line through the arena.
    const meleeOff = offAb != null && offAb.cls !== "ranged";
    // Simulation centres stay apart to protect the 3D creature silhouettes. A
    // melee tell may therefore start from the visible body-edge pocket, then its
    // post-windup pounce bridges the remaining centre distance.
    const commitRange = offAb == null ? 0 : meleeOff ? Math.max(offAb.range + 0.25, MIN_SEP + 1.15) : offAb.range;
    const meleeRouteOpen = !_warfrontMode || hasWalkableRoute(f.x, f.y, e.x, e.y);
    const losForCommit = d <= MELEE_RANGE + 0.6
        ? meleeRouteOpen
        : hasLineOfSight(f.x, f.y, e.x, e.y);
    const canFire = !holdRepos && offAb != null && d <= commitRange && losForCommit && (f.faceX * dx + f.faceY * dy) > -0.2;
    if (canFire) {
        setIntent(f, offAb.signature || killShot || desperate ? "burst" : "execute combo", rStar, offAb.name, killShot ? "enemy is vulnerable" : desperate ? "last-stand opening" : "ability is ready, in range, and line of sight is clear");
        f.commit = 0; beginCast(f, offIdx, e.id, t, events); return;
    }
    // A commanded move that is READY but still out of reach owns the approach. Without
    // this the pet would keep taking free ranged pokes from its comfortable neutral
    // range and never close, so an ordered melee move — a Bond Break above all — could
    // sit queued for the whole fight. Inert for an uncontrolled fighter.
    const closingForOrder = hasOrder(f) && offAb != null && !canFire;
    // Basic attack — melee must already be at contact range; ranged basics poke.
    if (!holdRepos && !closingForOrder && f.basicCdLeft <= 0 && f.stamina >= COST_BASIC) {
        const basicRange = f.basicRanged ? RANGED_RANGE * 0.85 : Math.max(f.reach + 0.35, MIN_SEP + 1.15);
        const basicLos = f.basicRanged ? hasLineOfSight(f.x, f.y, e.x, e.y) : losForCommit;
        if (d <= basicRange && basicLos && (f.faceX * dx + f.faceY * dy) > -0.2) {
            setIntent(f, killShot ? "burst" : "attack", rStar, f.basicRanged ? "ranged pressure" : "contact strike", killShot ? "enemy is vulnerable" : "basic attack window is open");
            f.commit = 0; beginCast(f, -1, e.id, t, events); return;
        }
    }

    // A pet placed on either rear column becomes a HOME GUARD because of where
    // the player put it, not because a job label was assigned. It holds while a
    // living teammate is deployed materially closer to centre, then joins once
    // that screen has collapsed. Players may field zero, one, or several guards.
    const rearDeployed = Math.abs(f.homeX) >= 14.5;
    if (_warfrontMode && rearDeployed && !holdRepos && !_forcedEngage) {
        const screenAlive = fighters.some((ally) => ally.team === f.team && ally.hp > 0
            && Math.abs(ally.homeX) < Math.abs(f.homeX) - 2);
        const threatRange = Math.max(
            commitRange,
            f.basicRanged ? RANGED_RANGE * 0.85 : Math.max(f.reach + 0.35, MIN_SEP + 1.15),
        );
        if (screenAlive && d > threatRange) {
            const homeDx = f.homeX - f.x, homeDy = f.homeY - f.y;
            const homeDistance = Math.hypot(homeDx, homeDy);
            f.routeActive = false; f.reposLeft = 0;
            if (homeDistance > 0.7) {
                setIntent(f, "regroup", threatRange, "return to the Anchor post", "the protection screen still holds");
                followRouteWaypoint(f, e, [f.homeX, f.homeY]);
            } else {
                f.vx = 0; f.vy = 0;
                f.faceX = dx / d; f.faceY = dy / d;
                setIntent(f, "hold position", threatRange, "guard the home post", "Vanguard and Warden still protect the line");
            }
            return;
        }
    }

    // Only one side owns the ingress burst for an exchange. It dashes to an
    // offset firing pocket (never into the opponent's body); the other side may
    // hold, dodge, or answer after the shared pressure role flips next beat.
    const pressureTeam: Fighter["team"] = _warfrontMode
        ? f.team
        : _partyMode
            ? _laneInitiativeTeam[laneIndex(f.slot)]
            : _cinematicInitiativeTeam;
    if (!holdRepos && mobilityIdx >= 0 && f.team === pressureTeam && f.commit >= Math.round(DUEL_TPS * 0.55)
        && d > rStar + BAND_H + 1.8 && f.statuses.rootLeft <= 0 && e.state !== "windup") {
        setIntent(f, "flank", rStar, `burst to an offset ${useRanged ? "firing" : "attack"} lane`, "owns this exchange's ingress");
        if (beginEngageManeuver(f, e, mobilityIdx, rStar, t, events)) return;
    }

    // 6) Nothing to fire → position via context steering. The anti-stall backstop
    // tightens desired range but never teleports or dashes either fighter into contact.
    if (offAb || f.basicCdLeft <= 0) f.commit++; else f.commit = Math.max(0, f.commit - 1);
    if (f.commit > Math.round(DUEL_TPS * 1.25)) {
        if (!useRanged) {
            rStar = Math.min(rStar, MELEE_RANGE * 0.78);
            f.commit = Math.round(DUEL_TPS * 1.2);
        } else {
            rStar = Math.min(rStar, moveRange * 0.55);
            f.commit = Math.round(DUEL_TPS * 1.2);
        }
    }
    if ((enemyOpen || killShot) && !useRanged && d > moveRange) rStar = Math.min(rStar, moveRange * 0.9);   // press the opening / go for the kill
    if (holdRepos) rStar = Math.max(rStar + f.style.reposBack + f.spacingOffset, minRepositionRange());
    else rStar = Math.max(MELEE_RANGE * 0.82, rStar + f.spacingOffset * (useRanged ? 0.34 : 0.16));
    // STALL BREAKER: collapse R* toward melee so a no-damage kiter stand-off is forced to close
    // and trade (the stronger stats then win). p=0 in normal fights → no effect.
    { const p = _forcedEngage ? 1 : _stallPressure; if (p > 0) rStar *= 1 - 0.9 * p; }
    if (holdRepos) setIntent(f, hpFrac < f.style.retreatHp ? "retreat" : "reposition", rStar, "complete the exit lane and re-evaluate", hpFrac < f.style.retreatHp ? "health is below retreat threshold" : "attack recovery requires a spacing reset");
    else if (killShot || desperate) setIntent(f, "burst", rStar, "close and finish", killShot ? "enemy is vulnerable" : "last-stand pressure");
    else if (useRanged && d < rStar - BAND_H) setIntent(f, "kite", rStar, "open ranged spacing", "enemy is inside preferred range");
    else if (d > rStar + BAND_H) setIntent(f, "engage", rStar, "claim preferred attack range", "target is outside effective range");
    else setIntent(f, "hold position", rStar, "read cooldowns and preserve the firing pocket", "already inside preferred range band");
    // Central duel-stage arbitration: only one fighter may own a full exit route at
    // a time. If both attempt to reset, the newer route wins; an exact tie follows
    // the lane's current initiative in Warfront instead of permanently favoring
    // the blue/player seat. The other fighter plants and watches the lane rather
    // than becoming a second runner.
    const sharedExitTieOwner: Fighter["team"] = _warfrontMode
        ? _laneInitiativeTeam[laneIndex(f.slot)]
        : "player";
    const rivalOwnsSharedExit = holdRepos && e.reposLeft > 0 && e.routeActive
        && (e.reposLeft > f.reposLeft || (e.reposLeft === f.reposLeft && e.team === sharedExitTieOwner));
    if (rivalOwnsSharedExit) {
        setIntent(f, "hold position", rStar, "plant and cover the opponent's exit lane", "opponent owns the shared reset route");
        f.routeActive = false; f.reposLeft = 0;
        f.vx = 0; f.vy = 0;
        f.faceX = dx / d; f.faceY = dy / d;
        return;
    }
    // A reset owns a real destination. Run there, wrap around cover if necessary,
    // then plant and watch the opponent until the beat expires. This branch never
    // asks for a radius around the foe, so it cannot devolve into circling.
    if (holdRepos && f.routeActive) {
        const gx = f.routeX - f.x, gy = f.routeY - f.y;
        if (gx * gx + gy * gy <= 1.2 * 1.2) {
            f.vx *= 0.42; f.vy *= 0.42;
            if (Math.hypot(f.vx, f.vy) < 0.012) { f.vx = 0; f.vy = 0; }
            // A 1v1 cinematic can afford a long planted stare after reaching its
            // mark. In a six-pet Warfront that reads as a frozen actor, especially
            // when two other cells remain active. Keep only a quick arrival beat,
            // then let this pet re-evaluate and use the lane it just earned.
            if (_warfrontMode) f.reposLeft = Math.min(f.reposLeft, Math.round(DUEL_TPS * 0.28));
            f.faceX = dx / d; f.faceY = dy / d;
            return;
        }
        // Global pathfinding owns obstacle navigation. This turns a stump from a
        // collision circle into a decision: take its protected side, wrap a chosen
        // edge, then emerge on a new attack angle.
        const destination = routeWaypoint(f);
        setIntent(f, hpFrac < f.style.retreatHp ? "retreat" : "reposition", rStar, "run the committed arena route", hpFrac < f.style.retreatHp ? "create recovery distance" : "change depth and attack angle");
        followRouteWaypoint(f, e, destination, true);
        return;
    }
    // The opponent owns a reset route. Hold the current stage mark and track it;
    // attacks above may still catch the runner, but locomotion never follows the
    // same line or destination. This creates a clean distance break before the
    // next side receives initiative.
    // Holding to counter the enemy's disengage is the other half of the deadlock
    // above: if I plant here while the enemy is "making room", neither of us closes.
    // A confirmed stand-off (forcedEngage) overrides the counter-wait and makes me
    // pursue, so a mutual spacing standoff resolves into a brawl.
    if (!_warfrontMode && !holdRepos && !_forcedEngage && e.reposLeft > 0 && e.routeActive) {
        setIntent(f, "hold position", rStar, "track the disengage and prepare a counter", "opponent owns the exit beat");
        f.vx = 0; f.vy = 0;
        f.faceX = dx / d; f.faceY = dy / d;
        return;
    }
    // Warfront navigation has an authored destination layer above local
    // avoidance. Pressure partners claim opposite target-relative sockets while
    // the screen intercepts the other team's pressure cell. Ordinary steering
    // owns only the final attack band inside that squad plan.
    if (_warfrontMode && !holdRepos && !_forcedEngage) {
        const engagement = reservedEngagementGoal(f, e, fighters, rStar);
        const gx = engagement[0] - f.x, gy = engagement[1] - f.y;
        if (gx * gx + gy * gy > 0.72 * 0.72) {
            // Most claims are straight runs inside one broad lane. Preserve the
            // original BFS cadence for duel routes, but only invoke it here when
            // the Warfront seal or a temporary wall actually blocks this socket.
            const direct = hasWalkableRoute(f.x, f.y, engagement[0], engagement[1]);
            const mazeDetour = direct ? null : warfrontMazeDetour(f, e);
            const waypoint = direct
                ? engagement
                : mazeDetour ?? waypointToward(f, engagement[0], engagement[1]);
            followRouteWaypoint(f, e, waypoint, Boolean(mazeDetour));
            return;
        }
    }
    // Low ruins do not stop projectiles, but they do stop a body. Melee always
    // clears the corner; a ranged pet does the same when it is too far away to
    // shoot. Otherwise a support can see over the wall while its direct movement
    // repeatedly strikes the collision rectangle, producing a frozen face-off.
    if (_warfrontMode && (!useRanged || d > rStar + BAND_H)
        && !hasWalkableRoute(f.x, f.y, e.x, e.y)) {
        const mazeDetour = warfrontMazeDetour(f, e);
        if (mazeDetour) {
            setIntent(f, "flank", rStar, "clear a low labyrinth wall", "contact range is not physically reachable");
            followRouteWaypoint(f, e, mazeDetour, true);
            return;
        }
    }
    // Route around terrain (BFS waypoint) when the direct line to the foe is blocked.
    let routeGoal: [number, number] | undefined;
    if (!hasLineOfSight(f.x, f.y, e.x, e.y)) {
        const mazeDetour = warfrontMazeDetour(f, e);
        if (mazeDetour) {
            setIntent(f, "flank", rStar, "commit past a labyrinth corner", "a ruin blocks line of sight");
            followRouteWaypoint(f, e, mazeDetour, true);
            return;
        }
        // Close cover stand-off: both fighters take opposite world-space edges
        // (their target vectors are reversed), so they do not meet nose-to-nose
        // at the same shortest-path cell. The first pet to clear an edge can fire;
        // the other may keep wrapping, producing a real peek/flank exchange.
        let targetX = e.x, targetY = e.y;
        if (d < 5.0) {
            targetX = f.x - (dy / d) * 3.1;
            targetY = f.y + (dx / d) * 3.1;
            [targetX, targetY] = snapPos(targetX, targetY);
        }
        const nxt = bfsNextStep(cellCol(f.x), cellRow(f.y), cellCol(targetX), cellRow(targetY), f.team);
        if (nxt) {
            routeGoal = cellCenter(nxt[0], nxt[1]);
            setIntent(f, "flank", rStar, "path around blocked line of sight", "terrain or a temporary wall blocks the direct angle");
            followRouteWaypoint(f, e, routeGoal);
            return;
        }
    }
    steer(f, e, fighters, rStar, routeGoal, holdRepos);
}

// ── Per-fighter tick ─────────────────────────────────────────────────────────────
/** Advances a fighter's status timers and applies any DoT tick. Returns the
 *  damage dealt by a lingering DoT (burn/wound) THIS tick, so the caller can tell
 *  passive chip apart from a real exchange: a DoT alone must NOT count as "combat
 *  happening", or the stall timer never ramps and both pets stand and stare while
 *  the burn ticks (the mid-fight freeze). */
function tickStatuses(f: Fighter): number {
    const s = f.statuses;
    if (f.itemsOn && f.cCleanse > 0 && (s.burnLeft > 0 || s.stunLeft > 0 || s.slowLeft > 0 || s.rootLeft > 0)) {
        s.burnLeft = 0; s.burnDmg = 0; s.halfHeal = false; s.stunLeft = 0; s.slowLeft = 0; s.rootLeft = 0; f.cCleanse = 0;
    }
    let dot = 0;
    if (s.burnLeft > 0) { if (s.burnLeft % Math.round(DUEL_TPS * 0.4) === 0) { f.hp -= s.burnDmg; dot = s.burnDmg; } if (--s.burnLeft <= 0) { s.burnDmg = 0; s.halfHeal = false; } }
    if (s.stunLeft > 0) s.stunLeft--;
    if (s.slowLeft > 0) s.slowLeft--;
    if (s.hasteLeft > 0) s.hasteLeft--;
    if (s.rootLeft > 0) s.rootLeft--;
    if (s.wallPenaltyLeft > 0) s.wallPenaltyLeft--;
    if (s.buffLeft > 0 && --s.buffLeft <= 0) s.buffMag = 0;
    if (f.perfectEvadeLeft > 0) f.perfectEvadeLeft--;
    // A player order lapses if the pet never gets a window to use it, so an
    // unreachable or permanently-blocked command can't freeze it out of its own AI.
    // A pending Bond Break is exempt: the meter was already spent on it.
    if (f.controlled && f.cmdLeft > 0 && --f.cmdLeft <= 0) {
        f.cmdIdx = -2;
        f.cmdTechnique = false;
        f.perfectRole = null;
    }
    return dot;
}
function stepManeuver(f: Fighter, fighters: Fighter[]) {
    const e = pickTarget(f, fighters);
    if (!e) { f.maneuverLeft = 0; return; }
    const dx = f.maneuverGoalX - f.x, dy = f.maneuverGoalY - f.y;
    const d = Math.max(1e-4, Math.hypot(dx, dy));
    const tx = dx / d, ty = dy / d;
    const tangentX = -ty, tangentY = tx;
    const p = 1 - f.maneuverLeft / Math.max(1, f.maneuverTotal);
    // Keep only a hint of lateral shape. The former wide S-hook repeatedly spun
    // agile quadrupeds during a single burst and read as orbiting rather than a
    // decisive anime lane change.
    const hook = (p < 0.5 ? p * 2 : (1 - p) * 2) * 0.12 * f.orbitDir;
    let mx = tx * 0.99 + tangentX * hook;
    let my = ty * 0.99 + tangentY * hook;
    const ml = Math.max(1e-4, Math.hypot(mx, my)); mx /= ml; my /= ml;
    const burst = p < 0.5 ? p * 2 : (1 - p) * 2;
    const speed = f.maxSpeed * (2.15 + burst * 0.72);
    const [nx, ny] = tryStep(f.x + mx * speed, f.y + my * speed, f.x, f.y);
    f.x = nx; f.y = ny;
    // Run into the lane, then visibly pivot back toward the opponent at the end.
    const ex = e.x - f.x, ey = e.y - f.y, ed = Math.max(1e-4, Math.hypot(ex, ey));
    f.faceX = p < 0.82 ? mx : ex / ed;
    f.faceY = p < 0.82 ? my : ey / ed;
    if (--f.maneuverLeft <= 0) {
        f.maneuverLeft = 0;
        f.vx = 0; f.vy = 0;
        f.routeActive = false;
        f.faceX = ex / ed; f.faceY = ey / ed;
        // An inward flank is the first half of a dash attack: hand control back almost
        // immediately so the strike follows the burst instead of adding an idle pause.
        // Disengages still plant long enough to make their support cast readable.
        f.guardLeft = Math.round(DUEL_TPS * (f.routeIntent === "flank" ? 0.08 : 0.27));
    }
}
function stepFighter(f: Fighter, fighters: Fighter[], projectiles: Projectile[], nextProjId: { n: number }, rng: () => number, t: number, events: DuelEvent[], accuracyEnabled: boolean) {
    if (f.state === "dead" || f.hp <= 0) return;
    if (f.targetLockLeft > 0) f.targetLockLeft--;
    if (f.basicCdLeft > 0) f.basicCdLeft--;
    for (const ab of f.abilities) if (ab.cdLeft > 0) ab.cdLeft--;
    if (f.dodgeCd > 0) f.dodgeCd--;
    if (f.stamina < STAM_MAX) f.stamina = Math.min(STAM_MAX, f.stamina + STAM_REGEN);
    if (f.statuses.stunLeft > 0) {
        // Hard CC interrupts a pounce: convert the mid-air dive to a stagger so the pose
        // is right during the stun and the stale lunge can't resume aimed at a ghost.
        if (f.state === "dash" && f.lungeAbIdx > -2) { f.state = "stagger"; f.stateLeft = f.staggerT; clearLunge(f); }
        f.maneuverLeft = 0; f.guardLeft = 0;
        f.vx = 0; f.vy = 0;
        f.x = clamp(f.x, -activeArenaX(), activeArenaX());
        f.y = clamp(f.y, -activeArenaY(), activeArenaY());
        return;
    }
    if (f.maneuverLeft > 0) {
        stepManeuver(f, fighters);
        f.x = clamp(f.x, -activeArenaX(), activeArenaX());
        f.y = clamp(f.y, -activeArenaY(), activeArenaY());
        return;
    }
    if (f.guardLeft > 0 && f.state === "idle") {
        const e = pickTarget(f, fighters);
        // A telegraph cancels the pose so defensive reactions remain responsive.
        if (!e || e.state !== "windup") {
            f.guardLeft--;
            f.vx = 0; f.vy = 0;
            if (e) { const dx = e.x - f.x, dy = e.y - f.y, d = Math.max(1e-4, Math.hypot(dx, dy)); f.faceX = dx / d; f.faceY = dy / d; }
            return;
        }
        f.guardLeft = 0;
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
                        const trackEff = f.perfectRole
                            ? 0.72
                            : clamp(f.style.lungeTrack + (f.spd - tgt.spd) * 0.0015, f.style.lungeTrack, 0.34);
                        const mx = f.moveDx * (1 - trackEff) + (ddx / dd) * trackEff;
                        const my = f.moveDy * (1 - trackEff) + (ddy / dd) * trackEff;
                        const ml = Math.max(1e-4, Math.sqrt(mx * mx + my * my));
                        f.moveDx = mx / ml; f.moveDy = my / ml; f.faceX = f.moveDx; f.faceY = f.moveDy;
                    }
                    if (dd <= (ab ? ab.range : f.reach) + 0.45) {
                        // CLASH BIND — a committed dive meets a fighter who can still answer
                        // it. The duel freezes here and both sides call Strike / Guard / Dodge
                        // (see the CLASH block near the top of this file). The rng draw sits
                        // behind the `f.brawl` short-circuit, so the authoritative stream is
                        // never touched by its presence.
                        if (!f.perfectRole && f.brawl && _clashOn && !_clash && _clashCount < CLASH_MAX_PER_DUEL
                            && t >= CLASH_MIN_TICK && t - _lastClashTick >= CLASH_COOLDOWN
                            && f.hp / f.maxHp > CLASH_MIN_HP && tgt.hp / tgt.maxHp > CLASH_MIN_HP
                            && tgt.statuses.stunLeft <= 0 && tgt.state !== "dead"
                            && rng() < CLASH_CHANCE) {
                            _clash = { aId: f.id, bId: tgt.id, startT: t, until: t + CLASH_WINDOW, picks: {} };
                            _clashCount++; _lastClashTick = t;
                            clearLunge(f); clearLunge(tgt);
                            f.state = "stagger"; f.stateLeft = CLASH_WINDOW;
                            tgt.state = "stagger"; tgt.stateLeft = CLASH_WINDOW;
                            f.vx = 0; f.vy = 0; tgt.vx = 0; tgt.vy = 0;
                            f.clashPick = -1; tgt.clashPick = -1;
                            events.push({ t, type: "stagger", side: f.team, actorId: f.id, move: "Clash Bind", targetId: tgt.id });
                            events.push({ t, type: "stagger", side: tgt.team, actorId: tgt.id, move: "Clash Bind", targetId: f.id });
                            break;
                        }
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
                    if (bt && (f.perfectRole || bd <= (ab ? ab.range : f.reach) + 0.45)) { resolveMeleeContact(f, ab, f.lungeTgtId, fighters, rng, t, events, accuracyEnabled); clearLunge(f); f.state = "strike"; f.stateLeft = 2; }
                    else { clearLunge(f); f.state = "recover"; f.stateLeft = Math.max(1, f.recovT); }   // short recover — no dodge happened
                    break;
                }
                if (--f.stateLeft <= 0) {
                    // GRAZING BLOW (live coliseum only). A committed dive should be beaten by
                    // a real DODGE — not by an opponent who simply walked backwards. Measured
                    // on the brawl path, 99% of melee whiffs were this timer expiring, at a
                    // median gap of 2.40 against a ~2.05 contact threshold: the dive died a
                    // body-width short and the player saw a pet lunge through its opponent and
                    // hit nothing. If the target is still basically in front of the attacker
                    // and did NOT slip it, the dive connects as a grazing blow instead.
                    // Gated on `brawl`, so every authoritative caller keeps the strict test.
                    const expTgt = f.lungeTgtId ? fighters.find((g) => g.id === f.lungeTgtId && g.hp > 0) : null;
                    if (f.perfectRole && expTgt) {
                        resolveMeleeContact(f, ab, f.lungeTgtId, fighters, rng, t, events, accuracyEnabled);
                        clearLunge(f); f.state = "strike"; f.stateLeft = 2;
                        break;
                    }
                    if (f.brawl && expTgt && expTgt.state !== "dodge") {
                        const gx = expTgt.x - f.x, gy = expTgt.y - f.y;
                        const gd = Math.sqrt(gx * gx + gy * gy);
                        if (gd <= (ab ? ab.range : f.reach) + 0.5 + BRAWL_GRAZE && (f.faceX * gx + f.faceY * gy) > 0) {
                            resolveMeleeContact(f, ab, f.lungeTgtId, fighters, rng, t, events, accuracyEnabled, BRAWL_GRAZE);
                            clearLunge(f); f.state = "strike"; f.stateLeft = 2;
                            break;
                        }
                    }
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
        case "dodge": {
            const [nx, ny] = tryStep(f.x + f.moveDx * f.maxSpeed * 2.9, f.y + f.moveDy * f.maxSpeed * 2.9, f.x, f.y);
            f.x = nx; f.y = ny;
            if (--f.stateLeft <= 0) {
                f.state = "idle";
                const target = pickTarget(f, fighters);
                if (f.postDodgeSupport) beginDodgeRetreat(f, target);
                else beginReposition(f, Math.round(DUEL_TPS * 0.65), target);
            }
            break;
        }
        case "windup": if (--f.stateLeft <= 0) {
            const wab = f.pendingIdx >= 0 ? f.abilities[f.pendingIdx] : null;
            const isMelee = wab ? wab.cls === "melee" : !f.basicRanged;
            if (isMelee) {
                payAbilityCost(f, wab);
                const target = f.pendingTargetId ? fighters.find((candidate) => candidate.id === f.pendingTargetId && candidate.hp > 0) : null;
                const dx = target ? target.x - f.x : 0, dy = target ? target.y - f.y : 0;
                const distance = target ? Math.hypot(dx, dy) : Infinity;
                const contact = (wab ? wab.range : f.reach) + 0.45;
                if (target && distance <= contact) {
                    resolveMeleeContact(f, wab, f.pendingTargetId, fighters, rng, t, events, accuracyEnabled);
                    f.state = "strike"; f.stateLeft = 2;
                } else if (target && (f.perfectRole || distance <= f.style.lungeInit + contact)) {
                    // The pet already earned an attack pocket before winding up. If
                    // the defender slips backward during the tell, finish with one
                    // short committed pounce. This is part of the strike—not the old
                    // opening dash choreography or an endlessly repeated gap closer.
                    const len = Math.max(1e-4, distance);
                    f.moveDx = dx / len; f.moveDy = dy / len;
                    f.faceX = f.moveDx; f.faceY = f.moveDy;
                    f.lungeAbIdx = f.pendingIdx; f.lungeTgtId = f.pendingTargetId;
                    f.lungeStuck = 0; f.state = "dash";
                    const perfectTravel = Math.ceil(distance / Math.max(1e-4, f.maxSpeed * f.style.lungeMult)) + 4;
                    f.stateLeft = f.perfectRole ? Math.max(f.style.lungeTicks, perfectTravel) : f.style.lungeTicks;
                } else {
                    events.push({ t, type: "whiff", side: f.team, actorId: f.id, move: wab?.name });
                    f.state = "recover"; f.stateLeft = Math.max(1, f.recovT);
                }
            } else {
                const supportCast = wab?.cls === "support";
                const nearestEnemy = supportCast
                    ? fighters.filter((candidate) => candidate.team !== f.team && candidate.hp > 0)
                        .sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))[0]
                    : null;
                const enemyGap = nearestEnemy ? Math.hypot(nearestEnemy.x - f.x, nearestEnemy.y - f.y) : Infinity;
                if (supportCast && !f.perfectRole && nearestEnemy && enemyGap < SUPPORT_CAST_CLEARANCE - 0.35) {
                    // The cast began in a safe pocket, but the opponent invaded the
                    // tell before payoff. Abort without spending the move and turn
                    // that pressure into another readable disengage instead of a
                    // point-blank buff animation.
                    f.state = "idle"; f.stateLeft = 0; f.pendingIdx = -2; f.pendingTargetId = null;
                    f.postDodgeSupport = true;
                    beginDodgeRetreat(f, nearestEnemy);
                    setIntent(f, "retreat", SUPPORT_CAST_CLEARANCE, "break contact and restart the power-up", "opponent invaded the casting pocket");
                } else {
                    resolveCast(f, fighters, projectiles, nextProjId, rng, t, events, accuracyEnabled);
                    f.state = "strike"; f.stateLeft = 1;
                }
            }
        } break;
        case "strike": if (--f.stateLeft <= 0) { f.state = "recover"; f.stateLeft = Math.max(1, f.recovT); } break;
        case "recover": if (--f.stateLeft <= 0) {
            f.state = "idle";
            const target = pickTarget(f, fighters);
            if (target) {
                if (_partyMode) _laneInitiativeTeam[laneIndex(f.slot)] = target.team;
                else _cinematicInitiativeTeam = target.team;
            }
            // The completed action hands pressure to the opponent while this pet
            // briefly plants. A full cross-arena exit is punctuation: every third
            // 1v1 exchange, every second 2v2 lane exchange, after a signature or
            // support setup, or when genuinely wounded. Routing after every basic hit made the match
            // mostly running and turned 2v2 into four unrelated travel lines.
            f.exchangesSinceRoute++;
            const justUsed = f.pendingIdx >= 0 ? f.abilities[f.pendingIdx] : null;
            const wounded = f.hp / f.maxHp < f.style.retreatHp;
            let cadence = _warfrontMode
                ? WARFRONT_ROUTE_CADENCE
                : _partyMode ? PARTY_ROUTE_CADENCE : DUEL_ROUTE_CADENCE;
            // Controlled-stance: Press trades several more exchanges before breaking
            // off (stays in your face); Guard resets sooner (patient spacing). No-op
            // for Balance / any uncontrolled fighter, so the authoritative path holds.
            if (f.controlled) cadence = f.stance === 0 ? cadence + 3 : f.stance === 2 ? Math.max(1, cadence - 1) : cadence;
            // The wall itself creates the route change for the opponent; sending
            // its caster across the floor too only doubles the dead air.
            const supportSetup = justUsed?.cls === "support"
                && justUsed.kind !== "barrier" && !f.supportResetDone;
            // Once the no-damage breaker has latched, "fight to a result" must
            // actually cancel optional cross-field exits. Previously the flag
            // collapsed attack range and dodging, but recover still launched a
            // brand-new route every other exchange. Support-heavy mirror teams
            // could therefore run for the full 75-second cap while their melee
            // casts whiffed against another moving target.
            const fullReset = !_forcedEngage && (!!justUsed?.signature || supportSetup
                || wounded || f.exchangesSinceRoute >= cadence);
            // If the rival is already disengaging from a dodge/reset, do not launch
            // a second route in parallel.
            if (target?.routeActive && target.reposLeft > 0) {
                f.routeActive = false; f.reposLeft = 0;
                f.vx = 0; f.vy = 0;
                f.guardLeft = Math.round(DUEL_TPS * 0.2);
            } else if (fullReset) {
                if (justUsed?.cls === "support") f.supportResetDone = true;
                f.exchangesSinceRoute = 0;
                // Press cuts the exit beat short to re-commit fast; Guard draws it out
                // to reset spacing. Controlled-only, ×1 for Balance/uncontrolled.
                const stanceRepos = f.controlled ? (f.stance === 0 ? 0.35 : f.stance === 2 ? 1.5 : 1) : 1;
                beginReposition(f, Math.round(DUEL_TPS * f.style.reposDur * stanceRepos), target);
            } else {
                f.routeActive = false; f.reposLeft = 0;
                f.spacingOffset = 0;
                f.vx = 0; f.vy = 0;
                f.guardLeft = Math.round(DUEL_TPS * 0.22);
            }
        } break;
        case "stagger": if (--f.stateLeft <= 0) {
            f.state = "idle";
            // Knockback already created the defensive displacement. Plant after
            // hit-stun and read the attacker instead of starting a second exit
            // route that turns the pair into a leader/follower train.
            f.routeActive = false; f.reposLeft = 0; f.maneuverLeft = 0;
            f.vx = 0; f.vy = 0;
            f.guardLeft = Math.round(DUEL_TPS * 0.2);
        } break;
    }
    f.x = clamp(f.x, -activeArenaX(), activeArenaX());
    f.y = clamp(f.y, -activeArenaY(), activeArenaY());
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
        // A CLASH BIND is two fighters LOCKED together. The ordinary separation pass
        // would shove them apart a little every tick and, over the length of the
        // window, walk them out of the bind entirely — which is the one thing the beat
        // cannot look like. The bound pair is exempt until it resolves. `_clash` is
        // null on every authoritative path, so this is byte-identical there.
        if (_clash && ((_clash.aId === a.id && _clash.bId === b.id) || (_clash.aId === b.id && _clash.bId === a.id))) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy);
        // A state-dependent contact radius fought the steering system every time
        // an attack entered or left windup: the pair was pushed out in idle, pulled
        // in during the strike, then pushed out again. Use one stable combat pocket
        // and let authored lunge/reposition states create the visible cadence.
        const directWarfrontEngagement = a.targetId === b.id || b.targetId === a.id;
        const separation = _warfrontMode
            ? a.team === b.team
                ? PARTY_ALLY_SEPARATION
                : directWarfrontEngagement
                    ? MIN_SEP + 0.8
                    : PARTY_ALLY_SEPARATION + 0.2
            : _partyMode && a.team === b.team
                ? PARTY_ALLY_SEPARATION
                : a.state === "idle" && b.state === "idle" ? MIN_SEP + 1.0 : MIN_SEP;
        if (d >= separation) continue;
        const push = (separation - d) / 2;
        if (d > 1e-6) { const ux = dx / d, uy = dy / d; const [ax, ay] = snapPos(a.x - ux * push, a.y - uy * push); a.x = ax; a.y = ay; const [bx, by] = snapPos(b.x + ux * push, b.y + uy * push); b.x = bx; b.y = by; }
        else { a.x -= push; b.x += push; }
        if (_warfrontMode && directWarfrontEngagement && a.state === "idle" && b.state === "idle") {
            // Cancel the residual closing velocity at the resolved pocket. Without
            // this, steering re-entered the overlap on the next tick and separation
            // corrected it again—the small back-and-forth the user saw as jitter.
            a.vx = 0; a.vy = 0; b.vx = 0; b.vy = 0;
        }
    }
}
function quantizeFighter(f: Fighter) {
    f.x = quant(f.x); f.y = quant(f.y); f.vx = quant(f.vx); f.vy = quant(f.vy);
    f.stamina = quant(f.stamina); f.faceX = quant(f.faceX); f.faceY = quant(f.faceY);
    f.statuses.shieldHp = quant(f.statuses.shieldHp);
}

function snap(t: number, fighters: Fighter[], projectiles: Projectile[], debugTrace: boolean, objectives: WarfrontRelicState[] = []): DuelSnapshot {
    return {
        t,
        actors: fighters.map((f): DuelActorSnap => ({
            id: f.id, team: f.team, slot: f.slot,
            x: f.x, y: f.y, faceX: f.faceX, faceY: f.faceY,
            targetId: f.targetId,
            hp: Math.max(0, f.hp), maxHp: f.maxHp, stamina: f.stamina,
            state: f.state, statuses: statusFlags(f.statuses),
            ...(debugTrace ? { ai: {
                state: f.aiState, targetId: f.targetId,
                desiredRange: f.desiredRange, plan: f.aiPlan, reason: f.aiReason,
                path: f.routeActive
                    ? [{ x: f.x, y: f.y }, { x: f.routeX, y: f.routeY }]
                    : f.maneuverLeft > 0
                        ? [{ x: f.x, y: f.y }, { x: f.maneuverGoalX, y: f.maneuverGoalY }]
                        : [],
                cooldownPriorities: f.abilities
                    .map((ab) => ({ ab, score: (ab.cdLeft > 0 ? 1000 + ab.cdLeft : 0) + (ab.signature ? 20 : 0) }))
                    .sort((a, b) => a.score - b.score || a.ab.name.localeCompare(b.ab.name))
                    .slice(0, 4)
                    .map(({ ab }) => `${ab.name}: ${ab.cdLeft <= 0 ? "ready" : `${(ab.cdLeft / DUEL_TPS).toFixed(1)}s`}`),
                elementalSetup: (() => {
                    const target = f.targetId ? fighters.find((g) => g.id === f.targetId) : null;
                    const el = String(f.element ?? "None").toLowerCase();
                    if (el === "fire") return target?.statuses.burnLeft ? "Burn active — force movement / finish" : "Looking to apply Burn pressure";
                    if (el === "water") return target && (target.statuses.slowLeft || target.statuses.stunLeft) ? "Control active — punish or sustain" : "Looking for slow / redirection setup";
                    if (el === "lightning") return target?.statuses.marked ? "Mark armed — burst will consume it" : "Looking for mark / interrupt window";
                    if (el === "earth") return f.statuses.shieldHp > 0 || f.statuses.wallPenaltyLeft > 0 ? "Fortified zone active" : "Looking to establish barrier space";
                    if (el === "wind") return target && (target.statuses.rootLeft || target.statuses.slowLeft) ? "Spacing control active — extend pressure" : "Looking to displace and change angle";
                    return "No elemental setup active";
                })(),
            } } : {}),
        })),
        projectiles: projectiles.map((p): DuelProjSnap => ({ id: p.id, x: p.x, y: p.y, team: p.team, kind: p.kind, element: p.element })),
        ...(objectives.length ? { objectives: objectives.map((objective) => ({ ...objective })) } : {}),
    };
}

const createWarfrontRelics = (): WarfrontRelicState[] => ([
    {
        id: "forbidden-scroll", kind: "scroll", owner: null,
        x: 0, y: 0, homeX: 0, homeY: 0,
        carrierId: null, state: "sealed", progress: 0, active: false,
    },
    ...WARFRONT_SEAL_POSITIONS.map((position): WarfrontRelicState => ({
        id: position.id,
        kind: "seal",
        owner: null,
        x: position.x,
        y: position.y,
        homeX: position.x,
        homeY: position.y,
        carrierId: null,
        state: "neutral",
        progress: 0,
        active: true,
    })),
    {
        id: "player-extraction", kind: "extraction", owner: "player",
        x: -WARFRONT_RELIC_HOME_X, y: 0, homeX: -WARFRONT_RELIC_HOME_X, homeY: 0,
        carrierId: null, state: "inactive", progress: 0, active: false,
    },
    {
        id: "enemy-extraction", kind: "extraction", owner: "enemy",
        x: WARFRONT_RELIC_HOME_X, y: 0, homeX: WARFRONT_RELIC_HOME_X, homeY: 0,
        carrierId: null, state: "inactive", progress: 0, active: false,
    },
]);

/** Advance Shadow Relay after movement. Teams first claim two of three cipher
 * seals. That opens one neutral scroll; one clean hit or body tag drops it, and
 * either team can recover it before a carrier reaches their extraction gate. */
function updateWarfrontRelics(
    fighters: Fighter[],
    objectives: WarfrontRelicState[],
    t: number,
    events: DuelEvent[],
): Fighter["team"] | null {
    const scroll = objectives.find((objective) => objective.kind === "scroll");
    const seals = objectives.filter((objective) => objective.kind === "seal");
    const gates = objectives.filter((objective) => objective.kind === "extraction");
    if (!scroll) return null;
    const living = fighters.filter((fighter) => fighter.hp > 0 && fighter.state !== "dead").sort((a, b) => (
        (a.team === b.team ? 0 : a.team === "player" ? -1 : 1)
        || a.slot - b.slot
        || a.id.localeCompare(b.id)
    ));

    if (scroll.carrierId) {
        const carrier = fighters.find((fighter) => fighter.id === scroll.carrierId);
        if (!carrier || carrier.hp <= 0 || carrier.state === "dead") {
            if (carrier) { scroll.x = carrier.x; scroll.y = carrier.y; }
            const fallenId = scroll.carrierId;
            scroll.carrierId = null; scroll.state = "dropped";
            const fallenTeam = carrier?.team ?? (fallenId.startsWith("player-") ? "player" : "enemy");
            gates.forEach((gate) => { gate.active = false; gate.state = "inactive"; });
            events.push({ t, type: "relic_drop", side: fallenTeam, actorId: fallenId, targetId: scroll.id, move: "Forbidden Scroll dropped" });
        } else {
            let hitInterceptor: DuelEvent | undefined;
            for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex--) {
                const event = events[eventIndex];
                if (event.t < t) break;
                if (event.type === "hit" && event.side !== carrier.team
                    && event.targetId === carrier.id && (event.dmg ?? 0) > 0) {
                    hitInterceptor = event;
                    break;
                }
            }
            let pickup: DuelEvent | undefined;
            for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex--) {
                const event = events[eventIndex];
                if (event.type === "relic_pickup" && event.targetId === scroll.id && event.actorId === carrier.id) {
                    pickup = event;
                    break;
                }
            }
            const contactInterceptor = pickup && t - pickup.t >= WARFRONT_RELIC_TAG_GRACE_TICKS
                ? nearestFighter(carrier, living.filter((fighter) => (
                    fighter.team !== carrier.team
                    && Math.hypot(fighter.x - carrier.x, fighter.y - carrier.y) <= WARFRONT_RELIC_TAG_RADIUS
                )))
                : null;
            const interceptorId = hitInterceptor?.actorId ?? contactInterceptor?.id;
            if (interceptorId) {
                scroll.carrierId = null;
                scroll.x = carrier.x; scroll.y = carrier.y; scroll.state = "dropped";
                gates.forEach((gate) => { gate.active = false; gate.state = "inactive"; });
                events.push({ t, type: "relic_drop", side: carrier.team, actorId: carrier.id, targetId: scroll.id, move: "Substitution tag — scroll dropped" });
                events.push({ t, type: "relic_return", side: carrier.team === "player" ? "enemy" : "player", actorId: interceptorId, targetId: scroll.id, move: "Scroll intercepted" });
            } else {
                scroll.x = carrier.x; scroll.y = carrier.y;
                const gate = gates.find((candidate) => candidate.owner === carrier.team);
                if (gate && Math.hypot(carrier.x - gate.x, carrier.y - gate.y) <= WARFRONT_RELIC_CAPTURE_RADIUS) {
                    events.push({ t, type: "capture", side: carrier.team, actorId: carrier.id, targetId: scroll.id, move: "Forbidden Scroll extracted" });
                    return carrier.team;
                }
            }
        }
    }

    if (scroll.state === "sealed") {
        for (const seal of seals) {
            if (seal.state === "captured") continue;
            const playerPresence = living.filter((fighter) => fighter.team === "player" && Math.hypot(fighter.x - seal.x, fighter.y - seal.y) <= WARFRONT_SIGIL_RADIUS).length;
            const enemyPresence = living.filter((fighter) => fighter.team === "enemy" && Math.hypot(fighter.x - seal.x, fighter.y - seal.y) <= WARFRONT_SIGIL_RADIUS).length;
            const pressure = playerPresence - enemyPresence;
            if (pressure !== 0) seal.progress = clamp(seal.progress + pressure / WARFRONT_SEAL_CAPTURE_TICKS, -1, 1);
            else if (playerPresence === 0 && enemyPresence === 0) seal.progress *= 0.992;
            seal.progress = Math.round(seal.progress * 4096) / 4096;
            seal.state = playerPresence > 0 && enemyPresence > 0 ? "contested" : Math.abs(seal.progress) > 0.02 ? "contested" : "neutral";
            if (Math.abs(seal.progress) >= 1) {
                const owner: Fighter["team"] = seal.progress > 0 ? "player" : "enemy";
                seal.owner = owner; seal.state = "captured"; seal.active = true;
                const channeler = [...living.filter((fighter) => fighter.team === owner)].sort((a, b) => (
                    Math.hypot(a.x - seal.x, a.y - seal.y) - Math.hypot(b.x - seal.x, b.y - seal.y)
                    || a.slot - b.slot
                ))[0];
                events.push({ t, type: "seal_capture", side: owner, actorId: channeler?.id ?? `${owner}-0`, targetId: seal.id, move: `${seal.id.replace("seal-", "")} cipher claimed` });
            }
        }
        const playerSeals = seals.filter((seal) => seal.owner === "player").length;
        const enemySeals = seals.filter((seal) => seal.owner === "enemy").length;
        const vaultTeam: Fighter["team"] | null = playerSeals >= 2 ? "player" : enemySeals >= 2 ? "enemy" : null;
        if (vaultTeam) {
            scroll.owner = vaultTeam;
            scroll.state = "available";
            scroll.active = true;
            const opener = [...living.filter((fighter) => fighter.team === vaultTeam)].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0];
            events.push({ t, type: "vault_open", side: vaultTeam, actorId: opener?.id ?? `${vaultTeam}-0`, targetId: scroll.id, move: "Forbidden Vault opened" });
        }
    }

    if (!scroll.carrierId && (scroll.state === "available" || scroll.state === "dropped")) {
        const touching = living.filter((fighter) => Math.hypot(fighter.x - scroll.x, fighter.y - scroll.y) <= WARFRONT_RELIC_PICKUP_RADIUS);
        const carrier = touching.find((fighter) => fighter.team === scroll.owner) ?? touching[0];
        if (carrier) {
            scroll.carrierId = carrier.id; scroll.state = "carried";
            scroll.x = carrier.x; scroll.y = carrier.y;
            carrier.routeActive = false; carrier.reposLeft = 0;
            gates.forEach((gate) => { const on = gate.owner === carrier.team; gate.active = on; gate.state = on ? "active" : "inactive"; });
            events.push({ t, type: "relic_pickup", side: carrier.team, actorId: carrier.id, targetId: scroll.id, move: "Forbidden Scroll claimed" });
        }
    }
    return null;
}

// ── Core loop ──────────────────────────────────────────────────────────────────
// The loop is split into createDuelState / stepDuelState / finishDuelState so the
// player-controlled path (pet-duel-live.ts) can drive it one tick at a time, read
// the fighters between ticks, and rewind. `simulate()` below composes the three in
// exactly the order the single fused loop used to run, so every existing entry
// point — and therefore the server mirror, the ladder and sector war — produces
// byte-identical snapshots and events.

/** A duel paused between ticks. Opaque to callers outside this module. */
export interface CinematicDuelState {
    fighters: Fighter[];
    projectiles: Projectile[];
    nextProjId: { n: number };
    snapshots: DuelSnapshot[];
    events: DuelEvent[];
    rngState: RngState;
    rng: () => number;
    accuracyEnabled: boolean;
    debugTrace: boolean;
    t: number;                       // the next tick to run
    ticks: number;
    winner: "player" | "enemy" | null;
    done: boolean;
    lastDmgTick: number;
    prevTotalHp: number;
    // Mirrors of the module-level scratch globals. They are swapped in before each
    // tick and back out after, so a PAUSED duel can never be corrupted by another
    // duel (a preview harness, a replay) simulating in between.
    walls: { x: number; y: number; r: number; expiry: number; ownerId: string }[];
    stallPressure: number;
    forcedEngage: boolean;
    partyMode: boolean;
    initiativeTeam: "player" | "enemy";
    laneInitiative: LaneInitiative;
    clash: ClashBind | null;
    clashCount: number;
    lastClashTick: number;
    clashEnabled: boolean;
    warfrontRelics: WarfrontRelicState[];
}

function createDuelState(fighters: Fighter[], seed: number, accuracyEnabled: boolean, debugTrace: boolean): CinematicDuelState {
    const rngState = newRngState(seed);
    let prevTotalHp = 0;
    for (const f of fighters) prevTotalHp += Math.max(0, f.hp);
    // Clear the scratch globals BEFORE the opening snapPos pass: snapPos consults
    // SIM_WALLS through walkableAt, so a previous duel's expired barriers would
    // otherwise displace this duel's spawn positions.
    SIM_WALLS = [];
    _stallPressure = 0; _forcedEngage = false;
    _clash = null; _clashCount = 0; _lastClashTick = -CLASH_COOLDOWN; _clashOn = true;
    _partyMode = fighters.length > 2;
    _warfrontMode = fighters.length >= 6;
    _warfrontRelics = _warfrontMode ? createWarfrontRelics() : [];
    _warfrontAssignments = _warfrontMode ? buildWarfrontAssignments(fighters) : new Map();
    _warfrontPathCache.clear();
    _warfrontPathWallSignature = "";
    for (const f of fighters) { const [sx, sy] = snapPos(f.x, f.y); f.x = sx; f.y = sy; }
    const initiativeTeam: "player" | "enemy" = (seed & 1) === 0 ? "player" : "enemy";
    return {
        fighters, projectiles: [], nextProjId: { n: 0 }, snapshots: [], events: [],
        rngState, rng: makeRngFrom(rngState), accuracyEnabled, debugTrace,
        t: 0, ticks: 0, winner: null, done: false,
        lastDmgTick: 0, prevTotalHp,
        walls: [], stallPressure: 0, forcedEngage: false,
        partyMode: fighters.length > 2,
        initiativeTeam,
        laneInitiative: [
            initiativeTeam,
            initiativeTeam === "player" ? "enemy" : "player",
            initiativeTeam === "player" ? "enemy" : "player",
            initiativeTeam,
        ],
        clash: null, clashCount: 0, lastClashTick: -CLASH_COOLDOWN, clashEnabled: true,
        warfrontRelics: _warfrontRelics.map((relic) => ({ ...relic })),
    };
}

/** Run exactly one tick. Returns false once the duel is over (or the cap is hit). */
/** Settle an active clash bind: compare the two calls and pay out the momentum
 *  swing. A tie is the old symmetric deflect — both bounce apart, nobody scores,
 *  which keeps the beat a tension reset rather than a coin-flip on damage. */
function resolveClashBind(bind: ClashBind, fighters: Fighter[], rng: () => number, t: number, events: DuelEvent[]) {
    const a = fighters.find((g) => g.id === bind.aId);
    const b = fighters.find((g) => g.id === bind.bId);
    if (!a || !b || a.hp <= 0 || b.hp <= 0) return;
    // A fighter that never called (the AI, or a player who let the window lapse) gets
    // its archetype's read. Exactly ONE draw is taken here whatever happens, and both
    // reads are hashed out of it (see clashRoll): the draw count is therefore
    // independent of who called and who defaulted, so a player's choice can never
    // shift the rng stream — which is what keeps the server's replay of the input log
    // identical to the fight that was on screen.
    const salt = Math.floor(rng() * 4294967296) >>> 0;
    const pa = a.clashPick >= 0 ? a.clashPick : clashAiPick(a, clashRoll(salt, a.id, bind.startT));
    const pb = b.clashPick >= 0 ? b.clashPick : clashAiPick(b, clashRoll(salt, b.id, bind.startT));
    a.clashPick = -1; b.clashPick = -1;

    const dx = a.x - b.x, dy = a.y - b.y, d = Math.max(1e-4, Math.sqrt(dx * dx + dy * dy));
    if (pa === pb) {
        const [ax, ay] = snapPos(a.x + (dx / d) * CLASH_KB, a.y + (dy / d) * CLASH_KB);
        const [bx, by] = snapPos(b.x - (dx / d) * CLASH_KB, b.y - (dy / d) * CLASH_KB);
        a.x = ax; a.y = ay; b.x = bx; b.y = by;
        a.state = "stagger"; a.stateLeft = a.staggerT;
        b.state = "stagger"; b.stateLeft = b.staggerT;
        events.push({ t, type: "stagger", side: a.team, actorId: a.id, move: "Clash", targetId: b.id });
        events.push({ t, type: "stagger", side: b.team, actorId: b.id, move: "Clash", targetId: a.id });
        return;
    }
    const aWon = clashBeats(pa, pb);
    const win = aWon ? a : b, lose = aWon ? b : a;
    // Face the payoff so applyDamage's own facing test passes.
    const fx = lose.x - win.x, fy = lose.y - win.y, fd = Math.max(1e-4, Math.sqrt(fx * fx + fy * fy));
    win.faceX = fx / fd; win.faceY = fy / fd;
    win.state = "strike"; win.stateLeft = 2;
    applyDamage(win, lose, CLASH_PAYOFF, rng, t, events, false);
    // applyDamage already staggers a target it catches idle/dashing/winding up, but a
    // clash loser is pinned in the bind — extend it explicitly so the winner always
    // gets the clean follow-up that makes the read worth making.
    if (lose.hp > 0) {
        lose.state = "stagger"; lose.stateLeft = CLASH_LOSER_STAGGER;
        clearLunge(lose);
    }
}

function stepDuelState(sim: CinematicDuelState): boolean {
    if (sim.done) return false;
    const t = sim.t;
    if (t >= CAP_TICKS) { sim.done = true; return false; }
    const { fighters, projectiles, nextProjId, events, snapshots, rng, accuracyEnabled } = sim;
    const commandEventStart = events.length;
    // Load this duel's scratch state into the module globals the helpers read.
    SIM_WALLS = sim.walls;
    _stallPressure = sim.stallPressure; _forcedEngage = sim.forcedEngage;
    _partyMode = sim.partyMode;
    _warfrontMode = sim.fighters.length >= 6;
    _warfrontRelics = sim.warfrontRelics;
    _warfrontAssignments = _warfrontMode ? buildWarfrontAssignments(fighters) : new Map();
    _cinematicInitiativeTeam = sim.initiativeTeam;
    _laneInitiativeTeam = sim.laneInitiative;
    _clash = sim.clash; _clashCount = sim.clashCount; _lastClashTick = sim.lastClashTick;
    _clashOn = sim.clashEnabled;

    sim.ticks = t + 1;
    if (SIM_WALLS.length) SIM_WALLS = SIM_WALLS.filter((w) => w.expiry > t);   // expire finished walls
    // Stall pressure: how long since ANY damage landed → ramps to force a decisive exchange.
    _stallPressure = clamp(((t - sim.lastDmgTick) / DUEL_TPS - STALL_START_SECS) / STALL_RAMP_SECS, 0, 1);
    if (_stallPressure >= 1) _forcedEngage = true;   // latch a confirmed stand-off → brawl to a result
    // Alternate the per-tick step order by tick parity so neither side keeps a
    // persistent "second-mover" reaction edge (which skews mirror matches). The
    // pet that steps second sees the first's fresh wind-up and can react-dodge —
    // alternating averages it to ~50%. Deterministic (tick parity, no rng).
    // CLASH BIND — while two fighters are locked, they do not act. Everything else
    // (projectiles already in flight, damage-over-time, the other lane in a 2v2)
    // keeps ticking, so the freeze reads as those two being locked together rather
    // than the whole match pausing. The bind settles when both calls are in or the
    // window lapses, whichever comes first.
    let bound: ClashBind | null = _clash;
    if (bound) {
        const ca = fighters.find((g) => g.id === bound!.aId);
        const cb = fighters.find((g) => g.id === bound!.bId);
        if (!ca || !cb || ca.hp <= 0 || cb.hp <= 0) { _clash = null; bound = null; }
        else if (t >= bound.until || (ca.clashPick >= 0 && cb.clashPick >= 0)) {
            resolveClashBind(bound, fighters, rng, t, events);
            _clash = null; bound = null;
        } else {
            ca.vx = 0; ca.vy = 0; cb.vx = 0; cb.vy = 0;
            ca.stateLeft = Math.max(1, bound.until - t);
            cb.stateLeft = Math.max(1, bound.until - t);
        }
    }
    const held = bound ? new Set([bound.aId, bound.bId]) : null;
    const stepOne = (f: Fighter) => { if (!held || !held.has(f.id)) stepFighter(f, fighters, projectiles, nextProjId, rng, t, events, accuracyEnabled); };
    if ((t & 1) === 1) { for (let i = fighters.length - 1; i >= 0; i--) stepOne(fighters[i]); }
    else { for (const f of fighters) stepOne(f); }
    stepProjectiles(fighters, projectiles, rng, t, events);
    let dotDmg = 0;
    for (const f of fighters) dotDmg += tickStatuses(f);
    // Command energy comes from participating in the exchange, not waiting on an
    // ability cooldown. Passive gain guarantees a window in quiet matchups; clean
    // hits, defensive reads and absorbing pressure bring the next call forward.
    for (const f of fighters) {
        if (f.controlled && f.hp > 0 && !f.cmdTechnique) {
            f.commandCharge = Math.min(DUEL_COMMAND_FULL, f.commandCharge + 1);
        }
    }
    for (let i = commandEventStart; i < events.length; i++) {
        const event = events[i];
        if (event.type === "hit") {
            const actor = fighters.find((f) => f.id === event.actorId);
            const target = event.targetId ? fighters.find((f) => f.id === event.targetId) : null;
            if (actor?.controlled) actor.commandCharge = Math.min(DUEL_COMMAND_FULL, actor.commandCharge + DUEL_COMMAND_HIT_GAIN);
            if (target?.controlled) target.commandCharge = Math.min(DUEL_COMMAND_FULL, target.commandCharge + DUEL_COMMAND_HURT_GAIN);
        } else if (event.type === "dodge") {
            const actor = fighters.find((f) => f.id === event.actorId);
            if (actor?.controlled) actor.commandCharge = Math.min(DUEL_COMMAND_FULL, actor.commandCharge + DUEL_COMMAND_DODGE_GAIN);
        }
    }
    separateAll(fighters);
    const newlyDefeated = new Set<string>();
    for (const f of fighters) {
        if (f.hp <= 0 && f.state !== "dead" && f.reviveLeft > 0) { f.reviveLeft -= 1; f.hp = Math.max(1, Math.round(f.maxHp * 0.4)); clearLunge(f); }
        if (f.hp <= 0 && f.state !== "dead") {
            f.hp = 0;
            f.state = "dead"; f.stateLeft = 0;
            f.vx = 0; f.vy = 0; f.routeActive = false; f.maneuverLeft = 0;
            f.targetId = null; f.targetLockLeft = 0;
            clearLunge(f);
            setIntent(f, "eliminated", 0, "match over", "health reached zero");
            newlyDefeated.add(f.id);
            events.push({ t, type: "ko", side: f.team, actorId: f.id });
        }
        const [sx, sy] = snapPos(f.x, f.y); f.x = sx; f.y = sy;
        quantizeFighter(f);
    }
    if (newlyDefeated.size > 0) {
        // Projectiles owned by or targeting a defeated pet cannot resolve after
        // the decisive knockout. Other active projectiles continue normally.
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            if (newlyDefeated.has(p.ownerId) || newlyDefeated.has(p.targetId)) projectiles.splice(i, 1);
        }
        SIM_WALLS = SIM_WALLS.filter((wall) => !newlyDefeated.has(wall.ownerId));
    }
    const captureWinner = _warfrontMode ? updateWarfrontRelics(fighters, _warfrontRelics, t, events) : null;
    // A landed EXCHANGE resets the stall timer → pressure only builds in a genuine
    // no-damage stand-off. Passive DoT chip (dotDmg) is deliberately excluded: a
    // lingering burn kept resetting the timer every 0.4 s, which pinned stallPressure
    // at 0 and left both pets planted (holdNeutral on, forcedEngage never latching) —
    // the mid-fight "just standing there" freeze. Subtracting dotDmg means real damage
    // still resets it (byte-identical to the old rule in any DoT-free tick) while a
    // DoT-only tick no longer counts as combat.
    { let totalHp = 0; for (const f of fighters) totalHp += Math.max(0, f.hp); if (sim.prevTotalHp - totalHp > dotDmg + 0.5) sim.lastDmgTick = t; sim.prevTotalHp = totalHp; }
    snapshots.push(snap(t, fighters, projectiles, sim.debugTrace, _warfrontRelics));

    // Store the scratch state back before anything else can run a duel. The
    // initiative team is load-bearing here: a landed exchange HANDS THE BEAT OVER
    // (`_cinematicInitiativeTeam = target.team`), so failing to write it back would
    // silently reset initiative to its opening value every tick.
    sim.walls = SIM_WALLS;
    sim.stallPressure = _stallPressure; sim.forcedEngage = _forcedEngage;
    sim.initiativeTeam = _cinematicInitiativeTeam;
    sim.laneInitiative = _laneInitiativeTeam;
    sim.clash = _clash; sim.clashCount = _clashCount; sim.lastClashTick = _lastClashTick;
    sim.warfrontRelics = _warfrontRelics;
    sim.t = t + 1;

    if (captureWinner) { sim.winner = captureWinner; sim.done = true; return false; }
    const pA = teamAlive(fighters, "player"), eA = teamAlive(fighters, "enemy");
    if (!pA || !eA) { sim.winner = pA && !eA ? "player" : eA && !pA ? "enemy" : null; sim.done = true; return false; }
    if (sim.t >= CAP_TICKS) sim.done = true;
    return !sim.done;
}

/** Resolve the timeout draw rule and package the DuelResult. Safe to call repeatedly. */
function finishDuelState(sim: CinematicDuelState): DuelResult {
    const { fighters } = sim;
    let winner = sim.winner;
    if (winner === null && teamAlive(fighters, "player") && teamAlive(fighters, "enemy")) {
        const frac = (team: "player" | "enemy") => fighters
            .filter((f) => f.team === team)
            .reduce((score, f) => score + Math.max(0, f.hp) / f.maxHp, 0);
        const pf = frac("player"), ef = frac("enemy");
        winner = Math.abs(pf - ef) < 1e-6 ? null : pf > ef ? "player" : "enemy";
    }
    const result: DuelResult["result"] = winner === "player" ? "win" : winner === "enemy" ? "loss" : "draw";
    return { result, winner, ticks: sim.ticks, snapshots: sim.snapshots, events: sim.events };
}

function simulate(fighters: Fighter[], seed: number, accuracyEnabled: boolean, debugTrace: boolean): DuelResult {
    const sim = createDuelState(fighters, seed, accuracyEnabled, debugTrace);
    while (stepDuelState(sim)) { /* run to a KO or the cap */ }
    return finishDuelState(sim);
}

// ── Public entry points (drop-in for the casual coliseum call sites) ──────────────
/** 1v1 cinematic coliseum duel — result from the player pet's perspective.
 *  Deterministic in (pets, seed). Items ON by default so equipped gear/consumables
 *  matter (casual reward stays server-capped + keyed only off the result string). */
export function runPetDuelCinematic(
    playerPet: Pet, enemyPet: Pet, seed: number,
    playerDamageMult = 1, playerHpMult = 1, playerReviveOnce = false,
    applyItems = true, accuracyEnabled = petAccuracyEnabled(), terrain: string | null = null,
    debugTrace = false,
): DuelResult {
    const fighters = [
        buildFighter(playerPet, "player", 0, -5.6, 2.6, enemyPet.element, playerDamageMult * terrainPetMult(terrain, playerPet.element), playerHpMult, playerReviveOnce, applyItems),
        buildFighter(enemyPet, "enemy", 0, 5.6, 2.6, playerPet.element, terrainPetMult(terrain, enemyPet.element), 1, false, applyItems),
    ];
    return simulate(fighters, seed, accuracyEnabled, debugTrace);
}
/** 2v2 cinematic coliseum duel — player lead+reserve vs enemy lead+reserve. */
export function runPetPartyDuelCinematic(
    playerLead: Pet, playerReserve: Pet | null,
    enemyLead: Pet, enemyReserve: Pet | null,
    seed: number, playerDamageMult = 1, playerHpMult = 1, playerReviveOnce = false,
    applyItems = true, accuracyEnabled = petAccuracyEnabled(), debugTrace = false,
): DuelResult {
    const fighters: Fighter[] = [buildFighter(playerLead, "player", 0, -5.6, 2.6, enemyLead.element, playerDamageMult, playerHpMult, playerReviveOnce, applyItems)];
    if (playerReserve) fighters.push(buildFighter(playerReserve, "player", 1, -5.0, -3.2, enemyReserve?.element ?? enemyLead.element, playerDamageMult, playerHpMult, false, applyItems));
    fighters.push(buildFighter(enemyLead, "enemy", 0, 5.6, 2.6, playerLead.element, 1, 1, false, applyItems));
    if (enemyReserve) fighters.push(buildFighter(enemyReserve, "enemy", 1, 5.0, -3.2, playerReserve?.element ?? playerLead.element, 1, 1, false, applyItems));
    return simulate(fighters, seed, accuracyEnabled, debugTrace);
}
/**
 * N-vs-N cinematic squad clash — Hollow Warfront's Rite fields up to four a side.
 *
 * ADDITIVE ONLY. This does not touch runPetDuelCinematic / runPetPartyDuelCinematic
 * or anything they call, so every Coliseum path stays byte-identical; it exists
 * because the engine was already squad-capable and only its public entry points
 * were capped at two. `simulate` takes a fighter ARRAY, `_partyMode` switches
 * itself on at `fighters.length > 2`, and the ally-separation rule loops over all
 * teammates rather than assuming one — so the AI already spaces an arbitrary
 * team. The caps were an entry-point limitation, not an engine one.
 *
 * Formation positions are battlefield JOBS, not four mirrored duels:
 * Vanguard contests centre, Warden intercepts the opposing Flanker, Flanker
 * hunts the Anchor, and Anchor holds its home post behind the protection screen.
 * Enemy Y is mirrored so both intercept routes are symmetric.
 */
export const SQUAD_FRONT_SLOTS = 2;

// ── BEASTBOUND WARFRONT: deterministic formation-board combat ───────────────
// Warfront deliberately does not use the continuous steering engine above. A
// formation autobattler needs stable squares, readable threat ranges and hard
// occupancy; feeding eight large creatures into free steering is what produced
// the old scrum, pushing and wrong-way jitter.
type KageRole = "vanguard" | "striker" | "ranger" | "support" | "shadow";
type KageOpeningJob = "front" | "cover" | "flank" | "wing";
interface KageUnit {
    fighter: Fighter;
    role: KageRole;
    col: number; row: number;
    /** The committed cell is tactical information. Keep it after movement so
     * target selection can distinguish a screen, a firing rank and a wing. */
    homeCol: number; homeRow: number;
    fromCol: number; fromRow: number;
    moveLeft: number; moveTotal: number;
    windLeft: number; recoverLeft: number;
    pendingIdx: number; pendingTargetId: string | null;
    targetLockLeft: number; blockedTicks: number;
    /** Targets recently abandoned by a live order. Prevents the squad from
     * publishing an A-B-A-B-A-B indecision loop while both contacts live. */
    targetReturnLocks: Record<string, number>;
    targetHistory: string[];
    openingJob: KageOpeningJob;
    openingCol: number; openingRow: number; openingTargetId: string | null;
    openingContactEstablished: boolean; openingWaitTicks: number;
    chakra: number; shadowStepReady: boolean; koSent: boolean; quietTicks: number;
}
interface KageProjectile extends Projectile { born: number }

const KAGE_BLOCKED = new Set(["3,1", "3,3"]);
const KAGE_SMOKE = new Set(["2,2", "4,2"]);
const KAGE_COVER = new Set(["2,0", "4,4"]);
const KAGE_VERDICT_TICK = DUEL_TPS * 28;
const KAGE_CAP_TICKS = DUEL_TPS * 38;
/** Orders persist long enough to read, then the squad takes a fresh battlefield
 * picture. A dead target or blocked route breaks the order immediately. */
const KAGE_ORDER_LOCK_TICKS = Math.round(DUEL_TPS * 2.2);
const KAGE_TARGET_RETURN_LOCK_TICKS = DUEL_TPS * 6;
const KAGE_OPENING_SHAPE_TICKS = DUEL_TPS * 6;
const KAGE_OPENING_BLOCKED_RELEASE_TICKS = Math.round(DUEL_TPS * 0.5);
const KAGE_BLOCKED_RETARGET_TICKS = 5;
const kageKey = (col: number, row: number) => `${col},${row}`;
const kageInside = (col: number, row: number) => col >= 0 && col < WARFRONT_GRID_COLS && row >= 0 && row < WARFRONT_GRID_ROWS;
const kageWalkable = (col: number, row: number) => kageInside(col, row) && !KAGE_BLOCKED.has(kageKey(col, row));
const kagePoint = (col: number, row: number): [number, number] => [
    quant((col - (WARFRONT_GRID_COLS - 1) / 2) * WARFRONT_CELL_X),
    quant((row - (WARFRONT_GRID_ROWS - 1) / 2) * WARFRONT_CELL_Y),
];
const kageCell = (x: number, y: number): [number, number] => [
    clamp(Math.round(x / WARFRONT_CELL_X + (WARFRONT_GRID_COLS - 1) / 2), 0, WARFRONT_GRID_COLS - 1),
    clamp(Math.round(y / WARFRONT_CELL_Y + (WARFRONT_GRID_ROWS - 1) / 2), 0, WARFRONT_GRID_ROWS - 1),
];
const kageRange = (a: KageUnit, b: KageUnit) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const kageRole = (fighter: Fighter): KageRole => {
    if (fighter.pet.role === "assassin" || fighter.pet.subRole === "assassin") return "shadow";
    if (fighter.pet.role === "sage" || fighter.pet.subRole === "support") return "support";
    if (fighter.pet.role === "defender" || fighter.pet.subRole === "tank") return "vanguard";
    if (fighter.pet.subRole === "kite") return "ranger";
    switch (fighter.style.arche) {
        case "defender": return "vanguard";
        case "rusher": return "shadow";
        case "kiter": return "ranger";
        case "support": return "support";
        default: return fighter.basicRanged ? "ranger" : "striker";
    }
};
const kagePreferredRange = (unit: KageUnit) => unit.role === "ranger" ? 3 : unit.role === "support" ? 3 : unit.role === "vanguard" ? 1 : 1;
const kageBlockedLine = (a: KageUnit, b: KageUnit): boolean => {
    const steps = Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
    for (let step = 1; step < steps; step++) {
        const t = step / steps;
        const col = Math.round(a.col + (b.col - a.col) * t);
        const row = Math.round(a.row + (b.row - a.row) * t);
        if (KAGE_BLOCKED.has(kageKey(col, row))) return true;
    }
    return false;
};
const kageSmokeLine = (a: KageUnit, b: KageUnit): boolean => {
    const steps = Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
    for (let step = 1; step < steps; step++) {
        const t = step / steps;
        if (KAGE_SMOKE.has(kageKey(Math.round(a.col + (b.col - a.col) * t), Math.round(a.row + (b.row - a.row) * t)))) return true;
    }
    return false;
};

/** One deterministic breadth-first route step toward a legal attack cell. The
 * old one-step gradient could bounce on opposite sides of a shoji forever; this
 * searches the whole 35-cell board once, then publishes only the first step. */
const kageRouteStep = (
    unit: KageUnit,
    target: KageUnit,
    occupied: ReadonlySet<string>,
    nearby: readonly KageUnit[],
    avoidFirstKey?: string,
    forbidPile = false,
): [number, number] | null => {
    const startKey = kageKey(unit.col, unit.row);
    const createsVisualPile = (candidateCol: number, candidateRow: number) => {
        const bodies = [{ col: candidateCol, row: candidateRow }, ...nearby
            .filter((other) => other !== unit && other.fighter.hp > 0)
            .map((other) => ({ col: other.col, row: other.row }))];
        const connected = new Set<number>([0]);
        const pending = [0];
        while (pending.length) {
            const current = pending.pop()!;
            for (let index = 1; index < bodies.length; index++) {
                if (connected.has(index)) continue;
                const distance = Math.hypot(
                    (bodies[current].col - bodies[index].col) * WARFRONT_CELL_X,
                    (bodies[current].row - bodies[index].row) * WARFRONT_CELL_Y,
                );
                // 2 × 1.105 rendered radius / 0.7 world scale.
                if (distance <= 3.158) { connected.add(index); pending.push(index); }
            }
        }
        return connected.size >= 3;
    };
    const queue: Array<[number, number]> = [[unit.col, unit.row]];
    const parent = new Map<string, string | null>([[startKey, null]]);
    const distance = new Map<string, number>([[startKey, 0]]);
    const dirs: ReadonlyArray<readonly [number, number]> = unit.fighter.team === "player"
        ? [[1, 0], [0, -1], [0, 1], [-1, 0]]
        : [[-1, 0], [0, 1], [0, -1], [1, 0]];
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const [col, row] = queue[cursor];
        const key = kageKey(col, row);
        for (const [dc, dr] of dirs) {
            const nextCol = col + dc, nextRow = row + dr, nextKey = kageKey(nextCol, nextRow);
            if (key === startKey && avoidFirstKey === nextKey) continue;
            if (!kageWalkable(nextCol, nextRow) || occupied.has(nextKey) || parent.has(nextKey)) continue;
            if (forbidPile && createsVisualPile(nextCol, nextRow)) continue;
            parent.set(nextKey, key);
            distance.set(nextKey, (distance.get(key) ?? 0) + 1);
            queue.push([nextCol, nextRow]);
        }
    }
    const desired = kagePreferredRange(unit);
    const ranged = unit.role === "ranger" || unit.role === "support";
    // Keep the approach in the deployed lane until the last two files. Shadows
    // take an outside corridor; everybody else preserves the row the player
    // deliberately bought with placement. This is the formation's route plan,
    // rather than eight independent shortest paths to the centre cell.
    const horizontalGap = Math.abs(unit.col - target.col);
    const flankRow = unit.homeRow < 2 ? 0 : unit.homeRow > 2 ? WARFRONT_GRID_ROWS - 1 : (unit.fighter.slot % 2 ? WARFRONT_GRID_ROWS - 1 : 0);
    const approachRow = unit.role === "shadow" ? flankRow : horizontalGap > 2 ? unit.homeRow : target.row;
    const destinations = queue.map(([col, row]) => {
        const phantom = { ...unit, col, row };
        const range = kageRange(phantom, target);
        const blockedLine = ranged && kageBlockedLine(phantom, target);
        const legalBand = ranged ? range >= 2 && range <= 3 && !blockedLine : range <= 1;
        const neighbors = nearby.filter((other) => other !== unit && other !== target && other.fighter.hp > 0
            && Math.max(Math.abs(other.col - col), Math.abs(other.row - row)) <= 1);
        const touchesTarget = Math.max(Math.abs(target.col - col), Math.abs(target.row - row)) <= 1;
        const bridgesThroughTarget = touchesTarget && nearby.some((other) => other !== unit && other !== target
            && other.fighter.hp > 0
            && Math.max(Math.abs(other.col - target.col), Math.abs(other.row - target.row)) <= 1);
        const alliedNeighbors = neighbors.filter((other) => other.fighter.team === unit.fighter.team).length;
        const crowd = neighbors.length;
        const pileRisk = crowd >= 2 || (touchesTarget && crowd > 0) || bridgesThroughTarget;
        const tactical = Math.abs(range - desired) * 7
            + (blockedLine ? 42 : 0)
            + (ranged && range < 2 ? 18 : 0)
            + (legalBand ? -18 : 0)
            + (KAGE_COVER.has(kageKey(col, row)) && ranged ? -5 : 0)
            + (KAGE_SMOKE.has(kageKey(col, row)) && unit.role === "shadow" ? -3 : 0)
            + Math.abs(row - approachRow) * (unit.role === "shadow" ? 3.4 : 2.2)
            // One screen plus one cross-cover attacker is readable. A fourth
            // body joining that contact is a scrum, so seek another socket.
            + crowd * 8 + alliedNeighbors * 4
            + (distance.get(kageKey(col, row)) ?? 99) * 0.7
            + row * 0.001 + col * 0.0001;
        return { col, row, tactical, legalBand, crowd, pileRisk };
    }).sort((a, b) => {
        const progressA = unit.fighter.team === "player" ? a.col : WARFRONT_GRID_COLS - 1 - a.col;
        const progressB = unit.fighter.team === "player" ? b.col : WARFRONT_GRID_COLS - 1 - b.col;
        return a.tactical - b.tactical || progressB - progressA || a.row - b.row;
    });
    // If a legal firing/contact socket exists, standing still outside range is
    // never a valid route answer. Prefer sockets which cannot form a four-body
    // knot; relax that crowd rule only when the board offers no open contact.
    const legal = destinations.filter((destination) => destination.legalBand);
    const safeLegal = legal.find((candidate) => !candidate.pileRisk);
    const destination = safeLegal
        ?? (forbidPile ? undefined : legal.find((candidate) => candidate.crowd < 2) ?? legal[0])
        ?? (forbidPile ? destinations.find((candidate) => !candidate.pileRisk) : destinations[0]);
    if (!destination || (destination.col === unit.col && destination.row === unit.row)) return null;
    let stepKey = kageKey(destination.col, destination.row);
    let prior = parent.get(stepKey);
    while (prior && prior !== startKey) {
        stepKey = prior;
        prior = parent.get(stepKey);
    }
    const [col, row] = stepKey.split(",").map(Number);
    return Number.isInteger(col) && Number.isInteger(row) ? [col, row] : null;
};

/** Route to a reserved opening socket rather than another body. Resolving the
 * file first makes fronts, diagonal cover and perimeter flanks separate into
 * readable lanes before they advance; hard occupancy still owns every step. */
const kageOpeningStep = (
    unit: KageUnit,
    occupied: ReadonlySet<string>,
    avoidFirstKey?: string,
): [number, number] | null => {
    if (unit.col === unit.openingCol && unit.row === unit.openingRow) return null;
    const startKey = kageKey(unit.col, unit.row);
    const goalKey = kageKey(unit.openingCol, unit.openingRow);
    const rowDirection = Math.sign(unit.openingRow - unit.row);
    const colDirection = Math.sign(unit.openingCol - unit.col);
    const candidates: Array<[number, number]> = unit.openingJob === "flank"
        ? [[0, rowDirection], [colDirection, 0], [0, -rowDirection], [-colDirection, 0]]
        : [[0, rowDirection], [colDirection, 0], [-colDirection, 0], [0, -rowDirection]];
    const dirs = candidates.filter(([dc, dr], index) => (dc !== 0 || dr !== 0)
        && candidates.findIndex(([otherDc, otherDr]) => otherDc === dc && otherDr === dr) === index);
    for (const fallback of [[1, 0], [0, -1], [0, 1], [-1, 0]] as const) {
        if (!dirs.some(([dc, dr]) => dc === fallback[0] && dr === fallback[1])) dirs.push([...fallback]);
    }
    const queue: Array<[number, number]> = [[unit.col, unit.row]];
    const parent = new Map<string, string | null>([[startKey, null]]);
    for (let cursor = 0; cursor < queue.length && !parent.has(goalKey); cursor++) {
        const [col, row] = queue[cursor];
        const key = kageKey(col, row);
        for (const [dc, dr] of dirs) {
            const nextCol = col + dc, nextRow = row + dr, nextKey = kageKey(nextCol, nextRow);
            if (key === startKey && nextKey === avoidFirstKey) continue;
            if (!kageWalkable(nextCol, nextRow) || occupied.has(nextKey) || parent.has(nextKey)) continue;
            parent.set(nextKey, key);
            queue.push([nextCol, nextRow]);
        }
    }
    if (!parent.has(goalKey)) return null;
    let stepKey = goalKey;
    let prior = parent.get(stepKey);
    while (prior && prior !== startKey) { stepKey = prior; prior = parent.get(stepKey); }
    const [col, row] = stepKey.split(",").map(Number);
    return Number.isInteger(col) && Number.isInteger(row) ? [col, row] : null;
};

function kageFormationSim(
    fighters: Fighter[], seed: number, accuracyEnabled: boolean, debugTrace: boolean,
): DuelResult {
    const rng = makeRngFrom(newRngState(seed));
    const events: DuelEvent[] = [];
    const snapshots: DuelSnapshot[] = [];
    let nextProjectile = 1;
    let projectiles: KageProjectile[] = [];
    const units: KageUnit[] = fighters.map((fighter) => {
        const [col, row] = kageCell(fighter.x, fighter.y);
        const [x, y] = kagePoint(col, row);
        fighter.x = x; fighter.y = y; fighter.homeX = x; fighter.homeY = y;
        fighter.state = "idle"; fighter.stateLeft = 0; fighter.targetId = null;
        fighter.statuses = emptyStatuses(); fighter.stamina = 18;
        fighter.abilities.forEach((ability, index) => { ability.cdLeft = index === 0 ? 12 : Math.min(ability.cdLeft, 45); });
        return {
            fighter, role: kageRole(fighter), col, row, fromCol: col, fromRow: row,
            homeCol: col, homeRow: row,
            moveLeft: 0, moveTotal: 0, windLeft: 0, recoverLeft: 0,
            pendingIdx: -2, pendingTargetId: null, chakra: 10 + fighter.slot * 5,
            targetLockLeft: 0, blockedTicks: 0,
            targetReturnLocks: {}, targetHistory: [],
            openingJob: "wing", openingCol: col, openingRow: row, openingTargetId: null,
            openingContactEstablished: false, openingWaitTicks: 0,
            shadowStepReady: kageRole(fighter) === "shadow", koSent: false, quietTicks: 0,
        };
    });
    const byId = (id: string | null) => id ? units.find((unit) => unit.fighter.id === id) ?? null : null;
    const alive = (team?: Fighter["team"]) => units.filter((unit) => unit.fighter.hp > 0 && (!team || unit.fighter.team === team));
    const occupied = (except?: KageUnit) => {
        const cells = new Set<string>();
        for (const unit of alive()) {
            if (unit === except) continue;
            cells.add(kageKey(unit.col, unit.row));
            // `col,row` reserves the destination at dash start. The departing
            // body is still visibly crossing its old cell for eight ticks, so
            // reserve that cell too; otherwise a following pet walks through it
            // and several legal one-cell moves render as one central knot.
            if (unit.moveLeft > 0) cells.add(kageKey(unit.fromCol, unit.fromRow));
        }
        return cells;
    };

    // The opening is one coordinated team plan, not eight independent shortest
    // paths.  Preserve the information in deployment long enough to read it:
    // one screen receives the clash, the firing rank keeps two diagonal lanes,
    // and the shadow travels the outside file to the opposing firing rank.
    // Sockets are unique across both teams and are derived only from committed
    // cells + seed, so replay/server lockstep stays exact.
    const openingTeams = (["player", "enemy"] as const).map((team) => {
        const members = units.filter((unit) => unit.fighter.team === team)
            .sort((a, b) => a.fighter.slot - b.fighter.slot);
        const front = members.find((unit) => unit.role === "vanguard")
            ?? members.find((unit) => unit.role === "striker")
            ?? members.find((unit) => unit.role !== "ranger" && unit.role !== "support")
            ?? members[0];
        const flank = members.find((unit) => unit !== front && unit.role === "shadow")
            ?? members.find((unit) => unit !== front && unit.role === "striker");
        const cover = members.filter((unit) => unit !== front && unit !== flank)
            .sort((a, b) => {
                const aBack = a.role === "ranger" || a.role === "support" ? 0 : 1;
                const bBack = b.role === "ranger" || b.role === "support" ? 0 : 1;
                return aBack - bBack || a.fighter.slot - b.fighter.slot;
            });
        return { team, members, front, flank, cover };
    });
    const playerOpening = openingTeams.find((entry) => entry.team === "player")!;
    const enemyOpening = openingTeams.find((entry) => entry.team === "enemy")!;
    const frontHomes = [playerOpening.front, enemyOpening.front].filter(Boolean) as KageUnit[];
    const averageFrontRow = frontHomes.reduce((sum, unit) => sum + unit.homeRow, 0) / Math.max(1, frontHomes.length);
    // Even files are uninterrupted through the two centre shoji.  This keeps
    // the shared front visible instead of letting a wall arbitrarily pick one
    // of four private contacts.
    const openingFrontRow = [0, 2, 4]
        .sort((a, b) => Math.abs(a - averageFrontRow) - Math.abs(b - averageFrontRow)
            || (((a + seed) & 1) - ((b + seed) & 1)) || a - b)[0];
    const playerFrontCol = (seed & 1) === 0 ? 2 : 3;
    const enemyFrontCol = playerFrontCol + 1;
    if (playerOpening.front) {
        Object.assign(playerOpening.front, { openingJob: "front" as const, openingCol: playerFrontCol, openingRow: openingFrontRow });
    }
    if (enemyOpening.front) {
        Object.assign(enemyOpening.front, { openingJob: "front" as const, openingCol: enemyFrontCol, openingRow: openingFrontRow });
    }
    const coverRowsFor = (team: Fighter["team"]): number[] => {
        if (openingFrontRow === 0) return [1, 3, 2];
        if (openingFrontRow === 4) return [3, 1, 2];
        // Opposite diagonals leave a clear sightline through the screen and put
        // each enemy shadow next to—not on top of—one firing-rank actor.
        return team === "player" ? [3, 1, 4] : [1, 3, 0];
    };
    const playerFlankRow = playerOpening.flank?.homeRow != null
        ? (playerOpening.flank.homeRow <= 2 ? 0 : 4) : 0;
    // Keep the committed outer lane. If both shadows chose the same boundary,
    // give red the opposite perimeter so their routes never collide head-on
    // and each formation retains a separately readable flank.
    const enemyFlankRow = 4 - playerFlankRow;
    for (const opening of openingTeams) {
        const playerSide = opening.team === "player";
        const coverCol = playerSide ? playerFrontCol - 2 : enemyFrontCol + 2;
        const coverRows = coverRowsFor(opening.team);
        opening.cover.forEach((unit, index) => {
            unit.openingJob = unit.role === "ranger" || unit.role === "support" ? "cover" : "wing";
            unit.openingCol = coverCol;
            unit.openingRow = coverRows[index] ?? (playerSide ? 4 : 0);
        });
        if (opening.flank) {
            opening.flank.openingJob = "flank";
            opening.flank.openingCol = playerSide ? enemyFrontCol + 2 : playerFrontCol - 2;
            opening.flank.openingRow = playerSide ? playerFlankRow : enemyFlankRow;
        }
    }
    if (playerOpening.front && enemyOpening.front) {
        playerOpening.front.openingTargetId = enemyOpening.front.fighter.id;
        enemyOpening.front.openingTargetId = playerOpening.front.fighter.id;
        for (const unit of playerOpening.cover) {
            unit.openingTargetId = unit.openingJob === "cover" ? enemyOpening.front.fighter.id : null;
        }
        for (const unit of enemyOpening.cover) {
            unit.openingTargetId = unit.openingJob === "cover" ? playerOpening.front.fighter.id : null;
        }
    }
    const nearestBackline = (attacker: KageUnit | undefined, opening: typeof playerOpening) => attacker
        ? opening.cover.reduce<KageUnit | undefined>((best, unit) => !best
            || Math.abs(unit.openingRow - attacker.openingRow) < Math.abs(best.openingRow - attacker.openingRow)
            || (Math.abs(unit.openingRow - attacker.openingRow) === Math.abs(best.openingRow - attacker.openingRow)
                && unit.fighter.slot < best.fighter.slot) ? unit : best, undefined)
        : undefined;
    if (playerOpening.flank) {
        playerOpening.flank.openingTargetId = (nearestBackline(playerOpening.flank, enemyOpening)
            ?? enemyOpening.front)?.fighter.id ?? null;
    }
    if (enemyOpening.flank) {
        enemyOpening.flank.openingTargetId = (nearestBackline(enemyOpening.flank, playerOpening)
            ?? playerOpening.front)?.fighter.id ?? null;
    }

    const homeAdvance = (unit: KageUnit) => unit.fighter.team === "player"
        ? unit.homeCol
        : WARFRONT_GRID_COLS - 1 - unit.homeCol;
    const roleOrder = (unit: KageUnit) => {
        switch (unit.role) {
            case "vanguard": return 0;
            case "striker": return 1;
            case "shadow": return 2;
            case "ranger": return 3;
            case "support": return 4;
        }
    };
    const chooseTargets = () => {
        // A killed assignment is cancelled before another frame is published.
        // In particular, a wind-up never spends the next third-second aiming at
        // a corpse while the public target arrow points somewhere else.
        for (const unit of alive()) {
            if (unit.targetLockLeft > 0) unit.targetLockLeft--;
            for (const targetId of Object.keys(unit.targetReturnLocks)) {
                const remaining = unit.targetReturnLocks[targetId] - 1;
                if (remaining > 0) unit.targetReturnLocks[targetId] = remaining;
                else delete unit.targetReturnLocks[targetId];
            }
            const pending = byId(unit.pendingTargetId);
            const pendingAbility = unit.pendingIdx >= 0 ? unit.fighter.abilities[unit.pendingIdx] : null;
            if (unit.pendingTargetId && (!pending || pending.fighter.hp <= 0) && pendingAbility?.cls !== "support") {
                unit.pendingIdx = -2; unit.pendingTargetId = null; unit.windLeft = 0;
                unit.fighter.state = "idle"; unit.fighter.stateLeft = 0;
            }
            const current = byId(unit.fighter.targetId);
            if (!current || current.fighter.hp <= 0) {
                unit.fighter.targetId = null; unit.targetLockLeft = 0;
            }
        }

        for (const team of ["player", "enemy"] as const) {
            const claimed = new Map<string, number>();
            const allies = alive(team).sort((a, b) => roleOrder(a) - roleOrder(b) || a.fighter.slot - b.fighter.slot);
            const foes = alive(team === "player" ? "enemy" : "player");
            for (const unit of allies) {
                const openingTarget = tick < KAGE_OPENING_SHAPE_TICKS ? byId(unit.openingTargetId) : null;
                if (openingTarget?.fighter.hp) {
                    const previousTargetId = unit.fighter.targetId;
                    unit.fighter.targetId = openingTarget.fighter.id;
                    unit.targetLockLeft = KAGE_ORDER_LOCK_TICKS;
                    if (previousTargetId && previousTargetId !== openingTarget.fighter.id) {
                        unit.targetReturnLocks[previousTargetId] = KAGE_TARGET_RETURN_LOCK_TICKS;
                    }
                    if (unit.targetHistory.at(-1) !== openingTarget.fighter.id) {
                        unit.targetHistory.push(openingTarget.fighter.id);
                        if (unit.targetHistory.length > 8) unit.targetHistory.shift();
                    }
                    claimed.set(openingTarget.fighter.id, (claimed.get(openingTarget.fighter.id) ?? 0) + 1);
                    const aiState: DuelAiState = unit.openingJob === "flank" ? "flank"
                        : unit.openingJob === "front" ? "hold position" : "prepare combo";
                    const plan = unit.openingJob === "flank" ? "take the outside lane and threaten the firing rank"
                        : unit.openingJob === "front" ? "receive pressure at the shared front"
                            : "hold a diagonal firing lane behind the screen";
                    setIntent(unit.fighter, aiState, kagePreferredRange(unit), plan,
                        `${openingTarget.fighter.id} is the opening formation's shared contact`);
                    continue;
                }
                const current = byId(unit.fighter.targetId);
                if (current && current.fighter.hp > 0 && unit.targetLockLeft > 0) {
                    claimed.set(current.fighter.id, (claimed.get(current.fighter.id) ?? 0) + 1);
                    continue;
                }
                // If an order was just abandoned, the next readable plan uses
                // another living contact. Only relax this when every remaining
                // foe is return-locked, so a shrinking endgame cannot stall.
                const wouldResumeAlternation = (foe: KageUnit) => {
                    const history = unit.targetHistory;
                    if (history.length < 4) return false;
                    const [a, b, c, d] = history.slice(-4);
                    return a === c && b === d && a !== b && foe.fighter.id === a
                        && Boolean(byId(a)?.fighter.hp) && Boolean(byId(b)?.fighter.hp);
                };
                const unlockedFoes = foes.filter((foe) => !unit.targetReturnLocks[foe.fighter.id]);
                const unlockedWithoutLoop = unlockedFoes.filter((foe) => !wouldResumeAlternation(foe));
                const anyWithoutLoop = foes.filter((foe) => !wouldResumeAlternation(foe));
                const candidates = unlockedWithoutLoop.length > 0 ? unlockedWithoutLoop
                    : anyWithoutLoop.length > 0 ? anyWithoutLoop
                        : unlockedFoes.length > 0 ? unlockedFoes : foes;
                let best: KageUnit | null = null, bestScore = Infinity, bestLoad = 0, bestScreened = false;
                for (const foe of candidates) {
                    const range = kageRange(unit, foe);
                    const rowGap = Math.abs(unit.homeRow - foe.homeRow);
                    const load = claimed.get(foe.fighter.id) ?? 0;
                    const hp = foe.fighter.hp / foe.fighter.maxHp;
                    const backline = (foe.fighter.team === "enemy" ? foe.homeCol : WARFRONT_GRID_COLS - 1 - foe.homeCol);
                    const foeCrowd = alive().filter((other) => other !== unit && other !== foe && kageRange(other, foe) <= 1).length;
                    const screened = foes.some((screen) => screen !== foe
                        && homeAdvance(screen) > homeAdvance(foe)
                        && Math.abs(screen.homeRow - foe.homeRow) <= 1);
                    // The first front actor establishes contact. A ranged or
                    // support actor deliberately becomes its cross-cover; a
                    // third claim is forbidden unless there is no living choice.
                    const loadCost = load >= 2 ? 80 + load * 20
                        : load === 1 ? (unit.role === "ranger" || unit.role === "support" ? -9 : 7)
                            : 0;
                    let score = range * 4 + rowGap * 3.2 + loadCost + hp * 1.5 + foeCrowd * 3.5 + foe.fighter.slot * 0.01;
                    if (screened && unit.role !== "shadow") score += 15;
                    if (unit.role === "shadow") {
                        score += hp * 5 - backline * 1.5
                            - (foe.role === "support" || foe.role === "ranger" ? 8 : 0)
                            + load * 12;
                    }
                    if (unit.role === "vanguard") score += foe.role === "shadow" ? -7 : 0;
                    if (unit.role === "ranger" || unit.role === "support") score += kageBlockedLine(unit, foe) ? 10 : 0;
                    if (score < bestScore) { bestScore = score; best = foe; bestLoad = load; bestScreened = screened; }
                }
                const previousTargetId = unit.fighter.targetId;
                unit.fighter.targetId = best?.fighter.id ?? null;
                if (previousTargetId && best && previousTargetId !== best.fighter.id) {
                    unit.targetReturnLocks[previousTargetId] = KAGE_TARGET_RETURN_LOCK_TICKS;
                }
                if (best && unit.targetHistory.at(-1) !== best.fighter.id) {
                    unit.targetHistory.push(best.fighter.id);
                    if (unit.targetHistory.length > 8) unit.targetHistory.shift();
                }
                unit.targetLockLeft = best ? KAGE_ORDER_LOCK_TICKS : 0;
                if (best) {
                    claimed.set(best.fighter.id, bestLoad + 1);
                    const crossCover = bestLoad === 1 && (unit.role === "ranger" || unit.role === "support");
                    const aiState: DuelAiState = unit.role === "shadow" ? "flank"
                        : unit.role === "vanguard" ? "hold position"
                            : crossCover ? "prepare combo" : "engage";
                    const plan = unit.role === "shadow" ? "take the outside lane and pressure the firing rank"
                        : unit.role === "vanguard" ? "screen the formation and intercept the nearest breach"
                            : crossCover ? "cross-cover the front contact"
                                : "hold the deployed lane and contest its threat";
                    const reason = crossCover ? `${best.fighter.id} is the screen's visible focus`
                        : bestScreened && unit.role === "shadow" ? `${best.fighter.id} is exposed behind its screen`
                            : `${best.fighter.id} is the best threat in this lane`;
                    setIntent(unit.fighter, aiState, kagePreferredRange(unit), plan, reason);
                }
            }
        }
    };

    const moveUnit = (unit: KageUnit, col: number, row: number, duration = 8, name?: string) => {
        unit.fromCol = unit.col; unit.fromRow = unit.row;
        unit.col = col; unit.row = row; unit.moveTotal = duration; unit.moveLeft = duration;
        unit.quietTicks = 0; unit.blockedTicks = 0;
        unit.fighter.state = "dash"; unit.fighter.routeX = kagePoint(col, row)[0]; unit.fighter.routeY = kagePoint(col, row)[1]; unit.fighter.routeActive = true;
        events.push({ t: tick, type: name ? "maneuver" : "dash", side: unit.fighter.team, actorId: unit.fighter.id, move: name });
    };

    const startAttack = (unit: KageUnit, target: KageUnit) => {
        const ready = unit.fighter.abilities
            .map((ability, index) => ({ ability, index }))
            .filter(({ ability }) => !ability.isMove && ability.cdLeft <= 0);
        let selected = unit.chakra >= 95 ? ready.find(({ ability }) => {
            if (!ability.signature) return false;
            if (ability.cls === "support") return alive(unit.fighter.team).length > 1;
            if (ability.cls === "ranged") return kageRange(unit, target) <= 3 && !kageBlockedLine(unit, target);
            return kageRange(unit, target) <= 1;
        }) : undefined;
        if (!selected && unit.role === "support") {
            const supportMove = ready.find(({ ability }) => ability.cls === "support");
            const teamUnits = alive(unit.fighter.team);
            const needsHelp = supportMove && teamUnits.length > 1 && teamUnits.some((ally) => {
                const hp = ally.fighter.hp / ally.fighter.maxHp;
                if (supportMove.ability.kind === "heal") return hp < 0.74;
                if (supportMove.ability.kind === "barrier") return hp < 0.94 && ally.fighter.statuses.shieldHp <= 0;
                return hp < 0.82;
            });
            if (needsHelp) selected = supportMove;
        }
        if (!selected) selected = ready.find(({ ability }) => ability.cls !== "support" && (ability.cls === "ranged" || kageRange(unit, target) <= 1));
        const idx = selected?.index ?? -1;
        const ability = idx >= 0 ? unit.fighter.abilities[idx] : null;
        const supporting = ability?.cls === "support";
        const ranged = ability ? ability.cls === "ranged" : unit.role === "ranger" || unit.role === "support";
        if (!supporting && ranged && (kageRange(unit, target) > 3 || kageBlockedLine(unit, target))) return false;
        if (!supporting && !ranged && kageRange(unit, target) > 1) return false;
        if (idx < 0 && unit.fighter.basicCdLeft > 0) return false;
        unit.pendingIdx = idx; unit.pendingTargetId = target.fighter.id;
        unit.quietTicks = 0;
        unit.windLeft = ability?.signature ? 15 : ranged ? 10 : 8;
        unit.fighter.state = "windup"; unit.fighter.stateLeft = unit.windLeft;
        if (ability?.signature) {
            unit.chakra = 0;
            events.push({ t: tick, type: "ultimate", side: unit.fighter.team, actorId: unit.fighter.id, targetId: target.fighter.id, kind: ability.kind, move: ability.name, signature: true });
        } else {
            events.push({ t: tick, type: ability?.cls === "support" ? "cast" : "windup", side: unit.fighter.team, actorId: unit.fighter.id, targetId: target.fighter.id, kind: ability?.kind ?? "damage", move: ability?.name });
        }
        return true;
    };

    const resolveAttack = (unit: KageUnit) => {
        const fighter = unit.fighter;
        const target = byId(unit.pendingTargetId);
        const ability = unit.pendingIdx >= 0 ? fighter.abilities[unit.pendingIdx] : null;
        unit.pendingIdx = -2; unit.pendingTargetId = null; unit.blockedTicks = 0;
        fighter.state = "strike";
        if (ability?.cls === "support") {
            const ally = [...alive(fighter.team)].sort((a, b) => {
                if (ability.kind === "barrier") {
                    const shieldOrder = a.fighter.statuses.shieldHp - b.fighter.statuses.shieldHp;
                    if (shieldOrder) return shieldOrder;
                }
                return a.fighter.hp / a.fighter.maxHp - b.fighter.hp / b.fighter.maxHp || a.fighter.slot - b.fighter.slot;
            })[0] ?? unit;
            if (ability.kind === "heal") {
                const verdict = clamp((tick - KAGE_VERDICT_TICK) / Math.max(1, KAGE_CAP_TICKS - KAGE_VERDICT_TICK), 0, 1);
                const heal = Math.max(1, Math.round(ally.fighter.maxHp * (ability.signature ? 0.24 : 0.15) * (1 - verdict * 0.55)));
                const before = ally.fighter.hp;
                ally.fighter.hp = Math.min(ally.fighter.maxHp, ally.fighter.hp + heal);
                events.push({ t: tick, type: "heal", side: fighter.team, actorId: fighter.id, targetId: ally.fighter.id, dmg: Math.max(0, ally.fighter.hp - before), kind: ability.kind, move: ability.name, signature: ability.signature });
            } else {
                const shield = Math.round(ally.fighter.maxHp * (ability.signature ? 0.26 : 0.16));
                ally.fighter.statuses.shieldHp = Math.max(ally.fighter.statuses.shieldHp, shield);
                events.push({ t: tick, type: "shield", side: fighter.team, actorId: fighter.id, targetId: ally.fighter.id, dmg: shield, kind: ability.kind, move: ability.name, signature: ability.signature });
            }
            ability.cdLeft = ability.cdTicks; unit.recoverLeft = 12; return;
        }
        if (!target || target.fighter.hp <= 0) { events.push({ t: tick, type: "whiff", side: fighter.team, actorId: fighter.id }); unit.recoverLeft = 7; return; }
        const ranged = ability ? ability.cls === "ranged" : unit.role === "ranger" || unit.role === "support";
        if ((ranged && (kageRange(unit, target) > 3 || kageBlockedLine(unit, target))) || (!ranged && kageRange(unit, target) > 1)) {
            events.push({ t: tick, type: "whiff", side: fighter.team, actorId: fighter.id, targetId: target.fighter.id, move: ability?.name });
            unit.recoverLeft = 7; return;
        }
        const smokePenalty = ranged && kageSmokeLine(unit, target) ? 0.22 : 0;
        if (accuracyEnabled && ability && rng() >= Math.max(0.52, ability.accuracy / 100 - smokePenalty)) {
            events.push({ t: tick, type: "whiff", side: fighter.team, actorId: fighter.id, targetId: target.fighter.id, move: ability.name });
        } else {
            const oldPositions = units.map((entry) => [entry.fighter.x, entry.fighter.y] as const);
            const hpBefore = target.fighter.hp;
            applyDamage(fighter, target.fighter, ability, rng, tick, events, ranged);
            if (ranged && KAGE_COVER.has(kageKey(target.col, target.row))) {
                const dealt = Math.max(0, hpBefore - target.fighter.hp);
                const restore = Math.round(dealt * 0.28);
                target.fighter.hp = Math.min(hpBefore, target.fighter.hp + restore);
                const hit = [...events].reverse().find((event) => event.t === tick && event.type === "hit" && event.actorId === fighter.id && event.targetId === target.fighter.id);
                if (hit?.dmg) hit.dmg = Math.max(0, hit.dmg - restore);
            }
            const verdict = clamp((tick - KAGE_VERDICT_TICK) / Math.max(1, KAGE_CAP_TICKS - KAGE_VERDICT_TICK), 0, 1);
            const dealtAfterCover = Math.max(0, hpBefore - target.fighter.hp);
            if (verdict > 0 && dealtAfterCover > 0 && target.fighter.hp > 0) {
                const verdictDamage = Math.max(1, Math.round(dealtAfterCover * (0.35 + verdict)));
                target.fighter.hp = Math.max(0, target.fighter.hp - verdictDamage);
                const hit = [...events].reverse().find((event) => event.t === tick && event.type === "hit" && event.actorId === fighter.id && event.targetId === target.fighter.id);
                if (hit) {
                    hit.dmg = Math.max(1, Math.round((hit.dmg ?? dealtAfterCover) + verdictDamage));
                    hit.combo = "KAGE VERDICT";
                }
            }
            units.forEach((entry, index) => { entry.fighter.x = oldPositions[index][0]; entry.fighter.y = oldPositions[index][1]; });
            unit.chakra = quant(Math.min(100, unit.chakra + 19)); fighter.stamina = unit.chakra;
            target.chakra = Math.min(100, target.chakra + 12);
            if (ranged) projectiles.push({ id: nextProjectile++, ownerId: fighter.id, team: fighter.team, targetId: target.fighter.id, abilityIdx: ability ? fighter.abilities.indexOf(ability) : -1, x: fighter.x, y: fighter.y, speed: 0.72, ttl: 24, element: fighter.element, kind: ability?.kind ?? "damage", born: tick });
            if (ability?.aoe) for (const splash of alive(target.fighter.team)) {
                if (splash === target || Math.max(Math.abs(splash.col - target.col), Math.abs(splash.row - target.row)) > 1) continue;
                const splashDmg = Math.max(1, Math.round(Math.max(0, hpBefore - target.fighter.hp) * 0.45));
                splash.fighter.hp -= splashDmg;
                events.push({ t: tick, type: "hit", side: fighter.team, actorId: fighter.id, targetId: splash.fighter.id, dmg: splashDmg, element: fighter.element, kind: ability.kind, ranged: true, move: ability.name, signature: ability.signature, combo: "FORMATION BREAK" });
            }
        }
        if (ability) ability.cdLeft = ability.cdTicks; else fighter.basicCdLeft = fighter.basicCdT + 10;
        unit.recoverLeft = ability?.signature ? 18 : 11;
    };

    let tick = 0;
    const cap = KAGE_CAP_TICKS;
    for (; tick <= cap; tick++) {
        chooseTargets();
        // Resolve initiative in deterministic alternating side order. With
        // destination cells reserved at move start, always processing blue
        // first let red wind up against blue's future contact cell. Alternating
        // with a seeded opening bit removes that seat-order advantage while
        // preserving lockstep replay parity.
        const playerFirst = ((tick + (seed & 1)) & 1) === 0;
        const actionOrder = playerFirst
            ? [...units.filter((unit) => unit.fighter.team === "player"), ...units.filter((unit) => unit.fighter.team === "enemy")]
            : [...units.filter((unit) => unit.fighter.team === "enemy"), ...units.filter((unit) => unit.fighter.team === "player")];
        for (const unit of actionOrder) {
            const fighter = unit.fighter;
            if (fighter.hp <= 0) {
                fighter.hp = 0; fighter.state = "dead"; fighter.targetId = null;
                if (!unit.koSent) { unit.koSent = true; events.push({ t: tick, type: "ko", side: fighter.team, actorId: fighter.id }); }
                continue;
            }
            tickStatuses(fighter);
            unit.quietTicks++;
            fighter.abilities.forEach((ability) => { if (ability.cdLeft > 0) ability.cdLeft--; });
            if (fighter.basicCdLeft > 0) fighter.basicCdLeft--;
            unit.chakra = quant(Math.min(100, unit.chakra + 0.16)); fighter.stamina = unit.chakra;
            const target = byId(fighter.targetId);
            if (target && target.fighter.hp > 0) {
                const dx = target.fighter.x - fighter.x, dy = target.fighter.y - fighter.y, length = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
                fighter.faceX = quant(dx / length); fighter.faceY = quant(dy / length);
            }
            if (unit.moveLeft > 0) {
                unit.moveLeft--;
                const progress = 1 - unit.moveLeft / Math.max(1, unit.moveTotal);
                const [fx, fy] = kagePoint(unit.fromCol, unit.fromRow), [tx, ty] = kagePoint(unit.col, unit.row);
                fighter.x = quant(fx + (tx - fx) * progress); fighter.y = quant(fy + (ty - fy) * progress);
                if (unit.moveLeft <= 0) { fighter.x = tx; fighter.y = ty; fighter.state = "idle"; fighter.routeActive = false; }
                continue;
            }
            if (unit.windLeft > 0) { if (--unit.windLeft <= 0) resolveAttack(unit); continue; }
            if (unit.recoverLeft > 0) { fighter.state = "recover"; if (--unit.recoverLeft <= 0) fighter.state = "idle"; continue; }
            if (fighter.statuses.stunLeft > 0) { fighter.state = "stagger"; continue; }
            if (!target || target.fighter.hp <= 0) continue;
            const openingAnchor = tick < KAGE_OPENING_SHAPE_TICKS ? byId(unit.openingTargetId) : null;
            let holdsOpeningSocket = Boolean(openingAnchor?.fighter.hp) && unit.openingJob !== "wing";
            const atOpeningSocket = unit.col === unit.openingCol && unit.row === unit.openingRow;
            const openingReach = unit.role === "ranger" || unit.role === "support" ? 3 : 1;
            const openingContactLegal = Boolean(openingAnchor
                && kageRange(unit, openingAnchor) <= openingReach
                && (openingReach <= 1 || !kageBlockedLine(unit, openingAnchor)));
            if (holdsOpeningSocket && atOpeningSocket && openingContactLegal) {
                unit.openingContactEstablished = true;
                unit.openingWaitTicks = 0;
            }
            if (holdsOpeningSocket && atOpeningSocket && openingAnchor
                && !openingContactLegal
                && (unit.openingContactEstablished || ++unit.openingWaitTicks >= KAGE_OPENING_BLOCKED_RELEASE_TICKS)) {
                // The opposing job can be released early when its own contact
                // falls. Do not pin this actor to an empty square while that
                // still-living target fights elsewhere; resume ordinary route
                // selection immediately from the readable opening position.
                unit.openingTargetId = null;
                unit.openingJob = "wing";
                unit.targetLockLeft = 0;
                fighter.targetId = null;
                unit.blockedTicks = 0;
                holdsOpeningSocket = false;
                setIntent(fighter, "reposition", openingReach,
                    "pursue the displaced formation target", "the opposing firing socket has moved");
                continue;
            }
            if (holdsOpeningSocket && (unit.col !== unit.openingCol || unit.row !== unit.openingRow)) {
                const occupiedCells = occupied(unit);
                const previousKey = unit.fromCol !== unit.col || unit.fromRow !== unit.row
                    ? kageKey(unit.fromCol, unit.fromRow)
                    : undefined;
                const step = kageOpeningStep(unit, occupiedCells, previousKey)
                    ?? kageOpeningStep(unit, occupiedCells);
                // The committed cell also owns approach cadence. Adjacent
                // deployment swaps therefore change contact timing as well as
                // the drawn route instead of converging into an identical
                // scripted opener after frame zero.
                const routeTicks = 7 + ((unit.homeRow * 2 + unit.homeCol) % 3);
                if (step) moveUnit(unit, step[0], step[1], routeTicks);
                else if (++unit.blockedTicks >= KAGE_OPENING_BLOCKED_RELEASE_TICKS) {
                    // A reservation must never become a six-second stare-down.
                    // Release only this failed job; the other three readable
                    // lanes remain intact while normal target/path selection
                    // finds the actor a legal contribution.
                    unit.openingTargetId = null;
                    unit.openingJob = "wing";
                    unit.targetLockLeft = 0;
                    fighter.targetId = null;
                    unit.blockedTicks = 0;
                    setIntent(fighter, "reposition", kagePreferredRange(unit),
                        "join the nearest open engagement", "the reserved opening socket is temporarily sealed");
                }
                continue;
            }
            if (unit.role === "shadow" && unit.shadowStepReady && tick > KAGE_OPENING_SHAPE_TICKS) {
                const behind = target.fighter.team === "enemy" ? 1 : -1;
                const preferred = [
                    [target.col + behind, target.row], [target.col + behind, target.row - 1], [target.col + behind, target.row + 1],
                    [target.col, target.row - 1], [target.col, target.row + 1], [target.col - behind, target.row],
                ];
                const fallback = Array.from({ length: WARFRONT_GRID_COLS * WARFRONT_GRID_ROWS }, (_, index) => [index % WARFRONT_GRID_COLS, Math.floor(index / WARFRONT_GRID_COLS)])
                    .sort((a, b) => Math.max(Math.abs(a[0] - target.col), Math.abs(a[1] - target.row)) - Math.max(Math.abs(b[0] - target.col), Math.abs(b[1] - target.row)));
                const landing = [...preferred, ...fallback]
                    .filter(([col, row]) => kageWalkable(col, row) && !occupied(unit).has(kageKey(col, row)))
                    .map(([col, row]) => {
                        const distance = Math.max(Math.abs(col - target.col), Math.abs(row - target.row));
                        const crowd = alive().filter((other) => other !== unit && other !== target
                            && Math.max(Math.abs(other.col - col), Math.abs(other.row - row)) <= 1).length;
                        const flankRow = unit.homeRow < 2 ? 0 : unit.homeRow > 2 ? WARFRONT_GRID_ROWS - 1 : (unit.fighter.slot % 2 ? WARFRONT_GRID_ROWS - 1 : 0);
                        return { col, row, score: distance * 20 + crowd * 9 + Math.abs(row - flankRow) * 2 };
                    })
                    .sort((a, b) => a.score - b.score || a.col - b.col || a.row - b.row)[0];
                if (landing) {
                    unit.shadowStepReady = false; moveUnit(unit, landing.col, landing.row, 11, "SHADOW STEP"); continue;
                }
            }
            // A malformed imported pet cooldown or an exotic support-only kit
            // must never create a permanent stare-down. Two seconds without a
            // move/cast opens a basic attack window; ordinary kits never touch
            // this guard because their real cooldown is only 25 ticks.
            if (unit.quietTicks > DUEL_TPS * 2) fighter.basicCdLeft = 0;
            if (startAttack(unit, target)) continue;
            // A unit which has reached its reserved opening socket fights from
            // that socket.  Ranged pets do not erase their own firing lane by
            // walking into the screen, and flankers do not immediately fold
            // back into the front after reaching the outside rank.
            if (holdsOpeningSocket) { unit.blockedTicks = 0; continue; }

            const want = kagePreferredRange(unit);
            const tooClose = (unit.role === "ranger" || unit.role === "support") && kageRange(unit, target) < 2;
            const ranged = unit.role === "ranger" || unit.role === "support";
            const needsPosition = tooClose || kageRange(unit, target) > want || (ranged && kageBlockedLine(unit, target));
            if (!needsPosition) { unit.blockedTicks = 0; continue; }
            const occupiedCells = occupied(unit);
            const previousKey = unit.fromCol !== unit.col || unit.fromRow !== unit.row
                ? kageKey(unit.fromCol, unit.fromRow)
                : undefined;
            // An immediate A→B→A reversal is not a plan. Seek any other legal
            // first step before allowing the previous cell as a last resort.
            const openingSpacing = tick < KAGE_OPENING_SHAPE_TICKS;
            const step = kageRouteStep(unit, target, occupiedCells, alive(), previousKey, openingSpacing)
                ?? kageRouteStep(unit, target, occupiedCells, alive(), undefined, openingSpacing);
            if (step) moveUnit(unit, step[0], step[1], 8);
            else if (++unit.blockedTicks >= KAGE_BLOCKED_RETARGET_TICKS) {
                // The route reservation, not an invisible force, rejected this
                // order. Take a new assignment within 167 ms instead of staring
                // at the blocked contact or oscillating around it.
                if (fighter.targetId) unit.targetReturnLocks[fighter.targetId] = KAGE_TARGET_RETURN_LOCK_TICKS;
                unit.blockedTicks = 0; unit.targetLockLeft = 0; fighter.targetId = null;
                setIntent(fighter, "reposition", want, "take a free firing lane", "the assigned contact has no legal socket");
            }
        }

        for (const projectile of projectiles) {
            const target = byId(projectile.targetId);
            if (!target || target.fighter.hp <= 0) { projectile.ttl = 0; continue; }
            const dx = target.fighter.x - projectile.x, dy = target.fighter.y - projectile.y, length = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
            projectile.x = quant(projectile.x + dx / length * projectile.speed); projectile.y = quant(projectile.y + dy / length * projectile.speed); projectile.ttl--;
            if (length < projectile.speed * 1.25) projectile.ttl = 0;
        }
        projectiles = projectiles.filter((projectile) => projectile.ttl > 0);
        // Reconcile facing after every actor has moved. Sequential simulation
        // order must never leave an early actor looking at yesterday's target
        // position in the published snapshot.
        for (const unit of alive()) {
            const target = byId(unit.fighter.targetId);
            if (!target || target.fighter.hp <= 0) continue;
            const dx = target.fighter.x - unit.fighter.x, dy = target.fighter.y - unit.fighter.y;
            const length = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
            unit.fighter.faceX = quant(dx / length); unit.fighter.faceY = quant(dy / length);
        }
        snapshots.push(snap(tick, fighters, projectiles, debugTrace));
        const blueAlive = alive("player").length, redAlive = alive("enemy").length;
        if (!blueAlive || !redAlive) break;
    }
    const blueAlive = alive("player"), redAlive = alive("enemy");
    const blueScore = blueAlive.reduce((sum, unit) => sum + unit.fighter.hp / unit.fighter.maxHp, 0);
    const redScore = redAlive.reduce((sum, unit) => sum + unit.fighter.hp / unit.fighter.maxHp, 0);
    const winner: DuelResult["winner"] = blueAlive.length !== redAlive.length
        ? (blueAlive.length > redAlive.length ? "player" : "enemy")
        : Math.abs(blueScore - redScore) > 1e-6 ? (blueScore > redScore ? "player" : "enemy") : null;
    return { result: winner === "player" ? "win" : winner === "enemy" ? "loss" : "draw", winner, ticks: tick, snapshots, events };
}

export function runPetSquadDuelCinematic(
    playerSquad: readonly Pet[], enemySquad: readonly Pet[], seed: number,
    applyItems = true, accuracyEnabled = petAccuracyEnabled(), debugTrace = false,
    playerDeployment?: readonly number[], enemyDeployment?: readonly number[],
): DuelResult {
    const fighters: Fighter[] = [];
    const leadElement = (squad: readonly Pet[]) => squad[0]?.element ?? null;
    const postFor = (deployment: readonly number[] | undefined, slot: number): readonly [number, number] => {
        const nodeId = deployment?.[slot];
        if (Number.isInteger(nodeId) && Number(nodeId) >= 0 && Number(nodeId) < WARFRONT_DEPLOYMENT_NODES.length) {
            return WARFRONT_DEPLOYMENT_NODES[Number(nodeId)];
        }
        return WARFRONT_POSTS[Math.min(slot, WARFRONT_POSTS.length - 1)];
    };
    playerSquad.forEach((pet, slot) => {
        const [x, y] = postFor(playerDeployment, slot);
        fighters.push(buildFighter(pet, "player", slot, -x, y, enemySquad[slot]?.element ?? leadElement(enemySquad), 1, 1, false, applyItems));
    });
    enemySquad.forEach((pet, slot) => {
        const [x, y] = postFor(enemyDeployment, slot);
        // Beastbound Warfront bands face each other across the vertical centre line.
        // Mirror X only so North remains North and both seats have identical
        // access to shoji, smoke and cover.
        fighters.push(buildFighter(pet, "enemy", slot, x, y, playerSquad[slot]?.element ?? leadElement(playerSquad), 1, 1, false, applyItems));
    });
    return kageFormationSim(fighters, seed, accuracyEnabled, debugTrace);
}

/** The fighting archetype the engine assigns a pet — exported for the balance harness
 *  so per-archetype win-rate is measured from the SAME classifier the sim uses. */
export function petCinematicArchetype(pet: Pet): Archetype {
    return classifyArchetype(pet, petCinematicAbilities(pet));
}

// ── LIVE / PLAYER-CONTROLLED API ────────────────────────────────────────────────
// Everything below exists only for the commanded coliseum path (pet-duel-live.ts).
// None of it runs for runPetDuelCinematic / runPetPartyDuelCinematic, so the
// server mirror, the pet ladder and sector war are untouched by its presence.

/** One player input. `idx` is an ability slot, or -1 for a plain basic attack. */
export type DuelCommand =
    | { kind: "ability"; actorId: string; idx: number }
    | { kind: "technique"; actorId: string; idx: number }
    | { kind: "break"; actorId: string }
    | { kind: "stance"; actorId: string; stance: number }
    | { kind: "auto"; actorId: string; on: boolean }
    | { kind: "clash"; actorId: string; pick: number };

/** What the command deck needs to draw one fighter's buttons for a given tick. */
export interface DuelControlSnap {
    stamina: number;
    hp: number; maxHp: number;
    stance: number;
    auto: boolean;
    orderedIdx: number;                 // -2 none, -1 basic, >=0 ability slot
    breakPending: boolean;
    commandCharge: number;
    commandReady: boolean;
    abilities: Array<{ name: string; kind: PetJutsu["kind"]; cost: number; signature: boolean; cdLeft: number; cdTicks: number; isMove: boolean; support: boolean }>;
}

/** LIVE-COLISEUM ONLY — give the basic attack back its melee identity.
 *
 *  `buildFighter` derives `basicRanged` from "owns ANY ranged-class ability", and
 *  `abilityClass()` calls every kind except damage/crush/lifesteal ranged. So a
 *  brawler carrying one Freeze utility fights the entire match as a zoner. Measured
 *  over 312 duels the coliseum produced 19.9 PROJECTILE hits per fight against 0.2
 *  melee ones: bodies never met, the pounce never resolved, and the only body dashes
 *  on screen were whiffs. That is the "pets trigger moves and miss each other /
 *  dashes have no impact" complaint at its source — the fight was never melee.
 *
 *  Here the basic follows the pet's ARCHETYPE instead. Only a KITER keeps a ranged
 *  basic: that is the one archetype whose classifier actually means "wants
 *  distance" (sub === "kite", or fast+glass with a ranged kit). `support` is NOT a
 *  range statement — `classifyArchetype` assigns it for carrying ANY heal/buff/
 *  shield — and holding those at range was the same over-broad-classification bug
 *  in a second coat of paint: measured across the shipped 140-pet pool, 67 pets
 *  were held ranged and **every one of them owns a melee attack**. Not a single pet
 *  in the game is genuinely ranged-only, so the old `!hasMelee` escape was dead
 *  code. Melee-identity coverage 52% → 88% of the roster.
 *
 *  Ranged ABILITIES are untouched — a support pet still heals and shields on
 *  cooldown, it just stops poking with projectiles in between and has to earn
 *  contact like everything else.
 *
 *  Deliberately NOT applied to runPetDuelCinematic: the pet ladder and sector war
 *  replay that path server-side, so leaving it alone keeps those outcomes — and the
 *  parity test — byte-identical. The live client and api/pet/_duel-replay.ts both
 *  build through the constructors below, so they always agree.
 */
function applyLiveBrawlProfile(fighters: Fighter[]) {
    for (const f of fighters) {
        const arch = classifyArchetype(f.pet, f.abilities);
        f.basicRanged = arch === "kiter" || !f.abilities.some((a) => a.cls === "melee");
        if (f.basicRanged) continue;   // true zoners keep their kiting identity intact
        f.brawl = true;

        // …AND THE DIVE HAS TO LAND. With melee basics restored, 99% of the resulting
        // whiffs were the pounce TIMER expiring, and the median gap when it did was 2.40
        // against a ~2.0 contact threshold — every dive was dying about a body-width
        // short, which on screen is a pet lunging THROUGH its opponent and hitting
        // nothing. A longer, faster, better-tracked dive converts those near-misses into
        // real contact; a shorter exit beat keeps the pair in the pocket where a melee
        // exchange is legible instead of breaking a full body-length apart after every
        // trade. `style` is replaced, never mutated, so the checkpoint/rewind machinery
        // (which shares it by reference) is unaffected.
        f.style = {
            ...f.style,
            lungeTicks: Math.round(f.style.lungeTicks * LIVE_BRAWL_LUNGE_TICKS),
            lungeMult: f.style.lungeMult * LIVE_BRAWL_LUNGE_SPEED,
            lungeTrack: Math.max(f.style.lungeTrack, LIVE_BRAWL_LUNGE_TRACK),
            reposBack: f.style.reposBack * LIVE_BRAWL_REPOS_BACK,
            reposDur: f.style.reposDur * LIVE_BRAWL_REPOS_DUR,
        };
    }
}

/** Order-of-battle for the live path: which fighters obey the player. */
export function createLiveCinematicDuel(
    playerPet: Pet, enemyPet: Pet, seed: number,
    playerDamageMult = 1, playerHpMult = 1, playerReviveOnce = false,
    applyItems = true, accuracyEnabled = petAccuracyEnabled(), terrain: string | null = null,
    debugTrace = false,
    /** TEST SEAM ONLY — leave at the default. Passing false skips the brawl profile,
     *  which exists so `pet-duel-live.test.ts` can prove that the create/step/rewind
     *  machinery is still byte-faithful to the one-shot engine and that ALL of the
     *  live path's divergence comes from the profile. Production and the server
     *  replay must both use the default, or they desynchronise. */
    brawlProfile = true,
): CinematicDuelState {
    // Identical construction to runPetDuelCinematic — the ONLY difference is that
    // the player's fighter accepts commands, so an "Auto"-only run reproduces the
    // uncontrolled fight exactly.
    const fighters = [
        buildFighter(playerPet, "player", 0, -5.6, 2.6, enemyPet.element, playerDamageMult * terrainPetMult(terrain, playerPet.element), playerHpMult, playerReviveOnce, applyItems),
        buildFighter(enemyPet, "enemy", 0, 5.6, 2.6, playerPet.element, terrainPetMult(terrain, enemyPet.element), 1, false, applyItems),
    ];
    fighters[0].controlled = true;
    if (brawlProfile) applyLiveBrawlProfile(fighters);
    return createDuelState(fighters, seed, accuracyEnabled, debugTrace);
}

/** 2v2 variant — both player-side pets take commands. */
export function createLivePartyCinematicDuel(
    playerLead: Pet, playerReserve: Pet | null,
    enemyLead: Pet, enemyReserve: Pet | null,
    seed: number, playerDamageMult = 1, playerHpMult = 1, playerReviveOnce = false,
    applyItems = true, accuracyEnabled = petAccuracyEnabled(), debugTrace = false,
    /** TEST SEAM ONLY — see createLiveCinematicDuel. */
    brawlProfile = true,
): CinematicDuelState {
    const fighters: Fighter[] = [buildFighter(playerLead, "player", 0, -5.6, 2.6, enemyLead.element, playerDamageMult, playerHpMult, playerReviveOnce, applyItems)];
    if (playerReserve) fighters.push(buildFighter(playerReserve, "player", 1, -5.0, -3.2, enemyReserve?.element ?? enemyLead.element, playerDamageMult, playerHpMult, false, applyItems));
    fighters.push(buildFighter(enemyLead, "enemy", 0, 5.6, 2.6, playerLead.element, 1, 1, false, applyItems));
    if (enemyReserve) fighters.push(buildFighter(enemyReserve, "enemy", 1, 5.0, -3.2, playerReserve?.element ?? playerLead.element, 1, 1, false, applyItems));
    for (const f of fighters) if (f.team === "player") f.controlled = true;
    if (brawlProfile) applyLiveBrawlProfile(fighters);
    return createDuelState(fighters, seed, accuracyEnabled, debugTrace);
}

export const stepCinematicDuel = (sim: CinematicDuelState): boolean => stepDuelState(sim);
export const finishCinematicDuel = (sim: CinematicDuelState): DuelResult => finishDuelState(sim);
export const cinematicDuelDone = (sim: CinematicDuelState): boolean => sim.done;

/** How long an unfulfilled order waits for its window before lapsing. */
export const DUEL_ORDER_TICKS = Math.round(DUEL_TPS * 5);

export function applyDuelCommand(sim: CinematicDuelState, cmd: DuelCommand): boolean {
    const f = sim.fighters.find((g) => g.id === cmd.actorId);
    if (!f || !f.controlled || f.hp <= 0) return false;
    switch (cmd.kind) {
        case "ability": {
            if (cmd.idx < -1 || cmd.idx >= f.abilities.length) return false;
            f.cmdIdx = cmd.idx; f.cmdLeft = DUEL_ORDER_TICKS;
            return true;
        }
        case "technique": {
            const ab = f.abilities[cmd.idx];
            if (!ab || ab.signature || f.commandCharge < DUEL_COMMAND_FULL || f.cmdTechnique) return false;
            // Cancel the old beat cleanly. decide() commits the selected technique
            // on the very next simulation tick.
            clearLunge(f);
            f.state = "idle";
            f.stateLeft = 0;
            f.pendingIdx = -2;
            f.pendingTargetId = null;
            f.vx = 0;
            f.vy = 0;
            f.cmdIdx = cmd.idx;
            f.cmdLeft = Math.round(DUEL_TPS * 1.5);
            f.cmdTechnique = true;
            f.perfectRole = duelPerfectRoleForMove(ab);
            f.commandCharge = 0;
            return true;
        }
        case "break": {
            if (!f.abilities.some((a) => a.signature)) return false;
            f.cmdBreak = true;
            return true;
        }
        case "stance":
            f.stance = clamp(Math.round(cmd.stance), 0, 2);
            return true;
        case "auto":
            // "Auto" hands the fight back to the AI mid-duel: clear any standing
            // order so the brain is not still executing the last command.
            f.controlled = !cmd.on;
            f.cmdIdx = -2; f.cmdLeft = 0; f.cmdBreak = false; f.cmdTechnique = false; f.perfectRole = null;
            return true;
        case "clash": {
            // Only accepted while this fighter is actually bound, and only once —
            // otherwise a client could re-call after seeing the opponent commit, or
            // append log entries the server's replay would have to reject.
            const bind = sim.clash;
            if (!bind || (bind.aId !== f.id && bind.bId !== f.id)) return false;
            if (f.clashPick >= 0) return false;
            if (cmd.pick !== 0 && cmd.pick !== 1 && cmd.pick !== 2) return false;
            f.clashPick = cmd.pick;
            bind.picks[f.id] = cmd.pick;
            return true;
        }
    }
}

/** The bind the player is being asked to answer, or null. Drives the clash prompt
 *  in the renderer; `deadline` is the tick the window lapses on. */
export interface ClashPrompt {
    aId: string; bId: string;
    /** The bound fighter this player controls. */
    selfId: string;
    /** The bound fighter they are locked against. */
    foeId: string;
    startT: number; deadline: number;
    /** This player's call, or -1 if they have not made one. */
    pick: number;
    /** Whether the opposing fighter has locked a call in — NOT which one. In live
     *  PvP the prompt needs to say "waiting for them" versus "they have committed",
     *  and leaking the actual pick would turn a simultaneous read into a reaction
     *  test. A player cannot change their own call once made, so knowing only THAT
     *  the opponent has answered gives away nothing. */
    foeCommitted: boolean;
}

/** Turn the clash bind OFF for a duel.
 *
 *  Live PvP (pet-duel-lockstep) uses this. A bind freezes BOTH fighters and asks
 *  each for a read, which across two clients needs its own synchronised prompt and
 *  proposal round-trip — and a competitive mode should not ship a beat where one
 *  side answers and the other silently defaults. Until that exists, PvP keeps the
 *  un-bound fight. Casual PvE (createLiveDuel) leaves it on. */
export function setCinematicClashEnabled(sim: CinematicDuelState, on: boolean) {
    sim.clashEnabled = on;
    if (!on) sim.clash = null;
}

export function readClashPrompt(sim: CinematicDuelState, actorId: string): ClashPrompt | null {
    const bind = sim.clash;
    if (!bind) return null;
    if (bind.aId !== actorId && bind.bId !== actorId) return null;
    const self = sim.fighters.find((g) => g.id === actorId);
    if (!self || !self.controlled) return null;
    const foeId = bind.aId === actorId ? bind.bId : bind.aId;
    const foe = sim.fighters.find((g) => g.id === foeId);
    return {
        aId: bind.aId, bId: bind.bId,
        selfId: actorId, foeId,
        startT: bind.startT, deadline: bind.until,
        pick: self.clashPick,
        foeCommitted: !!foe && foe.clashPick >= 0,
    };
}

export function readDuelControl(sim: CinematicDuelState, actorId: string): DuelControlSnap | null {
    const f = sim.fighters.find((g) => g.id === actorId);
    if (!f) return null;
    return {
        stamina: f.stamina, hp: Math.max(0, f.hp), maxHp: f.maxHp,
        stance: f.stance, auto: !f.controlled,
        orderedIdx: f.controlled ? f.cmdIdx : -2, breakPending: f.controlled && f.cmdBreak,
        commandCharge: Math.max(0, Math.min(DUEL_COMMAND_FULL, f.commandCharge)),
        commandReady: f.controlled && f.commandCharge >= DUEL_COMMAND_FULL && !f.cmdTechnique,
        abilities: f.abilities.map((a) => ({
            name: a.name, kind: a.kind, cost: a.cost, signature: a.signature,
            cdLeft: a.cdLeft, cdTicks: a.cdTicks, isMove: a.isMove, support: a.cls === "support",
        })),
    };
}

// ── Checkpoint / rewind ─────────────────────────────────────────────────────────
// The live path keeps the simulation a beat AHEAD of playback so the presentation
// layer still gets its look-ahead. To keep commands responsive anyway, it rewinds
// to the last fully-played tick and re-simulates with the order applied. The engine
// is deterministic and cheap, so replaying a fraction of a second is free.

const cloneStatuses = (s: Statuses): Statuses => ({ ...s });
const cloneAbility = (a: Ability): Ability => ({ ...a });
function cloneFighter(f: Fighter): Fighter {
    // `pet` and `style` are never mutated during a run, so they are shared by
    // reference — cloning `pet` per tick would copy the whole pet record (including
    // any inlined artwork) thirty times a second.
    return { ...f, abilities: f.abilities.map(cloneAbility), statuses: cloneStatuses(f.statuses) };
}

export interface CinematicDuelCheckpoint {
    fighters: Fighter[];
    projectiles: Projectile[];
    nextProjId: number;
    snapshotCount: number;
    eventCount: number;
    rngS: number;
    t: number; ticks: number;
    winner: "player" | "enemy" | null;
    done: boolean;
    lastDmgTick: number; prevTotalHp: number;
    walls: { x: number; y: number; r: number; expiry: number; ownerId: string }[];
    stallPressure: number; forcedEngage: boolean;
    initiativeTeam: "player" | "enemy";
    laneInitiative: LaneInitiative;
    clash: ClashBind | null;
    clashCount: number; lastClashTick: number; clashEnabled: boolean;
    warfrontRelics: WarfrontRelicState[];
}

export function checkpointCinematicDuel(sim: CinematicDuelState): CinematicDuelCheckpoint {
    return {
        fighters: sim.fighters.map(cloneFighter),
        projectiles: sim.projectiles.map((p) => ({ ...p })),
        nextProjId: sim.nextProjId.n,
        snapshotCount: sim.snapshots.length,
        eventCount: sim.events.length,
        rngS: sim.rngState.s,
        t: sim.t, ticks: sim.ticks, winner: sim.winner, done: sim.done,
        lastDmgTick: sim.lastDmgTick, prevTotalHp: sim.prevTotalHp,
        walls: sim.walls.map((w) => ({ ...w })),
        stallPressure: sim.stallPressure, forcedEngage: sim.forcedEngage,
        initiativeTeam: sim.initiativeTeam,
        // Copied, not aliased: the lane array is mutated in place when a squad lane
        // hands its beat over, which would otherwise write through the checkpoint.
        laneInitiative: [
            sim.laneInitiative[0], sim.laneInitiative[1],
            sim.laneInitiative[2], sim.laneInitiative[3],
        ],
        // Same reasoning for the bind: `picks` is written into as calls arrive, so a
        // shared reference would let a post-checkpoint call leak backwards through a
        // rewind and desynchronise the server replay.
        clash: sim.clash ? { ...sim.clash, picks: { ...sim.clash.picks } } : null,
        clashCount: sim.clashCount, lastClashTick: sim.lastClashTick, clashEnabled: sim.clashEnabled,
        warfrontRelics: sim.warfrontRelics.map((relic) => ({ ...relic })),
    };
}

/** Rewind the sim to a checkpoint, discarding every snapshot and event produced
 *  after it. The retained prefix is bit-identical to what was already played. */
export function restoreCinematicDuel(sim: CinematicDuelState, cp: CinematicDuelCheckpoint): void {
    sim.fighters.length = 0;
    for (const f of cp.fighters) sim.fighters.push(cloneFighter(f));
    sim.projectiles.length = 0;
    for (const p of cp.projectiles) sim.projectiles.push({ ...p });
    sim.nextProjId.n = cp.nextProjId;
    sim.snapshots.length = cp.snapshotCount;
    sim.events.length = cp.eventCount;
    sim.rngState.s = cp.rngS;
    sim.t = cp.t; sim.ticks = cp.ticks; sim.winner = cp.winner; sim.done = cp.done;
    sim.lastDmgTick = cp.lastDmgTick; sim.prevTotalHp = cp.prevTotalHp;
    sim.walls = cp.walls.map((w) => ({ ...w }));
    sim.stallPressure = cp.stallPressure; sim.forcedEngage = cp.forcedEngage;
    sim.initiativeTeam = cp.initiativeTeam;
    sim.laneInitiative = [
        cp.laneInitiative[0], cp.laneInitiative[1],
        cp.laneInitiative[2], cp.laneInitiative[3],
    ];
    sim.clash = cp.clash ? { ...cp.clash, picks: { ...cp.clash.picks } } : null;
    sim.clashCount = cp.clashCount; sim.lastClashTick = cp.lastClashTick; sim.clashEnabled = cp.clashEnabled;
    sim.warfrontRelics = cp.warfrontRelics.map((relic) => ({ ...relic }));
}
