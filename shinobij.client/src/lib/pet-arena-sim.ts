/*
 * ── Tactical Pet Arena — deathmatch + capture-objective match sim ─────────────
 * A deterministic 30 Hz match: 2 teams (2v2 or 4v4), first to 10 points wins.
 *   • Defeat an enemy pet            → +1 point (victim loses a life, respawns 5 s)
 *   • Capture the center scroll and
 *     return it to your own base      → +2 points
 * Every pet is assigned one of four ROLES (defender / tracker / assassin / sage)
 * that drive stats, abilities, targeting, positioning and objective behaviour.
 *
 * Self-contained on purpose: it reuses the WALKABILITY MASK (pet-arena-walkmask)
 * but NOT the duel sim, so the duel's tests are untouched. Same determinism rules
 * as the duel: seeded LCG (no Math.random/Date), IEEE-safe math (sqrt/round only),
 * state quantized to 1/256 per tick → byte-identical replays from a seed.
 *
 * PREVIEW-ONLY (behind a flag). The renderer plays the snapshot stream.
 */
import type { Pet } from "../types/pet";
import { FULL_MASK, FULL_COLS, FULL_ROWS } from "./pet-arena-fullmask";

export const ARENA_TPS = 30;
export const MAX_SECONDS = 300;          // 5-min safety cap (tactical fights run ~2–4 min)
const MAX_TICKS = ARENA_TPS * MAX_SECONDS;
export const WIN_SCORE = 5;          // first team to 5 SCROLL CAPTURES wins — kills don't score (purely tactical)
export const ARENA_X = 14.0, ARENA_Y = 7.5;

// ── Pacing ───────────────────────────────────────────────────────────────────
// Fights should read as deliberate tactical exchanges (~2–5 min), not a 40-second
// melee where pets blink and die. The main lever is TIME-TO-KILL: HP scaled up +
// one slower swing/sec, so engagements last long enough to SEE a defender peel, a
// sage sustain, an assassin dive. Plus a periodic (~0.5 s) decision cadence so pets
// COMMIT instead of darting, meaningful deaths (longer respawn = fewer pets thrash
// at once), and a late scroll as a recurring objective beat.
const TTK_HP_MUL = 2.4;                    // ×effective HP → ~4× time-to-kill (relative role balance unchanged)
const ATTACK_CD = Math.round(ARENA_TPS * 1.0);   // one basic swing/sec (was 0.55 s — too frantic to follow)
const DECISION_TICKS = 16;                 // re-decide ~every 0.53 s; reuse the plan between → deliberate, smooth

export const SCROLL_FIRST_SPAWN = ARENA_TPS * 20;   // first scroll at 20 s — an early objective beat the squads converge on
const SCROLL_ANTICIPATE = 7;                 // seconds before a spawn that pets start pre-positioning toward the centre
const SCROLL_RESPAWN = ARENA_TPS * 22;       // re-spawn 22 s after capture/reset — a brisk cycle so a race to 5 captures resolves
const SCROLL_CHANNEL = ARENA_TPS * 2;        // 2 s channel to pick up
const SCROLL_DROP_LIFE = ARENA_TPS * 10;     // a dropped scroll resets after 10 s
const RESPAWN_TICKS = ARENA_TPS * 7;         // 7 s respawn — a kill earns a real window, fewer pets churning
const PICKUP_RANGE = 1.4;                     // how close you must be to channel
const BASE_SCORE_RANGE = 1.8;                 // carrier scores within this of its base
const CARRIER_SLOW = 0.85;                    // −15% speed while carrying

// ── Roles ────────────────────────────────────────────────────────────────────
export type ArenaRole = "defender" | "tracker" | "assassin" | "sage";
type AbilityKind = "guard" | "mark" | "assassinate" | "mend";
interface RoleCfg {
    hpMul: number; defMul: number; dmgMul: number; spdMul: number;
    neutral: number;          // preferred fighting distance
    atkRange: number;         // basic-attack reach
    crit: number;
    ability: AbilityKind; abilityCd: number; abilityCost: number;
}
const ROLE_CFG: Record<ArenaRole, RoleCfg> = {
    // Tanky frontline — hard to kill, low damage, short range, taunts + shields.
    defender: { hpMul: 1.75, defMul: 1.7, dmgMul: 0.62, spdMul: 0.82, neutral: 1.5, atkRange: 1.5, crit: 0.05, ability: "guard", abilityCd: 6, abilityCost: 35 },
    // Sustained pressure — chases, marks targets for bonus damage over time.
    tracker: { hpMul: 1.05, defMul: 1.05, dmgMul: 1.0, spdMul: 1.06, neutral: 3.4, atkRange: 4.0, crit: 0.1, ability: "mark", abilityCd: 4, abilityCost: 28 },
    // Fragile burst — dashes onto squishies/carriers, high crit, low durability.
    assassin: { hpMul: 0.7, defMul: 0.68, dmgMul: 1.55, spdMul: 1.26, neutral: 2.2, atkRange: 1.6, crit: 0.32, ability: "assassinate", abilityCd: 5, abilityCost: 40 },
    // Support — heals/shields allies, weak offense, sits at range, never frontlines.
    sage: { hpMul: 0.85, defMul: 0.95, dmgMul: 0.5, spdMul: 1.02, neutral: 5.5, atkRange: 4.6, crit: 0.05, ability: "mend", abilityCd: 3, abilityCost: 22 },
};

// ── Walkability nav (the painted path mask) ──────────────────────────────────
const GCOLS = FULL_COLS, GROWS = FULL_ROWS;     // the FULL-arena walkmask (reaches all four corner seals)
const CELL_X = (ARENA_X * 2) / GCOLS, CELL_Y = (ARENA_Y * 2) / GROWS;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const quant = (v: number) => Math.round(v * 256) / 256;
const cellWalkable = (c: number, r: number) => c >= 0 && r >= 0 && c < GCOLS && r < GROWS && FULL_MASK.charCodeAt(r * GCOLS + c) === 49;
const cellCenter = (c: number, r: number): [number, number] => [(c + 0.5) * CELL_X - ARENA_X, (r + 0.5) * CELL_Y - ARENA_Y];
const cellOf = (x: number, y: number): [number, number] => [clamp(Math.floor((x + ARENA_X) / CELL_X), 0, GCOLS - 1), clamp(Math.floor((y + ARENA_Y) / CELL_Y), 0, GROWS - 1)];
function walkableAt(x: number, y: number): boolean {
    if (x < -ARENA_X || x > ARENA_X || y < -ARENA_Y || y > ARENA_Y) return false;
    return cellWalkable(Math.floor((x + ARENA_X) / CELL_X), Math.floor((y + ARENA_Y) / CELL_Y));
}
function snapPoint(x: number, y: number): [number, number] {
    if (walkableAt(x, y)) return [x, y];
    const [c0, r0] = cellOf(x, y);
    for (let rad = 1; rad <= GCOLS + GROWS; rad++)
        for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
            if (cellWalkable(c0 + dc, r0 + dr)) return cellCenter(c0 + dc, r0 + dr);
        }
    return [x, y];
}
function lineClear(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax, dy = by - ay, d = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(2, Math.ceil(d / (CELL_X * 0.4)));   // fine enough to catch a 1-cell-thin wall
    for (let i = 1; i < steps; i++) { const t = i / steps; if (!walkableAt(ax + dx * t, ay + dy * t)) return false; }
    return true;
}
const BFS_DC = [1, -1, 0, 0, 1, 1, -1, -1], BFS_DR = [0, 0, 1, -1, 1, -1, 1, -1];
// Preallocated BFS scratch + a generation counter (no per-call allocation / clear).
const _N = GCOLS * GROWS;
const _came = new Int32Array(_N), _vis = new Int32Array(_N), _queue = new Int32Array(_N);
let _gen = 0;

// The fixed objective centre (the painted paw): the scroll spawn AND the seed for the
// "main" walkable region below.
const ARENA_CENTER: [number, number] = snapPoint(0, -1.1);

// Flood the path tiles reachable from the centre (same 8-dir + corner-cut rule the
// pathfinder uses) ONCE. The painted map leaves ~5% of its path tiles in little
// disconnected pockets near the edges; a pet that spawns/respawns into one (the old
// respawn offsets did exactly that) can never path to the fight and sits there frozen.
// Snapping every spawn / respawn / nav-goal INTO this region is what keeps pets moving.
const _mainComp: Uint8Array = (() => {
    const set = new Uint8Array(_N);
    const [sc, sr] = cellOf(ARENA_CENTER[0], ARENA_CENTER[1]);
    if (!cellWalkable(sc, sr)) return set;
    const q = new Int32Array(_N); let head = 0, tail = 0;
    const s0 = sr * GCOLS + sc; q[tail++] = s0; set[s0] = 1;
    while (head < tail) {
        const cur = q[head++]; const cc = cur % GCOLS, cr = (cur - cc) / GCOLS;
        for (let k = 0; k < 8; k++) {
            const dc = BFS_DC[k], dr = BFS_DR[k], nc = cc + dc, nr = cr + dr;
            if (!cellWalkable(nc, nr)) continue;
            if (dc !== 0 && dr !== 0 && (!cellWalkable(cc + dc, cr) || !cellWalkable(cc, cr + dr))) continue;
            const ni = nr * GCOLS + nc; if (set[ni]) continue; set[ni] = 1; q[tail++] = ni;
        }
    }
    return set;
})();
const inMain = (c: number, r: number) => c >= 0 && r >= 0 && c < GCOLS && r < GROWS && _mainComp[r * GCOLS + c] === 1;
/** Snap (x,y) to the nearest path tile that is part of the centre-connected region. */
function snapMain(x: number, y: number): [number, number] {
    const [c0, r0] = cellOf(x, y);
    if (walkableAt(x, y) && inMain(c0, r0)) return [x, y];
    for (let rad = 1; rad <= GCOLS + GROWS; rad++)
        for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
            if (inMain(c0 + dc, r0 + dr)) return cellCenter(c0 + dc, r0 + dr);
        }
    return snapPoint(x, y);
}

// Full-path BFS (reverse flood from the goal) reconstructed pet→goal as cell indices.
// A full path + line-of-sight string-pulling (below) gives smooth, direct motion that
// hugs corners — instead of the old jerky one-cell-every-4-ticks re-step that stalled
// on every turn.
function bfsPath(fc: number, fr: number, tc: number, tr: number, out: number[]): number[] {
    out.length = 0;
    if (fc === tc && fr === tr) return out;
    _gen++;
    const start = tr * GCOLS + tc;
    _vis[start] = _gen; _came[start] = -1;
    let head = 0, tail = 0; _queue[tail++] = start; let hit = -1;
    while (head < tail) {
        const cur = _queue[head++]; const cc = cur % GCOLS, cr = (cur - cc) / GCOLS;
        if (cc === fc && cr === fr) { hit = cur; break; }
        for (let k = 0; k < 8; k++) {
            const dc = BFS_DC[k], dr = BFS_DR[k], nc = cc + dc, nr = cr + dr;
            if (!cellWalkable(nc, nr)) continue;
            if (dc !== 0 && dr !== 0 && (!cellWalkable(cc + dc, cr) || !cellWalkable(cc, cr + dr))) continue;
            const ni = nr * GCOLS + nc;
            if (_vis[ni] === _gen) continue;
            _vis[ni] = _gen; _came[ni] = cur; _queue[tail++] = ni;
        }
    }
    if (hit < 0) return out;                          // unreachable — caller falls back to a straight nudge
    for (let cur = hit; cur >= 0; cur = _came[cur]) out.push(cur);   // pet → … → goal
    return out;
}
const cellPt = (idx: number): [number, number] => cellCenter(idx % GCOLS, (idx - (idx % GCOLS)) / GCOLS);

/** Advance `f` one step toward (tx,ty), facing (faceGx,faceGy). Returns whether it
 *  intended to move (so the caller's stuck-watchdog can tell "blocked" from "arrived"). */
function stepStraight(f: AF, tx: number, ty: number, spd: number, stopAt: number, faceGx: number, faceGy: number): boolean {
    const fdx = faceGx - f.x, fdy = faceGy - f.y, fl = Math.sqrt(fdx * fdx + fdy * fdy);
    if (fl > 1e-6) { f.faceX = fdx / fl; f.faceY = fdy / fl; }
    const dx = tx - f.x, dy = ty - f.y, d = Math.sqrt(dx * dx + dy * dy);
    const s = Math.min(spd, Math.max(0, d - stopAt));
    if (s <= 0 || d <= 1e-6) return false;
    const ux = dx / d, uy = dy / d, nx = f.x + ux * s, ny = f.y + uy * s;
    // Verify the STEP doesn't cross a wall (not just that the endpoint is walkable) —
    // else a fast step / a corner-cut could hop over a thin wall. Slide along an axis.
    if (walkableAt(nx, ny) && lineClear(f.x, f.y, nx, ny)) { f.x = nx; f.y = ny; }
    else if (walkableAt(nx, f.y) && lineClear(f.x, f.y, nx, f.y)) f.x = nx;
    else if (walkableAt(f.x, ny) && lineClear(f.x, f.y, f.x, ny)) f.y = ny;
    return true;
}
/** Last-resort un-wedge: hop one cell along the walkable compass dir that best closes on
 *  the goal — but ALWAYS take a walkable step if any exists (least-bad when escape means
 *  briefly stepping away from a concave nook), so a wedged pet can never stay frozen.
 *  Deterministic; only fires after the watchdog sees a real jam. */
function unstick(f: AF, gx: number, gy: number, spd: number) {
    const cur = Math.sqrt((gx - f.x) * (gx - f.x) + (gy - f.y) * (gy - f.y));
    const step = Math.max(spd, CELL_Y); let best = -1, bestGain = -Infinity;
    for (let k = 0; k < 8; k++) {
        const nx = f.x + BFS_DC[k] * step, ny = f.y + BFS_DR[k] * step;
        if (!walkableAt(nx, ny)) continue;
        const dx = gx - nx, dy = gy - ny, gain = cur - Math.sqrt(dx * dx + dy * dy);
        if (gain > bestGain) { bestGain = gain; best = k; }
    }
    if (best >= 0) { f.x += BFS_DC[best] * step; f.y += BFS_DR[best] * step; }
}

/** Steer `f` toward (gx,gy): straight when the goal is visible, else follow a string-
 *  pulled BFS path around terrain. Repaths from the CURRENT cell on a short cadence so a
 *  moving goal stays tracked, and self-recovers if it ever wedges — so nothing freezes. */
function moveToward(f: AF, gx: number, gy: number, spd: number, stopAt = 0) {
    // Keep the pet ON the navigable mesh: if quantize/body-shove ever nudges it onto a
    // non-path tile (or off the centre-connected region), pull it back — otherwise it
    // can't be pathed and would sit wedged.
    { const [fc0, fr0] = cellOf(f.x, f.y); if (!inMain(fc0, fr0)) { const [mx, my] = snapMain(f.x, f.y); f.x = mx; f.y = my; f.path = null; f.navAge = 0; } }
    const sx = f.x, sy = f.y; let attempted: boolean;
    if (lineClear(f.x, f.y, gx, gy)) {                 // clear shot — go straight, drop any path
        f.path = null; f.navAge = 0;
        attempted = stepStraight(f, gx, gy, spd, stopAt, gx, gy);
    } else {
        // Route to the goal's cell, snapped into the reachable region if it's blocked.
        let [tc, tr] = cellOf(gx, gy);
        if (!inMain(tc, tr)) { const [mx, my] = snapMain(gx, gy);[tc, tr] = cellOf(mx, my); }
        const goalCell = tr * GCOLS + tc;
        const [fc, fr] = cellOf(f.x, f.y);
        if (!f.path || f.navAge <= 0 || f.navGoal !== goalCell) {
            f.path = f.path ?? [];
            bfsPath(fc, fr, tc, tr, f.path);
            f.navGoal = goalCell; f.navAge = 8; f.pathIdx = 1;
        }
        f.navAge--;
        const path = f.path;
        if (!path || path.length <= 1) {               // no route — straight nudge (watchdog may kick in)
            attempted = stepStraight(f, gx, gy, spd, stopAt, gx, gy);
        } else {
            let idx = f.pathIdx < 1 ? 1 : (f.pathIdx > path.length - 1 ? path.length - 1 : f.pathIdx);
            while (idx < path.length - 1) {            // string-pull: skip to the farthest visible node
                const [wx, wy] = cellPt(path[idx + 1]);
                if (lineClear(f.x, f.y, wx, wy)) idx++; else break;
            }
            f.pathIdx = idx;
            if (idx >= path.length - 1 && lineClear(f.x, f.y, gx, gy)) {   // last node + goal in view → finish straight
                attempted = stepStraight(f, gx, gy, spd, stopAt, gx, gy);
            } else {
                const [wx, wy] = cellPt(path[idx]);
                attempted = stepStraight(f, wx, wy, spd, idx >= path.length - 1 ? stopAt : 0, gx, gy);
            }
        }
    }
    // Stuck watchdog: meant to move but didn't → repath fast, then hop free. Keeps a pet
    // from ever locking up in a concave nook or behind a body it can't slide past.
    if (attempted && Math.abs(f.x - sx) + Math.abs(f.y - sy) < 0.004) {
        f.stuckTicks++;
        if (f.stuckTicks === 3) { f.path = null; f.navAge = 0; }        // first: force a fresh route
        else if (f.stuckTicks >= 6) { unstick(f, gx, gy, spd); f.stuckTicks = 0; f.path = null; f.navAge = 0; }   // then: physically hop free
    } else f.stuckTicks = 0;
}
const dist = (a: AF, b: AF) => { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); };
const distPt = (a: AF, x: number, y: number) => { const dx = a.x - x, dy = a.y - y; return Math.sqrt(dx * dx + dy * dy); };

// ── Deterministic RNG ────────────────────────────────────────────────────────
function makeRng(seed: number): () => number {
    let s = (Math.max(1, Math.floor(seed)) >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ── Fighter ──────────────────────────────────────────────────────────────────
export type ArenaState = "idle" | "move" | "attack" | "dash" | "channel" | "respawning" | "dead";
interface AF {
    id: string; team: "blue" | "red"; slot: number; role: ArenaRole; pet: Pet; element?: string | null;
    x: number; y: number; faceX: number; faceY: number; baseX: number; baseY: number;
    hp: number; maxHp: number; atk: number; def: number; moveSpeed: number; atkRange: number; crit: number;
    energy: number; lives: number;
    state: ArenaState; respawnLeft: number; attackCd: number; abilityCd: number; dashLeft: number; moveDx: number; moveDy: number;
    // statuses
    shieldHp: number; slowLeft: number; dotLeft: number; dotDmg: number; markLeft: number; tauntBy: string | null; tauntLeft: number;
    carrying: boolean; seals: [number, number][];
    path: number[] | null; pathIdx: number; navGoal: number; navAge: number; stuckTicks: number;   // BFS path cache + stuck watchdog
    aiTargetId: string | null;                          // last committed target — decision hysteresis (anti-flip-flop)
    plan: Plan | null;                                  // current decision (recomputed every DECISION_TICKS, reused between → deliberate)
    decisionCd: number;                                 // ticks until the next full re-decide
}
// The two spawn seals per team (arena corners), snapped to a path tile. 2v2 puts
// one pet on each seal; 4v4 puts two pets (a "player" pair) on each seal.
// Field positions of the four painted spawn seals, measured off the diorama art
// (scripts/find-seals.mjs); snapped to the nearest walkable path tile so pets
// emerge ON the seal. [0] = upper seal, [1] = lower seal, per team. Left on the
// real (slightly asymmetric) art on purpose: symmetric-team balance is moot —
// pets are trained differently, so quality decides and a stronger team wins from
// either side (verified) — so seal-art alignment wins over a mirror-perfect spawn.
const SEALS: Record<"blue" | "red", [number, number][]> = {
    blue: [snapPoint(-10.3, -5.6), snapPoint(-12.4, 2.5)],
    red: [snapPoint(9.5, -5.0), snapPoint(11.7, 2.5)],
};
function buildFighter(pet: Pet, team: "blue" | "red", role: ArenaRole, slot: number, count: number): AF {
    const cfg = ROLE_CFG[role];
    const seals = SEALS[team];
    const sealIdx = count <= 2 ? Math.min(slot, 1) : (slot < 2 ? 0 : 1);
    const [sx, sy] = seals[sealIdx];
    const [x, y] = snapMain(sx, sy + (count <= 2 ? 0 : slot % 2 ? 0.9 : -0.9));
    const maxHp = Math.max(1, Math.round((pet.hp || 600) * cfg.hpMul * TTK_HP_MUL));
    return {
        id: `${team}-${slot}`, team, slot, role, pet, element: pet.element,
        x, y, faceX: team === "blue" ? 1 : -1, faceY: 0, baseX: sx, baseY: sy, seals,
        hp: maxHp, maxHp, atk: Math.max(1, (pet.attack || 60) * cfg.dmgMul), def: Math.max(0, (pet.defense || 30) * cfg.defMul),
        moveSpeed: clamp(2.6 + (pet.speed || 50) * 0.016, 2.6, 6.0) * cfg.spdMul / ARENA_TPS,
        atkRange: cfg.atkRange, crit: cfg.crit, energy: 100, lives: 3,
        state: "idle", respawnLeft: 0, attackCd: 0, abilityCd: Math.round(ARENA_TPS * 1.5), dashLeft: 0, moveDx: 0, moveDy: 0,
        shieldHp: 0, slowLeft: 0, dotLeft: 0, dotDmg: 0, markLeft: 0, tauntBy: null, tauntLeft: 0, carrying: false,
        path: null, pathIdx: 0, navGoal: -1, navAge: 0, stuckTicks: 0, aiTargetId: null, plan: null, decisionCd: 0,
    };
}
const alive = (f: AF) => f.lives > 0 && f.state !== "dead" && f.state !== "respawning";
const effSpeed = (f: AF) => f.moveSpeed * (f.slowLeft > 0 ? 0.6 : 1) * (f.carrying ? CARRIER_SLOW : 1);

// ── Objective (the scroll) ───────────────────────────────────────────────────
interface Scroll {
    state: "inactive" | "center" | "carried" | "dropped";
    x: number; y: number; carrierId: string | null;
    channelById: string | null; channelLeft: number; spawnTimer: number; dropTimer: number;
}

// ── Snapshots + events ───────────────────────────────────────────────────────
export interface ArenaActorSnap {
    id: string; team: "blue" | "red"; slot: number; role: ArenaRole; element?: string | null;
    x: number; y: number; faceX: number; faceY: number; hp: number; maxHp: number; energy: number;
    lives: number; state: ArenaState; carrying: boolean; statuses: string[];
}
export interface ArenaSnapshot {
    t: number; actors: ArenaActorSnap[];
    scroll: { state: Scroll["state"]; x: number; y: number; carrierId: string | null; channelFrac: number };
    scoreBlue: number; scoreRed: number;
}
export type ArenaEvent =
    | { t: number; type: "hit"; targetId: string; actorId: string; dmg: number; crit: boolean; element?: string | null; ability?: boolean }
    | { t: number; type: "heal" | "shield"; targetId: string; actorId: string; amount: number }
    | { t: number; type: "kill"; targetId: string; actorId: string; team: "blue" | "red" }
    | { t: number; type: "ability"; actorId: string; kind: AbilityKind }
    | { t: number; type: "pickup" | "drop" | "capture" | "scrollspawn" | "respawn"; actorId?: string; team?: "blue" | "red" };
export interface ArenaResult {
    winner: "blue" | "red" | "draw"; scoreBlue: number; scoreRed: number; ticks: number;
    snapshots: ArenaSnapshot[]; events: ArenaEvent[];
    bases: { blue: [number, number][]; red: [number, number][] }; center: [number, number];
}
export interface ArenaSlot { pet: Pet; role: ArenaRole; }

// ── Combat ───────────────────────────────────────────────────────────────────
function dealDamage(src: AF, tgt: AF, raw: number, rng: () => number, t: number, events: ArenaEvent[], ability = false) {
    const crit = rng() < src.crit;
    let dmg = Math.max(1, Math.round((raw - tgt.def * 0.38) * (crit ? 1.8 : 1) * (tgt.markLeft > 0 ? 1.25 : 1)));
    if (tgt.shieldHp > 0) { const absorbed = Math.min(tgt.shieldHp, dmg); tgt.shieldHp -= absorbed; dmg -= absorbed; }
    tgt.hp -= dmg;
    events.push({ t, type: "hit", targetId: tgt.id, actorId: src.id, dmg, crit, element: src.element, ability });
}

// ── AI: pick a goal + target by role × objective context ─────────────────────
function nearestEnemy(f: AF, fs: AF[]): AF | null {
    let best: AF | null = null, bd = Infinity;
    for (const g of fs) { if (g.team === f.team || !alive(g)) continue; const d = dist(f, g); if (d < bd) { bd = d; best = g; } }
    return best;
}
function lowestHpAlly(f: AF, fs: AF[], includeSelf = true): AF | null {
    let best: AF | null = null, bf = Infinity;
    for (const g of fs) { if (g.team !== f.team || !alive(g) || (!includeSelf && g.id === f.id)) continue; const r = g.hp / g.maxHp; if (r < bf) { bf = r; best = g; } }
    return best;
}
function nearestSeal(f: AF): [number, number] {
    let best = f.seals[0], bd = distPt(f, best[0], best[1]);
    for (const s of f.seals) { const d = distPt(f, s[0], s[1]); if (d < bd) { bd = d; best = s; } }
    return best;
}

// ── Score-based tactical AI ───────────────────────────────────────────────────
// Each pet scores a small set of role-appropriate INTENTS (objective + threat +
// role + survival + team-tactics) and commits to the highest, so a viewer reads
// each pet's job without any UI: Defender protects, Tracker hunts, Assassin
// eliminates priority targets, Sage supports. The role priority NUMBERS come
// straight from the combat handoff. Fully deterministic — positions/hp/roles
// only, no rng in here; ties resolve to the first (fixed-order) candidate.
const THREAT: Record<ArenaRole, number> = { defender: 30, tracker: 60, assassin: 90, sage: 100 };
const hpFrac = (f: AF) => f.hp / f.maxHp;
const oppOf = (t: "blue" | "red") => (t === "blue" ? "red" : "blue");
const teamLives = (fs: AF[], team: "blue" | "red") => fs.reduce((s, g) => (g.team === team ? s + Math.max(0, g.lives) : s), 0);
const enemiesAlive = (f: AF, fs: AF[]): AF[] => fs.filter((g) => g.team !== f.team && alive(g));
const alliesAlive = (f: AF, fs: AF[], includeSelf = true): AF[] => fs.filter((g) => g.team === f.team && alive(g) && (includeSelf || g.id !== f.id));
function nearestPt(x: number, y: number, list: AF[]): AF | null { let b: AF | null = null, bd = Infinity; for (const g of list) { const dx = g.x - x, dy = g.y - y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; b = g; } } return b; }
function countWithin(x: number, y: number, list: AF[], r: number): number { let n = 0; const r2 = r * r; for (const g of list) { const dx = g.x - x, dy = g.y - y; if (dx * dx + dy * dy <= r2) n++; } return n; }
/** The enemy assassin closest to me or any ally, when within striking range. */
function assassinThreat(f: AF, fs: AF[]): AF | null {
    const guard = alliesAlive(f, fs, true); let best: AF | null = null, bd = Infinity;
    for (const e of enemiesAlive(f, fs)) { if (e.role !== "assassin") continue; for (const a of guard) { const d = dist(a, e); if (d < bd) { bd = d; best = e; } } }
    return best && bd < 5.5 ? best : null;
}
/** Highest-THREAT enemy, lightly distance-discounted (Tracker's default pick). */
function threatTarget(f: AF, enemies: AF[]): AF | null { let b: AF | null = null, bv = -Infinity; for (const e of enemies) { const v = THREAT[e.role] - dist(f, e) * 1.2; if (v > bv) { bv = v; b = e; } } return b; }

// Match-state rubber-band: ahead → close it out safely; behind → force fights;
// at match point → emergency (the objective is everything).
type MatchPhase = "normal" | "closeit" | "comeback" | "emergency";
interface Ctx { myCarrier: AF | null; enemyCarrier: AF | null; scrollOpen: boolean; scrollSoon: boolean; leadLives: number; leadScore: number; phase: MatchPhase; }
function makeCtx(f: AF, fs: AF[], scroll: Scroll, score: { blue: number; red: number }): Ctx {
    const carrier = scroll.carrierId ? fs.find((g) => g.id === scroll.carrierId) ?? null : null;
    const mine = score[f.team], opp = score[oppOf(f.team)], lead = mine - opp;
    const phase: MatchPhase = (mine >= WIN_SCORE - 1 || opp >= WIN_SCORE - 1) ? "emergency" : lead >= 3 ? "closeit" : lead <= -3 ? "comeback" : "normal";
    return {
        myCarrier: carrier && carrier.team === f.team ? carrier : null,
        enemyCarrier: carrier && carrier.team !== f.team ? carrier : null,
        scrollOpen: scroll.state === "center" || scroll.state === "dropped",
        scrollSoon: scroll.state === "inactive" && scroll.spawnTimer <= ARENA_TPS * SCROLL_ANTICIPATE,   // about to spawn → pre-position
        leadLives: teamLives(fs, f.team) - teamLives(fs, oppOf(f.team)),
        leadScore: lead, phase,
    };
}

// ── Squad awareness (built ONCE per tick, shared by every pet) ─────────────────
// Role "power" for outnumbered checks + the focus-fire tally (how many of a team's
// pets are committed to each enemy) so allies naturally collapse on the same kill.
const POWER: Record<ArenaRole, number> = { defender: 110, tracker: 100, assassin: 90, sage: 80 };
interface Squad { focus: { blue: Record<string, number>; red: Record<string, number> }; }
function buildSquad(fs: AF[]): Squad {
    const focus = { blue: {} as Record<string, number>, red: {} as Record<string, number> };
    for (const g of fs) { if (!alive(g) || !g.aiTargetId) continue; const m = focus[g.team]; m[g.aiTargetId] = (m[g.aiTargetId] ?? 0) + 1; }
    return { focus };
}
/** Role-weighted, HP-scaled fighting power of `list` within radius r of a point. */
function localPower(x: number, y: number, list: AF[], r: number): number {
    let p = 0; const r2 = r * r;
    for (const g of list) { const dx = g.x - x, dy = g.y - y; if (dx * dx + dy * dy <= r2) p += POWER[g.role] * hpFrac(g); }
    return p;
}
/** A teammate (not me) below 30% HP with an enemy bearing down on it → rescue. */
function criticalAlly(f: AF, fs: AF[]): AF | null {
    const enemies = enemiesAlive(f, fs); let best: AF | null = null, bd = Infinity;
    for (const a of alliesAlive(f, fs, false)) {
        if (hpFrac(a) >= 0.30) continue;
        const ne = nearestPt(a.x, a.y, enemies);
        if (ne && dist(a, ne) < 4.5) { const d = dist(f, a); if (d < bd) { bd = d; best = a; } }
    }
    return best;
}

interface Plan { gx: number; gy: number; stopAt: number; target: AF | null; channel: boolean; }
type CandKind = "objective" | "escort" | "protectCarrier" | "interceptCarrier" | "interceptAssassin" | "protectSage" | "protectAlly" | "hunt" | "frontline" | "regroup" | "retreat" | "support";
interface Cand { score: number; plan: Plan; kind: CandKind; }
const huntP = (f: AF, e: AF, neutral: number): Plan => ({ ...spreadGoal(f, e, neutral), target: e, channel: false });
const diveP = (e: AF, stop: number): Plan => ({ gx: e.x, gy: e.y, stopAt: stop, target: e, channel: false });
const pokeP = (e: AF, neutral: number): Plan => ({ gx: e.x, gy: e.y, stopAt: neutral, target: e, channel: false });
// Sit on the HOME side of an ally (sage never leads the engagement).
const behindP = (f: AF, ally: AF, target: AF | null): Plan => ({ gx: ally.x + (f.team === "blue" ? -2.6 : 2.6), gy: ally.y, stopAt: 0.4, target, channel: false });
function retreatP(f: AF, fs: AF[]): Plan {
    const anchor = nearestPt(f.x, f.y, alliesAlive(f, fs, false));
    const [bx, by] = nearestSeal(f);
    const gx = anchor ? (anchor.x + bx) / 2 : bx, gy = anchor ? (anchor.y + by) / 2 : by;
    const block = nearestEnemy(f, fs);
    return { gx, gy, stopAt: 0, target: block && dist(f, block) < f.atkRange ? block : null, channel: false };   // only fight if cornered
}
function contestP(f: AF, fs: AF[], scroll: Scroll): Plan {
    const dScroll = distPt(f, scroll.x, scroll.y);
    const channeler = scroll.channelById ? fs.find((g) => g.id === scroll.channelById) ?? null : null;
    // No one's on the pickup + I'm in range → I channel it.
    if (dScroll <= PICKUP_RANGE && (channeler === null || channeler.id === f.id)) return { gx: f.x, gy: f.y, stopAt: 0, target: nearestEnemy(f, fs), channel: true };
    // Someone ELSE is channelling — do NOT freeze: rush an ENEMY channeller to break
    // it (killing/reaching it cancels the pickup), or guard an ALLY channeller (ring
    // up around the spot and fight whoever comes).
    if (channeler && channeler.id !== f.id) {
        if (channeler.team !== f.team) return { gx: channeler.x, gy: channeler.y, stopAt: 0.2, target: channeler, channel: false };
        const goff = f.role === "assassin" ? 2.2 : f.role === "sage" ? 3.0 : 1.3;
        return { gx: scroll.x + (f.team === "blue" ? -goff : goff), gy: scroll.y + (f.slot % 2 ? goff : -goff), stopAt: 0.4, target: nearestEnemy(f, fs), channel: false };
    }
    // Free scroll — approach with the role offset (assassin flanks, sage holds back).
    const off = f.role === "assassin" ? 2.2 : f.role === "sage" ? 3.0 : 0;
    const ex = scroll.x + (f.team === "blue" ? -off : off), ey = scroll.y + (f.slot % 2 ? off : -off);
    return { gx: off ? ex : scroll.x, gy: off ? ey : scroll.y, stopAt: off ? 0.5 : 0, target: nearestEnemy(f, fs), channel: false };
}
/** Pre-position for the IMMINENT scroll spawn (scroll.x/y holds the spawn point):
 *  defender claims the spot, tracker pressures it, assassin takes a flank, sage rings
 *  up behind — so the spawn is a beat the squad has gathered for, not a surprise. */
function anticipateP(f: AF, fs: AF[], scroll: Scroll): Plan {
    const off = f.role === "assassin" ? 2.8 : f.role === "sage" ? 3.4 : f.role === "tracker" ? 1.6 : 0.7;
    const ex = scroll.x + (f.team === "blue" ? -off : off), ey = scroll.y + (f.slot % 2 ? off : -off);
    return { gx: ex, gy: ey, stopAt: 0.4, target: nearestEnemy(f, fs), channel: false };
}
/** Rally to the team — toward the nearest defender (the wall), but biased to the
 *  centre/fight so a regrouping pet never just parks in its spawn corner (which
 *  reads as — and tests as — frozen). moveToward snaps the goal into the connected
 *  region. Only used when there IS an ally to group to (see candidates). */
function regroupPlan(f: AF, fs: AF[]): Plan {
    const allies = alliesAlive(f, fs, false);
    const anchor = allies.find((a) => a.role === "defender") ?? nearestPt(f.x, f.y, allies);
    const ax = anchor ? anchor.x : ARENA_CENTER[0], ay = anchor ? anchor.y : ARENA_CENTER[1];
    const gx = (ax + ARENA_CENTER[0]) / 2, gy = (ay + ARENA_CENTER[1]) / 2;
    const block = nearestEnemy(f, fs);
    return { gx, gy, stopAt: 1.2, target: block && dist(f, block) < f.atkRange ? block : null, channel: false };
}
/** Rescue a critical ally — role-specific: sage heal-positions on it, defender bodies
 *  between it and the threat, tracker/assassin punish the attacker. */
function protectPlan(f: AF, ally: AF, fs: AF[]): { plan: Plan; score: number } {
    const threat = nearestPt(ally.x, ally.y, enemiesAlive(f, fs));
    if (f.role === "sage") return { plan: behindP(f, ally, null), score: 94 };
    if (f.role === "defender" && threat) return { plan: { gx: (ally.x + threat.x) / 2, gy: (ally.y + threat.y) / 2, stopAt: 0, target: threat, channel: false }, score: 86 };
    if (threat) return { plan: huntP(f, threat, ROLE_CFG[f.role].neutral), score: f.role === "tracker" ? 72 : 62 };
    return { plan: behindP(f, ally, nearestEnemy(f, fs)), score: 42 };
}

const SAME_TARGET_BONUS = 13;        // per OTHER ally already committed to a target → collapse on it
const OUTNUMBER_RATIO = 1.5, LOCAL_R = 6;
const REGROUP_SCORE: Record<ArenaRole, number> = { sage: 88, assassin: 85, tracker: 58, defender: 35 };   // sage/assassin disengage first, defender last

/** Build the role's scored candidate intents (handoff priority numbers) layered with
 *  squad awareness: focus-fire, rescue, and regroup-when-outnumbered. */
function candidates(f: AF, fs: AF[], scroll: Scroll, ctx: Ctx, squad: Squad): Cand[] {
    const cfg = ROLE_CFG[f.role];
    const enemies = enemiesAlive(f, fs);
    const cands: Cand[] = [];
    const stick = (e: AF) => (e.id === f.aiTargetId ? 6 : 0);                          // hysteresis — resist flip-flopping
    const distPen = (e: AF) => clamp(dist(f, e), 0, 16) * 1.1;                         // prefer reachable high-value targets
    // Focus-fire: bonus for piling onto an enemy MY OTHER allies already target.
    const fire = (e: AF) => SAME_TARGET_BONUS * Math.max(0, (squad.focus[f.team][e.id] ?? 0) - (f.aiTargetId === e.id ? 1 : 0));
    const huntC = (e: AF, base: number): Cand => ({ score: base - distPen(e) + stick(e) + fire(e), kind: "hunt", plan: huntP(f, e, cfg.neutral) });

    // SQUAD LAYER (all roles): rescue a dying ally, regroup when locally outnumbered.
    const crit = criticalAlly(f, fs);
    if (crit) { const p = protectPlan(f, crit, fs); cands.push({ score: p.score, kind: "protectAlly", plan: p.plan }); }
    if (!f.carrying && alliesAlive(f, fs, false).length > 0) {   // "regroup" needs an ally to group TO — a lone pet fights (stays mobile)
        const myPow = localPower(f.x, f.y, alliesAlive(f, fs, true), LOCAL_R);
        const enPow = localPower(f.x, f.y, enemies, LOCAL_R);
        if (enPow > myPow * OUTNUMBER_RATIO) cands.push({ score: REGROUP_SCORE[f.role], kind: "regroup", plan: regroupPlan(f, fs) });
    }

    // Objective: contest the open scroll, OR pre-position for an imminent spawn
    // (scroll.x/y = the spawn point). Tracker/Defender weigh it hardest. Weights are
    // high + the distance falloff is MILD, so the squad actually travels to the
    // centre and converges on the scroll instead of ignoring it from across the map.
    if (ctx.scrollOpen || ctx.scrollSoon) {
        const w = f.role === "tracker" ? 78 : f.role === "defender" ? 72 : f.role === "assassin" ? 48 : 38;
        const dS = distPt(f, scroll.x, scroll.y);
        const score = ctx.scrollOpen ? w + (dS <= PICKUP_RANGE ? 45 : -dS * 0.6) : w * 0.85 - dS * 0.5;   // anticipation softer
        cands.push({ score, kind: "objective", plan: ctx.scrollOpen ? contestP(f, fs, scroll) : anticipateP(f, fs, scroll) });
    }

    if (f.role === "defender") {
        if (ctx.myCarrier && ctx.myCarrier.id !== f.id) {
            const th = nearestPt(ctx.myCarrier.x, ctx.myCarrier.y, enemies);
            const mx = th ? (ctx.myCarrier.x + th.x) / 2 : ctx.myCarrier.x, my = th ? (ctx.myCarrier.y + th.y) / 2 : ctx.myCarrier.y;
            cands.push({ score: ctx.leadLives >= 3 ? 115 : 100, kind: "escort", plan: { gx: mx, gy: my, stopAt: 0, target: th, channel: false } });   // escort carrier
            if (th && dist(th, ctx.myCarrier) < 3) cands.push({ score: 75, kind: "protectCarrier", plan: diveP(th, 0.2) });           // protect carrier
        }
        const asn = assassinThreat(f, fs);
        if (asn) cands.push({ score: 50, kind: "interceptAssassin", plan: pokeP(asn, cfg.neutral) });                                  // intercept assassin
        if (ctx.enemyCarrier) cands.push({ score: 55, kind: "interceptCarrier", plan: diveP(ctx.enemyCarrier, 0.2) });                 // intercept enemy carrier
        const sage = alliesAlive(f, fs, false).find((a) => a.role === "sage");
        if (sage) { const st = nearestPt(sage.x, sage.y, enemies); if (st && dist(st, sage) < 4) cands.push({ score: 40, kind: "protectSage", plan: { gx: (sage.x + st.x) / 2, gy: (sage.y + st.y) / 2, stopAt: 0, target: st, channel: false } }); }
        const near = nearestEnemy(f, fs);
        if (near) cands.push({ score: 25 + stick(near) + fire(near), kind: "frontline", plan: huntP(f, near, cfg.neutral) });          // frontline nearest threat
    } else if (f.role === "tracker") {
        if (ctx.enemyCarrier) cands.push(huntC(ctx.enemyCarrier, 80));                                                                 // hunt carrier
        for (const e of enemies) {
            const hf = hpFrac(e);
            if (hf < 0.30) cands.push(huntC(e, 70));                                                                                   // execute
            else if (hf < 0.50) cands.push(huntC(e, 50));                                                                             // pressure
        }
        if (ctx.myCarrier && ctx.myCarrier.id !== f.id) cands.push({ score: 40, kind: "escort", plan: pokeP(ctx.myCarrier, 1.6) });    // escort
        const tt = threatTarget(f, enemies);
        if (tt) cands.push(huntC(tt, 30));                                                                                            // highest-value enemy
        if (hpFrac(f) < 0.25 && countWithin(f.x, f.y, enemies, 4.5) >= 2) cands.push({ score: 75, kind: "retreat", plan: retreatP(f, fs) });
    } else if (f.role === "assassin") {
        for (const e of enemies) {
            let s: number;
            if (e.role === "sage") s = 100;                                                                                           // kill the sage
            else if (ctx.enemyCarrier && e.id === ctx.enemyCarrier.id) s = 95;                                                        // kill the carrier
            else if (hpFrac(e) < 0.40) s = 80;                                                                                        // execute
            else if (e.role === "tracker") s = 50;                                                                                    // ambush tracker
            else if (e.role === "defender") continue;                                                                                 // ignore defenders
            else s = 30;
            cands.push(huntC(e, s));
        }
        if (hpFrac(f) < 0.30) cands.push({ score: 120, kind: "retreat", plan: retreatP(f, fs) });                                      // disengage immediately when hurt
        else if (countWithin(f.x, f.y, enemies, 3.0) >= 2 && hpFrac(f) < 0.6) cands.push({ score: 70, kind: "retreat", plan: retreatP(f, fs) });
    } else { // sage — survival-focused support; never leads
        const allies = alliesAlive(f, fs, true);
        const hurt = allies.reduce<AF | null>((b, a) => (b === null || hpFrac(a) < hpFrac(b) ? a : b), null);
        const defender = allies.find((a) => a.role === "defender" && a.id !== f.id) ?? null;
        const anchor = defender ?? nearestPt(f.x, f.y, alliesAlive(f, fs, false));
        if (hurt && hpFrac(hurt) < 0.25) cands.push({ score: 100, kind: "protectAlly", plan: behindP(f, hurt, null) });               // emergency heal positioning
        if (ctx.myCarrier) cands.push({ score: 90, kind: "protectCarrier", plan: behindP(f, ctx.myCarrier, null) });                  // protect carrier
        if (hurt && hpFrac(hurt) < 0.50) cands.push({ score: 75, kind: "support", plan: behindP(f, hurt, null) });                    // heal
        if (anchor) cands.push({ score: 50, kind: "support", plan: behindP(f, anchor, nearestEnemy(f, fs)) });                        // buff / stay behind defender
        if (assassinThreat(f, fs)) cands.push({ score: 40, kind: "retreat", plan: retreatP(f, fs) });                                 // escape an assassin
        if (hpFrac(f) < 0.25) cands.push({ score: 95, kind: "retreat", plan: retreatP(f, fs) });                                      // survival
        if (anchor) cands.push({ score: 18, kind: "support", plan: behindP(f, anchor, nearestEnemy(f, fs)) });                        // fallback
    }

    if (cands.length === 0) { const near = nearestEnemy(f, fs); cands.push(near ? { score: 1, kind: "frontline", plan: huntP(f, near, cfg.neutral) } : { score: 0, kind: "support", plan: { gx: f.x, gy: f.y, stopAt: 0, target: null, channel: false } }); }
    return cands;
}

// Match-state rubber-band: nudge candidate scores by KIND so a viewer sees the team
// shift posture with the scoreboard. Ahead → protect/group; behind → force fights;
// match point → the objective + the enemy carrier are everything.
const PHASE_ADJ: Record<MatchPhase, Partial<Record<CandKind, number>>> = {
    normal: {},
    closeit: { escort: 18, protectCarrier: 18, protectAlly: 14, protectSage: 12, regroup: 12, support: 8, hunt: -10, frontline: -8 },
    comeback: { objective: 16, hunt: 12, interceptCarrier: 14, frontline: 8, retreat: -14, regroup: -10 },
    emergency: { objective: 30, protectCarrier: 30, interceptCarrier: 36, escort: 24, hunt: -16, frontline: -16, support: -8 },
};
// Trait personality: nudges (not overrides) the role's choices by the pet's OWN
// trait, so two same-role pets play a little differently — an Aggressive one dives,
// a Loyal one guards. Mild on purpose; absent/unknown traits → no change.
const TRAIT_ADJ: Record<string, Partial<Record<CandKind, number>>> = {
    Aggressive: { hunt: 14, frontline: 12, interceptCarrier: 10, retreat: -14, regroup: -10 },
    Loyal: { protectCarrier: 16, protectSage: 14, protectAlly: 14, escort: 12 },
    Guardian: { protectCarrier: 12, protectSage: 12, protectAlly: 10, regroup: 10, escort: 10, hunt: -6 },
    Swift: { objective: 12, interceptCarrier: 10, interceptAssassin: 8, hunt: 6 },
    Lucky: { hunt: 8, objective: 8 },
    Battleborn: { frontline: 14, hunt: 10, retreat: -12, regroup: -8 },
};

const COMMIT_MARGIN = 12;   // keep last tick's target unless another beats it by this much
function decide(f: AF, fs: AF[], scroll: Scroll, score: { blue: number; red: number }, squad: Squad): Plan {
    const cfg = ROLE_CFG[f.role];
    if (f.carrying) return carryHome(f, fs);                                            // carrier behavior tree
    if (f.tauntLeft > 0 && f.tauntBy) {                                                 // forced taunt overrides
        const tn = fs.find((g) => g.id === f.tauntBy && alive(g));
        if (tn) { f.aiTargetId = tn.id; return { gx: tn.x, gy: tn.y, stopAt: cfg.neutral, target: tn, channel: false }; }
    }
    const ctx = makeCtx(f, fs, scroll, score);
    const cands = candidates(f, fs, scroll, ctx, squad);
    const adj = PHASE_ADJ[ctx.phase];
    for (const c of cands) { const a = adj[c.kind]; if (a) c.score += a; }              // match-state rubber-band
    const tadj = f.pet.trait ? TRAIT_ADJ[f.pet.trait] : undefined;                      // trait personality
    if (tadj) for (const c of cands) { const a = tadj[c.kind]; if (a) c.score += a; }
    let best = cands[0];
    for (let i = 1; i < cands.length; i++) if (cands[i].score > best.score) best = cands[i];   // first wins ties → deterministic
    // Sticky commitment: stay on last tick's target unless something beats it by a
    // margin — deliberate squad behaviour instead of twitchy per-tick re-targeting.
    if (f.aiTargetId) {
        let keep: Cand | null = null;
        for (const c of cands) if (c.plan.target && c.plan.target.id === f.aiTargetId && (keep === null || c.score > keep.score)) keep = c;
        if (keep && keep.score >= best.score - COMMIT_MARGIN) best = keep;
    }
    f.aiTargetId = best.plan.target ? best.plan.target.id : null;
    return best.plan;
}

/** Carrier behavior tree: head home via whichever seal keeps the most distance
 *  from the nearest enemy; only fight if something's right in the way. (handoff:
 *  return home > avoid threats > stay near allies > fight only if blocked.) */
function carryHome(f: AF, fs: AF[]): Plan {
    const enemies = enemiesAlive(f, fs);
    let best = f.seals[0], bestScore = -Infinity;
    for (const s of f.seals) {
        const ne = nearestPt(s[0], s[1], enemies);
        const dEnemy = ne ? Math.sqrt((ne.x - s[0]) * (ne.x - s[0]) + (ne.y - s[1]) * (ne.y - s[1])) : 99;
        const sc = -distPt(f, s[0], s[1]) + dEnemy * 0.5;     // closer to home + farther from danger
        if (sc > bestScore) { bestScore = sc; best = s; }
    }
    const block = nearestEnemy(f, fs);
    return { gx: best[0], gy: best[1], stopAt: 0, target: block && dist(f, block) < f.atkRange + 0.3 ? block : null, channel: false };
}

/** Close to just inside striking range of the target. No team-dependent term, so
 *  the engagement is fair (blue/red mirror across x=0); the team fans out naturally
 *  via body-separation + role-distinct attack ranges (defender hugs, tracker/sage
 *  hang back). Going to a STABLE goal (the target itself) avoids the orbit-the-
 *  standing-spot stall that parks pets just out of reach. */
function spreadGoal(f: AF, target: AF, neutral: number): { gx: number; gy: number; stopAt: number } {
    return { gx: target.x, gy: target.y, stopAt: Math.min(neutral, f.atkRange) * 0.92 };
}

/** Act on the plan: channel, attack, or fire the role ability. */
function act(f: AF, plan: Plan, fs: AF[], scroll: Scroll, rng: () => number, t: number, events: ArenaEvent[]) {
    const cfg = ROLE_CFG[f.role];
    const tgt = plan.target;
    const d = tgt ? dist(f, tgt) : Infinity;
    // Role ability when ready + appropriate.
    if (f.abilityCd <= 0 && f.energy >= cfg.abilityCost) {
        if (cfg.ability === "mend") {                                   // Sage: heal the most-hurt ally
            const ally = lowestHpAlly(f, fs); if (ally && ally.hp < ally.maxHp * 0.85) { const amt = Math.round(ally.maxHp * 0.22); ally.hp = Math.min(ally.maxHp, ally.hp + amt); ally.shieldHp = Math.max(ally.shieldHp, Math.round(ally.maxHp * 0.12)); f.abilityCd = cfg.abilityCd * ARENA_TPS; f.energy -= cfg.abilityCost; events.push({ t, type: "ability", actorId: f.id, kind: "mend" }, { t, type: "heal", targetId: ally.id, actorId: f.id, amount: amt }); return; }
        } else if (cfg.ability === "guard" && tgt && d < cfg.neutral + 2 && (tgt.carrying || tgt.role === "assassin" || tgt.role === "tracker" || hpFrac(f) < 0.55)) {  // Defender: SAVE the taunt for the carrier / a striker / when pressured
            tgt.tauntBy = f.id; tgt.tauntLeft = Math.round(ARENA_TPS * 2.5); f.shieldHp = Math.max(f.shieldHp, Math.round(f.maxHp * 0.25)); f.abilityCd = cfg.abilityCd * ARENA_TPS; f.energy -= cfg.abilityCost; events.push({ t, type: "ability", actorId: f.id, kind: "guard" }, { t, type: "shield", targetId: f.id, actorId: f.id, amount: f.shieldHp }); return;
        } else if (cfg.ability === "mark" && tgt && d < cfg.atkRange + 1 && (tgt.carrying || hpFrac(tgt) < 0.6 || tgt.id === f.aiTargetId)) {  // Tracker: mark the carrier / the wounded / the committed kill
            tgt.markLeft = Math.round(ARENA_TPS * 4); tgt.slowLeft = Math.max(tgt.slowLeft, Math.round(ARENA_TPS * 1.5)); f.abilityCd = cfg.abilityCd * ARENA_TPS; f.energy -= cfg.abilityCost; events.push({ t, type: "ability", actorId: f.id, kind: "mark" }); dealDamage(f, tgt, f.atk * 0.8, rng, t, events, true); return;
        } else if (cfg.ability === "assassinate" && tgt && d < 5 && d > cfg.atkRange && (tgt.carrying || tgt.role === "sage" || hpFrac(tgt) < 0.5)) {  // Assassin: spend burst on the carrier / sage / a finish
            f.moveDx = (tgt.x - f.x) / d; f.moveDy = (tgt.y - f.y) / d; f.state = "dash"; f.dashLeft = 6; f.abilityCd = cfg.abilityCd * ARENA_TPS; f.energy -= cfg.abilityCost; events.push({ t, type: "ability", actorId: f.id, kind: "assassinate" }); return;
        }
    }
    // Basic attack when a target is in range + line of sight.
    if (tgt && d <= f.atkRange + 0.1 && f.attackCd <= 0 && lineClear(f.x, f.y, tgt.x, tgt.y)) {
        dealDamage(f, tgt, f.atk, rng, t, events); f.attackCd = ATTACK_CD; f.state = "attack";
    }
}

// Two-phase tick (FAIRNESS): every pet first DECIDES on the frozen start-of-tick
// board, then all pets EXECUTE. If decide+move+act ran per-pet in one pass, the
// team processed second would react to the first team's same-tick moves — a
// second-mover edge that, with reactive AI, snowballs into a lopsided win rate.
function tickDecide(f: AF, fs: AF[], scroll: Scroll, score: { blue: number; red: number }, squad: Squad) {
    if (f.attackCd > 0) f.attackCd--; if (f.abilityCd > 0) f.abilityCd--;
    if (f.slowLeft > 0) f.slowLeft--; if (f.markLeft > 0) f.markLeft--; if (f.tauntLeft > 0) f.tauntLeft--; else f.tauntBy = null;
    if (f.energy < 100) f.energy = Math.min(100, f.energy + 18 / ARENA_TPS);
    if (f.dotLeft > 0) { f.dotLeft--; if (f.dotLeft % Math.round(ARENA_TPS * 0.5) === 0) f.hp -= f.dotDmg; }
    if (f.state === "dash" && f.dashLeft > 0) { f.plan = null; return; }
    // Periodic decisions: re-decide ~every 0.5 s (or immediately if the committed
    // target died / I picked up the scroll), and REUSE the plan in between. Movement
    // tracks the cached goal and act() keeps attacking the committed target every
    // tick, so combat stays fluid while the pet reads as deliberate, not twitchy.
    f.decisionCd--;
    const tgt = f.plan?.target ?? null;
    const stale = f.plan === null || f.decisionCd <= 0 || f.carrying || (tgt !== null && !alive(tgt));   // carrier re-routes every tick; target died → re-pick now
    if (stale) { f.plan = decide(f, fs, scroll, score, squad); f.decisionCd = DECISION_TICKS + (f.slot & 3); }
}

function tickExecute(f: AF, fs: AF[], scroll: Scroll, rng: () => number, t: number, events: ArenaEvent[]) {
    if (f.state === "dash" && f.dashLeft > 0) {                       // assassin lunge — fast, collision-aware
        f.dashLeft--; const nx = f.x + f.moveDx * f.moveSpeed * 3.4, ny = f.y + f.moveDy * f.moveSpeed * 3.4;
        if (walkableAt(nx, ny) && lineClear(f.x, f.y, nx, ny)) { f.x = nx; f.y = ny; } else f.dashLeft = 0;   // dash stops at a wall, never jumps it
        if (f.dashLeft <= 0) f.state = "idle";
        return;
    }
    const plan = f.plan;
    if (!plan) { f.state = "idle"; return; }
    if (plan.channel) { f.state = "channel"; act(f, plan, fs, scroll, rng, t, events); return; }
    const before = { x: f.x, y: f.y };
    moveToward(f, plan.gx, plan.gy, effSpeed(f), plan.stopAt);
    const moved = Math.abs(f.x - before.x) + Math.abs(f.y - before.y) > 0.002;
    f.state = moved ? "move" : "idle";
    act(f, plan, fs, scroll, rng, t, events);
}

// ── Scroll lifecycle ─────────────────────────────────────────────────────────
function stepScroll(scroll: Scroll, fs: AF[], center: [number, number], t: number, events: ArenaEvent[], score: { blue: number; red: number }) {
    if (scroll.state === "inactive") {
        if (scroll.spawnTimer > 0) scroll.spawnTimer--;
        if (scroll.spawnTimer <= 0) { scroll.state = "center"; scroll.x = center[0]; scroll.y = center[1]; scroll.channelById = null; scroll.channelLeft = 0; events.push({ t, type: "scrollspawn" }); }
        return;
    }
    if (scroll.state === "carried") {
        const carrier = fs.find((g) => g.id === scroll.carrierId);
        if (!carrier || !alive(carrier)) {                            // dropped on death (handled in death pass) — guard here too
            scroll.state = "dropped"; scroll.dropTimer = SCROLL_DROP_LIFE; scroll.carrierId = null; if (carrier) carrier.carrying = false;
            return;
        }
        scroll.x = carrier.x; scroll.y = carrier.y;
        const [bx, by] = nearestSeal(carrier);
        if (distPt(carrier, bx, by) <= BASE_SCORE_RANGE) {   // SCORE the capture
            score[carrier.team] += 1; carrier.carrying = false;   // each capture = 1 point (race to 5)
            scroll.state = "inactive"; scroll.spawnTimer = SCROLL_RESPAWN; scroll.carrierId = null;
            scroll.x = center[0]; scroll.y = center[1];   // park at the spawn point so the next anticipation aims true
            events.push({ t, type: "capture", team: carrier.team, actorId: carrier.id });
        }
        return;
    }
    // center or dropped → channelling to pick up
    if (scroll.state === "dropped") { if (scroll.dropTimer > 0) scroll.dropTimer--; if (scroll.dropTimer <= 0) { scroll.state = "inactive"; scroll.spawnTimer = SCROLL_RESPAWN; scroll.channelById = null; scroll.x = center[0]; scroll.y = center[1]; return; } }
    const chan = scroll.channelById ? fs.find((g) => g.id === scroll.channelById) : null;
    if (chan && (!alive(chan) || distPt(chan, scroll.x, scroll.y) > PICKUP_RANGE + 0.2)) { scroll.channelById = null; scroll.channelLeft = 0; }
    if (!scroll.channelById) {                                        // claim by the closest channeller (deterministic: lowest id)
        const cands = fs.filter((g) => alive(g) && distPt(g, scroll.x, scroll.y) <= PICKUP_RANGE).sort((a, b) => (a.id < b.id ? -1 : 1));
        if (cands.length) { scroll.channelById = cands[0].id; scroll.channelLeft = SCROLL_CHANNEL; }
    }
    if (scroll.channelById) {
        scroll.channelLeft--;
        if (scroll.channelLeft <= 0) {
            const c = fs.find((g) => g.id === scroll.channelById)!;
            scroll.state = "carried"; scroll.carrierId = c.id; c.carrying = true; scroll.channelById = null;
            events.push({ t, type: "pickup", actorId: c.id, team: c.team });
        }
    }
}

function snap(t: number, fs: AF[], scroll: Scroll, score: { blue: number; red: number }): ArenaSnapshot {
    return {
        t,
        actors: fs.map((f) => {
            const statuses: string[] = [];
            if (f.shieldHp > 0) statuses.push("shield"); if (f.slowLeft > 0) statuses.push("slow"); if (f.markLeft > 0) statuses.push("mark");
            if (f.tauntLeft > 0) statuses.push("taunt"); if (f.carrying) statuses.push("carry");
            return { id: f.id, team: f.team, slot: f.slot, role: f.role, element: f.element, x: quant(f.x), y: quant(f.y), faceX: quant(f.faceX), faceY: quant(f.faceY), hp: Math.max(0, Math.round(f.hp)), maxHp: f.maxHp, energy: Math.round(f.energy), lives: f.lives, state: f.state, carrying: f.carrying, statuses };
        }),
        scroll: { state: scroll.state, x: quant(scroll.x), y: quant(scroll.y), carrierId: scroll.carrierId, channelFrac: scroll.channelById ? 1 - scroll.channelLeft / SCROLL_CHANNEL : 0 },
        scoreBlue: score.blue, scoreRed: score.red,
    };
}

/** Run a full deterministic match. `blue`/`red` are role-assigned rosters (2 or 4 each). */
export function runPetArenaMatch(blue: ArenaSlot[], red: ArenaSlot[], seed: number): ArenaResult {
    const rng = makeRng(seed);
    const nB = blue.length, nR = red.length;
    const fs: AF[] = [
        ...blue.map((s, i) => buildFighter(s.pet, "blue", s.role, i, nB)),
        ...red.map((s, i) => buildFighter(s.pet, "red", s.role, i, nR)),
    ];
    const center = ARENA_CENTER;   // on the painted center paw (measured off the art)
    const scroll: Scroll = { state: "inactive", x: center[0], y: center[1], carrierId: null, channelById: null, channelLeft: 0, spawnTimer: SCROLL_FIRST_SPAWN, dropTimer: 0 };
    const score = { blue: 0, red: 0 };
    const snapshots: ArenaSnapshot[] = []; const events: ArenaEvent[] = [];
    let winner: "blue" | "red" | "draw" = "draw"; let ticks = 0;

    for (let t = 0; t < MAX_TICKS; t++) {
        ticks = t + 1;
        // respawn timers
        for (const f of fs) if (f.state === "respawning") { if (--f.respawnLeft <= 0) { const [x, y] = snapMain(f.baseX, f.baseY + (f.slot - 1.5) * 1.0); f.x = x; f.y = y; f.hp = f.maxHp; f.energy = 100; f.shieldHp = 0; f.slowLeft = f.dotLeft = f.markLeft = f.tauntLeft = 0; f.tauntBy = null; f.state = "idle"; f.path = null; f.navAge = 0; f.stuckTicks = 0; events.push({ t, type: "respawn", actorId: f.id, team: f.team }); } }
        // Decide on a frozen start-of-tick board (no second-mover advantage), then
        // execute in an order that ALTERNATES each tick (forward = blue-first,
        // reverse = red-first) so neither team gets a persistent same-tick first-
        // strike. Deterministic (keyed on the tick). NOTE: with stat-IDENTICAL
        // rosters a small side-lean remains (a symmetric-map artifact of attack
        // timing), but a clearly stronger team wins from EITHER side (verified), so
        // real matches — player pets vs AI pets, never identical — are decided by
        // pet quality, not side.
        const squad = buildSquad(fs);   // shared squad awareness (focus-fire tally) — built once per tick
        for (const f of fs) if (alive(f)) tickDecide(f, fs, scroll, score, squad);
        for (let k = 0; k < fs.length; k++) { const f = (t & 1) === 0 ? fs[k] : fs[fs.length - 1 - k]; if (alive(f)) tickExecute(f, fs, scroll, rng, t, events); }
        // separate overlapping bodies
        for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
            const a = fs[i], b = fs[j]; if (!alive(a) || !alive(b)) continue;
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy);
            if (d >= 1.5 || d < 1e-6) continue; const push = (1.5 - d) / 2, ux = dx / d, uy = dy / d;
            const ax = a.x - ux * push, ay = a.y - uy * push, bx = b.x + ux * push, by = b.y + uy * push;
            if (walkableAt(ax, ay)) { a.x = ax; a.y = ay; } if (walkableAt(bx, by)) { b.x = bx; b.y = by; }
        }
        // deaths → score, life, respawn, drop scroll
        for (const f of fs) {
            if (f.hp > 0 || f.state === "respawning" || f.state === "dead") continue;
            const killer = lastAttacker(events, f.id) ?? f.team;
            const killTeam: "blue" | "red" = killer === "blue" || killer === "red" ? killer : (f.team === "blue" ? "red" : "blue");
            events.push({ t, type: "kill", targetId: f.id, actorId: "", team: killTeam });   // kills DON'T score — purely tactical (clear the path / defend the carry)
            if (f.carrying) { f.carrying = false; scroll.state = "dropped"; scroll.dropTimer = SCROLL_DROP_LIFE; scroll.carrierId = null; scroll.x = f.x; scroll.y = f.y; events.push({ t, type: "drop", actorId: f.id }); }
            f.lives -= 1;
            if (f.lives <= 0) { f.state = "dead"; } else { f.state = "respawning"; f.respawnLeft = RESPAWN_TICKS; }
        }
        for (const f of fs) { f.x = quant(clamp(f.x, -ARENA_X, ARENA_X)); f.y = quant(clamp(f.y, -ARENA_Y, ARENA_Y)); }
        stepScroll(scroll, fs, center, t, events, score);
        snapshots.push(snap(t, fs, scroll, score));

        // win checks
        if (score.blue >= WIN_SCORE || score.red >= WIN_SCORE) { winner = score.blue >= WIN_SCORE ? "blue" : "red"; break; }
        const blueUp = fs.some((f) => f.team === "blue" && f.lives > 0), redUp = fs.some((f) => f.team === "red" && f.lives > 0);
        if (!blueUp || !redUp) { winner = blueUp ? "blue" : redUp ? "red" : "draw"; break; }
    }
    // Time-cap (or simultaneous-wipe) tiebreaker: higher score, then more total
    // remaining lives+HP — so a cap-reached match almost never ends a flat "draw".
    if (winner === "draw") {
        if (score.blue !== score.red) winner = score.blue > score.red ? "blue" : "red";
        else {
            const tally = (team: "blue" | "red") => fs.reduce((s, f) => (f.team === team ? s + Math.max(0, f.lives) * 5000 + Math.max(0, f.hp) : s), 0);
            const tb = tally("blue"), tr = tally("red");
            winner = tb > tr ? "blue" : tr > tb ? "red" : "draw";
        }
    }
    return { winner, scoreBlue: score.blue, scoreRed: score.red, ticks, snapshots, events, bases: { blue: SEALS.blue, red: SEALS.red }, center };
}

/** The team of the most recent hit on `id` (kill credit). Scans events backward. */
function lastAttacker(events: ArenaEvent[], id: string): "blue" | "red" | null {
    for (let i = events.length - 1; i >= 0; i--) { const e = events[i]; if (e.type === "hit" && e.targetId === id) return e.actorId.startsWith("blue") ? "blue" : "red"; }
    return null;
}
