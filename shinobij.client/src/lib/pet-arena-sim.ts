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
const MAX_SECONDS = 150;                 // safety cap — a match should resolve well before
const MAX_TICKS = ARENA_TPS * MAX_SECONDS;
export const WIN_SCORE = 10;
export const ARENA_X = 14.0, ARENA_Y = 7.5;

export const SCROLL_FIRST_SPAWN = ARENA_TPS * 18;   // first scroll (beta value for watchability; spec = 45 s)
const SCROLL_RESPAWN = ARENA_TPS * 60;       // re-spawn 60 s after capture / reset
const SCROLL_CHANNEL = ARENA_TPS * 2;        // 2 s channel to pick up
const SCROLL_DROP_LIFE = ARENA_TPS * 10;     // a dropped scroll resets after 10 s
const RESPAWN_TICKS = ARENA_TPS * 5;         // 5 s respawn
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
    const steps = Math.ceil(d / (CELL_X * 0.6));
    for (let i = 1; i < steps; i++) { const t = i / steps; if (!walkableAt(ax + dx * t, ay + dy * t)) return false; }
    return true;
}
const BFS_DC = [1, -1, 0, 0, 1, 1, -1, -1], BFS_DR = [0, 0, 1, -1, 1, -1, 1, -1];
// Preallocated BFS scratch + a generation counter (no per-call allocation / clear).
const _N = GCOLS * GROWS;
const _came = new Int32Array(_N), _vis = new Int32Array(_N), _queue = new Int32Array(_N);
let _gen = 0;
function bfsStep(fc: number, fr: number, tc: number, tr: number): [number, number] | null {
    if (fc === tc && fr === tr) return null;
    _gen++;
    const start = tr * GCOLS + tc;
    _vis[start] = _gen; _came[start] = -1;
    let head = 0, tail = 0; _queue[tail++] = start;
    while (head < tail) {
        const cur = _queue[head++]; const cc = cur % GCOLS, cr = (cur - cc) / GCOLS;
        if (cc === fc && cr === fr) { const nxt = _came[cur]; return nxt < 0 ? null : [nxt % GCOLS, (nxt - (nxt % GCOLS)) / GCOLS]; }
        for (let k = 0; k < 8; k++) {
            const dc = BFS_DC[k], dr = BFS_DR[k], nc = cc + dc, nr = cr + dr;
            if (!cellWalkable(nc, nr)) continue;
            if (dc !== 0 && dr !== 0 && (!cellWalkable(cc + dc, cr) || !cellWalkable(cc, cr + dr))) continue;
            const ni = nr * GCOLS + nc;
            if (_vis[ni] === _gen) continue;
            _vis[ni] = _gen; _came[ni] = cur; _queue[tail++] = ni;
        }
    }
    return null;
}
/** Step `f` toward (gx,gy): straight if there's a clear path, else BFS around terrain. */
function moveToward(f: AF, gx: number, gy: number, spd: number, stopAt = 0) {
    let tx = gx, ty = gy;
    if (!lineClear(f.x, f.y, gx, gy)) {
        const [fc, fr] = cellOf(f.x, f.y), [gc, gr] = cellOf(gx, gy);
        // Recompute the BFS step at most every 4 ticks (re-pathing to the goal's
        // CURRENT cell each time) — not every tick. ~4× fewer BFS, pathing stays fresh.
        if (f.navStep < 0 || f.navAge <= 0) {
            const nxt = bfsStep(fc, fr, gc, gr);
            f.navStep = nxt ? nxt[1] * GCOLS + nxt[0] : -1; f.navAge = 4;
        }
        f.navAge--;
        if (f.navStep >= 0) { const [wx, wy] = cellCenter(f.navStep % GCOLS, (f.navStep - (f.navStep % GCOLS)) / GCOLS); tx = wx; ty = wy; stopAt = 0; }
    }
    const dx = tx - f.x, dy = ty - f.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-6) { f.faceX = (gx - f.x); f.faceY = (gy - f.y); const fl = Math.sqrt(f.faceX * f.faceX + f.faceY * f.faceY) || 1; f.faceX /= fl; f.faceY /= fl; }
    const s = Math.min(spd, Math.max(0, d - stopAt));
    if (s <= 0) return;
    const nx = f.x + (dx / d) * s, ny = f.y + (dy / d) * s;
    if (walkableAt(nx, ny)) { f.x = nx; f.y = ny; }
    else if (walkableAt(nx, f.y)) f.x = nx;
    else if (walkableAt(f.x, ny)) f.y = ny;
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
    navStep: number; navGoal: number; navAge: number;   // BFS step cache (perf)
}
// The two spawn seals per team (arena corners), snapped to a path tile. 2v2 puts
// one pet on each seal; 4v4 puts two pets (a "player" pair) on each seal.
// Field positions of the four painted spawn seals, measured off the diorama art
// (scripts/find-seals.mjs); snapped to the nearest walkable path tile so pets
// emerge ON the seal. [0] = upper seal, [1] = lower seal, per team.
const SEALS: Record<"blue" | "red", [number, number][]> = {
    blue: [snapPoint(-10.3, -5.6), snapPoint(-12.4, 2.5)],
    red: [snapPoint(9.5, -5.0), snapPoint(11.7, 2.5)],
};
function buildFighter(pet: Pet, team: "blue" | "red", role: ArenaRole, slot: number, count: number): AF {
    const cfg = ROLE_CFG[role];
    const seals = SEALS[team];
    const sealIdx = count <= 2 ? Math.min(slot, 1) : (slot < 2 ? 0 : 1);
    const [sx, sy] = seals[sealIdx];
    const [x, y] = snapPoint(sx, sy + (count <= 2 ? 0 : slot % 2 ? 0.9 : -0.9));
    const maxHp = Math.max(1, Math.round((pet.hp || 600) * cfg.hpMul));
    return {
        id: `${team}-${slot}`, team, slot, role, pet, element: pet.element,
        x, y, faceX: team === "blue" ? 1 : -1, faceY: 0, baseX: sx, baseY: sy, seals,
        hp: maxHp, maxHp, atk: Math.max(1, (pet.attack || 60) * cfg.dmgMul), def: Math.max(0, (pet.defense || 30) * cfg.defMul),
        moveSpeed: clamp(2.6 + (pet.speed || 50) * 0.016, 2.6, 6.0) * cfg.spdMul / ARENA_TPS,
        atkRange: cfg.atkRange, crit: cfg.crit, energy: 100, lives: 3,
        state: "idle", respawnLeft: 0, attackCd: 0, abilityCd: Math.round(ARENA_TPS * 1.5), dashLeft: 0, moveDx: 0, moveDy: 0,
        shieldHp: 0, slowLeft: 0, dotLeft: 0, dotDmg: 0, markLeft: 0, tauntBy: null, tauntLeft: 0, carrying: false,
        navStep: -1, navGoal: -1, navAge: 0,
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
/** Lane discipline: your same-slot counterpart (the four duels spread across the
 *  map, no 4-on-1 focus-fire snowball), or the nearest enemy if it's down. */
function laneEnemy(f: AF, fs: AF[]): AF | null {
    const lane = fs.find((g) => g.team !== f.team && g.slot === f.slot && alive(g));
    return lane ?? nearestEnemy(f, fs);
}
function weakestEnemy(f: AF, fs: AF[]): AF | null {
    // Assassin/Tracker bias: prefer the squishiest (sage > assassin > tracker > defender), then lowest HP.
    const order: Record<ArenaRole, number> = { sage: 0, assassin: 1, tracker: 2, defender: 3 };
    let best: AF | null = null, bk = Infinity;
    for (const g of fs) { if (g.team === f.team || !alive(g)) continue; const k = order[g.role] * 1000 + g.hp; if (k < bk) { bk = k; best = g; } }
    return best;
}
function nearestSeal(f: AF): [number, number] {
    let best = f.seals[0], bd = distPt(f, best[0], best[1]);
    for (const s of f.seals) { const d = distPt(f, s[0], s[1]); if (d < bd) { bd = d; best = s; } }
    return best;
}

interface Plan { gx: number; gy: number; stopAt: number; target: AF | null; channel: boolean; }
function decide(f: AF, fs: AF[], scroll: Scroll): Plan {
    const cfg = ROLE_CFG[f.role];
    const carrier = scroll.carrierId ? fs.find((g) => g.id === scroll.carrierId) ?? null : null;
    const taunter = f.tauntLeft > 0 && f.tauntBy ? fs.find((g) => g.id === f.tauntBy && alive(g)) ?? null : null;

    // I CARRY THE SCROLL → head home; only fight if something's in the way.
    if (f.carrying) {
        const [bx, by] = nearestSeal(f); const block = nearestEnemy(f, fs);
        const target = block && dist(f, block) < f.atkRange + 0.3 ? block : null;
        return { gx: bx, gy: by, stopAt: 0, target, channel: false };
    }
    // forced target (defender taunt) overrides offense
    if (taunter) return { gx: taunter.x, gy: taunter.y, stopAt: cfg.neutral, target: taunter, channel: false };

    // ALLY CARRIES → escort + peel.
    if (carrier && carrier.team === f.team && carrier.id !== f.id) {
        const threat = nearestEnemy(carrier, fs);
        if (f.role === "sage") return { gx: carrier.x - f.faceX * 1.5, gy: carrier.y, stopAt: 0.5, target: null, channel: false };       // sit behind, heal handled in act()
        if (f.role === "defender" && threat) { const mx = (carrier.x + threat.x) / 2, my = (carrier.y + threat.y) / 2; return { gx: mx, gy: my, stopAt: 0, target: threat, channel: false }; }
        if (threat && dist(f, threat) < cfg.atkRange + 3) return { gx: threat.x, gy: threat.y, stopAt: cfg.neutral, target: threat, channel: false };
        return { gx: carrier.x, gy: carrier.y, stopAt: 1.6, target: threat, channel: false };                                              // escort
    }
    // ENEMY CARRIES → intercept.
    if (carrier && carrier.team !== f.team) {
        const stop = f.role === "sage" ? cfg.neutral : f.role === "tracker" ? cfg.neutral : 0.2;   // assassin/defender dive, ranged poke
        return { gx: carrier.x, gy: carrier.y, stopAt: stop, target: carrier, channel: false };
    }
    // SCROLL OPEN (center or dropped) → contest it (role-weighted approach).
    if (scroll.state === "center" || scroll.state === "dropped") {
        const dScroll = distPt(f, scroll.x, scroll.y);
        const someoneChanneling = scroll.channelById && scroll.channelById !== f.id;
        if (dScroll <= PICKUP_RANGE && !someoneChanneling) return { gx: f.x, gy: f.y, stopAt: 0, target: nearestEnemy(f, fs), channel: true };
        // Assassin holds a flank (offset) unless it can grab; ranged/sage take a safe nearby spot; defender/tracker go straight.
        const off = f.role === "assassin" ? 2.2 : f.role === "sage" ? 3.0 : 0;
        const ex = scroll.x + (f.team === "blue" ? -off : off), ey = scroll.y + (f.slot % 2 ? off : -off);
        return { gx: someoneChanneling ? f.x : (off ? ex : scroll.x), gy: someoneChanneling ? f.y : (off ? ey : scroll.y), stopAt: off ? 0.5 : 0, target: nearestEnemy(f, fs), channel: false };
    }
    // NO SCROLL → fight normally with role POSITIONING (spread out, don't clump)
    // + role targeting. Sage hangs back behind a hurt ally; everyone else fans out
    // laterally by slot, and assassins swing wide to flank.
    if (f.role === "sage") { const hurt = lowestHpAlly(f, fs, false) ?? f; return { gx: hurt.x - (f.team === "blue" ? 2.4 : -2.4), gy: hurt.y, stopAt: 0.5, target: nearestEnemy(f, fs), channel: false }; }
    // Bruisers fight their lane counterpart (spread, no snowball); assassins roam
    // for the weakest pick. Either way, fan out laterally so we don't clump.
    const target = f.role === "assassin" ? weakestEnemy(f, fs) : laneEnemy(f, fs);
    if (!target) return { gx: f.x, gy: f.y, stopAt: 0, target: null, channel: false };
    return { ...spreadGoal(f, target, cfg.neutral), target, channel: false };
}

/** Approach `target` to `neutral` range but offset PERPENDICULAR by slot (allies
 *  fan out) — and assassins swing wide to flank — so the team spreads instead of
 *  piling onto one tile. */
function spreadGoal(f: AF, target: AF, neutral: number): { gx: number; gy: number; stopAt: number } {
    const dx = target.x - f.x, dy = target.y - f.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    const px = -dy / d, py = dx / d;                       // unit perpendicular
    const lane = (f.slot - 1.5) * 2.4;                     // lateral spread by slot
    const flank = f.role === "assassin" ? (f.slot % 2 ? 4.0 : -4.0) : 0;
    return { gx: target.x + px * (lane + flank), gy: target.y + py * (lane + flank), stopAt: neutral };
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
        } else if (cfg.ability === "guard" && tgt && d < cfg.neutral + 2) {  // Defender: taunt + self-shield
            tgt.tauntBy = f.id; tgt.tauntLeft = Math.round(ARENA_TPS * 2.5); f.shieldHp = Math.max(f.shieldHp, Math.round(f.maxHp * 0.25)); f.abilityCd = cfg.abilityCd * ARENA_TPS; f.energy -= cfg.abilityCost; events.push({ t, type: "ability", actorId: f.id, kind: "guard" }, { t, type: "shield", targetId: f.id, actorId: f.id, amount: f.shieldHp }); return;
        } else if (cfg.ability === "mark" && tgt && d < cfg.atkRange + 1) {  // Tracker: mark for bonus damage + a slow
            tgt.markLeft = Math.round(ARENA_TPS * 4); tgt.slowLeft = Math.max(tgt.slowLeft, Math.round(ARENA_TPS * 1.5)); f.abilityCd = cfg.abilityCd * ARENA_TPS; f.energy -= cfg.abilityCost; events.push({ t, type: "ability", actorId: f.id, kind: "mark" }); dealDamage(f, tgt, f.atk * 0.8, rng, t, events, true); return;
        } else if (cfg.ability === "assassinate" && tgt && d < 5 && d > cfg.atkRange) {  // Assassin: dash onto target + burst
            f.moveDx = (tgt.x - f.x) / d; f.moveDy = (tgt.y - f.y) / d; f.state = "dash"; f.dashLeft = 6; f.abilityCd = cfg.abilityCd * ARENA_TPS; f.energy -= cfg.abilityCost; events.push({ t, type: "ability", actorId: f.id, kind: "assassinate" }); return;
        }
    }
    // Basic attack when a target is in range + line of sight.
    if (tgt && d <= f.atkRange + 0.1 && f.attackCd <= 0 && lineClear(f.x, f.y, tgt.x, tgt.y)) {
        dealDamage(f, tgt, f.atk, rng, t, events); f.attackCd = Math.round(ARENA_TPS * 0.55); f.state = "attack";
    }
}

function step(f: AF, fs: AF[], scroll: Scroll, rng: () => number, t: number, events: ArenaEvent[]) {
    if (f.attackCd > 0) f.attackCd--; if (f.abilityCd > 0) f.abilityCd--;
    if (f.slowLeft > 0) f.slowLeft--; if (f.markLeft > 0) f.markLeft--; if (f.tauntLeft > 0) f.tauntLeft--; else f.tauntBy = null;
    if (f.energy < 100) f.energy = Math.min(100, f.energy + 18 / ARENA_TPS);
    if (f.dotLeft > 0) { f.dotLeft--; if (f.dotLeft % Math.round(ARENA_TPS * 0.5) === 0) f.hp -= f.dotDmg; }

    if (f.state === "dash" && f.dashLeft > 0) {                       // assassin lunge — fast, collision-aware
        f.dashLeft--; const nx = f.x + f.moveDx * f.moveSpeed * 3.4, ny = f.y + f.moveDy * f.moveSpeed * 3.4;
        if (walkableAt(nx, ny)) { f.x = nx; f.y = ny; } else f.dashLeft = 0;
        if (f.dashLeft <= 0) f.state = "idle";
        return;
    }

    const plan = decide(f, fs, scroll);
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
            score[carrier.team] += 2; carrier.carrying = false;
            scroll.state = "inactive"; scroll.spawnTimer = SCROLL_RESPAWN; scroll.carrierId = null;
            events.push({ t, type: "capture", team: carrier.team, actorId: carrier.id });
        }
        return;
    }
    // center or dropped → channelling to pick up
    if (scroll.state === "dropped") { if (scroll.dropTimer > 0) scroll.dropTimer--; if (scroll.dropTimer <= 0) { scroll.state = "inactive"; scroll.spawnTimer = SCROLL_RESPAWN; scroll.channelById = null; return; } }
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
    const center = snapPoint(0, -1.1);   // on the painted center paw (measured off the art)
    const scroll: Scroll = { state: "inactive", x: center[0], y: center[1], carrierId: null, channelById: null, channelLeft: 0, spawnTimer: SCROLL_FIRST_SPAWN, dropTimer: 0 };
    const score = { blue: 0, red: 0 };
    const snapshots: ArenaSnapshot[] = []; const events: ArenaEvent[] = [];
    let winner: "blue" | "red" | "draw" = "draw"; let ticks = 0;

    for (let t = 0; t < MAX_TICKS; t++) {
        ticks = t + 1;
        // respawn timers
        for (const f of fs) if (f.state === "respawning") { if (--f.respawnLeft <= 0) { const [x, y] = snapPoint(f.baseX, f.baseY + (f.slot - 1.5) * 1.0); f.x = x; f.y = y; f.hp = f.maxHp; f.energy = 100; f.shieldHp = 0; f.slowLeft = f.dotLeft = f.markLeft = f.tauntLeft = 0; f.tauntBy = null; f.state = "idle"; events.push({ t, type: "respawn", actorId: f.id, team: f.team }); } }
        // act (fixed order = determinism)
        for (const f of fs) if (alive(f)) step(f, fs, scroll, rng, t, events);
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
            score[killTeam] += 1;
            events.push({ t, type: "kill", targetId: f.id, actorId: "", team: killTeam });
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
    if (winner === "draw" && score.blue !== score.red) winner = score.blue > score.red ? "blue" : "red";
    return { winner, scoreBlue: score.blue, scoreRed: score.red, ticks, snapshots, events, bases: { blue: SEALS.blue, red: SEALS.red }, center };
}

/** The team of the most recent hit on `id` (kill credit). Scans events backward. */
function lastAttacker(events: ArenaEvent[], id: string): "blue" | "red" | null {
    for (let i = events.length - 1; i >= 0; i--) { const e = events[i]; if (e.type === "hit" && e.targetId === id) return e.actorId.startsWith("blue") ? "blue" : "red"; }
    return null;
}
