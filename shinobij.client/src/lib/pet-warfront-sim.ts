/*
 * ── Hollow Warfront — the lane-war match sim (deterministic, chunked) ────────
 * A mini-MOBA on the pet-warfront-map battlefield: two squads of 4 pets, two
 * weaving lanes, and a win-by-destruction objective — break BOTH of a base's
 * Guardian Totems to expose its WARD SEAL; destroy the Seal to win. A Hollow
 * Gate breach at the centre pours out neutral hollow-spawn raiders that march
 * the lanes and attack anything they meet, until the GATE WARDEN inside the
 * breach is slain (a huge bounty + the map goes quiet). Two LESSER WARDENS on
 * the mid-corridor shrine pads pay a medium bounty + a short team attack buff.
 *
 * ECONOMY: teams earn coins (trickle + mob/pet/objective bounties). Every 90 s
 * the match pauses on a ROUND BOUNDARY and coins buy small per-pet powerup
 * stacks ("minimal but matters": ~3-6% each, hard-capped). The player's choices
 * enter through advanceRound(); the AI team (and any auto-buy player) spends by
 * a deterministic greedy policy — so a match is a pure function of
 * (teams, seed, policies, choice log) and replays byte-identically.
 *
 * Same determinism discipline as pet-arena-sim: seeded LCG (no Math.random /
 * Date), state quantized to 1/256 per tick. Chunked on purpose:
 * runWarfrontMatch() (full-auto) exists for tests, shared co-op replays, and
 * the SERVER-AUTHORITATIVE reward re-sim, where buy policies are locked instead
 * of interactive.
 *
 * DETERMINISM CONTRACT — CROSS-ENGINE. The result is a pure function of
 * (teams, seed, policies, stance, choice log) and byte-identical on ANY JS
 * engine. Only +,-,*,/,Math.sqrt/min/max/round/floor/abs (IEEE-correctly-
 * rounded → identical everywhere) plus a seeded LCG. Math.sin/cos/atan2/hypot
 * are BANNED (implementation-defined in the last ULP → diverge across V8 /
 * SpiderMonkey / JSC, which over an 18k-tick match flips winners); use hyp2 and
 * dsin/dcos (defined below) instead. This is load-bearing: the reward server
 * (Node/V8) re-runs this exact sim to verify a browser's reported outcome, so a
 * Firefox player's win MUST reproduce byte-for-byte on the server.
 */
import type { Pet } from "../types/pet";
import type { ArenaRole, ArenaSlot } from "./pet-arena-sim";
import {
    WF_X, WF_Y, WF_COLS, WF_ROWS, WF_CELL_X, WF_CELL_Y,
    wfCellWalkable, wfClearanceWalkable, wfMobRoute, WF_SPAWNS, WF_DEPLOY_POINTS, WF_CORE, WF_STATUES, WF_PADS, WF_LAIR, WF_LANES, WF_GUARD_POSTS, WF_BUSHES, wfInBush,
    type WfLaneId,
} from "./pet-warfront-map";

export const WARFRONT_TPS = 30;
export const WF_ROUND_SECONDS = 90;           // buy-round cadence (the War Council popup)
export const WF_MAX_SECONDS = 600;            // 10-minute hard cap
// The match SCRIPT (broadcast pacing): LANING (farm your lane) → SKIRMISH
// (camps unlock, rotations/punishes allowed) → WAR (the Warden awakens,
// grouped play) → SUDDEN DEATH (all minions elite — somebody ends it).
export const WF_PHASE_SKIRMISH = 60;          // camps + ultimates come online quickly
export const WF_PHASE_WAR = 240;              // grouped objective play begins at 4:00
export const WF_PHASE_SUDDEN = 420;           // the Hollow Collapse begins at 7:00
const ROUND_TICKS = WARFRONT_TPS * WF_ROUND_SECONDS;
const MAX_TICKS = WARFRONT_TPS * WF_MAX_SECONDS;

// ── Structures ───────────────────────────────────────────────────────────────
const STATUE_HP = 2600;
const STATUE_DMG = 70;
const STATUE_CD = Math.round(WARFRONT_TPS * 1.2);
const STATUE_RANGE = 4.2;
const CORE_HP = 3200;
const CORE_REGEN = 3 / WARFRONT_TPS;          // per tick, only while safe
const CORE_SAFE_RANGE = 5;

// ── The Gate Warden + lesser wardens ─────────────────────────────────────────
const WARDEN_HP = 6500;
const WARDEN_SWIPE = 138;
const WARDEN_SWIPE_CD = Math.round(WARFRONT_TPS * 1.1);
const WARDEN_SLAM = 235;
const WARDEN_SLAM_R = 3.0;
const WARDEN_SLAM_EVERY = Math.round(WARFRONT_TPS * 6);
const WARDEN_WINDUP = Math.round(WARFRONT_TPS * 1.2);
const WARDEN_LEASH = 6.5;
const WARDEN_RESET_DELAY = WARFRONT_TPS * 6;
const MINI_HP = 1400;
const MINI_DMG = 108;
const MINI_CD = Math.round(WARFRONT_TPS * 1.2);
const MINI_ATTACK_ANIM_TICKS = Math.round(WARFRONT_TPS * 0.4);
const MINI_AGGRO = 4.5;   // a WIDE neutral aggro so passers-by get pulled into a camp fight
const MINI_FIRST_SPAWN = WARFRONT_TPS * WF_PHASE_SKIRMISH;   // camps unlock with the Skirmish phase
const MINI_RESPAWN = WARFRONT_TPS * 75;
const RECRUIT_TICKS = WARFRONT_TPS * 50;   // a recruited camp boss fights for you ~50 s
const MINI_BUFF_TICKS = WARFRONT_TPS * 25;
const MINI_BUFF_ATK = 1.08;

// ── Hollow-spawn mobs ────────────────────────────────────────────────────────
const MOB_HP = 240;
const MOB_DMG_PET = 26;
const MOB_DMG_STRUCT = 40;
const MOB_CD = Math.round(WARFRONT_TPS * 1.1);
const MOB_ATTACK_ANIM_TICKS = Math.round(WARFRONT_TPS * 0.34);
const MOB_SPEED = 2.0 / WARFRONT_TPS;
const MOB_EVERY = WARFRONT_TPS * 12;   // hollow raiders from the breach
const MOB_CAP = 6;                     // hollow raiders alive at once
const WAVE_EVERY = WARFRONT_TPS * 15;  // team minion waves (all three lanes)
const MINION_CAP = 12;                 // per side
const MINION_HP = 300;
const MINION_DMG = 30;
export const WF_COIN_MINION = 12;
const MOB_AGGRO = 2.2;
const MOB_CHASE = 4.0;

// ── Team STANCES (formation/strategy) ──────────────────────────────────────────────
// Picked before the match and adjustable at every War Council; the AI side
// counter-picks deterministically from the scoreboard + the opponent's stance.
// Each stance changes VISIBLE field behavior, not hidden numbers only.
export type WfStance = "balanced" | "siege" | "jungle" | "headhunt" | "turtle";
export type WfDoctrine = "none" | "vanguard" | "bulwark" | "zealot" | "warden-pact";
export const WF_DOCTRINES: ReadonlyArray<{ id: WfDoctrine; icon: string; label: string; desc: string }> = [
    { id: "vanguard", icon: "\u2694", label: "Vanguard", desc: "+8% attack \u2014 win trades and crack gates" },
    { id: "bulwark", icon: "\ud83d\udee1", label: "Bulwark", desc: "+12% HP \u2014 outlast and last-stand harder" },
    { id: "zealot", icon: "\ud83d\udca8", label: "Zealot", desc: "+10% speed \u2014 rotate, gank, escape" },
    { id: "warden-pact", icon: "\ud83e\udd1d", label: "Warden\u2019s Pact", desc: "recruited bosses fight 50% longer and hit 18% harder" },
];
export const WF_STANCES: ReadonlyArray<{ id: WfStance; icon: string; label: string; desc: string }> = [
    { id: "balanced", icon: "⚖️", label: "Balanced War", desc: "Standard lanes — take what the map gives." },
    { id: "siege", icon: "🏰", label: "Siege March", desc: "March with the waves and break structures; fight only at the gates." },
    { id: "jungle", icon: "🌿", label: "Jungle Reign", desc: "Own the camps and the Warden — win through trophies and ambushes." },
    { id: "headhunt", icon: "🗡️", label: "Headhunters", desc: "Force fights and hunt picks — snowball kills into sieges." },
    { id: "turtle", icon: "🐢", label: "Iron Turtle", desc: "Hold your third, farm safe, counter-punch when the wards drop." },
];
interface StanceCfg {
    engageR: number;      // how far pets look for fights
    huntCdMul: number;    // assassin gank cadence (lower = more ganks)
    camps: 0 | 1 | 2;     // 0 skip camps / 1 side lanes take them / 2 mid rotates too
    wardenShare: number;  // squad-health gate for a committed Warden take
    snowballAt: number;   // enemies down before the squad groups to push
    clampAhead: number;   // how far laners advance past their own wave
    structFocus: boolean; // skip farm calls — structures over everything
    farmLine: number;     // defensive-third boundary (fraction of WF_X)
    disengageHp: number;  // HP fraction where a pet breaks contact
}
const STANCE_CFG: Record<WfStance, StanceCfg> = {
    balanced: { engageR: 6.5, huntCdMul: 1, camps: 1, wardenShare: 0.72, snowballAt: 2, clampAhead: 2.5, structFocus: false, farmLine: 1 / 3, disengageHp: 0.22 },
    siege: { engageR: 5.0, huntCdMul: 1.3, camps: 0, wardenShare: 0.78, snowballAt: 2, clampAhead: 3.5, structFocus: true, farmLine: 0, disengageHp: 0.25 },
    jungle: { engageR: 6.0, huntCdMul: 0.7, camps: 2, wardenShare: 0.58, snowballAt: 2, clampAhead: 2.0, structFocus: false, farmLine: 1 / 3, disengageHp: 0.22 },
    headhunt: { engageR: 8.5, huntCdMul: 0.45, camps: 0, wardenShare: 0.72, snowballAt: 1, clampAhead: 3.5, structFocus: false, farmLine: 1 / 3, disengageHp: 0.18 },
    turtle: { engageR: 6.0, huntCdMul: 1.8, camps: 0, wardenShare: 0.8, snowballAt: 2, clampAhead: 1.2, structFocus: false, farmLine: 1 / 6, disengageHp: 0.26 },
};

// ── Coins ────────────────────────────────────────────────────────────────────
export const WF_COIN_TRICKLE = 4;             // per team per second
export const WF_COIN_MOB = 25;
export const WF_COIN_PET_KILL = 175;
const SHUTDOWN_PER_STREAK = 40;   // extra coins per streak level on a fed enemy's head
const SHUTDOWN_CAP = 6;
const COMEBACK_MULT = 1.35;       // the team BEHIND on gates earns more per kill (rubber-band)
export const WF_COIN_STATUE = 200;
export const WF_COIN_MINI = 350;
export const WF_COIN_WARDEN = 1200;           // "a ton"

// ── Powerups ("minimal but matters") ─────────────────────────────────────────
export type WfPowerupKind = "strike" | "guard" | "vitality" | "swift" | "mend";
export const WF_POWERUPS: ReadonlyArray<{ kind: WfPowerupKind; label: string; desc: string; icon: string }> = [
    { kind: "strike", label: "Oni Talisman", desc: "+5% attack", icon: "🗡" },
    { kind: "guard", label: "Tortoise Ward", desc: "+5% defense", icon: "🛡" },
    { kind: "vitality", label: "Vitality Pill", desc: "+7% max HP (and heals it)", icon: "🫀" },
    { kind: "swift", label: "Windstep Charm", desc: "+4% move speed", icon: "🌀" },
    { kind: "mend", label: "Sage Salve", desc: "+0.4% max HP regen /s", icon: "🌿" },
];
export const WF_STACK_CAP = 6;
const POWERUP_BASE_COST = 120;
const POWERUP_COST_MUL = 1.35;
export function wfPowerupCost(stacksBought: number): number {
    let cost = POWERUP_BASE_COST;
    for (let i = 0; i < stacksBought; i++) cost *= POWERUP_COST_MUL;
    return Math.round(cost / 5) * 5;
}
export type WfBuyPolicy = "off" | "balanced" | "offense" | "defense";
const POLICY_KINDS: Record<Exclude<WfBuyPolicy, "off">, WfPowerupKind[]> = {
    balanced: ["strike", "vitality", "guard", "swift", "mend"],
    offense: ["strike", "swift", "vitality", "strike", "guard"],
    defense: ["guard", "vitality", "mend", "swift", "strike"],
};
const ROLE_BALANCED_BUYS: Record<ArenaRole, WfPowerupKind[]> = {
    defender: ["guard", "vitality", "mend", "strike", "swift"],
    tracker: ["strike", "swift", "vitality", "guard", "mend"],
    assassin: ["strike", "swift", "vitality", "mend", "guard"],
    sage: ["mend", "vitality", "guard", "swift", "strike"],
};

// ── Pet roles (mirrors the tactical arena's role identity) ───────────────────
interface RoleCfg { hpMul: number; defMul: number; dmgMul: number; spdMul: number; neutral: number; atkRange: number; crit: number }
const ROLE_CFG: Record<ArenaRole, RoleCfg> = {
    defender: { hpMul: 1.75, defMul: 1.7, dmgMul: 0.62, spdMul: 0.82, neutral: 1.5, atkRange: 1.5, crit: 0.05 },
    tracker: { hpMul: 1.05, defMul: 1.05, dmgMul: 1.0, spdMul: 1.06, neutral: 3.4, atkRange: 4.0, crit: 0.1 },
    assassin: { hpMul: 0.7, defMul: 0.68, dmgMul: 1.55, spdMul: 1.26, neutral: 2.2, atkRange: 1.6, crit: 0.32 },
    sage: { hpMul: 0.85, defMul: 0.95, dmgMul: 0.5, spdMul: 1.02, neutral: 5.5, atkRange: 4.6, crit: 0.05 },
};
const TTK_HP_MUL = 2.4;
const ATTACK_CD = Math.round(WARFRONT_TPS * 1.0);
const ABILITY_CD = WARFRONT_TPS * 6;
const CALL_TICKS = WARFRONT_TPS * 2;          // team macro "call" cadence
const PET_BASE_SPEED = 2.9 / WARFRONT_TPS;
const KICKOFF_DEPLOY_TICKS = WARFRONT_TPS * 3;
const BODY_R = 0.9;
const MINI_BODY_R = 1.05;
const WARDEN_BODY_R = 1.6;
const FOUNTAIN_R = 5.2;
const FOUNTAIN_HEAL_PER_SEC = 0.1;             // a committed reset takes a few seconds, not the rest of the match
const RETREAT_RECOVER_AT = 0.74;               // hysteresis: never stutter in/out of retreat at the low-HP threshold
// Melee reach must ALWAYS beat the body-separation floor (BODY_R * 2), or two
// melee pets chasing each other lock into a permanent 1.6u chest-bump standoff
// where neither can ever land a hit — the great "stuck at mid" bug.
const MELEE_REACH = BODY_R * 2 + 0.1;
const MINI_REACH = BODY_R + MINI_BODY_R + 0.12;
const MINI_ATTACK_REACH = MINI_REACH + 0.3;
const WARDEN_REACH = BODY_R + WARDEN_BODY_R + 0.14;
const RESPAWN_BASE = WARFRONT_TPS * 9;
const RESPAWN_PER_MIN = WARFRONT_TPS * 1;     // +1 s per elapsed minute (LoL-style scaling)

const ELEMENT_BEATS: Record<string, string> = { Fire: "Wind", Wind: "Lightning", Lightning: "Earth", Earth: "Water", Water: "Fire" };
function elementMult(att?: string | null, def?: string | null): number {
    if (!att || !def || att === "None" || def === "None") return 1;
    if (ELEMENT_BEATS[att] === def) return 1.15;
    if (ELEMENT_BEATS[def] === att) return 0.85;
    return 1;
}

// ── Determinism helpers ──────────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const quant = (v: number) => Math.round(v * 256) / 256;

// ── Cross-engine-deterministic math ──────────────────────────────────────────
// Math.hypot / sin / cos / atan2 are implementation-defined in the last ULP and
// DIVERGE across JS engines (V8 vs SpiderMonkey vs JSC); over an 18k-tick match
// those differences compound into different WINNERS, which would break the
// server-authoritative reward re-sim (a Firefox player's win must match the V8
// server). These use only +,-,*,/,sqrt,round — all IEEE-correctly-rounded, so
// they are bit-identical on every engine. hyp2 replaces hypot; dsin/dcos are a
// reflected-Taylor approximation (~2e-4, plenty for patrol/ring motion).
const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;
function hyp2(dx: number, dy: number): number { return Math.sqrt(dx * dx + dy * dy); }
function dsin(x: number): number {
    x -= TAU * Math.round(x / TAU);                       // reduce to [-PI, PI]
    if (x > HALF_PI) x = Math.PI - x; else if (x < -HALF_PI) x = -Math.PI - x;   // fold to [-PI/2, PI/2]
    const x2 = x * x;
    return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040))));
}
function dcos(x: number): number { return dsin(x + HALF_PI); }
function makeRng(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

// ── Grid pathing (BFS on the warfront mask) ──────────────────────────────────
const cellOf = (x: number, y: number): [number, number] => [
    clamp(Math.floor((x + WF_X) / WF_CELL_X), 0, WF_COLS - 1),
    clamp(Math.floor((y + WF_Y) / WF_CELL_Y), 0, WF_ROWS - 1),
];
const cellCenter = (c: number, r: number): [number, number] => [(c + 0.5) * WF_CELL_X - WF_X, (r + 0.5) * WF_CELL_Y - WF_Y];
// Fighters are full 3D bodies, not points. A center-cell-only check let their
// paws and rigs clip through the two surrounding wall cells, then separation
// shoved them back and forth across that boundary. Precompute a conservative
// clearance mask once so every pet/boss path keeps its whole footprint on the
// painted road.
const PET_CLEARANCE_CELLS = 2;
const PET_NAV_MASK = (() => {
    const mask = new Uint8Array(WF_COLS * WF_ROWS);
    for (let r = 0; r < WF_ROWS; r++) {
        for (let c = 0; c < WF_COLS; c++) {
            if (wfClearanceWalkable(c, r, PET_CLEARANCE_CELLS)) mask[r * WF_COLS + c] = 1;
        }
    }
    return mask;
})();
const petCellWalkable = (c: number, r: number): boolean =>
    c >= 0 && r >= 0 && c < WF_COLS && r < WF_ROWS && PET_NAV_MASK[r * WF_COLS + c] === 1;

/** Find the genuinely nearest cell on the first Chebyshev ring that contains
 * one. The old implementation returned the first scan-order hit, permanently
 * biasing obstacles to the west: red pets were pulled through the base gate
 * while mirrored blue pets were pulled backward into it. World-distance and
 * centre-distance tie breaks are mirror-neutral for the two teams. */
function nearestCell(
    x: number,
    y: number,
    canWalk: (c: number, r: number) => boolean,
    maxRadius: number,
): [number, number] {
    const [c0, r0] = cellOf(x, y);
    if (canWalk(c0, r0)) return [c0, r0];
    for (let radius = 1; radius < maxRadius; radius++) {
        let bestC = -1, bestR = -1;
        let bestDistance = Infinity, bestAbsX = Infinity, bestAbsY = Infinity;
        for (let dr = -radius; dr <= radius; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
                if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
                const c = c0 + dc, r = r0 + dr;
                if (!canWalk(c, r)) continue;
                const [wx, wy] = cellCenter(c, r);
                const dx = wx - x, dy = wy - y;
                const distance = dx * dx + dy * dy;
                const absX = Math.abs(wx), absY = Math.abs(wy);
                if (distance < bestDistance
                    || (distance === bestDistance && absX < bestAbsX)
                    || (distance === bestDistance && absX === bestAbsX && absY < bestAbsY)) {
                    bestC = c; bestR = r;
                    bestDistance = distance; bestAbsX = absX; bestAbsY = absY;
                }
            }
        }
        if (bestC >= 0) return [bestC, bestR];
    }
    return [c0, r0];
}
function nearestWalkableCell(x: number, y: number): [number, number] {
    return nearestCell(x, y, wfCellWalkable, 10);
}
function nearestPetWalkableCell(x: number, y: number): [number, number] {
    const nearest = nearestCell(x, y, petCellWalkable, 18);
    return petCellWalkable(nearest[0], nearest[1]) ? nearest : nearestWalkableCell(x, y);
}
/** BFS shortest path (4-neighbour) from world (sx,sy) to (gx,gy); returns cell
 * indices to walk, or null when unreachable (never happens on this mask). */
function findPath(sx: number, sy: number, gx: number, gy: number, petClearance = false): number[] | null {
    const nearest = petClearance ? nearestPetWalkableCell : nearestWalkableCell;
    const canWalk = petClearance ? petCellWalkable : wfCellWalkable;
    const [sc, sr] = nearest(sx, sy);
    const [gc, gr] = nearest(gx, gy);
    const start = sr * WF_COLS + sc, goal = gr * WF_COLS + gc;
    if (start === goal) return [goal];
    const prev = new Int32Array(WF_COLS * WF_ROWS).fill(-1);
    prev[start] = start;
    const queue = [start];
    let qi = 0;
    while (qi < queue.length) {
        const cur = queue[qi++];
        if (cur === goal) break;
        const c = cur % WF_COLS, r = (cur - c) / WF_COLS;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nc = c + dc, nr = r + dr;
            if (!canWalk(nc, nr)) continue;
            const idx = nr * WF_COLS + nc;
            if (prev[idx] === -1) { prev[idx] = cur; queue.push(idx); }
        }
    }
    if (prev[goal] === -1) return null;
    const path: number[] = [];
    for (let cur = goal; cur !== prev[cur]; cur = prev[cur]) path.push(cur);
    path.reverse();
    return path;
}

// ── Internal entity state ────────────────────────────────────────────────────
type Team = "blue" | "red";
const other = (t: Team): Team => (t === "blue" ? "red" : "blue");

interface WfPet {
    id: string; team: Team; slot: number; role: ArenaRole; pet: Pet; element?: string | null;
    x: number; y: number; faceX: number; faceY: number;
    hp: number; maxHp: number; baseMaxHp: number; atk: number; baseAtk: number; def: number; baseDef: number;
    moveSpeed: number; baseSpeed: number; regen: number; atkRange: number; crit: number; neutral: number;
    state: "idle" | "move" | "attack" | "dash" | "respawning";
    respawnLeft: number; attackCd: number; abilityCd: number; dashLeft: number; dashDx: number; dashDy: number;
    path: number[] | null; pathIdx: number; navGoal: number; stuckTicks: number; lastX: number; lastY: number;
    wantD: number;   // distance walkToward still wanted this tick (0 = content)
    // Duel-stalemate breaker ("never take even trades forever"): who I'm
    // dueling, for how long, their HP when the timer started, and a per-foe
    // truce that makes nearestEnemy ignore them while it runs.
    duelId: string | null; duelTicks: number; duelFoeHp: number; duelTruce: number;
    // Gank orders (assassins): prey id, the bush to lurk in, time left on the
    // order, and a cooldown between hunts.
    huntPrey: string | null; huntX: number; huntY: number; huntTicks: number; huntCd: number;
    ultCd: number;   // internal cooldown after each cast — ults stay MOMENTS
    elemCd: number;  // element-signature cooldown (every pet's main-game element is a MOVE)
    slowLeft: number; rootLeft: number;   // crowd control from element signatures
    assists: number; focusCd: number; streak: number;   // kill streak → shutdown bounty
    hitLog: Array<{ id: string; t: number }>;   // recent damagers — assists + focus-fire
    stacks: Record<WfPowerupKind, number>; coinsEarned: number;
    xp: number; wlevel: number; ult: number; kills: number; dmgDealt: number;
    shieldHp: number; markLeft: number;
    retreating: boolean;
}
interface WfStatue { x: number; y: number; hp: number; alive: boolean; attackCd: number }
interface WfGuardian {
    x: number; y: number; hp: number; maxHp: number; alive: boolean;
    attackCd: number; faceX: number; shotCount: number;
    rallyLeft: number; rallyPulse: number;
}
const GUARD_HP = 2200;
const GUARD_DMG_PET = 120;
const GUARD_DMG_MOB = 160;
const GUARD_RANGE = 5.5;
const GUARD_CD = Math.round(WARFRONT_TPS * 1.1);
const GUARD_ATTACK_ANIM_TICKS = Math.round(WARFRONT_TPS * 0.32);
const GUARD_RALLY_RANGE = 8;
const GUARD_RALLY_CD = Math.round(WARFRONT_TPS * 0.65);
const GUARD_RALLY_DURATION = WARFRONT_TPS * 16;
const GUARD_RALLY_WARD_EVERY = WARFRONT_TPS * 4;
// The rally is a magical lane relay, not a melee aura: each surviving post can
// project a ward all the way up its own lane behind the captured Warden's push.
const GUARD_RALLY_WARD_RANGE = 50;
export const WF_COIN_GUARD = 250;
interface WfCore { x: number; y: number; hp: number; alive: boolean; sinceHit: number }
interface WfMob { id: number; side: Team | "hollow"; elite: boolean; lane: WfLaneId; x: number; y: number; hp: number; maxHp: number; toward: Team; route: Array<[number, number]>; wpIdx: number; attackCd: number; chaseId: string | null }
interface WfBoss { alive: boolean; dead: boolean; hp: number; x: number; y: number; faceX: number; swipeCd: number; slamIn: number; windUp: number; targetId: string | null; phase: 1 | 2 | 3; calmTicks: number }
interface WfMini {
    padIdx: number; alive: boolean; hp: number; spawnIn: number;
    x: number; y: number; homeX: number; homeY: number; faceX: number;
    attackCd: number; sigCd: number; sigWind: number; sigActive: number; boonCd: number;
    ally: Team | null; allyLeft: number; targetId: string | null;
    path: number[] | null; pathIdx: number; navGoal: number;
}

// ── Snapshots + events (the renderer contract) ───────────────────────────────
export interface WfActorSnap {
    id: string; team: Team; slot: number; role: ArenaRole; element?: string | null;
    x: number; y: number; faceX: number; faceY: number; hp: number; maxHp: number;
    state: WfPet["state"]; respawnSecs: number; stacksTotal: number; wlevel: number; carrying: false; statuses: string[];
    shielded: boolean;
    intent: string;
}
export interface WfStructSnap { statues: Array<{ x: number; y: number; hp: number; maxHp: number; alive: boolean }>; core: { x: number; y: number; hp: number; maxHp: number; alive: boolean; exposed: boolean } }
export interface WfSnapshot {
    t: number;
    actors: WfActorSnap[];
    mobs: Array<{ id: number; side: Team | "hollow"; elite: boolean; x: number; y: number; hp: number; maxHp: number; toward: Team; attackPhase: number }>;
    guardians: Record<Team, Array<{
        x: number; y: number; hp: number; maxHp: number; alive: boolean; faceX: number;
        rallySecs: number; attackPhase: number;
    }>>;
    wardenBuff: { team: Team | null; secs: number };
    warden: {
        alive: boolean; dead: boolean; hp: number; maxHp: number; x: number; y: number; faceX: number;
        winding: boolean; windupSecs: number; slamRadius: number; phase: 1 | 2 | 3; resetSecs: number; resetting: boolean;
        damage: Record<Team, number>;
    };
    minis: Array<{ padIdx: number; alive: boolean; hp: number; maxHp: number; spawnSecs: number; allySecs: number; x: number; y: number; faceX: number; ally: Team | null; attackPhase: number }>;
    structures: Record<Team, WfStructSnap>;
    coins: Record<Team, number>;
    atkBuff: Record<Team, number>;   // lesser-warden buff seconds remaining
    stances: Record<Team, WfStance>;
}
export type WfEvent =
    | { t: number; type: "hit"; targetId: string; actorId: string; dmg: number; crit: boolean; element?: string | null }
    | { t: number; type: "heal"; targetId: string; actorId: string; amount: number }
    | { t: number; type: "kill"; targetId: string; actorId: string; team: Team }
    | { t: number; type: "shutdown"; targetId: string; actorId: string; bounty: number; streak: number }
    | { t: number; type: "mobhit"; x: number; y: number; targetId: string }
    | { t: number; type: "mobstrike"; x: number; y: number; el: string }
    | { t: number; type: "ability"; petId: string; kind: "shield" | "dash" | "mark"; x: number; y: number; targetId?: string }
    | { t: number; type: "focus"; x: number; y: number; targetId: string }
    | { t: number; type: "bosssig"; padIdx: number; kind: "quake" | "quakeland" | "shell" | "blink" | "flame" | "roar"; x: number; y: number }
    | { t: number; type: "wardenshock"; x: number; y: number }
    | { t: number; type: "elemsig"; petId: string; el: string; name: string; px: number; py: number; x: number; y: number; targetId: string }
    | { t: number; type: "mobkill"; mobId: number; x: number; y: number; team: Team }
    | { t: number; type: "structhit"; team: Team; statue?: number; core?: boolean; x: number; y: number }
    | { t: number; type: "statuedown"; team: Team; statue: number; by: Team }
    | { t: number; type: "coreexposed"; team: Team }
    | { t: number; type: "coredown"; team: Team; by: Team }
    | { t: number; type: "minispawn"; padIdx: number }
    | { t: number; type: "minikill"; padIdx: number; team: Team }
    | { t: number; type: "wardenhit"; actorId: string }
    | { t: number; type: "gank"; actorId: string; targetId: string; x: number; y: number }
    | { t: number; type: "stance"; team: Team; stance: WfStance; answer: boolean }
    | { t: number; type: "wardenslam"; x: number; y: number }
    | { t: number; type: "wardenwindup"; x: number; y: number }
    | { t: number; type: "wardenphase"; phase: 2 | 3; x: number; y: number }
    | { t: number; type: "wardenkill"; team: Team; stolen?: boolean }
    | { t: number; type: "miniboon"; padIdx: number; team: Team; kind: "shield" | "heal" | "hunt" | "siege"; x: number; y: number }
    | { t: number; type: "mobwave" }
    | { t: number; type: "buy"; team: Team; petId: string; kind: WfPowerupKind; cost: number }
    | { t: number; type: "council"; team: Team; buys: number; spent: number; shieldPct: number; ult: number; stance: WfStance }
    | { t: number; type: "guardianrally"; team: Team; padIdx: number; secs: number }
    | { t: number; type: "guardianward"; team: Team; idx: number; targetId: string; amount: number; x: number; y: number }
    | { t: number; type: "petlevel"; petId: string; level: number }
    | { t: number; type: "guardiandown"; team: Team; idx: number; by: Team }
    | { t: number; type: "ultimate"; petId: string; kind: string; x: number; y: number }
    | { t: number; type: "phase"; name: string }
    | { t: number; type: "round"; round: number };

/** Live win-condition score — the SAME formula the 10:00 timer verdict uses:
 * one point per enemy statue broken plus one for their destroyed core, coins as
 * the tiebreak. Exported so the HUD score strip and the verdict screen can
 * never disagree with the sim about who is winning. */
export function wfVerdictScore(s: WfSnapshot): Record<Team, number> {
    const downed = (tm: Team) => s.structures[tm].statues.filter((x) => !x.alive).length + (s.structures[tm].core.alive ? 0 : 1);
    return { blue: downed("red"), red: downed("blue") };
}

export interface WarfrontResult {
    winner: Team | "draw" | null;      // null while the match is still running
    ticks: number;
    petStats?: Array<{ id: string; name: string; team: Team; level: number; kills: number; assists: number; dmg: number; coins: number }>;
    snapshots: WfSnapshot[];
    events: WfEvent[];
    theme?: string;
    coins: Record<Team, number>;
}
export interface WarfrontChoice { petIndex: number; kind: WfPowerupKind }

// ── Match construction ───────────────────────────────────────────────────────
function makePet(slot: ArenaSlot, team: Team, i: number): WfPet {
    const cfg = ROLE_CFG[slot.role];
    const p = slot.pet;
    const hp = Math.max(200, (p.hp ?? 400)) * cfg.hpMul * TTK_HP_MUL;
    const atk = Math.max(10, (p.attack ?? 40)) * cfg.dmgMul;
    const def = Math.max(5, (p.defense ?? 20)) * cfg.defMul;
    const spd = PET_BASE_SPEED * cfg.spdMul * clamp(0.85 + ((p.speed ?? 40) / 200), 0.85, 1.35);
    const [sx, sy] = WF_SPAWNS[team][i % WF_SPAWNS[team].length];
    return {
        id: `${team}-${i}`, team, slot: i, role: slot.role, pet: p, element: p.element,
        x: sx, y: sy, faceX: team === "blue" ? 1 : -1, faceY: 0,
        hp, maxHp: hp, baseMaxHp: hp, atk, baseAtk: atk, def, baseDef: def,
        moveSpeed: spd, baseSpeed: spd, regen: 0, atkRange: cfg.atkRange, crit: cfg.crit, neutral: cfg.neutral,
        state: "idle", respawnLeft: 0, attackCd: 0, abilityCd: 0, dashLeft: 0, dashDx: 0, dashDy: 0,
        path: null, pathIdx: 0, navGoal: -1, stuckTicks: 0, lastX: sx, lastY: sy, wantD: 0,
        duelId: null, duelTicks: 0, duelFoeHp: 0, duelTruce: 0,
        huntPrey: null, huntX: 0, huntY: 0, huntTicks: 0, huntCd: 0,
        elemCd: WARFRONT_TPS * 10, slowLeft: 0, rootLeft: 0, assists: 0, focusCd: 0, streak: 0, hitLog: [],
        stacks: { strike: 0, guard: 0, vitality: 0, swift: 0, mend: 0 }, coinsEarned: 0,
        xp: 0, wlevel: 1, ult: 0, ultCd: 0, kills: 0, dmgDealt: 0,
        shieldHp: 0, markLeft: 0, retreating: false,
    };
}

interface WfState {
    t: number;
    rng: () => number;
    pets: WfPet[];
    statues: Record<Team, [WfStatue, WfStatue]>;
    guardians: Record<Team, WfGuardian[]>;
    wardenBuff: { team: Team | null; left: number };
    rally: Record<Team, number>;   // LAST STAND ticks while a team's Ward Seal is exposed
    cores: Record<Team, WfCore>;
    boss: WfBoss;
    minis: WfMini[];
    mobs: WfMob[];
    mobSeq: number; mobTimer: number; mobFlip: boolean; waveTimer: number;
    coins: Record<Team, number>; coinFrac: number;
    atkBuff: Record<Team, number>;
    wardenDmg: Record<Team, number>;   // damage attribution — detects a STEAL
    stance: Record<Team, WfStance>;
    doctrine: Record<Team, WfDoctrine>;
    eliteWaveOwed: Record<Team, boolean>;   // Rift Devourer trophy — next wave marches elite
    calls: Record<Team, {
        squad: WfCall | null;
        groups: [WfCall, WfCall, WfCall];
        assignment: [number, number, number, number];
        until: number;
        rally?: { x: number; y: number };
        committed?: boolean;
        rallySince?: number;
    }>;
    winner: Team | "draw" | null;
    events: WfEvent[];
    snapshots: WfSnapshot[];
    stacksBought: Record<Team, number[][]>;   // [petSlot][kindIdx] — price escalation
}

function initState(blue: ArenaSlot[], red: ArenaSlot[], seed: number): WfState {
    const pets = [
        ...blue.slice(0, 4).map((s, i) => makePet(s, "blue", i)),
        ...red.slice(0, 4).map((s, i) => makePet(s, "red", i)),
    ];
    const statues: WfState["statues"] = {
        blue: [
            { x: WF_STATUES.blue[0][0], y: WF_STATUES.blue[0][1], hp: STATUE_HP, alive: true, attackCd: 0 },
            { x: WF_STATUES.blue[1][0], y: WF_STATUES.blue[1][1], hp: STATUE_HP, alive: true, attackCd: 0 },
        ],
        red: [
            { x: WF_STATUES.red[0][0], y: WF_STATUES.red[0][1], hp: STATUE_HP, alive: true, attackCd: 0 },
            { x: WF_STATUES.red[1][0], y: WF_STATUES.red[1][1], hp: STATUE_HP, alive: true, attackCd: 0 },
        ],
    };
    return {
        t: 0, rng: makeRng(seed), pets,
        statues,
        guardians: {
            blue: WF_GUARD_POSTS.blue.map(([gx, gy]) => ({
                x: gx, y: gy, hp: GUARD_HP, maxHp: GUARD_HP, alive: true,
                attackCd: 0, faceX: 1, shotCount: 0, rallyLeft: 0, rallyPulse: 0,
            })),
            red: WF_GUARD_POSTS.red.map(([gx, gy]) => ({
                x: gx, y: gy, hp: GUARD_HP, maxHp: GUARD_HP, alive: true,
                attackCd: 0, faceX: -1, shotCount: 0, rallyLeft: 0, rallyPulse: 0,
            })),
        },
        wardenBuff: { team: null, left: 0 },
        rally: { blue: 0, red: 0 },
        cores: {
            blue: { x: WF_CORE.blue[0], y: WF_CORE.blue[1], hp: CORE_HP, alive: true, sinceHit: 9999 },
            red: { x: WF_CORE.red[0], y: WF_CORE.red[1], hp: CORE_HP, alive: true, sinceHit: 9999 },
        },
        boss: { alive: true, dead: false, hp: WARDEN_HP, x: WF_LAIR.x, y: WF_LAIR.y, faceX: 1, swipeCd: 0, slamIn: WARDEN_SLAM_EVERY, windUp: 0, targetId: null, phase: 1, calmTicks: 0 },
        minis: WF_PADS.map((pad, i) => ({
            padIdx: i, alive: false, hp: MINI_HP, spawnIn: MINI_FIRST_SPAWN, x: pad[0], y: pad[1], homeX: pad[0], homeY: pad[1], faceX: i < 2 ? 1 : -1, attackCd: 0, sigCd: WARFRONT_TPS * 5, sigWind: 0, sigActive: 0, boonCd: WARFRONT_TPS * (2 + i), ally: null, allyLeft: 0, targetId: null, path: null, pathIdx: 0, navGoal: -1,
        })) as unknown as WfState["minis"],
        mobs: [], mobSeq: 0, mobTimer: WARFRONT_TPS * 10, mobFlip: false, waveTimer: WARFRONT_TPS * 8,
        coins: { blue: 150, red: 150 }, coinFrac: 0,
        atkBuff: { blue: 0, red: 0 },
        wardenDmg: { blue: 0, red: 0 },
        stance: { blue: "balanced", red: "balanced" },
        doctrine: { blue: "none", red: "none" },
        eliteWaveOwed: { blue: false, red: false },
        calls: {
            blue: { squad: null, groups: [{ goal: "farm", x: -20, y: -17 }, { goal: "farm", x: -15, y: 0 }, { goal: "farm", x: -20, y: 17 }], assignment: [0, 1, 2, 1], until: 0 },
            red: { squad: null, groups: [{ goal: "farm", x: 20, y: -17 }, { goal: "farm", x: 15, y: 0 }, { goal: "farm", x: 20, y: 17 }], assignment: [0, 1, 2, 1], until: 0 },
        },
        winner: null, events: [], snapshots: [],
        stacksBought: { blue: [0, 1, 2, 3].map(() => [0, 0, 0, 0, 0]), red: [0, 1, 2, 3].map(() => [0, 0, 0, 0, 0]) },
    };
}

// ── Damage ───────────────────────────────────────────────────────────────────
// How many of a team's own Guardian Totems have fallen (0-2). A team is
// BEHIND when more of ITS gates are down than the enemy's — the comeback
// rubber-band pays that team extra so a lead is never a foregone conclusion.
function gatesLost(st: WfState, team: Team): number {
    return (st.statues[team][0].alive ? 0 : 1) + (st.statues[team][1].alive ? 0 : 1);
}

function petDamage(st: WfState, src: WfPet, tgt: WfPet, raw: number, crit: boolean) {
    let dmg = raw * (crit ? 1.8 : 1) * elementMult(src.element, tgt.element) * (tgt.markLeft > 0 ? 1.2 : 1);
    if (st.atkBuff[src.team] > 0) dmg *= MINI_BUFF_ATK;
    if (st.wardenBuff.team === src.team && st.wardenBuff.left > 0) dmg *= 1.15;   // Gate's Wrath
    if (st.rally[src.team] > 0) dmg *= 1.2;   // LAST STAND — a Seal-exposed team hits back harder
    dmg *= 100 / (100 + tgt.def);
    // IRON TURTLE identity: a harder shell on home ground.
    if (st.stance[tgt.team] === "turtle" && (tgt.team === "blue" ? tgt.x < 0 : tgt.x > 0)) dmg *= 0.85;
    dmg = Math.round(dmg);
    if (tgt.shieldHp > 0) { const soak = Math.min(tgt.shieldHp, dmg); tgt.shieldHp -= soak; dmg -= soak; }
    tgt.hp = Math.max(0, tgt.hp - dmg);
    src.dmgDealt += dmg;
    // Recent-damager log → assists + the visible FOCUS FIRE cue on marks.
    tgt.hitLog.push({ id: src.id, t: st.t });
    while (tgt.hitLog.length > 8 || (tgt.hitLog.length && tgt.hitLog[0].t < st.t - WARFRONT_TPS * 5)) tgt.hitLog.shift();
    if (tgt.markLeft > 0 && st.t >= tgt.focusCd
        && tgt.hitLog.some((h) => h.id !== src.id && h.t > st.t - WARFRONT_TPS && st.pets.some((q) => q.id === h.id && q.team === src.team))) {
        tgt.focusCd = st.t + WARFRONT_TPS * 3;
        st.events.push({ t: st.t, type: "focus", x: quant(tgt.x), y: quant(tgt.y), targetId: tgt.id });
    }
    // Ult charge is deliberately SLOW (an ult is a broadcast moment, not
    // wallpaper — at the old rates everyone ulted in the first lane trade).
    src.ult = Math.min(100, src.ult + 2);
    tgt.ult = Math.min(100, tgt.ult + 1);
    st.events.push({ t: st.t, type: "hit", targetId: tgt.id, actorId: src.id, dmg, crit, element: src.element });
    if (tgt.hp <= 0 && tgt.state !== "respawning") {
        tgt.state = "respawning";
        tgt.respawnLeft = RESPAWN_BASE + Math.floor(st.t / (WARFRONT_TPS * 60)) * RESPAWN_PER_MIN;
        // SHUTDOWN BOUNTY: a fed enemy (high streak) pays out big when killed,
        // so the trailing team can cash in on the snowballing carry. COMEBACK
        // RUBBER-BAND: the team behind on gates earns more per kill.
        const shutdown = Math.min(tgt.streak, SHUTDOWN_CAP) * SHUTDOWN_PER_STREAK;
        const behind = gatesLost(st, src.team) > gatesLost(st, other(src.team));
        const cm = behind ? COMEBACK_MULT : 1;
        const bounty = Math.round((WF_COIN_PET_KILL + shutdown) * cm);
        st.coins[src.team] += bounty;
        src.coinsEarned += bounty;
        grantXp(st, src, Math.round(150 * cm));
        src.kills++;
        src.streak++;
        if (tgt.streak >= 3) st.events.push({ t: st.t, type: "shutdown", targetId: tgt.id, actorId: src.id, bounty, streak: tgt.streak });
        tgt.streak = 0;
        // Assists: every teammate who drew blood in the last 5 s shares credit.
        for (const h of tgt.hitLog) {
            if (h.id === src.id || h.t < st.t - WARFRONT_TPS * 5) continue;
            const helper = st.pets.find((q) => q.id === h.id && q.team === src.team);
            if (helper) helper.assists++;
        }
        tgt.hitLog = [];
        st.events.push({ t: st.t, type: "kill", targetId: tgt.id, actorId: src.id, team: src.team });
    }
}

// ── ULTIMATES — the pet's kit crescendos at 100 charge (built from damage
// dealt/taken) into a role-flavored signature: Bulwark Aegis (defender team
// shield), Piercing Volley (tracker multi-shot), Shadow Execution (assassin
// blink-strike on the squishiest), Sanctuary (sage mass mend + cleanse). ────
const ULT_NAME: Record<ArenaRole, string> = {
    defender: "Bulwark Aegis", tracker: "Piercing Volley", assassin: "Shadow Execution", sage: "Sanctuary",
};
function tryUltimate(st: WfState, p: WfPet): boolean {
    // Ults unlock with the Skirmish phase (the laning opening stays honest)
    // and re-arm slowly — an ultimate is a broadcast MOMENT, 3-4 per pet a
    // match, never wallpaper.
    if (st.t < WARFRONT_TPS * WF_PHASE_SKIRMISH) return false;
    if (p.ult < 100 || p.ultCd > 0) return false;
    const foes = st.pets.filter((q) => q.team !== p.team && q.state !== "respawning");
    if (p.role === "defender") {
        const allies = st.pets.filter((q) => q.team === p.team && q.state !== "respawning" && hyp2(q.x - p.x, q.y - p.y) < 4.5);
        if (!foes.some((q) => hyp2(q.x - p.x, q.y - p.y) < 7)) return false;
        for (const a of allies) a.shieldHp = Math.max(a.shieldHp, Math.round(a.maxHp * 0.2));
    } else if (p.role === "tracker") {
        const inRange = foes.filter((q) => hyp2(q.x - p.x, q.y - p.y) < 5.5).slice(0, 3);
        if (!inRange.length) return false;
        for (const q of inRange) petDamage(st, p, q, p.atk * 1.6, false);
    } else if (p.role === "assassin") {
        let mark: WfPet | null = null, worst = Infinity;
        for (const q of foes) {
            const d = hyp2(q.x - p.x, q.y - p.y);
            if (d < 6.5 && q.hp < worst) { worst = q.hp; mark = q; }
        }
        if (!mark) return false;
        // Blink to the target's flank, then a huge crit strike.
        const [nc, nr] = cellOf(mark.x + 0.8, mark.y);
        if (petCellWalkable(nc, nr)) { p.x = mark.x + 0.8; p.y = mark.y; }
        petDamage(st, p, mark, p.atk * 2.5, true);
    } else {
        const hurt = st.pets.filter((q) => q.team === p.team && q.state !== "respawning" && q.hp < q.maxHp && hyp2(q.x - p.x, q.y - p.y) < 5.5);
        if (hurt.length < 2) return false;
        for (const a of hurt) {
            const amount = Math.round(a.maxHp * 0.18);
            a.hp = Math.min(a.maxHp, a.hp + amount);
            a.markLeft = 0;
            st.events.push({ t: st.t, type: "heal", targetId: a.id, actorId: p.id, amount });
        }
    }
    p.ult = 0;
    p.ultCd = WARFRONT_TPS * 35;
    st.events.push({ t: st.t, type: "ultimate", petId: p.id, kind: ULT_NAME[p.role], x: quant(p.x), y: quant(p.y) });
    return true;
}

// ── Unite-style leveling: farm and fights grant XP; levels are real spikes ───
const WF_LEVEL_XP = [350, 900] as const;       // L2, L3 thresholds
const WF_LEVEL_MULT = 1.09;                     // per level: atk/def/maxHp
function grantXp(st: WfState, p: WfPet, amount: number) {
    if (p.wlevel >= WF_LEVEL_XP.length + 1) { p.xp += amount; return; }
    p.xp += amount;
    while (p.wlevel < WF_LEVEL_XP.length + 1 && p.xp >= WF_LEVEL_XP[p.wlevel - 1]) {
        p.wlevel++;
        const prevMax = p.maxHp;
        p.baseAtk *= WF_LEVEL_MULT; p.atk *= WF_LEVEL_MULT;
        p.baseDef *= WF_LEVEL_MULT; p.def *= WF_LEVEL_MULT;
        p.baseMaxHp *= WF_LEVEL_MULT; p.maxHp *= WF_LEVEL_MULT;
        p.hp = Math.min(p.maxHp, p.hp + (p.maxHp - prevMax));
        st.events.push({ t: st.t, type: "petlevel", petId: p.id, level: p.wlevel });
    }
}

// ── Team macro AI — lane groups + squad objectives (LoL-shaped) ──────────────
// Defender+sage push/hold the NORTH lane; tracker+assassin run SOUTH. The whole
// squad converges only for real objectives: emergency core defence, punishing an
// enemy Warden commit, a committed Warden take, or contesting a Lesser Warden.
// This is what keeps eight pets from stacking into one blob at mid.
interface WfCall { goal: string; x: number; y: number }
const GROUP_OF_SLOT = [0, 1, 2, 1] as const;   // defender→top, tracker+sage→mid, assassin→bottom
const GROUP_LANE: readonly WfLaneId[] = ["n", "m", "s"];

/** Where a grouped squad should siege: the weaker standing gate — but its
 * warding SENTINEL first while it stands (totems take half damage warded, so
 * grinding the gate through the ward is throwing; sudden death skips this). */
function squadSiegeTarget(st: WfState, foe: Team): { x: number; y: number } {
    const fs = st.statues[foe];
    if (!fs[0].alive && !fs[1].alive) return st.cores[foe];
    const idx = !fs[0].alive ? 1 : !fs[1].alive ? 0 : fs[0].hp <= fs[1].hp ? 0 : 1;
    const gg = st.guardians[foe][idx];
    if (gg.alive && st.t <= WARFRONT_TPS * WF_PHASE_SUDDEN) return gg;
    return fs[idx];
}

const ROLE_LANE_FIT: Record<ArenaRole, readonly [number, number, number]> = {
    defender: [5.5, 1.5, 5.5],
    tracker: [2.5, 5.0, 2.5],
    assassin: [5.0, 1.0, 5.0],
    sage: [2.5, 5.5, 2.5],
};

/**
 * Assign the four pets to the three live lane goals as a TEAM. Blizzard's
 * published Heroes AI model scores every map goal and assigns the most suitable
 * hero; this is the deterministic Warfront version. Every lane keeps coverage,
 * the highest-pressure lane receives the extra body, role fit matters, and a
 * small previous-assignment bonus prevents two-second lane ping-pong.
 */
function assignLaneGroups(st: WfState, team: Team, groups: [WfCall, WfCall, WfCall]): [number, number, number, number] {
    const pets = st.pets.filter((p) => p.team === team).sort((a, b) => a.slot - b.slot);
    const previous = st.calls[team]?.assignment ?? [...GROUP_OF_SLOT];
    const urgency = groups.map((call, group) => {
        let score = call.goal.startsWith("defend") ? 12
            : call.goal.startsWith("mini-") ? 10
                : call.goal === "farm" ? 4
                    : call.goal.startsWith("push") ? 3 : 2;
        const lane = GROUP_LANE[group];
        for (const mob of st.mobs) {
            if (mob.side === team || mob.lane !== lane) continue;
            const defensive = team === "blue" ? mob.x < 0 : mob.x > 0;
            if (defensive) score += 1.25;
        }
        for (const foe of st.pets) {
            if (foe.team === team || foe.state === "respawning") continue;
            if (hyp2(foe.x - call.x, foe.y - call.y) < 7) score += 1.6;
        }
        return score;
    });
    let best: [number, number, number, number] = [...GROUP_OF_SLOT];
    let bestScore = -Infinity;
    // 3^4 is only 81 candidates. Stable ascending enumeration is the tie-break,
    // so the planner is byte-identical across browsers and the server replay.
    for (let code = 0; code < 81; code++) {
        let n = code;
        const pick = [0, 0, 0, 0] as [number, number, number, number];
        const counts = [0, 0, 0];
        for (let slot = 0; slot < 4; slot++) {
            pick[slot] = n % 3;
            counts[pick[slot]]++;
            n = Math.floor(n / 3);
        }
        if (counts.some((count) => count < 1 || count > 2)) continue;
        let score = 0;
        for (const pet of pets) {
            const group = pick[pet.slot];
            const call = groups[group];
            score += ROLE_LANE_FIT[pet.role][group];
            score += urgency[group] * (counts[group] === 2 ? 0.62 : 0.42);
            score -= hyp2(pet.x - call.x, pet.y - call.y) * 0.08;
            if (previous[pet.slot] === group) score += 1.35;
        }
        // Complementary pairings read like an intentional lane duo.
        for (let group = 0; group < 3; group++) {
            const roles = pets.filter((pet) => pick[pet.slot] === group).map((pet) => pet.role);
            if (roles.includes("defender") && roles.includes("sage")) score += 2.8;
            if (roles.includes("tracker") && roles.includes("assassin")) score += 2.2;
        }
        if (score > bestScore) { bestScore = score; best = pick; }
    }
    return best;
}

function updateCall(st: WfState, team: Team) {
    const cfg = STANCE_CFG[st.stance[team]];
    const foe = other(team);
    const alive = st.pets.filter((p) => p.team === team && p.state !== "respawning");
    const healthyShare = st.pets.filter((p) => p.team === team)
        .reduce((a, p) => a + (p.state === "respawning" ? 0 : p.hp / p.maxHp), 0) / 4;
    let squad: WfCall | null = null;
    // 1) Emergency defence of an exposed core under threat.
    const coreT = st.cores[team];
    if (coreT.alive && !st.statues[team][0].alive && !st.statues[team][1].alive) {
        const threat = st.pets.some((p) => p.team === foe && p.state !== "respawning" && hyp2(p.x - coreT.x, p.y - coreT.y) < 9)
            || st.mobs.some((m) => m.toward === team && hyp2(m.x - coreT.x, m.y - coreT.y) < 9);
        if (threat) squad = { goal: "defend-core", x: coreT.x, y: coreT.y };
    }
    // Once a lane group has meaningfully damaged a nearby camp, finish that
    // rotation before answering ordinary map pressure. Previously a two-second
    // macro refresh could abandon a 70%-health Lesser Warden for a routine push,
    // making the squad look indecisive and erasing the camp layer in some seeds.
    // Emergency core defence and a genuine low-health Warden steal still win.
    const finishingCamp = st.minis.some((camp) => camp.alive && !camp.ally && camp.hp < MINI_HP * 0.95
        && alive.some((pet) => hyp2(pet.x - camp.x, pet.y - camp.y) < 8));
    // 2) Read an enemy Warden commit. A healthy squad contests a boss already
    // below the steal threshold; otherwise it punishes the missing defenders by
    // cracking a lane. This creates deliberate steals instead of blind trades.
    if (!squad) {
        const foesAtWarden = st.pets.filter((p) => p.team === foe && p.state !== "respawning"
            && hyp2(p.x - WF_LAIR.x, p.y - WF_LAIR.y) < WF_LAIR.r + 1.5).length;
        if (st.boss.alive && foesAtWarden >= 2 && alive.length >= 3 && st.t > WARFRONT_TPS * WF_PHASE_SKIRMISH) {
            if (st.boss.hp / WARDEN_HP <= 0.58 && healthyShare > 0.56) {
                squad = { goal: "warden", x: WF_LAIR.x, y: WF_LAIR.y };
            } else if (!finishingCamp) {
                const target = squadSiegeTarget(st, foe);
                squad = { goal: "push-squad", x: target.x, y: target.y };
            }
        }
    }
    // A critically wounded Warden is the highest-value finish/steal on the
    // field. Minor lane pressure must not make both coaches abandon a boss at
    // single-digit health; two survivors are enough to force the conclusion.
    if (!squad && st.boss.alive && st.boss.hp / WARDEN_HP <= 0.32
        && alive.length >= 2 && st.t > WARFRONT_TPS * WF_PHASE_SKIRMISH) {
        squad = { goal: "warden", x: WF_LAIR.x, y: WF_LAIR.y };
    }
    // 3) SNOWBALL: two or more enemies down → the squad groups and cracks the
    // weakest gate NOW (numbers advantages must be spent — the pro-play rule).
    if (!squad && !finishingCamp) {
        const foeDown = st.pets.filter((pp) => pp.team === foe && pp.state === "respawning").length;
        if (foeDown >= cfg.snowballAt && alive.length >= 3 && st.t > WARFRONT_TPS * WF_PHASE_SKIRMISH) {
            const target = squadSiegeTarget(st, foe);
            squad = { goal: "push-squad", x: target.x, y: target.y };
        }
    }
    // 4) A healthy team can force the headline objective during Skirmish instead
    // of waiting until minute four. The stance-specific health gate still keeps
    // reckless teams from donating a wipe.
    const headlineReady = st.events.some((event) => event.type === "minikill") || st.t > WARFRONT_TPS * WF_PHASE_WAR;
    if (!squad && headlineReady && !finishingCamp && st.boss.alive
        && st.t > WARFRONT_TPS * (WF_PHASE_SKIRMISH + 55)
        && healthyShare > cfg.wardenShare && alive.length >= 3) {
        squad = { goal: "warden", x: WF_LAIR.x, y: WF_LAIR.y };
    }
    // 5) DEATHBALL: in sudden death the game must end as five — group and push,
    // injured or not (the health gate was letting even teams scatter into a
    // timer verdict). Whoever's ahead ends it; whoever's behind dies trying.
    if (!squad && st.t > WARFRONT_TPS * WF_PHASE_SUDDEN && alive.length >= 3) {
        const target = squadSiegeTarget(st, foe);
        squad = { goal: "push-squad", x: target.x, y: target.y };
    }

    // Per-lane group calls: defend own statue > clear approaching lane mobs >
    // siege the lane statue > converge on the last statue > break the core.
    const groups = [0, 1, 2].map((g) => {
        const lane = GROUP_LANE[g];
        // Which base gate this lane feeds: top+mid → north gate, bottom → south.
        const sIdx = lane === "s" ? 1 : 0;
        const own = st.statues[team][sIdx];
        if (own.alive) {
            const threat = st.pets.some((p) => p.team === foe && p.state !== "respawning" && hyp2(p.x - own.x, p.y - own.y) < 6)
                || st.mobs.some((m) => m.toward === team && m.lane === lane && hyp2(m.x - own.x, m.y - own.y) < 6);
            if (threat) return { goal: `defend-${sIdx}`, x: own.x, y: own.y };
        }
        // Finish a camp the team has committed resources to. Dropping an
        // objective at single-digit health because a stance timer rolled over
        // is strategically irrational and reads as broken AI.
        const woundedCamp = st.minis.find((mm) =>
            mm.alive
            && !mm.ally
            && mm.hp < MINI_HP * 0.95
            && (lane === "m" ? true : lane === "n" ? mm.y < -1 : mm.y > 1)
        );
        if (woundedCamp) return { goal: `mini-${woundedCamp.padIdx}`, x: woundedCamp.x, y: woundedCamp.y };
        // JUNGLE REIGN takes its camp before it thinks about waves — trophies
        // ARE its wave-clear.
        if (cfg.camps === 2) {
            const pad0 = st.minis.find((mm) => mm.alive && !mm.ally && (lane === "m" ? true : lane === "n" ? mm.y < -1 : mm.y > 1));
            if (pad0) return { goal: `mini-${pad0.padIdx}`, x: pad0.x, y: pad0.y };
        }
        // Clear waves on OUR defensive side (Iron Turtle defends a wider zone;
        // Siege March skips farm calls entirely — structures over everything).
        if (!cfg.structFocus) {
            const approaching = st.mobs.find((m) => m.lane === lane && m.side !== team && (team === "blue" ? m.x < -WF_X * cfg.farmLine : m.x > WF_X * cfg.farmLine));
            if (approaching) return { goal: "farm", x: approaching.x, y: approaching.y };
        }
        // Camps by stance: Jungle Reign rotates MID onto them too; balanced
        // sends side lanes; siege/headhunt/turtle skip camps entirely.
        if (cfg.camps > 0 && (lane !== "m" || cfg.camps === 2)) {
            const pad = st.minis.find((mm) => mm.alive && !mm.ally && (lane === "m" ? true : lane === "n" ? mm.y < -1 : mm.y > 1));
            if (pad) return { goal: `mini-${pad.padIdx}`, x: pad.x, y: pad.y };
        }
        const fs = st.statues[foe];
        // Side lanes must break their SENTINEL before the gates.
        if (lane !== "m") {
            const gg = st.guardians[foe][lane === "n" ? 0 : 1];
            if (gg.alive) return { goal: `push-${lane === "n" ? 0 : 1}`, x: gg.x, y: gg.y };
        }
        // Mid pressures the weaker standing gate; side lanes push their own gate first.
        const prefer = lane === "m"
            ? (fs[0].alive && fs[1].alive ? (fs[0].hp <= fs[1].hp ? 0 : 1) : fs[0].alive ? 0 : 1)
            : sIdx;
        if (fs[prefer].alive) return { goal: `push-${prefer}`, x: fs[prefer].x, y: fs[prefer].y };
        const oIdx = 1 - prefer;
        if (fs[oIdx].alive) return { goal: `push-${oIdx}`, x: fs[oIdx].x, y: fs[oIdx].y };
        return { goal: "push-core", x: st.cores[foe].x, y: st.cores[foe].y };
    }) as [WfCall, WfCall, WfCall];
    const assignment = assignLaneGroups(st, team, groups);
    // RALLY-THEN-ENGAGE: a squad push gathers at a staging point short of the
    // target and only commits once three members actually stand together —
    // trickling in one at a time was how squads fed. Commitment is sticky for
    // the same target across the 2 s call refresh.
    let rally: { x: number; y: number } | undefined;
    let committed: boolean | undefined;
    let rallySince: number | undefined;
    if (squad && squad.goal === "push-squad") {
        const prev = st.calls[team];
        const own = st.cores[team];
        const ddx = own.x - squad.x, ddy = own.y - squad.y;
        const dd = hyp2(ddx, ddy) || 1;
        const [rc, rr] = nearestWalkableCell(squad.x + (ddx / dd) * 9.5, squad.y + (ddy / dd) * 9.5);
        const [rx, ry] = cellCenter(rc, rr);
        rally = { x: rx, y: ry };
        const sameTarget = prev.squad && hyp2(prev.squad.x - squad.x, prev.squad.y - squad.y) < 3;
        committed = sameTarget ? prev.committed : false;
        rallySince = sameTarget ? (prev.rallySince ?? st.t) : st.t;
    }
    st.calls[team] = { squad, groups, assignment, until: st.t + CALL_TICKS, rally, committed, rallySince };
}

// ── Pet micro (fight what's near, else walk the call) ────────────────────────
/** Role- and element-aware fight targeting. Distance anchors the score, then:
 * an element ADVANTAGE pulls a pet onto the matchup it beats (and a bad one
 * pushes it away), everyone finishes bloodied targets (natural focus fire on
 * whoever the team has damaged), trackers pile onto their own mark, and
 * assassins hunt the enemy BACKLINE (sages/trackers) instead of the frontline. */
function nearestEnemy(st: WfState, p: WfPet, maxD = 6.5): WfPet | null {
    let best: WfPet | null = null, bs = Infinity;
    for (const q of st.pets) {
        if (q.team === p.team || q.state === "respawning") continue;
        // Truce with a foe I could not crack (duel-stalemate breaker) — ignore
        // them and play the map instead, UNLESS they got bloodied since or
        // they are actually hurting me (my own HP sinking suspends the truce).
        if (p.duelTruce > 0 && q.id === p.duelId && q.hp / q.maxHp > 0.5 && p.hp / p.maxHp > 0.6) continue;
        const d = hyp2(q.x - p.x, q.y - p.y);
        if (d >= maxD + 0.5) continue;
        // BUSH stealth: an enemy inside cover is invisible from outside it
        // beyond point-blank range.
        if (d > 3.0 && wfInBush(q.x, q.y) && !wfInBush(p.x, p.y)) continue;
        let score = d;
        const adv = elementMult(p.element, q.element);
        if (adv > 1) score -= 2.2;            // hunt what you counter
        else if (adv < 1) score += 1.4;       // shy away from what counters you
        if (q.markLeft > 0) score -= 1.6;     // pile onto the tracker's mark
        if (q.hp / q.maxHp < 0.4) score -= 1.8;   // finish the bloodied
        if (p.role === "assassin" && (q.role === "sage" || q.role === "tracker")) score -= 2.6;
        if (p.role === "defender" && q.role === "assassin") score -= 1.2;  // peel the diver
        // Target hysteresis: keep a valid duel for a small scoring advantage.
        // Without it, two similarly-scored enemies trade places every tick and
        // the pet oscillates between headings instead of committing to combat.
        if (q.id === p.duelId) score -= 1.15;
        if (score < bs) { bs = score; best = q; }
    }
    if (!best) return null;
    return hyp2(best.x - p.x, best.y - p.y) < maxD ? best : null;
}
function nearestMob(st: WfState, p: WfPet): WfMob | null {
    let best: WfMob | null = null, bd = Infinity;
    for (const m of st.mobs) {
        if (m.side === p.team) continue;   // never farm your own minions
        const d = hyp2(m.x - p.x, m.y - p.y);
        if (d < bd) { bd = d; best = m; }
    }
    return bd < 5 ? best : null;
}
function combatApproachPoint(p: WfPet, target: WfPet): [number, number] {
    // Four teammates receive stable, target-relative attack slots instead of
    // all pathing to the target's exact center. This removes the visible dogpile
    // and the separation/pathfinding tug-of-war that made melee pets jitter.
    const baseSlot = (p.slot * 2 + target.slot) % 8;
    const slot = p.team === "blue" ? baseSlot : (4 - baseSlot + 8) % 8;
    const angle = (slot / 8) * TAU;
    const ring = p.role === "tracker" || p.role === "sage"
        ? Math.max(MELEE_REACH, Math.min(p.atkRange - 0.25, p.neutral))
        : MELEE_REACH - 0.08;
    return [target.x + dcos(angle) * ring, target.y + dsin(angle) * ring];
}
function walkToward(st: WfState, p: WfPet, gx: number, gy: number) {
    if (p.rootLeft > 0) return;   // STONE GRASP — held fast
    const [gc, gr] = nearestPetWalkableCell(gx, gy);
    const goal = gr * WF_COLS + gc;
    const oldGoalC = p.navGoal >= 0 ? p.navGoal % WF_COLS : -99;
    const oldGoalR = p.navGoal >= 0 ? Math.floor(p.navGoal / WF_COLS) : -99;
    const goalMovedFar = Math.max(Math.abs(gc - oldGoalC), Math.abs(gr - oldGoalR)) > 2;
    if (!p.path || p.pathIdx >= p.path.length || goalMovedFar || p.stuckTicks > WARFRONT_TPS * 0.5) {
        p.path = findPath(p.x, p.y, gx, gy, true);
        p.pathIdx = 0; p.navGoal = goal; p.stuckTicks = 0;
    }
    if (!p.path || !p.path.length) return;
    let [tx, ty] = cellCenter(p.path[p.pathIdx] % WF_COLS, Math.floor(p.path[p.pathIdx] / WF_COLS));
    let dx = tx - p.x, dy = ty - p.y;
    let d = hyp2(dx, dy);
    while (d < 0.22 && p.pathIdx < p.path.length - 1) {
        p.pathIdx++;
        [tx, ty] = cellCenter(p.path[p.pathIdx] % WF_COLS, Math.floor(p.path[p.pathIdx] / WF_COLS));
        dx = tx - p.x; dy = ty - p.y; d = hyp2(dx, dy);
    }
    if (d > 1e-6) {
        p.wantD = d;
        const step = Math.min(p.moveSpeed * (p.slowLeft > 0 ? 0.55 : 1), d);
        let ux = dx / d, uy = dy / d;
        // Sustained no NET progress (the end-of-tick watchdog counts it) →
        // shear the step sideways with a deterministic per-slot spin. Body
        // separation can cancel a straight step exactly (three pets held each
        // other in a 20 s group-hug at the base gate) but never a rotation —
        // jams unwind as a natural-looking shuffle.
        if (p.stuckTicks > WARFRONT_TPS * 0.2) {
            const rot = (p.slot % 2 === 0 ? 1 : -1) * 0.9;
            const cs = dcos(rot), sn = dsin(rot);
            const rx = ux * cs - uy * sn, ry = ux * sn + uy * cs;
            ux = rx; uy = ry;
        }
        // WALL-CHECKED stepping with corner sliding: a pet's position may never
        // enter terrain, no matter what shoved it off its path line.
        const sx = ux * step, sy = uy * step;
        const [fc, fr] = cellOf(p.x + sx, p.y + sy);
        if (petCellWalkable(fc, fr)) { p.x += sx; p.y += sy; }
        else {
            const [xc, xr] = cellOf(p.x + sx, p.y);
            if (petCellWalkable(xc, xr)) p.x += sx;
            else {
                const [yc, yr] = cellOf(p.x, p.y + sy);
                if (petCellWalkable(yc, yr)) p.y += sy;
            }
        }
        p.faceX = dx / d; p.faceY = dy / d;
        p.state = "move";
    }
}

/** Read the Gate Warden's ground tell and break out along a stable per-slot
 * escape lane. The tangent component prevents four pets from choosing the same
 * doorway, while footprint-safe pathing keeps the dodge out of pit walls. */
function dodgeWardenSlam(st: WfState, p: WfPet): boolean {
    const boss = st.boss;
    if (!boss.alive || boss.windUp <= 0) return false;
    const radius = WARDEN_SLAM_R + (boss.phase === 3 ? 0.6 : boss.phase === 2 ? 0.25 : 0);
    const dx = p.x - boss.x, dy = p.y - boss.y;
    const distance = hyp2(dx, dy);
    if (distance > radius + 0.85) return false;
    const fallbackAngle = ((p.slot * 2 + (p.team === "blue" ? 0 : 1)) / 8) * TAU;
    const ux = distance > 1e-6 ? dx / distance : dcos(fallbackAngle);
    const uy = distance > 1e-6 ? dy / distance : dsin(fallbackAngle);
    const side = (p.slot + (p.team === "blue" ? 0 : 1)) % 2 === 0 ? 1 : -1;
    const escape = radius + 1.35;
    walkToward(st, p, boss.x + ux * escape - uy * side, boss.y + uy * escape + ux * side);
    return true;
}

/** The lane sentinel WARDS its gate: a totem takes half damage while its
 * lane's sentinel still stands — sentinels become mandatory objectives instead
 * of skippable decoration. Sudden death lifts the warding (the game must end). */
function wardMul(st: WfState, owner: Team, statueIdx: number): number {
    if (st.t > WARFRONT_TPS * WF_PHASE_SUDDEN) return 1;
    return st.guardians[owner][statueIdx]?.alive ? 0.5 : 1;
}

// THE HOLLOW COLLAPSE: sudden death is not a flat switch but a CRESCENDO — from
// 8:00 the structure-damage multiplier ramps ×3 → ×7 over the final two minutes,
// so a stalemated base WILL fall and the last push is the loudest fight of the
// match, not a fade to a clock verdict. Half of even matches used to time out.
function suddenRamp(st: WfState): number {
    if (st.t <= WARFRONT_TPS * WF_PHASE_SUDDEN) return 1;
    const p2 = Math.min(1, (st.t / WARFRONT_TPS - WF_PHASE_SUDDEN) / (WF_MAX_SECONDS - WF_PHASE_SUDDEN));
    return 3 + 4 * p2;
}

// Siege pacing: pets crack structures WITH their wave (minion-backed hits bite
// much harder — the LoL rule), and sudden death sharpens every siege so
// matches end on the map, not on the clock.
function siegeMul(st: WfState, p: WfPet): number {
    let backed = 0;
    for (const m of st.mobs) {
        if (m.side === p.team && hyp2(m.x - p.x, m.y - p.y) < 4.5 && ++backed >= 2) break;
    }
    // SIEGE MARCH identity: their wave-backed blows bite even harder.
    let mul = backed >= 2 ? (st.stance[p.team] === "siege" ? 2.2 : 1.8) : 1;
    // GATE'S WRATH: the Warden's slayers hit structures ×1.5 — taking him is
    // how you open a base (the Baron rule).
    if (st.wardenBuff.team === p.team && st.wardenBuff.left > 0) mul *= 1.5;
    // Sudden death DECIDES the game — chip pressure alone was fading every
    // match into a timer verdict with half-HP statues; now it crescendos.
    mul *= suddenRamp(st);
    return mul;
}

/** The pet's ELEMENT as a signature move (~12 s): Fire nukes, Water slows in
 * an area, Earth roots, Wind hurls, Lightning chains. Every cast is a named,
 * colored moment on the broadcast. */
function castElement(st: WfState, p: WfPet, tgt: WfPet) {
    const el = p.element ?? "";
    let name = "SPIRIT BOLT";
    if (el === "Fire") { name = "FIREBOLT"; petDamage(st, p, tgt, p.atk * 1.5, false); }
    else if (el === "Water") {
        name = "TIDAL WAVE";
        for (const q of st.pets) {
            if (q.team === p.team || q.state === "respawning") continue;
            if (hyp2(q.x - tgt.x, q.y - tgt.y) <= 3.2) {
                petDamage(st, p, q, p.atk * 0.8, false);
                if (q.hp > 0) q.slowLeft = WARFRONT_TPS * 2;
            }
        }
    } else if (el === "Earth") {
        name = "STONE GRASP";
        petDamage(st, p, tgt, p.atk * 0.9, false);
        if (tgt.state !== "respawning") tgt.rootLeft = Math.round(WARFRONT_TPS * 0.9);
    } else if (el === "Wind") {
        name = "GALE SLAM";
        petDamage(st, p, tgt, p.atk * 0.8, false);
        if (tgt.state !== "respawning") {
            const dq = hyp2(tgt.x - p.x, tgt.y - p.y) || 1;
            const ux = (tgt.x - p.x) / dq, uy = (tgt.y - p.y) / dq;
            for (let s2 = 0; s2 < 3; s2++) {
                const [nc2, nr2] = cellOf(tgt.x + ux * 0.7, tgt.y + uy * 0.7);
                if (!petCellWalkable(nc2, nr2)) break;
                tgt.x += ux * 0.7; tgt.y += uy * 0.7;
            }
            tgt.path = null; tgt.navGoal = -1;
        }
    } else if (el === "Lightning") {
        name = "CHAIN ARC";
        petDamage(st, p, tgt, p.atk * 1.1, false);
        let n2: WfPet | null = null, nd = 4;
        for (const q of st.pets) {
            if (q.team === p.team || q === tgt || q.state === "respawning") continue;
            const dd = hyp2(q.x - tgt.x, q.y - tgt.y);
            if (dd < nd) { nd = dd; n2 = q; }
        }
        if (n2) petDamage(st, p, n2, p.atk * 0.75, false);
    } else petDamage(st, p, tgt, p.atk * 1.2, false);
    st.events.push({ t: st.t, type: "elemsig", petId: p.id, el, name, px: quant(p.x), py: quant(p.y), x: quant(tgt.x), y: quant(tgt.y), targetId: tgt.id });
}

function petTick(st: WfState, p: WfPet) {
    if (p.state === "respawning") {
        p.respawnLeft--;
        if (p.respawnLeft <= 0) {
            const [sx, sy] = WF_SPAWNS[p.team][p.slot % 4];
            p.x = sx; p.y = sy; p.hp = p.maxHp; p.state = "idle"; p.path = null; p.navGoal = -1; p.shieldHp = 0; p.markLeft = 0; p.streak = 0; p.retreating = false;
        }
        return;
    }
    if (p.attackCd > 0) p.attackCd--;
    if (p.abilityCd > 0) p.abilityCd--;
    if (st.t % WARFRONT_TPS === 0) grantXp(st, p, 2);   // passive drip
    if (p.markLeft > 0) p.markLeft--;
    if (p.duelTruce > 0) p.duelTruce--;
    if (p.ultCd > 0) p.ultCd--;
    if (p.elemCd > 0) p.elemCd--;
    if (p.slowLeft > 0) p.slowLeft--;
    if (p.rootLeft > 0) p.rootLeft--;
    if (p.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.regen);
    const [homeX, homeY] = WF_SPAWNS[p.team][p.slot % 4];
    const homeDistance = hyp2(p.x - homeX, p.y - homeY);
    const homeContested = st.pets.some((q) =>
        q.team !== p.team
        && q.state !== "respawning"
        && hyp2(q.x - homeX, q.y - homeY) <= FOUNTAIN_R + 1.5
    );
    if (homeDistance <= FOUNTAIN_R && !homeContested) {
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * FOUNTAIN_HEAL_PER_SEC / WARFRONT_TPS);
        if (p.retreating && p.hp / p.maxHp >= RETREAT_RECOVER_AT) p.retreating = false;
    }
    // Dash resolution (assassin gap-closer).
    if (p.dashLeft > 0) {
        p.dashLeft--;
        const nx = p.x + p.dashDx, ny = p.y + p.dashDy;
        const [nc, nr] = cellOf(nx, ny);
        if (petCellWalkable(nc, nr)) { p.x = nx; p.y = ny; }
        p.state = "dash";
        return;
    }
    p.state = "idle";

    // Kickoff owns four short, mirrored deployment corridors. This gets every
    // pet clear of the base mouth before ordinary target selection can make a
    // whole squad request the same first BFS cell.
    if (st.t <= KICKOFF_DEPLOY_TICKS) {
        const [deployX, deployY] = WF_DEPLOY_POINTS[p.team][p.slot % 4];
        if (hyp2(deployX - p.x, deployY - p.y) > 0.45) {
            walkToward(st, p, deployX, deployY);
            return;
        }
    }

    // Bloodied? Break contact and fall back toward the home gate line (unless
    // the enemy Ward Seal is exposed — then it is win-now time, stay on it).
    const foeCoreExposed = !st.statues[other(p.team)][0].alive && !st.statues[other(p.team)][1].alive;
    const winNow = foeCoreExposed && hyp2(p.x - st.cores[other(p.team)].x, p.y - st.cores[other(p.team)].y) < 8;
    if (!winNow && p.hp / p.maxHp < STANCE_CFG[st.stance[p.team]].disengageHp) p.retreating = true;
    if (winNow) p.retreating = false;
    if (p.retreating) {
        walkToward(st, p, homeX, homeY);
        return;
    }

    // Boss tells outrank ordinary combat. Good squads scatter before the ring
    // lands, then naturally resume their previous objective on the next tick.
    if (dodgeWardenSlam(st, p)) return;

    const callState = st.calls[p.team];
    const assignedGroup = callState.assignment[p.slot] ?? GROUP_OF_SLOT[p.slot];
    const call = callState.squad ?? callState.groups[assignedGroup];
    // Sudden-death squad pushes TUNNEL-VISION the base: only fight enemies
    // right on top of us — two deathballs endlessly teamfighting mid was
    // burning the whole final phase without a single siege.
    const engageR = st.t > WARFRONT_TPS * WF_PHASE_SUDDEN && call.goal === "push-squad" ? 3.2 : STANCE_CFG[st.stance[p.team]].engageR;

    // GANKS: from the Skirmish phase on, a healthy assassin picks an ISOLATED
    // enemy, slips to the bush nearest them, lurks, and springs the ambush —
    // the rotation-and-pick stories MOBAs run on. The order is dropped the
    // moment it stops making sense (prey healed home, we got hurt, timer).
    if (p.role === "assassin" && st.t > WARFRONT_TPS * WF_PHASE_SKIRMISH && !callState.squad) {
        if (p.huntCd > 0) p.huntCd--;
        if (!p.huntPrey && p.huntCd <= 0 && p.hp / p.maxHp > 0.6) {
            for (const q of st.pets) {
                if (q.team === p.team || q.state === "respawning") continue;
                const dq = hyp2(q.x - p.x, q.y - p.y);
                if (dq < 7 || dq > 20) continue;    // worth a rotation, not a trek
                const escorted = st.pets.some((al) => al.team === q.team && al !== q && al.state !== "respawning" && hyp2(al.x - q.x, al.y - q.y) < 8);
                if (escorted) continue;
                let bx = 0, by = 0, bd = Infinity;  // the bush nearest the prey
                for (const [ux, uy] of WF_BUSHES) {
                    const db = hyp2(ux - q.x, uy - q.y);
                    if (db < bd) { bd = db; bx = ux; by = uy; }
                }
                if (bd > 9) continue;               // no cover near them — no ambush
                p.huntPrey = q.id; p.huntX = bx; p.huntY = by; p.huntTicks = WARFRONT_TPS * 12;
                break;
            }
        }
        if (p.huntPrey) {
            const prey = st.pets.find((q) => q.id === p.huntPrey && q.state !== "respawning");
            p.huntTicks--;
            const dPrey = prey ? hyp2(prey.x - p.x, prey.y - p.y) : Infinity;
            if (!prey || p.huntTicks <= 0 || dPrey > 24 || p.hp / p.maxHp < 0.45) {
                p.huntPrey = null; p.huntCd = Math.round(WARFRONT_TPS * 30 * STANCE_CFG[st.stance[p.team]].huntCdMul);
            } else if (dPrey < 5.5 && wfInBush(p.x, p.y)) {
                // SPRING the trap — fall through and let the fight branch bite.
                st.events.push({ t: st.t, type: "gank", actorId: p.id, targetId: prey.id, x: quant(p.x), y: quant(p.y) });
                p.huntPrey = null; p.huntCd = Math.round(WARFRONT_TPS * 40 * STANCE_CFG[st.stance[p.team]].huntCdMul);
            } else {
                const dBush = hyp2(p.huntX - p.x, p.huntY - p.y);
                if (dBush > 0.8) { walkToward(st, p, p.huntX, p.huntY); return; }
                p.faceX = (prey.x - p.x) / (dPrey || 1); p.faceY = (prey.y - p.y) / (dPrey || 1);
                return;   // crouched in cover, watching the prey
            }
        }
    }

    let foePet = nearestEnemy(st, p, engageR);
    // Duel-stalemate breaker: 8 s on the same target with no real HP progress
    // (tank-vs-tank shields can out-regen incoming damage → an INFINITE duel)
    // → truce that foe for 20 s and go play the map. Never truce a foe who is
    // threatening our own structures — peeling them stays mandatory.
    if (foePet) {
        const foeEhp = foePet.hp + foePet.shieldHp;
        if (p.duelId !== foePet.id) { p.duelId = foePet.id; p.duelTicks = 0; p.duelFoeHp = foeEhp; }
        else if (++p.duelTicks >= WARFRONT_TPS * 8) {
            const foe = foePet;
            const noProgress = p.duelFoeHp - foeEhp < foe.maxHp * 0.06;
            const core = st.cores[p.team];
            const threatens = hyp2(foe.x - core.x, foe.y - core.y) < 8
                || st.statues[p.team].some((s) => s.alive && hyp2(foe.x - s.x, foe.y - s.y) < 8);
            if (noProgress && !threatens) {
                p.duelTruce = WARFRONT_TPS * 20;
                foePet = nearestEnemy(st, p, engageR);   // re-pick with the truce active
                p.duelId = foePet ? foePet.id : null;
            }
            p.duelTicks = 0; p.duelFoeHp = foePet ? foePet.hp + foePet.shieldHp : 0;
        }
    } else if (p.duelTicks > 0) p.duelTicks = 0;
    // WINGMAN RULE: never CHASE into an outnumbered fight alone — the lone
    // dive into two enemies was how pets kept feeding. Contact fights and
    // committed squad pushes are exempt.
    if (foePet && !(callState.squad && callState.committed)) {
        const dW = hyp2(foePet.x - p.x, foePet.y - p.y);
        if (dW > 2.6) {
            let allies = 0, foes = 0;
            for (const q of st.pets) {
                if (q.state === "respawning") continue;
                if (q.team === p.team && q !== p && hyp2(q.x - p.x, q.y - p.y) < 7) allies++;
                if (q.team !== p.team && hyp2(q.x - foePet.x, q.y - foePet.y) < 6) foes++;
            }
            if (foes >= 2 && allies === 0) foePet = null;
        }
    }
    // ONE MAJOR ACTION PER TICK: honor tryUltimate's result — an ult ENDS the
    // pet's combat this tick. It used to fire AND still fall through to a role
    // ability + element signature + basic (a hidden quad-action).
    if ((foePet || p.ult >= 100) && tryUltimate(st, p)) return;
    // P0.5: a sage HEALS a wounded ally whether or not an enemy is near — the
    // heal was gated behind having an enemy target, so a sage escorting a hurt
    // ally couldn't actually heal until a foe wandered in. It's the sage's major
    // action for the tick.
    if (p.role === "sage" && p.abilityCd <= 0) {
        let ally: WfPet | null = null, worst = 0.82;
        for (const q of st.pets) {
            if (q.team !== p.team || q === p || q.state === "respawning") continue;
            const frac = q.hp / q.maxHp;
            if (frac < worst && hyp2(q.x - p.x, q.y - p.y) < 6) { worst = frac; ally = q; }
        }
        if (ally) {
            const amount = Math.round(ally.maxHp * 0.14);
            ally.hp = Math.min(ally.maxHp, ally.hp + amount);
            st.events.push({ t: st.t, type: "heal", targetId: ally.id, actorId: p.id, amount });
            p.abilityCd = ABILITY_CD;
            return;
        }
    }

    // Priority micro-targets near the pet — enemy pet > warden (when called) >
    // mini (when called) > mob > structure in reach > walk the call.
    if (foePet) {
        const d = hyp2(foePet.x - p.x, foePet.y - p.y);
        // Role abilities — each is a MAJOR action that ENDS the pet's tick (one
        // major action per tick). Sage heal is handled earlier, outside the enemy
        // gate. Stacking mark/shield + element + basic in one tick was a hidden
        // multi-action and made bursts look duplicated on the broadcast.
        if (p.abilityCd <= 0) {
            if (p.role === "defender" && p.hp / p.maxHp < 0.75) {
                p.shieldHp = Math.round(p.maxHp * 0.16);
                p.abilityCd = ABILITY_CD;
                st.events.push({ t: st.t, type: "ability", petId: p.id, kind: "shield", x: quant(p.x), y: quant(p.y) });
                return;
            } else if (p.role === "assassin" && d > 1.8 && d < 5) {
                const steps = WARFRONT_TPS * 0.4;
                p.dashLeft = steps; p.dashDx = (foePet.x - p.x) / steps; p.dashDy = (foePet.y - p.y) / steps;
                p.abilityCd = ABILITY_CD;
                st.events.push({ t: st.t, type: "ability", petId: p.id, kind: "dash", x: quant(p.x), y: quant(p.y), targetId: foePet.id });
                return;
            } else if (p.role === "tracker") {
                foePet.markLeft = WARFRONT_TPS * 5;
                p.abilityCd = ABILITY_CD;
                st.events.push({ t: st.t, type: "ability", petId: p.id, kind: "mark", x: quant(foePet.x), y: quant(foePet.y), targetId: foePet.id });
                return;
            }
        }
        // ELEMENT SIGNATURE — the pet's main-game element as a warfront MOVE;
        // also a major action that ends the tick.
        if (p.elemCd <= 0 && d <= 6) {
            p.elemCd = WARFRONT_TPS * 12;
            castElement(st, p, foePet);
            return;
        }
        if (d <= Math.max(p.atkRange, MELEE_REACH)) {
            p.faceX = (foePet.x - p.x) / (d || 1); p.faceY = (foePet.y - p.y) / (d || 1);
            if (p.attackCd <= 0) {
                p.state = "attack";
                p.attackCd = ATTACK_CD;
                petDamage(st, p, foePet, p.atk * (0.9 + st.rng() * 0.2), st.rng() < p.crit);
            } else if ((p.role === "tracker" || p.role === "sage") && d < p.neutral - 0.8) {
                // Ranged roles KITE back toward their neutral distance.
                const bx = p.x - ((foePet.x - p.x) / (d || 1)) * p.moveSpeed;
                const by = p.y - ((foePet.y - p.y) / (d || 1)) * p.moveSpeed;
                const [bc, br] = cellOf(bx, by);
                if (petCellWalkable(bc, br)) { p.x = bx; p.y = by; p.state = "move"; }
            } else if (p.attackCd > 6) {
                // Orbit-strafe between swings so fights read alive, not statuesque.
                const dirSign = p.slot % 2 === 0 ? 1 : -1;
                const tx = (-(foePet.y - p.y) / (d || 1)) * dirSign, tz = ((foePet.x - p.x) / (d || 1)) * dirSign;
                const nx = p.x + tx * p.moveSpeed * 0.45, ny = p.y + tz * p.moveSpeed * 0.45;
                const [nc, nr] = cellOf(nx, ny);
                if (petCellWalkable(nc, nr)) { p.x = nx; p.y = ny; p.state = "move"; }
            }
        } else {
            const [gx, gy] = combatApproachPoint(p, foePet);
            walkToward(st, p, gx, gy);
        }
        return;
    }

    // Warden engagement: on the squad call, when HE is mauling you, or
    // opportunistically when you are already at the pit's edge. Pets FAN OUT
    // around him (per-slot ring angle) and orbit between swings — no stacking.
    if (st.boss.alive) {
        const d = hyp2(st.boss.x - p.x, st.boss.y - p.y);
        const engaged = call.goal === "warden" || st.boss.targetId === p.id || d <= Math.max(p.atkRange, WARDEN_REACH) + 0.7;
        if (engaged && (call.goal === "warden" || d < 7)) {
            p.faceX = (st.boss.x - p.x) / (d || 1); p.faceY = (st.boss.y - p.y) / (d || 1);
            if (d <= Math.max(p.atkRange, WARDEN_REACH)) {
                if (p.attackCd <= 0) {
                    p.attackCd = ATTACK_CD; p.state = "attack";
                    // Reward a declared pre-WAR squad rotation with just enough
                    // focus-fire pace to complete a healthy objective call. An
                    // incidental pit-edge hit receives no bonus.
                    const coordinatedObjective = st.t < WARFRONT_TPS * WF_PHASE_WAR
                        && callState.squad?.goal === "warden" ? 1.08 : 1;
                    const dmg = Math.round(p.atk * (0.9 + st.rng() * 0.2)
                        * (st.atkBuff[p.team] > 0 ? MINI_BUFF_ATK : 1) * coordinatedObjective);
                    st.boss.hp -= dmg;
                    st.wardenDmg[p.team] += dmg;
                    // Establish aggro when the fight begins, but never spin the
                    // boss toward the last of four same-tick attackers.
                    if (!st.boss.targetId) st.boss.targetId = p.id;
                    st.events.push({ t: st.t, type: "wardenhit", actorId: p.id });
                    if (st.boss.hp <= 0 && st.boss.alive) {
                        st.boss.alive = false; st.boss.dead = true;
                        st.coins[p.team] += WF_COIN_WARDEN;
                        p.coinsEarned += WF_COIN_WARDEN;
                        grantXp(st, p, 300);
                        st.wardenBuff = { team: p.team, left: WARFRONT_TPS * 75 };   // Gate's Wrath: +atk aura + ELITE waves + siege power
                        // A STEAL: the last hit landed by the team that did LESS
                        // total Warden damage — peak broadcast drama.
                        st.events.push({ t: st.t, type: "wardenkill", team: p.team, stolen: st.wardenDmg[p.team] < st.wardenDmg[other(p.team)] });
                    }
                } else if (p.attackCd > 6) {
                    const dirSign = p.slot % 2 === 0 ? 1 : -1;
                    const tx = (-(st.boss.y - p.y) / (d || 1)) * dirSign, tz = ((st.boss.x - p.x) / (d || 1)) * dirSign;
                    const nx = p.x + tx * p.moveSpeed * 0.4, ny = p.y + tz * p.moveSpeed * 0.4;
                    const [nc, nr] = cellOf(nx, ny);
                    if (petCellWalkable(nc, nr)) { p.x = nx; p.y = ny; p.state = "move"; }
                }
            } else {
                // Approach a per-slot ring point — rotate the boss→pet direction
                // by a fixed per-slot offset (atan2/cos/sin round-trip dropped for
                // cross-engine determinism).
                const ringR = Math.max(p.atkRange * 0.85, WARDEN_REACH);
                const rdx = p.x - st.boss.x, rdy = p.y - st.boss.y, rdd = hyp2(rdx, rdy) || 1;
                const rux = rdx / rdd, ruy = rdy / rdd, roff = (p.slot - 1.5) * 0.5, rc = dcos(roff), rs = dsin(roff);
                walkToward(st, p, st.boss.x + (rux * rc - ruy * rs) * ringR, st.boss.y + (rux * rs + ruy * rc) * ringR);
            }
            return;
        }
    }
    if (call.goal.startsWith("mini-")) {
        const m = st.minis[Number(call.goal.slice(5)) || 0];
        if (m && m.alive && !m.ally) {
            const d = hyp2(m.x - p.x, m.y - p.y);
            if (d <= Math.max(p.atkRange, MINI_ATTACK_REACH)) {
                if (p.attackCd > 6) {
                    const dirSign = p.slot % 2 === 0 ? 1 : -1;
                    const tx = (-(m.y - p.y) / (d || 1)) * dirSign, tz = ((m.x - p.x) / (d || 1)) * dirSign;
                    const nx = p.x + tx * p.moveSpeed * 0.4, ny = p.y + tz * p.moveSpeed * 0.4;
                    const [nc, nr] = cellOf(nx, ny);
                    if (petCellWalkable(nc, nr)) { p.x = nx; p.y = ny; p.state = "move"; }
                }
                if (p.attackCd <= 0) {
                    p.attackCd = ATTACK_CD; p.state = "attack";
                    const dealt = Math.round(p.atk * (0.9 + st.rng() * 0.2));
                    m.hp -= dealt;
                    // CRYSTAL SHELL: while it shimmers, attackers bleed back.
                    if (m.padIdx === 1 && m.sigActive > 0) {
                        const back = Math.round(dealt * 0.3);
                        if (p.shieldHp > 0) { const soak = Math.min(p.shieldHp, back); p.shieldHp -= soak; p.hp = Math.max(0, p.hp - (back - soak)); }
                        else p.hp = Math.max(0, p.hp - back);
                        if (p.hp <= 0) {
                            p.state = "respawning";
                            p.respawnLeft = RESPAWN_BASE + Math.floor(st.t / (WARFRONT_TPS * 60)) * RESPAWN_PER_MIN;
                            st.events.push({ t: st.t, type: "kill", targetId: p.id, actorId: `mini-${m.padIdx}`, team: other(p.team) });
                        }
                    }
                    if (m.hp <= 0 && m.alive) {
                        // RECRUITED, not despawned — it fights for the slayer's team.
                        m.alive = true; m.hp = MINI_HP; m.ally = p.team; m.allyLeft = st.doctrine[p.team] === "warden-pact" ? Math.round(RECRUIT_TICKS * 1.5) : RECRUIT_TICKS; m.attackCd = 0; m.sigWind = 0; m.sigActive = 0; m.boonCd = WARFRONT_TPS * 2; m.targetId = null; m.path = null; m.pathIdx = 0; m.navGoal = -1;
                        st.coins[p.team] += WF_COIN_MINI;
                        p.coinsEarned += WF_COIN_MINI;
                        grantXp(st, p, 180);
                        st.atkBuff[p.team] = MINI_BUFF_TICKS;
                        // Camp identity boon (permanent, small): Golem=armor,
                        // Behemoth=regen, Stalker=speed, Devourer=power.
                        for (const ally of st.pets) {
                            if (ally.team !== p.team) continue;
                            if (m.padIdx === 0) { ally.def *= 1.06; ally.baseDef *= 1.06; }
                            else if (m.padIdx === 1) { ally.regen += ally.baseMaxHp * 0.0012 / WARFRONT_TPS * 30; }
                            else if (m.padIdx === 2) { ally.moveSpeed *= 1.04; ally.baseSpeed *= 1.04; }
                            else { ally.atk *= 1.05; ally.baseAtk *= 1.05; }
                            // CAMP TROPHY — big, visible, immediate (on top of
                            // the small permanent boon): the Golem armors the
                            // team in stone, the Behemoth surges healing, the
                            // Stalker focuses ults, the Devourer sends the next
                            // wave out ELITE.
                            if (ally.state === "respawning") continue;
                            if (m.padIdx === 0) ally.shieldHp = Math.max(ally.shieldHp, Math.round(ally.maxHp * 0.15));
                            else if (m.padIdx === 1) {
                                const amt = Math.round(ally.maxHp * 0.18);
                                ally.hp = Math.min(ally.maxHp, ally.hp + amt);
                                st.events.push({ t: st.t, type: "heal", targetId: ally.id, actorId: p.id, amount: amt });
                            } else if (m.padIdx === 2) ally.ult = Math.min(100, ally.ult + 25);
                        }
                        if (m.padIdx === 3) st.eliteWaveOwed[p.team] = true;
                        st.events.push({ t: st.t, type: "minikill", padIdx: m.padIdx, team: p.team });
                        activateGuardianRally(st, p.team, m.padIdx);
                    }
                }
            } else {
                const rdx = p.x - m.x, rdy = p.y - m.y, rdd = hyp2(rdx, rdy) || 1;
                const rux = rdx / rdd, ruy = rdy / rdd, roff = (p.slot - 1.5) * 0.55, rc = dcos(roff), rs = dsin(roff);
                walkToward(st, p, m.x + (rux * rc - ruy * rs) * MINI_REACH, m.y + (rux * rs + ruy * rc) * MINI_REACH);
            }
            return;
        }
    }

    // Mobs in reach — farm them.
    const mob = nearestMob(st, p);
    if (mob) {
        const d = hyp2(mob.x - p.x, mob.y - p.y);
        if (d <= Math.max(p.atkRange, MELEE_REACH)) {
            if (p.attackCd <= 0) {
                p.attackCd = ATTACK_CD; p.state = "attack";
                p.faceX = (mob.x - p.x) / (d || 1); p.faceY = (mob.y - p.y) / (d || 1);
                mob.hp -= Math.round(p.atk * (0.9 + st.rng() * 0.2));
                if (mob.hp <= 0) mobDown(st, mob, p);
            }
            return;
        }
        // Laners work the wave in front of them — a pet standing 3u behind its
        // fighting minions doing nothing read as "clueless". Farm calls chase;
        // push calls also step in on the local wave (nearestMob is ≤5u).
        if (call.goal === "farm" || call.goal.startsWith("push-")) { walkToward(st, p, mob.x, mob.y); return; }
    }

    // Structures in reach when pushing.
    const foe = other(p.team);
    // Structures are attacked when PUSHING (an always-on check glued pets to
    // sentinels they were merely walking past — the great stuck bug).
    if (call.goal.startsWith("push") || call.goal.startsWith("defend")) {
        for (const [gi, gg] of st.guardians[foe].entries()) {
            if (!gg.alive) continue;
            const d = hyp2(gg.x - p.x, gg.y - p.y);
            if (d <= Math.max(p.atkRange, 1.7)) {
                if (p.attackCd <= 0) {
                    p.attackCd = ATTACK_CD; p.state = "attack";
                    const dmg = Math.round(p.atk * (0.85 + st.rng() * 0.2) * siegeMul(st, p));
                    gg.hp -= dmg;
                    p.dmgDealt += dmg;
                    p.ult = Math.min(100, p.ult + 2);
                    st.events.push({ t: st.t, type: "structhit", team: foe, statue: gi, x: quant(gg.x), y: quant(gg.y) });
                    if (gg.hp <= 0) {
                        gg.alive = false;
                        st.coins[p.team] += WF_COIN_GUARD;
                        p.coinsEarned += WF_COIN_GUARD;
                        grantXp(st, p, 200);
                        st.events.push({ t: st.t, type: "guardiandown", team: foe, idx: gi, by: p.team });
                    }
                }
                return;
            }
        }
        for (const [i, s] of st.statues[foe].entries()) {
            if (!s.alive) continue;
            const d = hyp2(s.x - p.x, s.y - p.y);
            if (d <= Math.max(p.atkRange, 1.6)) {
                if (p.attackCd <= 0) {
                    p.attackCd = ATTACK_CD; p.state = "attack";
                    s.hp -= Math.round(p.atk * (0.85 + st.rng() * 0.2) * siegeMul(st, p) * wardMul(st, foe, i));
                    st.events.push({ t: st.t, type: "structhit", team: foe, statue: i, x: quant(s.x), y: quant(s.y) });
                    if (s.hp <= 0) {
                        s.alive = false;
                        st.coins[p.team] += WF_COIN_STATUE;
                        p.coinsEarned += WF_COIN_STATUE;
                        st.events.push({ t: st.t, type: "statuedown", team: foe, statue: i, by: p.team });
                        if (!st.statues[foe][0].alive && !st.statues[foe][1].alive) { st.rally[foe] = WARFRONT_TPS * 45; st.events.push({ t: st.t, type: "coreexposed", team: foe }); }
                    }
                }
                return;
            }
        }
        const core = st.cores[foe];
        const exposed = !st.statues[foe][0].alive && !st.statues[foe][1].alive;
        if (core.alive && exposed) {
            const d = hyp2(core.x - p.x, core.y - p.y);
            if (d <= Math.max(p.atkRange, 1.6)) {
                if (p.attackCd <= 0) {
                    p.attackCd = ATTACK_CD; p.state = "attack";
                    core.hp -= Math.round(p.atk * (0.85 + st.rng() * 0.2) * siegeMul(st, p));
                    core.sinceHit = 0;
                    st.events.push({ t: st.t, type: "structhit", team: foe, core: true, x: quant(core.x), y: quant(core.y) });
                    if (core.hp <= 0) {
                        core.alive = false;
                        st.winner = p.team;
                        st.events.push({ t: st.t, type: "coredown", team: foe, by: p.team });
                    }
                }
                return;
            }
        }
    }

    // ROLE GLUE — the healer shadows the wounded, the wall shadows the healer.
    if (p.role === "sage" && !callState.squad) {
        let ally: WfPet | null = null, worst = 0.65;
        for (const q of st.pets) {
            if (q.team !== p.team || q === p || q.state === "respawning") continue;
            const frac = q.hp / q.maxHp;
            if (frac < worst && hyp2(q.x - p.x, q.y - p.y) < 16) { worst = frac; ally = q; }
        }
        if (ally && hyp2(ally.x - p.x, ally.y - p.y) > 3.2) { walkToward(st, p, ally.x, ally.y); return; }
    }
    if (p.role === "defender" && !callState.squad) {
        const sageAlly = st.pets.find((q) => q.team === p.team && q.role === "sage" && q.state !== "respawning");
        if (sageAlly && hyp2(sageAlly.x - p.x, sageAlly.y - p.y) > 3
            && st.pets.some((q) => q.team !== p.team && q.state !== "respawning" && hyp2(q.x - sageAlly.x, q.y - sageAlly.y) < 8)) {
            walkToward(st, p, sageAlly.x, sageAlly.y);
            return;
        }
    }
    // ACTIVE HOLD: past laning, a pet with no squad call, no foe within reach,
    // and no wave to escort would otherwise stand at its lane line — a pet
    // wasted off the fight. If a teammate is fighting within 24u, it joins in.
    // (Only fires when genuinely disengaged — a pet sieging with its wave or one
    // with an enemy near keeps its job; it walks straight to a real fight and
    // never dithers, so there's no on-camera jitter.)
    if (!callState.squad && st.t > WARFRONT_TPS * WF_PHASE_SKIRMISH) {
        const foeClose = st.pets.some((q) => q.team !== p.team && q.state !== "respawning" && hyp2(q.x - p.x, q.y - p.y) < 9);
        const waveClose = st.mobs.some((m) => m.side === p.team && hyp2(m.x - p.x, m.y - p.y) < 6);
        if (!foeClose && !waveClose) {
            let rx = 0, ry = 0, rd = 24;
            for (const a of st.pets) {
                if (a.team !== p.team || a === p || a.state === "respawning") continue;
                const inFight = st.pets.some((e) => e.team !== p.team && e.state !== "respawning" && hyp2(e.x - a.x, e.y - a.y) < 3.5);
                if (!inFight) continue;
                const d = hyp2(a.x - p.x, a.y - p.y);
                if (d < rd) { rd = d; rx = a.x; ry = a.y; }
            }
            if (rd < 24) { walkToward(st, p, rx, ry); return; }   // join the fight
        }
    }
    // Walk the call with a per-role FORMATION offset (defender fronts, sage
    // hangs back, tracker/assassin take flanks) so the squad never stacks.
    const foeDir = p.team === "blue" ? 1 : -1;
    const FORM = [[1.0, 0], [0.6, 1.1], [0.6, -1.1], [-1.6, 0]] as const;
    const rallying = callState.squad && callState.squad.goal === "push-squad" && callState.rally && !callState.committed;
    const baseX = rallying ? callState.rally!.x : call.x;
    const baseY = rallying ? callState.rally!.y : call.y;
    let gx = baseX + FORM[p.slot % 4][0] * foeDir;
    const gy = baseY + FORM[p.slot % 4][1];
    // Wave discipline: while pushing a LANE whose gate still stands (and it is
    // not yet deathball time), advance only ~2.5u past our own minion front.
    if (!callState.squad && call.goal.startsWith("push-") && st.t < WARFRONT_TPS * WF_PHASE_WAR) {
        const lane = GROUP_LANE[assignedGroup];
        let front = p.team === "blue" ? -6 : 6;
        for (const mm of st.mobs) {
            if (mm.side !== p.team || mm.lane !== lane) continue;
            front = p.team === "blue" ? Math.max(front, mm.x) : Math.min(front, mm.x);
        }
        // The clamp never drags a pet back toward base past its own third-line
        // — early waves spawn BEHIND the laners, and walking backwards to
        // escort them read as "stuck at the start". Stride to the lane line,
        // hold it, and let the wave catch up.
        const ahead = STANCE_CFG[st.stance[p.team]].clampAhead;
        const hold = p.team === "blue" ? Math.max(front + ahead, -WF_X / 3) : Math.min(front - ahead, WF_X / 3);
        gx = p.team === "blue" ? Math.min(gx, hold) : Math.max(gx, hold);
    }
    walkToward(st, p, gx, gy);
}

// ── Structures, warden, minis, mobs ──────────────────────────────────────────
function statueTick(st: WfState, team: Team, idx: number) {
    const s = st.statues[team][idx];
    if (!s.alive) return;
    if (s.attackCd > 0) { s.attackCd--; return; }
    // Prefer mobs (they siege relentlessly), then enemy pets.
    let mob: WfMob | null = null, md = STATUE_RANGE;
    for (const m of st.mobs) { if (m.side === team) continue; const d = hyp2(m.x - s.x, m.y - s.y); if (d < md) { md = d; mob = m; } }
    if (mob) {
        mob.hp -= STATUE_DMG;
        s.attackCd = STATUE_CD;
        if (mob.hp <= 0) st.mobs = st.mobs.filter((m) => m !== mob);
        return;
    }
    let pet: WfPet | null = null, pd = STATUE_RANGE;
    for (const p of st.pets) {
        if (p.team === team || p.state === "respawning") continue;
        const d = hyp2(p.x - s.x, p.y - s.y);
        if (d < pd) { pd = d; pet = p; }
    }
    if (pet) {
        s.attackCd = STATUE_CD;
        let dmg = STATUE_DMG * (100 / (100 + pet.def));
        dmg = Math.round(dmg);
        if (pet.shieldHp > 0) { const soak = Math.min(pet.shieldHp, dmg); pet.shieldHp -= soak; dmg -= soak; }
        pet.hp = Math.max(0, pet.hp - dmg);
        st.events.push({ t: st.t, type: "hit", targetId: pet.id, actorId: `statue-${team}-${idx}`, dmg, crit: false });
        if (pet.hp <= 0 && pet.state !== "respawning") {
            pet.state = "respawning";
            pet.respawnLeft = RESPAWN_BASE + Math.floor(st.t / (WARFRONT_TPS * 60)) * RESPAWN_PER_MIN;
            st.events.push({ t: st.t, type: "kill", targetId: pet.id, actorId: `statue-${team}-${idx}`, team });
        }
    }
}

function guardianTick(st: WfState, team: Team, idx: number) {
    const g = st.guardians[team][idx];
    if (!g.alive) return;
    const rallying = g.rallyLeft > 0;
    if (rallying) {
        g.rallyLeft--;
        g.rallyPulse--;
        if (g.rallyPulse <= 0) {
            let ally: WfPet | null = null;
            let need = -Infinity;
            for (const p of st.pets) {
                if (p.team !== team || p.state === "respawning") continue;
                const d = hyp2(p.x - g.x, p.y - g.y);
                if (d > GUARD_RALLY_WARD_RANGE || Math.abs(p.y - g.y) > 7.5) continue;
                const score = 1 - (p.hp + p.shieldHp) / Math.max(1, p.maxHp) - d * 0.002;
                if (score > need) { need = score; ally = p; }
            }
            if (ally) {
                const ward = Math.round(ally.maxHp * 0.08);
                const wardCap = Math.round(ally.maxHp * 0.24);
                const amount = Math.min(ward, Math.max(0, wardCap - ally.shieldHp));
                if (amount > 0) {
                    ally.shieldHp += amount;
                    g.rallyPulse = GUARD_RALLY_WARD_EVERY;
                    st.events.push({
                        t: st.t, type: "guardianward", team, idx, targetId: ally.id,
                        amount, x: quant(g.x), y: quant(g.y),
                    });
                } else {
                    g.rallyPulse = WARFRONT_TPS;
                }
            } else {
                // No lane ally is in range yet; retry soon instead of wasting the
                // entire four-second support cadence.
                g.rallyPulse = WARFRONT_TPS;
            }
        }
    }
    if (g.attackCd > 0) { g.attackCd--; return; }
    // A War Council purchase overcharges surviving sentinels: they project
    // farther into the lane and fire faster while the rally is active.
    const range = rallying ? GUARD_RALLY_RANGE : GUARD_RANGE;
    const attackCd = rallying ? GUARD_RALLY_CD : GUARD_CD;
    // Enemy minions first (turret discipline), then pets.
    let mob: WfMob | null = null, md = range;
    for (const m of st.mobs) {
        if (m.side === team) continue;
        const d = hyp2(m.x - g.x, m.y - g.y);
        if (d < md) { md = d; mob = m; }
    }
    if (mob) {
        g.faceX = mob.x >= g.x ? 1 : -1;
        g.attackCd = attackCd;
        g.shotCount++;
        mob.hp -= GUARD_DMG_MOB;
        st.events.push({ t: st.t, type: "mobhit", x: quant(mob.x), y: quant(mob.y), targetId: `guard-${team}-${idx}` });
        if (mob.hp <= 0) mobDown(st, mob, null);
        return;
    }
    let pet: WfPet | null = null, pd = range;
    for (const p of st.pets) {
        if (p.team === team || p.state === "respawning") continue;
        const d = hyp2(p.x - g.x, p.y - g.y);
        if (d < pd) { pd = d; pet = p; }
    }
    if (pet) {
        g.faceX = pet.x >= g.x ? 1 : -1;
        g.attackCd = attackCd;
        // Every 6th shot is a CHARGED bolt (1.8×, flagged crit so it renders big
        // + shakes) — the sentinel reads as a dangerous turret, not scenery.
        const heavy = (++g.shotCount % 6 === 0);
        let dmg = Math.round(GUARD_DMG_PET * (heavy ? 1.8 : 1) * (100 / (100 + pet.def)));
        if (pet.shieldHp > 0) { const soak = Math.min(pet.shieldHp, dmg); pet.shieldHp -= soak; dmg -= soak; }
        pet.hp = Math.max(0, pet.hp - dmg);
        st.events.push({ t: st.t, type: "hit", targetId: pet.id, actorId: `guard-${team}-${idx}`, dmg, crit: heavy });
        if (pet.hp <= 0 && pet.state !== "respawning") {
            pet.state = "respawning";
            pet.respawnLeft = RESPAWN_BASE + Math.floor(st.t / (WARFRONT_TPS * 60)) * RESPAWN_PER_MIN;
            st.events.push({ t: st.t, type: "kill", targetId: pet.id, actorId: `guard-${team}-${idx}`, team });
        }
    }
}

function bossTick(st: WfState) {
    const b = st.boss;
    if (!b.alive) return;
    // Two readable thresholds turn the objective into a real three-act boss
    // fight. Phase 2 ruptures the pit; phase 3 enrages every basic attack.
    const phaseBurst = (phase: 2 | 3, radius: number, damageMul: number, shoveSteps: number) => {
        b.phase = phase;
        st.events.push({ t: st.t, type: "wardenphase", phase, x: quant(b.x), y: quant(b.y) });
        st.events.push({ t: st.t, type: "wardenshock", x: quant(b.x), y: quant(b.y) });
        for (const q of st.pets) {
            if (q.state === "respawning") continue;
            const dq = hyp2(q.x - b.x, q.y - b.y);
            if (dq > radius) continue;
            let dmg = Math.round(WARDEN_SLAM * damageMul * (100 / (100 + q.def)));
            if (q.shieldHp > 0) { const soak = Math.min(q.shieldHp, dmg); q.shieldHp -= soak; dmg -= soak; }
            q.hp = Math.max(0, q.hp - dmg);
            st.events.push({ t: st.t, type: "hit", targetId: q.id, actorId: "warden", dmg, crit: false });
            if (q.hp <= 0) {
                q.state = "respawning";
                q.respawnLeft = RESPAWN_BASE + Math.floor(st.t / (WARFRONT_TPS * 60)) * RESPAWN_PER_MIN;
                st.events.push({ t: st.t, type: "kill", targetId: q.id, actorId: "warden", team: other(q.team) });
                continue;
            }
            const ux = (q.x - b.x) / (dq || 1), uy = (q.y - b.y) / (dq || 1);
            for (let s2 = 0; s2 < shoveSteps; s2++) {
                const [nc2, nr2] = cellOf(q.x + ux * 0.75, q.y + uy * 0.75);
                if (!petCellWalkable(nc2, nr2)) break;
                q.x += ux * 0.75; q.y += uy * 0.75;
            }
            q.path = null; q.navGoal = -1;
        }
    };
    if (b.phase === 1 && b.hp <= WARDEN_HP * 0.7) {
        phaseBurst(2, 5.5, 0.55, 2);
    }
    if (b.phase === 2 && b.hp <= WARDEN_HP * 0.35) {
        phaseBurst(3, 6.5, 0.9, 4);
    }
    // BARON RULES: keep a valid locked attacker, otherwise acquire the nearest
    // pet inside the arena ring. The old nearest-first scan swapped targets on
    // almost every crossing and made the Warden's body/rig snap between pets.
    let tgt: WfPet | null = null, td = WF_LAIR.r - 0.8;
    if (b.targetId) {
        const attacker = st.pets.find((p) => p.id === b.targetId && p.state !== "respawning");
        if (attacker) {
            const d = hyp2(attacker.x - b.x, attacker.y - b.y);
            if (d < WARDEN_LEASH + 1.5) { tgt = attacker; td = d; }
        }
    }
    if (!tgt) {
        const acquireRadius = WF_LAIR.r - 0.8;
        let bestScore = Infinity;
        for (const p of st.pets) {
            if (p.state === "respawning") continue;
            const d = hyp2(p.x - b.x, p.y - b.y);
            if (d >= acquireRadius) continue;
            // Punish vulnerable backliners without snapping away from a clearly
            // closer threat. The target lock above keeps this choice readable.
            const score = d + (p.hp / p.maxHp) * 0.9 - (p.role === "sage" ? 0.7 : p.role === "tracker" ? 0.35 : 0);
            if (score < bestScore) { bestScore = score; td = d; tgt = p; }
        }
    }
    if (b.windUp > 0) {
        b.windUp--;
        if (b.windUp === 0) {
            st.events.push({ t: st.t, type: "wardenslam", x: quant(b.x), y: quant(b.y) });
            const slamRadius = WARDEN_SLAM_R + (b.phase === 3 ? 0.6 : b.phase === 2 ? 0.25 : 0);
            for (const p of st.pets) {
                if (p.state === "respawning") continue;
                if (hyp2(p.x - b.x, p.y - b.y) <= slamRadius) {
                    let dmg = Math.round(WARDEN_SLAM * (b.phase === 3 ? 1.22 : b.phase === 2 ? 1.08 : 1) * (100 / (100 + p.def)));
                    if (p.shieldHp > 0) { const soak = Math.min(p.shieldHp, dmg); p.shieldHp -= soak; dmg -= soak; }
                    p.hp = Math.max(0, p.hp - dmg);
                    st.events.push({ t: st.t, type: "hit", targetId: p.id, actorId: "warden", dmg, crit: false });
                    if (p.hp <= 0) {   // the loop guard already excluded respawning pets
                        p.state = "respawning";
                        p.respawnLeft = RESPAWN_BASE + Math.floor(st.t / (WARFRONT_TPS * 60)) * RESPAWN_PER_MIN;
                        st.events.push({ t: st.t, type: "kill", targetId: p.id, actorId: "warden", team: other(p.team) });
                    }
                }
            }
        }
        return;
    }
    b.targetId = tgt ? tgt.id : null;
    b.calmTicks = tgt ? 0 : b.calmTicks + 1;
    if (!tgt) {
        // RESET + PATROL: the old 40/tick (1,200/s) heal reset the instant a
        // fight broke — a squad chipped it to half, stepped into a teamfight,
        // and it was back to full, so it read as STUCK at 50%. Now it recovers
        // only after a real disengage (6 s untouched) and SLOWLY, so chip damage
        // sticks and the fight always reads as "we're wearing it down".
        if (b.calmTicks > WARDEN_RESET_DELAY && b.hp < WARDEN_HP) b.hp = Math.min(WARDEN_HP, b.hp + 8);
        const ang = (st.t / WARFRONT_TPS) * 0.22;
        const hx = WF_LAIR.x + dcos(ang) * 1.35, hy = WF_LAIR.y + dsin(ang) * 1.05;
        const dx = hx - b.x, dy = hy - b.y;
        const d = hyp2(dx, dy);
        if (d > 0.05) {
            const step = Math.min(0.65 / WARFRONT_TPS, d);
            b.x += (dx / d) * step; b.y += (dy / d) * step;
            b.faceX = dx >= 0 ? 1 : -1;
        }
        return;
    }
    b.faceX = tgt.x >= b.x ? 1 : -1;
    b.slamIn--;
    if (b.slamIn <= 0) {
        b.windUp = WARDEN_WINDUP;
        b.slamIn = b.phase === 3 ? WARFRONT_TPS * 4 : b.phase === 2 ? WARFRONT_TPS * 5 : WARDEN_SLAM_EVERY;
        st.events.push({ t: st.t, type: "wardenwindup", x: quant(b.x), y: quant(b.y) });
        return;
    }
    if (b.swipeCd > 0) { b.swipeCd--; return; }
    if (td <= WARDEN_REACH) {
        b.swipeCd = b.phase === 3 ? Math.round(WARDEN_SWIPE_CD * 0.72) : b.phase === 2 ? Math.round(WARDEN_SWIPE_CD * 0.88) : WARDEN_SWIPE_CD;
        // A true boss cleave: the locked target takes the full claw while pets
        // stacked beside it take a lighter hit. Attack-ring spacing gives the
        // squad room to avoid this instead of turning every swipe into free AoE.
        for (const victim of st.pets) {
            if (victim.state === "respawning" || hyp2(victim.x - tgt.x, victim.y - tgt.y) > 2.1) continue;
            const cleave = victim === tgt ? 1 : 0.58;
            let dmg = Math.round(WARDEN_SWIPE * cleave * (b.phase === 3 ? 1.2 : b.phase === 2 ? 1.08 : 1) * (100 / (100 + victim.def)));
            if (victim.shieldHp > 0) { const soak = Math.min(victim.shieldHp, dmg); victim.shieldHp -= soak; dmg -= soak; }
            victim.hp = Math.max(0, victim.hp - dmg);
            st.events.push({ t: st.t, type: "hit", targetId: victim.id, actorId: "warden", dmg, crit: false });
            // The loop guard above already excludes respawning pets, so a
            // depleted victim always transitions exactly once here.
            if (victim.hp <= 0) {
                victim.state = "respawning";
                victim.respawnLeft = RESPAWN_BASE + Math.floor(st.t / (WARFRONT_TPS * 60)) * RESPAWN_PER_MIN;
                st.events.push({ t: st.t, type: "kill", targetId: victim.id, actorId: "warden", team: other(victim.team) });
            }
        }
    } else {
        const step = 1.15 / WARFRONT_TPS;
        b.x += ((tgt.x - b.x) / td) * step;
        b.y += ((tgt.y - b.y) / td) * step;
    }
}

// A recruited boss marches faster than it prowls — it's ON the offensive.
/** Path-following for camp bosses. Their old direct-line step simply stopped
 * whenever a tree/rock cell sat between the den and patrol target, leaving the
 * model planted in its spawn forever. The same sticky two-cell retarget rule as
 * pets prevents a moving escort target from making the route flip every tick. */
function miniNavigate(m: WfMini, tx: number, ty: number, speed: number) {
    const [gc, gr] = nearestWalkableCell(tx, ty);
    const goal = gr * WF_COLS + gc;
    const oldGoalC = m.navGoal >= 0 ? m.navGoal % WF_COLS : -99;
    const oldGoalR = m.navGoal >= 0 ? Math.floor(m.navGoal / WF_COLS) : -99;
    const goalMovedFar = Math.max(Math.abs(gc - oldGoalC), Math.abs(gr - oldGoalR)) > 1;
    let reachedPathEnd = false;
    if (m.path?.length) {
        const end = m.path[m.path.length - 1];
        const [endX, endY] = cellCenter(end % WF_COLS, Math.floor(end / WF_COLS));
        reachedPathEnd = m.pathIdx >= m.path.length - 1 && hyp2(endX - m.x, endY - m.y) < 0.1;
    }
    if (!m.path || m.pathIdx >= m.path.length
        || (m.navGoal !== goal && (goalMovedFar || reachedPathEnd))) {
        m.path = findPath(m.x, m.y, tx, ty);
        m.pathIdx = 0;
        m.navGoal = goal;
    }
    if (!m.path?.length) return;
    let [wx, wy] = cellCenter(m.path[m.pathIdx] % WF_COLS, Math.floor(m.path[m.pathIdx] / WF_COLS));
    let dx = wx - m.x, dy = wy - m.y, d = hyp2(dx, dy);
    while (d < 0.22 && m.pathIdx < m.path.length - 1) {
        m.pathIdx++;
        [wx, wy] = cellCenter(m.path[m.pathIdx] % WF_COLS, Math.floor(m.path[m.pathIdx] / WF_COLS));
        dx = wx - m.x; dy = wy - m.y; d = hyp2(dx, dy);
    }
    if (m.pathIdx >= m.path.length - 1 && d < 0.08) return;
    if (d <= 1e-6) return;
    const step = Math.min(speed / WARFRONT_TPS, d);
    const sx = (dx / d) * step, sy = (dy / d) * step;
    const [cc, cr] = cellOf(m.x + sx, m.y + sy);
    if (wfCellWalkable(cc, cr)) { m.x += sx; m.y += sy; }
    else {
        const [xc, xr] = cellOf(m.x + sx, m.y);
        if (wfCellWalkable(xc, xr)) m.x += sx;
        else {
            const [yc, yr] = cellOf(m.x, m.y + sy);
            if (wfCellWalkable(yc, yr)) m.y += sy;
        }
    }
    m.faceX = dx >= 0 ? 1 : -1;
}

function miniAllyStep(_st: WfState, m: WfMini, tx: number, ty: number) {
    miniNavigate(m, tx, ty, 1.5);
}

function miniStrike(st: WfState, m: WfMini, q: WfPet, mult: number) {
    const pact = m.ally && st.doctrine[m.ally] === "warden-pact" ? 1.18 : 1;
    let dmg = Math.round(MINI_DMG * mult * pact * (100 / (100 + q.def)));
    if (q.shieldHp > 0) { const soak = Math.min(q.shieldHp, dmg); q.shieldHp -= soak; dmg -= soak; }
    q.hp = Math.max(0, q.hp - dmg);
    st.events.push({ t: st.t, type: "hit", targetId: q.id, actorId: `mini-${m.padIdx}`, dmg, crit: false });
    if (q.hp <= 0 && q.state !== "respawning") {
        q.state = "respawning";
        q.respawnLeft = RESPAWN_BASE + Math.floor(st.t / (WARFRONT_TPS * 60)) * RESPAWN_PER_MIN;
        st.events.push({ t: st.t, type: "kill", targetId: q.id, actorId: `mini-${m.padIdx}`, team: other(q.team) });
    }
}

function miniStrikeMob(st: WfState, m: WfMini, mob: WfMob) {
    const pact = m.ally && st.doctrine[m.ally] === "warden-pact" ? 1.18 : 1;
    mob.hp -= Math.round(MINI_DMG * 1.6 * pact);
    st.events.push({
        t: st.t, type: "mobhit", x: quant(mob.x), y: quant(mob.y),
        targetId: `mini-${m.padIdx}`,
    });
    if (mob.hp > 0) return;
    if (m.ally) {
        const pay = mob.side === "hollow" ? WF_COIN_MOB : WF_COIN_MINION;
        st.coins[m.ally] += pay;
        st.events.push({
            t: st.t, type: "mobkill", mobId: mob.id,
            x: quant(mob.x), y: quant(mob.y), team: m.ally,
        });
    }
    st.mobs = st.mobs.filter((candidate) => candidate !== mob);
}

function miniTarget(
    st: WfState,
    m: WfMini,
    hostile: (pet: WfPet) => boolean,
    acquireRadius: number,
    lockRadius: number,
): { pet: WfPet | null; distance: number } {
    if (m.targetId) {
        const locked = st.pets.find((pet) =>
            pet.id === m.targetId
            && pet.state !== "respawning"
            && hostile(pet));
        if (locked) {
            const distance = hyp2(locked.x - m.x, locked.y - m.y);
            if (distance < lockRadius) return { pet: locked, distance };
        }
    }
    let pet: WfPet | null = null;
    let distance = acquireRadius;
    for (const candidate of st.pets) {
        if (candidate.state === "respawning" || !hostile(candidate)) continue;
        const d = hyp2(candidate.x - m.x, candidate.y - m.y);
        if (d < distance) { distance = d; pet = candidate; }
    }
    m.targetId = pet?.id ?? null;
    return { pet, distance };
}

function miniTick(st: WfState, m: WfMini) {
    if (!m.alive) {
        m.spawnIn--;
        if (m.spawnIn <= 0) {
            m.alive = true; m.hp = MINI_HP; m.targetId = null; m.path = null; m.pathIdx = 0; m.navGoal = -1;
            // Respawn at a JITTERED den in the quadrant (deterministic — the
            // seeded rng), so the camp reads wild, not scripted.
            const [px2, py2] = WF_PADS[m.padIdx];
            const jx = px2 + (st.rng() * 2 - 1) * 2.2, jy = py2 + (st.rng() * 2 - 1) * 1.6;
            const [wc2, wr2] = nearestWalkableCell(jx, jy);
            const [hx2, hy2] = cellCenter(wc2, wr2);
            m.x = hx2; m.y = hy2; m.homeX = hx2; m.homeY = hy2;
            st.events.push({ t: st.t, type: "minispawn", padIdx: m.padIdx });
        }
        return;
    }
    // RECRUITED: a slain camp boss fights for its slayer's team — a roaming ally
    // that hunts enemy pets and escorts the push, then leaves when its timer runs
    // out. This is the comeback swing: invade the jungle, take the boss, flip a
    // fight. (Deterministic; no structure damage — its value is winning fights.)
    if (m.ally) {
        m.allyLeft--;
        if (m.allyLeft <= 0) { m.alive = false; m.ally = null; m.spawnIn = MINI_RESPAWN; m.targetId = null; m.path = null; m.pathIdx = 0; m.navGoal = -1; return; }
        m.hp = Math.min(MINI_HP, m.hp + 0.4);   // slow sustain so it lasts the tour
        if (m.attackCd > 0) m.attackCd--;
        if (m.boonCd > 0) m.boonCd--;
        if (m.boonCd <= 0) {
            m.boonCd = WARFRONT_TPS * (m.padIdx === 3 ? 8 : 4);
            const kind = (["shield", "heal", "hunt", "siege"] as const)[m.padIdx];
            if (m.padIdx === 0) {
                // Ancient Golem: refresh a stone ward around its escort.
                for (const a of st.pets) if (a.team === m.ally && a.state !== "respawning" && hyp2(a.x - m.x, a.y - m.y) <= 5.5) {
                    a.shieldHp = Math.max(a.shieldHp, Math.round(a.maxHp * 0.08));
                }
            } else if (m.padIdx === 1) {
                // Crystal Behemoth: sustain the nearby push.
                for (const a of st.pets) if (a.team === m.ally && a.state !== "respawning" && hyp2(a.x - m.x, a.y - m.y) <= 5.5) {
                    const amount = Math.min(Math.round(a.maxHp * 0.05), Math.round(a.maxHp - a.hp));
                    if (amount > 0) {
                        a.hp += amount;
                        st.events.push({ t: st.t, type: "heal", targetId: a.id, actorId: `mini-${m.padIdx}`, amount });
                    }
                }
            } else if (m.padIdx === 2) {
                // Void Stalker: reveal and mark enemies around the escort.
                for (const q of st.pets) if (q.team !== m.ally && q.state !== "respawning" && hyp2(q.x - m.x, q.y - m.y) <= 7) {
                    q.markLeft = Math.max(q.markLeft, WARFRONT_TPS * 4);
                }
            } else {
                // Rift Devourer: keeps the side's next marching wave elite.
                st.eliteWaveOwed[m.ally] = true;
            }
            st.events.push({ t: st.t, type: "miniboon", padIdx: m.padIdx, team: m.ally, kind, x: quant(m.x), y: quant(m.y) });
        }
        const foeT = other(m.ally);
        // Captured camps are siege vanguards first: connect them to an enemy
        // wave before they peel off for hero combat. This creates the visible
        // lane-pressure payoff that makes a neutral objective worth contesting.
        let hostileMob: WfMob | null = null, hostileDistance = 22;
        for (const mob of st.mobs) {
            if (mob.side === m.ally) continue;
            const distance = hyp2(mob.x - m.x, mob.y - m.y);
            if (distance < hostileDistance) { hostileDistance = distance; hostileMob = mob; }
        }
        if (hostileMob) {
            m.faceX = hostileMob.x >= m.x ? 1 : -1;
            if (hostileDistance <= 2.1) {
                if (m.attackCd <= 0) {
                    m.attackCd = MINI_CD;
                    miniStrikeMob(st, m, hostileMob);
                }
            } else {
                miniAllyStep(st, m, hostileMob.x, hostileMob.y);
            }
            return;
        }
        const acquired = miniTarget(st, m, (pet) => pet.team === foeT, 10, 12);
        const tgt = acquired.pet;
        const td = acquired.distance;
        if (tgt) {
            m.faceX = tgt.x >= m.x ? 1 : -1;
            if (td <= MINI_ATTACK_REACH) { if (m.attackCd <= 0) { m.attackCd = MINI_CD; miniStrike(st, m, tgt, 1.3); } }
            else miniAllyStep(st, m, tgt.x, tgt.y);
        } else {
            // VANGUARD DUTY: clear the hostile wave before following the team's
            // nearest marching wave. This makes a capture visibly turn lane
            // pressure instead of producing a boss that shadows one pet.
            let escortMob: WfMob | null = null, escortDistance = 18;
            for (const mob of st.mobs) {
                if (mob.side !== m.ally) continue;
                const distance = hyp2(mob.x - m.x, mob.y - m.y);
                if (distance < escortDistance) { escortDistance = distance; escortMob = mob; }
            }
            if (escortMob) {
                miniAllyStep(st, m, escortMob.x, escortMob.y);
                return;
            }
            // Between waves, regroup with the ally team's most-forward pet.
            let escortPet: WfPet | null = null, enemyCoreDistance = Infinity;
            for (const ally of st.pets) {
                if (ally.team !== m.ally || ally.state === "respawning") continue;
                const distance = hyp2(ally.x - st.cores[foeT].x, ally.y - st.cores[foeT].y);
                if (distance < enemyCoreDistance) { enemyCoreDistance = distance; escortPet = ally; }
            }
            if (escortPet) miniAllyStep(st, m, escortPet.x, escortPet.y);
        }
        return;
    }
    // SIGNATURE moves — every camp boss FIGHTS like a boss, not a piñata.
    if (m.sigWind > 0) {
        m.sigWind--;
        if (m.sigWind === 0 && m.padIdx === 0) {
            // QUAKE lands — the telegraph was the wind-up.
            for (const q of st.pets) {
                if (q.state === "respawning") continue;
                if (hyp2(q.x - m.x, q.y - m.y) <= 2.7) miniStrike(st, m, q, 1.5);
            }
            st.events.push({ t: st.t, type: "bosssig", padIdx: m.padIdx, kind: "quakeland", x: quant(m.x), y: quant(m.y) });
        }
        return;
    }
    if (m.sigActive > 0) m.sigActive--;
    if (m.sigCd > 0) m.sigCd--;
    if (m.attackCd > 0) { m.attackCd--; return; }
    // Territorial neutral: it bites anything that strays near — a WIDE aggro so
    // a pet rotating through the jungle gets pulled into a fight, not just one
    // that walks onto the den (camps sat idle ~94% of the match otherwise).
    // Provoked it chases wider; a home-leash keeps it from being kited off.
    const provoked = m.hp < MINI_HP;
    const homeD = hyp2(m.x - m.homeX, m.y - m.homeY);
    // In the Hollow Collapse the jungle stops mattering — camps must not pull
    // pets off the final base race (it was flipping a decisive match to a clock
    // verdict). They still bite minions and roar; they just don't divert pets.
    const aggroR = st.t > WARFRONT_TPS * WF_PHASE_SUDDEN ? (provoked ? 6.5 : 0) : (provoked ? 6.5 : MINI_AGGRO);
    const acquired = homeD < 8
        ? miniTarget(st, m, () => true, aggroR, Math.max(aggroR, 7.5))
        : { pet: null, distance: aggroR };
    const tgt = acquired.pet;
    const td = acquired.distance;
    if (!tgt && homeD >= 8) m.targetId = null;
    if (tgt && m.sigCd <= 0) {
        m.sigCd = Math.round(WARFRONT_TPS * 6.5);
        if (m.padIdx === 0) {
            m.sigWind = 20;   // QUAKE telegraph — get out of the ring
            st.events.push({ t: st.t, type: "bosssig", padIdx: 0, kind: "quake", x: quant(m.x), y: quant(m.y) });
            return;
        }
        if (m.padIdx === 1) {
            m.sigActive = WARFRONT_TPS * 4;   // CRYSTAL SHELL — attackers bleed
            st.events.push({ t: st.t, type: "bosssig", padIdx: 1, kind: "shell", x: quant(m.x), y: quant(m.y) });
        } else if (m.padIdx === 2 && td > 1.3) {
            // BLINK behind the quarry.
            const db = hyp2(tgt.x - m.x, tgt.y - m.y) || 1;
            const bx = tgt.x + ((tgt.x - m.x) / db) * 1.1, by = tgt.y + ((tgt.y - m.y) / db) * 1.1;
            const [bc2, br2] = cellOf(bx, by);
            if (wfCellWalkable(bc2, br2)) { m.x = bx; m.y = by; m.path = null; m.navGoal = -1; }
            st.events.push({ t: st.t, type: "bosssig", padIdx: 2, kind: "blink", x: quant(m.x), y: quant(m.y) });
        } else if (m.padIdx === 3) {
            // FLAME GOUT — a forward cone of fire.
            for (const q of st.pets) {
                if (q.state === "respawning") continue;
                if ((q.x - m.x) * m.faceX > 0 && Math.abs(q.y - m.y) < 2.2 && hyp2(q.x - m.x, q.y - m.y) < 3.4) miniStrike(st, m, q, 1.2);
            }
            st.events.push({ t: st.t, type: "bosssig", padIdx: 3, kind: "flame", x: quant(m.x), y: quant(m.y) });
        }
    }
    if (!tgt) {
        // Slow recovery only — a 240/s reset-heal made every camp fight
        // that briefly broke contact unwinnable (0 camp kills across seeds).
        m.hp = Math.min(MINI_HP, m.hp + (provoked ? 0.5 : 1.5));
        // Bite a stray minion that wanders through the camp — ambient menace so
        // the boss is visibly DOING something between pet fights.
        if (m.attackCd <= 0) {
            let mob: WfMob | null = null, mdd = 2.8;
            for (const mm of st.mobs) { const d = hyp2(mm.x - m.x, mm.y - m.y); if (d < mdd) { mdd = d; mob = mm; } }
            if (mob) {
                m.attackCd = MINI_CD;
                m.faceX = mob.x >= m.x ? 1 : -1;
                mob.hp -= MINI_DMG;
                st.events.push({ t: st.t, type: "mobhit", x: quant(mob.x), y: quant(mob.y), targetId: `mini-${m.padIdx}` });
                if (mob.hp <= 0) mobDown(st, mob, null);
                return;
            }
        }
        // Every ~15s an uncontested boss ROARS (staggered per camp) — reads as a
        // living threat on camera, not a statue pacing an empty ring.
        if ((st.t + m.padIdx * 90) % (WARFRONT_TPS * 15) === 0) {
            st.events.push({ t: st.t, type: "bosssig", padIdx: m.padIdx, kind: "roar", x: quant(m.x), y: quant(m.y) });
        }
        // Prowl a slow deterministic loop around the den. miniNavigate routes
        // around bordering rocks/trees instead of freezing against them.
        const ang = (st.t / WARFRONT_TPS) * 0.16 + m.padIdx * 1.9;
        const gx2 = m.homeX + dcos(ang) * 1.5, gy2 = m.homeY + dsin(ang) * 1.1;
        miniNavigate(m, gx2, gy2, 0.7);
        return;
    }
    m.faceX = tgt.x >= m.x ? 1 : -1;
    if (td <= MINI_ATTACK_REACH) {
        m.attackCd = MINI_CD;
        let dmg = Math.round(MINI_DMG * (100 / (100 + tgt.def)));
        if (tgt.shieldHp > 0) { const soak = Math.min(tgt.shieldHp, dmg); tgt.shieldHp -= soak; dmg -= soak; }
        tgt.hp = Math.max(0, tgt.hp - dmg);
        st.events.push({ t: st.t, type: "hit", targetId: tgt.id, actorId: `mini-${m.padIdx}`, dmg, crit: false });
        if (tgt.hp <= 0 && tgt.state !== "respawning") {
            tgt.state = "respawning";
            tgt.respawnLeft = RESPAWN_BASE + Math.floor(st.t / (WARFRONT_TPS * 60)) * RESPAWN_PER_MIN;
            st.events.push({ t: st.t, type: "kill", targetId: tgt.id, actorId: `mini-${m.padIdx}`, team: other(tgt.team) });
        }
    } else {
        const step = 1.0 / WARFRONT_TPS;
        const nx = m.x + ((tgt.x - m.x) / td) * step, ny = m.y + ((tgt.y - m.y) / td) * step;
        const [cc, cr] = cellOf(nx, ny);
        if (wfCellWalkable(cc, cr)) { m.x = nx; m.y = ny; }
    }
}

function minionRoute(lane: WfLaneId, team: Team): Array<[number, number]> {
    const pts = WF_LANES[lane];
    const ordered = team === "blue" ? pts : [...pts].reverse();
    const statue = WF_STATUES[other(team)][lane === "s" ? 1 : 0];
    return [...ordered.map(([x, y]) => [x, y] as [number, number]), [statue[0], statue[1]]];
}

/** Place consecutive waves on subtle parallel launch tracks. They converge on
 * the authored lane after the first waypoint, but no longer materialize on the
 * exact same center point and visually knot before their first step. */
function offsetMobSpawn(route: Array<[number, number]>, lateral: number): Array<[number, number]> {
    if (route.length < 2 || Math.abs(lateral) < 0.01) return route;
    const [x0, y0] = route[0], [x1, y1] = route[1];
    const dx = x1 - x0, dy = y1 - y0;
    const d = hyp2(dx, dy) || 1;
    const sx = x0 + (-dy / d) * lateral;
    const sy = y0 + (dx / d) * lateral;
    const [c, r] = cellOf(sx, sy);
    if (!wfCellWalkable(c, r)) return route;
    return [[quant(sx), quant(sy)], ...route.slice(1)];
}

function mobDown(st: WfState, m: WfMob, killer: WfPet | null) {
    if (killer) {
        const pay = m.side === "hollow" ? WF_COIN_MOB : WF_COIN_MINION;
        st.coins[killer.team] += pay;
        killer.coinsEarned += pay;
        grantXp(st, killer, m.side === "hollow" ? 70 : 40);
        st.events.push({ t: st.t, type: "mobkill", mobId: m.id, x: quant(m.x), y: quant(m.y), team: killer.team });
    }
    st.mobs = st.mobs.filter((q) => q !== m);
}

/** Wall-checked mob step with axis sliding — mobs may never leave the
 * walkable mask, no matter what lured (chases) or shoved (separation) them.
 * They used to end up parked ON the jungle walls in the dark. */
function mobStep(m: WfMob, dx: number, dy: number) {
    const [c, r] = cellOf(m.x + dx, m.y + dy);
    if (wfCellWalkable(c, r)) { m.x += dx; m.y += dy; return; }
    const [xc, xr] = cellOf(m.x + dx, m.y);
    if (wfCellWalkable(xc, xr)) { m.x += dx; return; }
    const [yc, yr] = cellOf(m.x, m.y + dy);
    if (wfCellWalkable(yc, yr)) m.y += dy;
}
const MOB_EL: Record<WfMob["side"], string> = { blue: "Water", red: "Fire", hollow: "Shadow" };

function mobsTick(st: WfState) {
    // TEAM MINION WAVES — every lane, both bases, marching to clash mid-lane
    // exactly like the video's loop. Capped per side.
    st.waveTimer--;
    if (st.waveTimer <= 0) {
        st.waveTimer = WAVE_EVERY;
        // Waves always land on an even tick, so a fixed blue,red spawn order gave
        // blue a systematic first-mover lane edge — alternate it per wave.
        const waveTeams: readonly Team[] = (Math.floor(st.t / WAVE_EVERY) & 1) === 0 ? ["blue", "red"] : ["red", "blue"];
        const waveIndex = Math.floor(st.t / WAVE_EVERY);
        for (const team of waveTeams) {
            let alive = st.mobs.filter((m) => m.side === team).length;
            for (const lane of ["n", "m", "s"] as const) {
                if (alive >= MINION_CAP) break;   // was checked against a STALE count → up to 2 over cap
                const trackCycle = [-0.42, 0, 0.42] as const;
                // Same track for mirrored teams preserves competitive symmetry;
                // north/south invert so the field also remains y-balanced.
                const laneSign = lane === "n" ? -1 : 1;
                const route = offsetMobSpawn(minionRoute(lane, team), trackCycle[(waveIndex + (lane === "m" ? 1 : 0)) % trackCycle.length] * laneSign);
                const elite = (st.wardenBuff.team === team && st.wardenBuff.left > 0) || st.t > WARFRONT_TPS * WF_PHASE_SUDDEN || st.eliteWaveOwed[team];
                const mhp = elite ? Math.round(MINION_HP * 1.8) : MINION_HP;
                st.mobs.push({ id: st.mobSeq++, side: team, elite, lane, x: route[0][0], y: route[0][1], hp: mhp, maxHp: mhp, toward: other(team), route, wpIdx: 1, attackCd: 0, chaseId: null });
                alive++;
            }
            st.eliteWaveOwed[team] = false;   // the Devourer's gift is one wave
        }
    }
    // HOLLOW RAIDERS — the breach keeps disgorging until its Warden falls.
    if (st.boss.alive) {
        st.mobTimer--;
        if (st.mobTimer <= 0 && st.mobs.filter((m) => m.side === "hollow").length + 2 <= MOB_CAP) {
            st.mobTimer = MOB_EVERY;
            const LANE_CYCLE: readonly WfLaneId[] = ["n", "m", "s"];
            const lane = LANE_CYCLE[st.mobSeq % 3];
            for (const toward of ["blue", "red"] as const) {
                const route = offsetMobSpawn(wfMobRoute(lane, toward), toward === "blue" ? -0.48 : 0.48);
                st.mobs.push({ id: st.mobSeq++, side: "hollow", elite: false, lane, x: route[0][0], y: route[0][1], hp: MOB_HP, maxHp: MOB_HP, toward, route, wpIdx: 1, attackCd: 0, chaseId: null });
            }
            st.events.push({ t: st.t, type: "mobwave" });
        }
    }
    for (const m of st.mobs) {
        if (m.hp <= 0) continue;   // killed earlier THIS tick (st.mobs was reassigned mid-loop) — no ghost turn
        if (m.attackCd > 0) m.attackCd--;
        const hostileTo = (side: WfMob["side"]) => side !== m.side;
        // 1) Enemy mob in reach → the wave GRINDS (minion-vs-minion front line).
        let foeMob: WfMob | null = null, fmd = 2.4;
        for (const q of st.mobs) {
            if (!hostileTo(q.side)) continue;
            const d = hyp2(q.x - m.x, q.y - m.y);
            if (d < fmd) { fmd = d; foeMob = q; }
        }
        if (foeMob) {
            if (fmd <= 1.2) {
                if (m.attackCd <= 0) {
                    m.attackCd = MOB_CD;
                    foeMob.hp -= (m.side === "hollow" ? MOB_DMG_PET : MINION_DMG) * (m.elite ? 1.5 : 1);
                    st.events.push({ t: st.t, type: "mobstrike", x: quant(foeMob.x), y: quant(foeMob.y), el: MOB_EL[m.side] });
                    if (foeMob.hp <= 0) mobDown(st, foeMob, null);
                }
            } else {
                mobStep(m, ((foeMob.x - m.x) / fmd) * MOB_SPEED, ((foeMob.y - m.y) / fmd) * MOB_SPEED);
            }
            continue;
        }
        // 2) Enemy pet close by (hollow raiders hate everyone).
        let tgt: WfPet | null = null, td = MOB_AGGRO;
        // Stay on the same valid quarry through the wider chase radius. Merely
        // widening the nearest-enemy scan still changed targets every tick.
        if (m.chaseId) {
            const locked = st.pets.find((pet) =>
                pet.id === m.chaseId
                && pet.state !== "respawning"
                && (m.side === "hollow" || pet.team !== m.side));
            if (locked) {
                const d = hyp2(locked.x - m.x, locked.y - m.y);
                if (d < MOB_CHASE) { tgt = locked; td = d; }
            }
        }
        if (!tgt) {
            td = MOB_AGGRO;
            for (const pp of st.pets) {
                if (pp.state === "respawning") continue;
                if (m.side !== "hollow" && pp.team === m.side) continue;
                const d = hyp2(pp.x - m.x, pp.y - m.y);
                if (d < td) { td = d; tgt = pp; }
            }
        }
        m.chaseId = tgt ? tgt.id : null;
        if (tgt) {
            if (td <= 1.1) {
                if (m.attackCd <= 0) {
                    m.attackCd = MOB_CD;
                    let dmg = Math.round((m.side === "hollow" ? MOB_DMG_PET : MINION_DMG) * (100 / (100 + tgt.def)));
                    if (tgt.shieldHp > 0) { const soak = Math.min(tgt.shieldHp, dmg); tgt.shieldHp -= soak; dmg -= soak; }
                    tgt.hp = Math.max(0, tgt.hp - dmg);
                    st.events.push({ t: st.t, type: "mobstrike", x: quant(tgt.x), y: quant(tgt.y), el: MOB_EL[m.side] });
                    if (tgt.hp <= 0 && tgt.state !== "respawning") {
                        tgt.state = "respawning";
                        tgt.respawnLeft = RESPAWN_BASE + Math.floor(st.t / (WARFRONT_TPS * 60)) * RESPAWN_PER_MIN;
                        st.events.push({ t: st.t, type: "kill", targetId: tgt.id, actorId: `mob-${m.id}`, team: m.side === "hollow" ? other(tgt.team) : (m.side as Team) });
                    }
                }
            } else {
                mobStep(m, ((tgt.x - m.x) / td) * MOB_SPEED, ((tgt.y - m.y) / td) * MOB_SPEED);
            }
            continue;
        }
        // 3) Structures: enemy sentinels in the path, then the destination base.
        const destGuards = st.guardians[m.toward];
        let hitGuard = false;
        for (const gg of destGuards) {
            if (!gg.alive) continue;
            if (hyp2(gg.x - m.x, gg.y - m.y) <= 1.3) {
                if (m.attackCd <= 0) {
                    m.attackCd = MOB_CD;
                    gg.hp -= MOB_DMG_STRUCT * (m.elite ? 1.5 : 1) * suddenRamp(st);
                    if (gg.hp <= 0) { gg.alive = false; st.events.push({ t: st.t, type: "guardiandown", team: m.toward, idx: destGuards.indexOf(gg), by: other(m.toward) }); }
                }
                hitGuard = true;
                break;
            }
        }
        if (hitGuard) continue;
        const destStatues = st.statues[m.toward];
        let struckStructure = false;
        for (const [i, s] of destStatues.entries()) {
            if (!s.alive) continue;
            const d = hyp2(s.x - m.x, s.y - m.y);
            if (d <= 1.2) {
                if (m.attackCd <= 0) {
                    m.attackCd = MOB_CD;
                    s.hp -= MOB_DMG_STRUCT * (m.elite ? 1.5 : 1) * suddenRamp(st) * wardMul(st, m.toward, i);
                    st.events.push({ t: st.t, type: "structhit", team: m.toward, statue: i, x: quant(s.x), y: quant(s.y) });
                    if (s.hp <= 0) {
                        s.alive = false;
                        st.events.push({ t: st.t, type: "statuedown", team: m.toward, statue: i, by: other(m.toward) });
                        if (!destStatues[0].alive && !destStatues[1].alive) { st.rally[m.toward] = WARFRONT_TPS * 45; st.events.push({ t: st.t, type: "coreexposed", team: m.toward }); }
                    }
                }
                struckStructure = true;
                break;
            }
        }
        if (struckStructure) continue;
        const core = st.cores[m.toward];
        const exposed = !destStatues[0].alive && !destStatues[1].alive;
        if (core.alive && exposed && hyp2(core.x - m.x, core.y - m.y) <= 1.2) {
            if (m.attackCd <= 0) {
                m.attackCd = MOB_CD;
                core.hp -= MOB_DMG_STRUCT * (m.elite ? 1.5 : 1) * suddenRamp(st);
                core.sinceHit = 0;
                st.events.push({ t: st.t, type: "structhit", team: m.toward, core: true, x: quant(core.x), y: quant(core.y) });
                if (core.hp <= 0) {
                    core.alive = false;
                    st.winner = other(m.toward);
                    st.events.push({ t: st.t, type: "coredown", team: m.toward, by: other(m.toward) });
                }
            }
            continue;
        }
        // 4) March the lane.
        if (m.wpIdx < m.route.length) {
            const [wx, wy] = m.route[m.wpIdx];
            const dx = wx - m.x, dy = wy - m.y;
            const d = hyp2(dx, dy);
            if (d < 0.3) m.wpIdx++;
            else mobStep(m, (dx / d) * MOB_SPEED, (dy / d) * MOB_SPEED);
        }
    }
}

// ── Crowd separation ─────────────────────────────────────────────────────────
function mobSeparation(st: WfState) {
    for (let i = 0; i < st.mobs.length; i++) {
        for (let j = i + 1; j < st.mobs.length; j++) {
            const a = st.mobs[i], b = st.mobs[j];
            if (a.side !== b.side) continue;
            let dx = b.x - a.x, dy = b.y - a.y;
            let d = hyp2(dx, dy);
            if (d <= 1e-6) {
                const angle = ((a.id * 37 + b.id * 17) % 360) * Math.PI / 180;
                dx = Math.cos(angle) * 0.01; dy = Math.sin(angle) * 0.01; d = 0.01;
            }
            if (d < 0.9) {
                const push = (0.9 - d) * 0.35;
                const nx = dx / d, ny = dy / d;
                mobStep(a, -nx * push, -ny * push);
                mobStep(b, nx * push, ny * push);
            }
        }
    }
}

function separation(st: WfState) {
    const live = st.pets.filter((p) => p.state !== "respawning" && p.dashLeft <= 0);
    for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
            const a = live[i], b = live[j];
            let dx = b.x - a.x, dy = b.y - a.y;
            let d = hyp2(dx, dy);
            if (d <= 1e-6) {
                const angle = ((a.slot * 97 + b.slot * 53 + (a.team === "blue" ? 0 : 181)) % 360) * Math.PI / 180;
                dx = Math.cos(angle) * 0.01; dy = Math.sin(angle) * 0.01; d = 0.01;
            }
            if (d < BODY_R * 2) {
                const push = (BODY_R * 2 - d) * 0.5;
                const nx = dx / d, ny = dy / d;
                const tryMove = (pp: WfPet, mx: number, my: number) => {
                    const [c1, r1] = cellOf(pp.x + mx, pp.y + my);
                    if (petCellWalkable(c1, r1)) { pp.x += mx; pp.y += my; return true; }
                    const [c2, r2] = cellOf(pp.x + mx, pp.y);        // slide along x
                    if (mx !== 0 && petCellWalkable(c2, r2)) { pp.x += mx; return true; }
                    const [c3, r3] = cellOf(pp.x, pp.y + my);        // slide along y
                    if (my !== 0 && petCellWalkable(c3, r3)) { pp.y += my; return true; }
                    return false;
                };
                tryMove(a, -nx * push, -ny * push);
                tryMove(b, nx * push, ny * push);
            }
        }
    }
}

function miniSeparation(st: WfState) {
    const livePets = st.pets.filter((pet) => pet.state !== "respawning" && pet.dashLeft <= 0);
    for (const mini of st.minis) {
        if (!mini.alive) continue;
        for (const pet of livePets) {
            let dx = pet.x - mini.x, dy = pet.y - mini.y;
            let d = hyp2(dx, dy);
            if (d <= 1e-6) {
                const angle = ((pet.slot * 83 + mini.padIdx * 109) % 360) * Math.PI / 180;
                dx = Math.cos(angle) * 0.01; dy = Math.sin(angle) * 0.01; d = 0.01;
            }
            if (d >= MINI_REACH) continue;
            const push = Math.min(0.14, (MINI_REACH - d) * 0.45);
            const nx = dx / d, ny = dy / d;
            const [pc, pr] = cellOf(pet.x + nx * push, pet.y + ny * push);
            if (petCellWalkable(pc, pr)) { pet.x += nx * push; pet.y += ny * push; }
            const [mc, mr] = cellOf(mini.x - nx * push, mini.y - ny * push);
            if (wfCellWalkable(mc, mr)) { mini.x -= nx * push; mini.y -= ny * push; }
        }
    }
}

// ── Snapshot ─────────────────────────────────────────────────────────────────
function petIntent(st: WfState, pet: WfPet): string {
    if (pet.state === "respawning") return "respawn";
    if (pet.retreating) return "recall";
    const calls = st.calls[pet.team];
    if (calls.squad) return `squad:${calls.squad.goal}`;
    const group = calls.assignment[pet.slot] ?? GROUP_OF_SLOT[pet.slot];
    return `${GROUP_LANE[group]}:${calls.groups[group].goal}`;
}

function snapshot(st: WfState): WfSnapshot {
    return {
        t: st.t,
        actors: st.pets.map((p) => ({
            id: p.id, team: p.team, slot: p.slot, role: p.role, element: p.element,
            x: quant(p.x), y: quant(p.y), faceX: quant(p.faceX), faceY: quant(p.faceY),
            hp: Math.round(p.hp), maxHp: Math.round(p.maxHp),
            state: p.state,
            respawnSecs: p.state === "respawning" ? Math.ceil(p.respawnLeft / WARFRONT_TPS) : 0,
            wlevel: p.wlevel,
            stacksTotal: p.stacks.strike + p.stacks.guard + p.stacks.vitality + p.stacks.swift + p.stacks.mend,
            carrying: false as const,
            statuses: [...(p.markLeft > 0 ? ["mark"] : []), ...(p.slowLeft > 0 ? ["slow"] : []), ...(p.rootLeft > 0 ? ["root"] : []), ...(p.retreating ? ["recall"] : [])],
            shielded: p.shieldHp > 0,
            intent: petIntent(st, p),
        })),
        mobs: st.mobs.map((m) => ({
            id: m.id, side: m.side, elite: m.elite, x: quant(m.x), y: quant(m.y),
            hp: Math.round(m.hp), maxHp: Math.round(m.maxHp), toward: m.toward,
            attackPhase: m.attackCd > MOB_CD - MOB_ATTACK_ANIM_TICKS
                ? quant((MOB_CD - m.attackCd) / MOB_ATTACK_ANIM_TICKS)
                : -1,
        })),
        warden: {
            alive: st.boss.alive,
            dead: st.boss.dead,
            hp: Math.max(0, Math.round(st.boss.hp)),
            maxHp: WARDEN_HP,
            x: quant(st.boss.x),
            y: quant(st.boss.y),
            faceX: st.boss.faceX,
            winding: st.boss.windUp > 0,
            windupSecs: Math.ceil(st.boss.windUp / WARFRONT_TPS),
            slamRadius: WARDEN_SLAM_R + (st.boss.phase === 3 ? 0.6 : st.boss.phase === 2 ? 0.25 : 0),
            phase: st.boss.phase,
            resetSecs: st.boss.hp < WARDEN_HP && st.boss.calmTicks > 0 && st.boss.calmTicks < WARDEN_RESET_DELAY
                ? Math.ceil((WARDEN_RESET_DELAY - st.boss.calmTicks) / WARFRONT_TPS)
                : 0,
            resetting: st.boss.hp < WARDEN_HP && st.boss.calmTicks >= WARDEN_RESET_DELAY,
            damage: { blue: Math.round(st.wardenDmg.blue), red: Math.round(st.wardenDmg.red) },
        },
        minis: st.minis.map((m) => ({
            padIdx: m.padIdx,
            alive: m.alive,
            hp: Math.max(0, Math.round(m.hp)),
            maxHp: MINI_HP,
            spawnSecs: m.alive ? 0 : Math.ceil(m.spawnIn / WARFRONT_TPS),
            allySecs: m.ally ? Math.ceil(m.allyLeft / WARFRONT_TPS) : 0,
            x: quant(m.x),
            y: quant(m.y),
            faceX: m.faceX,
            ally: m.ally,
            attackPhase: m.attackCd > MINI_CD - MINI_ATTACK_ANIM_TICKS
                ? quant((MINI_CD - m.attackCd) / MINI_ATTACK_ANIM_TICKS)
                : -1,
        })),
        structures: {
            blue: {
                statues: st.statues.blue.map((s) => ({ x: s.x, y: s.y, hp: Math.max(0, Math.round(s.hp)), maxHp: STATUE_HP, alive: s.alive })),
                core: { x: st.cores.blue.x, y: st.cores.blue.y, hp: Math.max(0, Math.round(st.cores.blue.hp)), maxHp: CORE_HP, alive: st.cores.blue.alive, exposed: !st.statues.blue[0].alive && !st.statues.blue[1].alive },
            },
            red: {
                statues: st.statues.red.map((s) => ({ x: s.x, y: s.y, hp: Math.max(0, Math.round(s.hp)), maxHp: STATUE_HP, alive: s.alive })),
                core: { x: st.cores.red.x, y: st.cores.red.y, hp: Math.max(0, Math.round(st.cores.red.hp)), maxHp: CORE_HP, alive: st.cores.red.alive, exposed: !st.statues.red[0].alive && !st.statues.red[1].alive },
            },
        },
        guardians: {
            blue: st.guardians.blue.map((g) => {
                const attackCd = g.rallyLeft > 0 ? GUARD_RALLY_CD : GUARD_CD;
                return {
                    x: g.x, y: g.y, hp: Math.max(0, Math.round(g.hp)), maxHp: g.maxHp,
                    alive: g.alive, faceX: g.faceX,
                    rallySecs: quant(Math.max(0, g.rallyLeft) / WARFRONT_TPS),
                    attackPhase: g.attackCd > attackCd - GUARD_ATTACK_ANIM_TICKS
                        ? quant((attackCd - g.attackCd) / GUARD_ATTACK_ANIM_TICKS)
                        : -1,
                };
            }),
            red: st.guardians.red.map((g) => {
                const attackCd = g.rallyLeft > 0 ? GUARD_RALLY_CD : GUARD_CD;
                return {
                    x: g.x, y: g.y, hp: Math.max(0, Math.round(g.hp)), maxHp: g.maxHp,
                    alive: g.alive, faceX: g.faceX,
                    rallySecs: quant(Math.max(0, g.rallyLeft) / WARFRONT_TPS),
                    attackPhase: g.attackCd > attackCd - GUARD_ATTACK_ANIM_TICKS
                        ? quant((attackCd - g.attackCd) / GUARD_ATTACK_ANIM_TICKS)
                        : -1,
                };
            }),
        },
        wardenBuff: { team: st.wardenBuff.team, secs: Math.ceil(st.wardenBuff.left / WARFRONT_TPS) },
        coins: { blue: Math.round(st.coins.blue), red: Math.round(st.coins.red) },
        atkBuff: { blue: Math.ceil(st.atkBuff.blue / WARFRONT_TPS), red: Math.ceil(st.atkBuff.red / WARFRONT_TPS) },
        stances: { ...st.stance },
    };
}

function tick(st: WfState, snapshotEvery: number) {
    st.t++;
    // Coin trickle (accumulate fractionally, credit whole coins).
    st.coinFrac += WF_COIN_TRICKLE / WARFRONT_TPS;
    if (st.coinFrac >= 1) {
        const whole = Math.floor(st.coinFrac);
        st.coinFrac -= whole;
        st.coins.blue += whole; st.coins.red += whole;
    }
    if (st.atkBuff.blue > 0) st.atkBuff.blue--;
    if (st.atkBuff.red > 0) st.atkBuff.red--;
    if (st.wardenBuff.left > 0) st.wardenBuff.left--;
    if (st.rally.blue > 0) st.rally.blue--;
    if (st.rally.red > 0) st.rally.red--;
    if (st.t === WARFRONT_TPS * WF_PHASE_SKIRMISH) st.events.push({ t: st.t, type: "phase", name: "SKIRMISH" });
    if (st.t === WARFRONT_TPS * WF_PHASE_WAR) st.events.push({ t: st.t, type: "phase", name: "WAR" });
    if (st.t === WARFRONT_TPS * WF_PHASE_SUDDEN) st.events.push({ t: st.t, type: "phase", name: "SUDDEN DEATH" });
    for (const team of ["blue", "red"] as const) {
        if (st.t >= st.calls[team].until) updateCall(st, team);
        const cs = st.calls[team];
        if (cs.squad && cs.rally && !cs.committed) {
            let together = 0, alive = 0;
            for (const q of st.pets) {
                if (q.team !== team || q.state === "respawning") continue;
                alive++;
                if (hyp2(q.x - cs.rally.x, q.y - cs.rally.y) < 4.5) together++;
            }
            // The gate scales to who can actually show up, and a patience timer
            // breaks the huddle — waiting on a dead teammate froze whole squads.
            const need = Math.min(3, Math.max(1, alive));
            const waited = st.t - (cs.rallySince ?? st.t);
            if (together >= need || waited > WARFRONT_TPS * 6) cs.committed = true;   // sticky — the squad GOES
        }
        const core = st.cores[team];
        if (core.alive) {
            core.sinceHit++;
            const foeNear = st.pets.some((p) => p.team !== team && p.state !== "respawning" && hyp2(p.x - core.x, p.y - core.y) < CORE_SAFE_RANGE)
                || st.mobs.some((m) => m.toward === team && hyp2(m.x - core.x, m.y - core.y) < CORE_SAFE_RANGE);
            // No regen during the Collapse — a besieged Seal must stay cracked.
            if (!foeNear && core.sinceHit > WARFRONT_TPS * 5 && st.t <= WARFRONT_TPS * WF_PHASE_SUDDEN) core.hp = Math.min(CORE_HP, core.hp + CORE_REGEN);
        }
    }
    // Alternate which team decides first each tick. In a reactive AI, acting
    // SECOND (choosing after the enemy's moves are already applied) is an edge —
    // blue-first EVERY tick handed red a measured ~18-point win advantage on
    // mirror matches. Swapping the order each tick removes the systematic
    // first/second-mover bias without restructuring petTick. Deterministic.
    const firstBlue = st.t % 2 === 0;
    const petOrder = firstBlue
        ? [...st.pets.filter((p) => p.team === "blue"), ...st.pets.filter((p) => p.team === "red")]
        : [...st.pets.filter((p) => p.team === "red"), ...st.pets.filter((p) => p.team === "blue")];
    for (const p of petOrder) petTick(st, p);
    separation(st);
    const structOrder: readonly Team[] = firstBlue ? ["blue", "red"] : ["red", "blue"];
    for (const team of structOrder) { statueTick(st, team, 0); statueTick(st, team, 1); guardianTick(st, team, 0); guardianTick(st, team, 1); }
    bossTick(st);
    for (const m of st.minis) miniTick(st, m);
    mobsTick(st);
    // Resolve spacing after movement so the presented frame never captures the
    // one-tick pile-up produced by mobs/minibosses stepping into one another.
    mobSeparation(st);
    miniSeparation(st);
    for (const m of st.mobs) {
        const [mc2, mr2] = cellOf(m.x, m.y);
        if (!wfCellWalkable(mc2, mr2)) {
            const [wc2, wr2] = nearestWalkableCell(m.x, m.y);
            const [wx2, wy2] = cellCenter(wc2, wr2);
            const dd2 = hyp2(wx2 - m.x, wy2 - m.y) || 1;
            const s3 = Math.min(MOB_SPEED * 2, dd2);
            m.x += ((wx2 - m.x) / dd2) * s3; m.y += ((wy2 - m.y) / dd2) * s3;
        }
    }
    for (const p of st.pets) {
        const [pc, pr] = cellOf(p.x, p.y);
        if (!petCellWalkable(pc, pr)) {
            // This is a last-resort invariant repair. Normal navigation and
            // separation are footprint-safe, so a correction should be rare.
            const [wc, wr] = nearestPetWalkableCell(p.x, p.y);
            const [wx2, wy2] = cellCenter(wc, wr);
            p.x = wx2; p.y = wy2; p.path = null; p.navGoal = -1;
        }
        p.x = quant(clamp(p.x, -WF_X, WF_X)); p.y = quant(clamp(p.y, -WF_Y, WF_Y));
        // NET-movement watchdog: separation (and every other shove) can cancel
        // a whole walk step — count "stuck" from what ACTUALLY happened this
        // tick, not from walkToward's intent. Feeds the sidestep + repath.
        // Half-speed threshold + decay (not reset): boundary jitter in a body
        // jam produces the occasional "good" tick that must not clear the count.
        if (p.state === "move" && p.wantD > 0.6
            && hyp2(p.x - p.lastX, p.y - p.lastY) < p.moveSpeed * 0.5) p.stuckTicks++;
        else p.stuckTicks = Math.max(0, p.stuckTicks - 2);
        p.lastX = p.x; p.lastY = p.y;
        p.wantD = 0;
    }
    // Gameplay always advances at 30 Hz. Presentation callers may retain a
    // lower-rate replay stream and interpolate between frames, avoiding tens of
    // thousands of nested snapshot allocations without changing simulation.
    if (st.t % snapshotEvery === 0 || st.winner !== null) st.snapshots.push(snapshot(st));
}

// ── Buying ───────────────────────────────────────────────────────────────────
/** Capturing a Lesser Warden issues a map-wide field order: surviving
 * sentinels repair slightly, overcharge their lane coverage, and begin warding
 * nearby allied pets while the captured boss leads the counter-push. */
function activateGuardianRally(st: WfState, team: Team, padIdx: number) {
    const living = st.guardians[team].filter((guardian) => guardian.alive);
    if (living.length === 0) return;
    for (const guardian of living) {
        guardian.rallyLeft = Math.max(guardian.rallyLeft, GUARD_RALLY_DURATION);
        guardian.rallyPulse = 1;
        guardian.attackCd = 0;
        guardian.hp = Math.min(guardian.maxHp, guardian.hp + Math.round(guardian.maxHp * 0.06));
    }
    st.events.push({
        t: st.t, type: "guardianrally", team, padIdx,
        secs: Math.ceil(GUARD_RALLY_DURATION / WARFRONT_TPS),
    });
}

function applyPowerup(st: WfState, team: Team, petSlot: number, kind: WfPowerupKind): boolean {
    const pet = st.pets.find((p) => p.team === team && p.slot === petSlot);
    if (!pet) return false;
    // Choices cross a worker boundary, so the union is not a runtime guarantee.
    // Resolve only the five supported keys before any computed array access.
    let kindIdx: number;
    let currentStacks: number;
    if (kind === "strike") { kindIdx = 0; currentStacks = pet.stacks.strike; }
    else if (kind === "guard") { kindIdx = 1; currentStacks = pet.stacks.guard; }
    else if (kind === "vitality") { kindIdx = 2; currentStacks = pet.stacks.vitality; }
    else if (kind === "swift") { kindIdx = 3; currentStacks = pet.stacks.swift; }
    else if (kind === "mend") { kindIdx = 4; currentStacks = pet.stacks.mend; }
    else return false;
    if (currentStacks >= WF_STACK_CAP) return false;
    const cost = wfPowerupCost(st.stacksBought[team][petSlot][kindIdx]);
    if (st.coins[team] < cost) return false;
    st.coins[team] -= cost;
    st.stacksBought[team][petSlot][kindIdx]++;
    switch (kind) {
        case "strike":
            pet.stacks.strike++;
            pet.atk = pet.baseAtk * (1 + 0.05 * pet.stacks.strike);
            break;
        case "guard":
            pet.stacks.guard++;
            pet.def = pet.baseDef * (1 + 0.05 * pet.stacks.guard);
            break;
        case "vitality": {
            pet.stacks.vitality++;
            const prevMax = pet.maxHp;
            pet.maxHp = pet.baseMaxHp * (1 + 0.07 * pet.stacks.vitality);
            pet.hp = Math.min(pet.maxHp, pet.hp + (pet.maxHp - prevMax));
            break;
        }
        case "swift":
            pet.stacks.swift++;
            pet.moveSpeed = pet.baseSpeed * (1 + 0.04 * pet.stacks.swift);
            break;
        case "mend":
            pet.stacks.mend++;
            pet.regen = (pet.baseMaxHp * 0.004 * pet.stacks.mend) / WARFRONT_TPS;
            break;
    }
    st.events.push({ t: st.t, type: "buy", team, petId: pet.id, kind, cost });
    return true;
}

/** Every council is a battlefield redeploy, not just a shop. The squad gains a
 * short-lived visible ward and ultimate tempo based on how decisively it spent.
 * This also gives a coin-starved team a small regrouping floor, so opening the
 * council is always consequential. */
function applyCouncilSurge(st: WfState, team: Team, buys: number, spent: number) {
    const shieldPct = Math.min(14, 5 + buys * 1.5);
    const ult = Math.min(18, 6 + buys * 3);
    for (const pet of st.pets) {
        if (pet.team !== team || pet.state === "respawning") continue;
        pet.shieldHp = Math.max(pet.shieldHp, Math.round(pet.maxHp * shieldPct / 100));
        pet.ult = Math.min(100, pet.ult + ult);
    }
    st.events.push({
        t: st.t, type: "council", team, buys, spent,
        shieldPct: Math.round(shieldPct * 10) / 10, ult, stance: st.stance[team],
    });
}

function autoBuy(st: WfState, team: Team, policy: WfBuyPolicy) {
    if (policy === "off") return;
    const kinds = POLICY_KINDS[policy];
    // Greedy: rotate the policy's preference list across pets (lowest total
    // stacks first) while the team can afford the next stack. Deterministic.
    for (let guard = 0; guard < 40; guard++) {
        const pets = st.pets.filter((p) => p.team === team).sort((a, b) =>
            (a.stacks.strike + a.stacks.guard + a.stacks.vitality + a.stacks.swift + a.stacks.mend)
            - (b.stacks.strike + b.stacks.guard + b.stacks.vitality + b.stacks.swift + b.stacks.mend) || a.slot - b.slot);
        let bought = false;
        for (const pet of pets) {
            const petKinds = policy === "balanced" ? ROLE_BALANCED_BUYS[pet.role] : kinds;
            for (const kind of petKinds) {
                if (pet.stacks[kind] >= WF_STACK_CAP) continue;
                if (applyPowerup(st, team, pet.slot, kind)) { bought = true; break; }
            }
            if (bought) break;
        }
        if (!bought) break;
    }
}

// ── The AI stance brain ──────────────────────────────────────────────────────
/** Deterministic macro coach for a non-interactive side: answer a lopsided
 * scoreboard first, otherwise counter the opponent's declared stance. */
function aiStance(st: WfState, team: Team): WfStance {
    const foe = other(team);
    const downed = (tm: Team) => st.statues[tm].filter((s) => !s.alive).length + (st.cores[tm].alive ? 0 : 1);
    const myPts = downed(foe), foePts = downed(team);
    let myK = 0, foeK = 0;
    for (const q of st.pets) { if (q.team === team) myK += q.kills; else foeK += q.kills; }
    if (foePts > myPts) return st.minis.some((m) => m.alive && !m.ally) ? "jungle" : "siege";   // behind → invade the jungle to recruit a comeback boss, else race
    if (foeK - myK >= 3) return "turtle";      // bleeding kills — stop feeding
    if (myK - foeK >= 3) return "headhunt";    // winning fights — press the blade
    // Note the cycle passes through JUNGLE (vs a turtle you take the whole
    // map's trophies) — a closed siege→headhunt→turtle loop once locked every
    // adaptive match out of camps-enabled stances entirely.
    const counter: Record<WfStance, WfStance> = { siege: "headhunt", headhunt: "turtle", turtle: "jungle", jungle: "siege", balanced: "jungle" };
    return counter[st.stance[foe]];
}
function setStance(st: WfState, team: Team, stance: WfStance, answer: boolean) {
    if (st.stance[team] === stance) return;
    st.stance[team] = stance;
    st.events.push({ t: st.t, type: "stance", team, stance, answer });
}

// ── Public API ───────────────────────────────────────────────────────────────
export interface WarfrontMatchCtl {
    readonly result: WarfrontResult;
    readonly done: boolean;
    readonly round: number;                    // rounds fully simulated so far
    /** Current per-pet powerup prices + stacks for the interactive buy UI. */
    buyState(team: Team): Array<{ petId: string; petName: string; stacks: Record<WfPowerupKind, number>; costs: Record<WfPowerupKind, number> }>;
    coins(team: Team): number;
    stances(): Record<Team, WfStance>;
    /** Apply the player's choices for this boundary (unaffordable/capped ones
     * are skipped), auto-buy for the AI/auto sides, then sim the next 90 s. */
    advanceRound(blueChoices?: WarfrontChoice[], blueStance?: WfStance): void;
    /** STREAMED alternative to advanceRound: sims up to `maxTicks` of the
     * current round per call (round-start buys/stances apply on the first call
     * of each round), returning true when the round or match completes. The
     * renderer pumps this a few ms per frame — the synchronous advanceRound
     * froze the main thread ~1 s at every 90 s boundary. Identical tick
     * sequence, so determinism and replays are unchanged. */
    advanceRoundPartial(maxTicks: number, blueChoices?: WarfrontChoice[], blueStance?: WfStance): boolean;
}

// A team's DOCTRINE is a pre-match boon baked into every pet at kickoff (a
// second strategic axis to the stance). Deterministic, sealed into the
// reward re-sim like the stance. Warden\u2019s Pact is checked at recruit time.
function applyDoctrine(pt: WfPet, doc: WfDoctrine) {
    // Strong, legible identities. These values intentionally match the lobby
    // contract: the pregame declaration is a build-defining commitment.
    if (doc === "vanguard") { pt.atk *= 1.08; pt.baseAtk *= 1.08; }
    else if (doc === "bulwark") { const wounded = pt.maxHp - pt.hp; pt.maxHp *= 1.12; pt.baseMaxHp *= 1.12; pt.hp = Math.max(1, pt.maxHp - wounded); }
    else if (doc === "zealot") { pt.moveSpeed *= 1.1; pt.baseSpeed *= 1.1; }
}

export function startWarfrontMatch(
    blue: ArenaSlot[], red: ArenaSlot[], seed: number,
    opts?: {
        bluePolicy?: WfBuyPolicy; redPolicy?: WfBuyPolicy; theme?: string;
        blueStance?: WfStance; redStance?: WfStance;
        blueDoctrine?: WfDoctrine; redDoctrine?: WfDoctrine;
        /** false = stances stay fixed all match (balance-matrix runs). */
        adaptStances?: boolean;
        /** Retained presentation cadence. Gameplay remains 30 Hz; a value of 2
         * records 15 visual frames per second. Defaults to every tick for
         * authority/parity callers. */
        snapshotEvery?: number;
    },
): WarfrontMatchCtl {
    const st = initState(blue, red, seed);
    const bluePolicy = opts?.bluePolicy ?? "off";
    const redPolicy = opts?.redPolicy ?? "balanced";
    const adapt = opts?.adaptStances ?? true;
    const snapshotEvery = Math.max(1, Math.min(WARFRONT_TPS, Math.floor(opts?.snapshotEvery ?? 1)));
    // Opening declarations: both teams announce a stance at 0:00. The AI side
    // counter-picks the player's opening unless one was forced in.
    st.stance.blue = opts?.blueStance ?? "balanced";
    st.events.push({ t: 0, type: "stance", team: "blue", stance: st.stance.blue, answer: false });
    st.stance.red = opts?.redStance ?? (adapt ? aiStance(st, "red") : "balanced");
    st.doctrine.blue = opts?.blueDoctrine ?? "none";
    st.doctrine.red = opts?.redDoctrine ?? "none";
    for (const pt of st.pets) applyDoctrine(pt, st.doctrine[pt.team]);
    st.events.push({ t: 0, type: "stance", team: "red", stance: st.stance.red, answer: true });
    const result: WarfrontResult = { winner: null, ticks: 0, snapshots: st.snapshots, events: st.events, theme: opts?.theme, coins: st.coins };
    st.snapshots.push(snapshot(st));
    let round = 0;
    let roundOpen = false;   // round-start buys/stances applied, ticks still owed
    const openRound = (blueChoices?: WarfrontChoice[], blueStance?: WfStance) => {
        if (round > 0) {
            st.events.push({ t: st.t, type: "round", round });
            // Stances first: the player's adjustment, the auto side's coach,
            // then the AI's counter-read of the new state of the war.
            if (blueStance) setStance(st, "blue", blueStance, false);
            else if (adapt && bluePolicy !== "off") setStance(st, "blue", aiStance(st, "blue"), false);
            if (adapt) setStance(st, "red", aiStance(st, "red"), true);
            const blueCoins = st.coins.blue;
            const blueEventStart = st.events.length;
            if (blueChoices) for (const c of blueChoices) applyPowerup(st, "blue", c.petIndex, c.kind);
            else autoBuy(st, "blue", bluePolicy);
            const blueBuys = st.events.slice(blueEventStart).filter((event) => event.type === "buy" && event.team === "blue").length;
            applyCouncilSurge(st, "blue", blueBuys, Math.round(blueCoins - st.coins.blue));

            const redCoins = st.coins.red;
            const redEventStart = st.events.length;
            autoBuy(st, "red", redPolicy);
            const redBuys = st.events.slice(redEventStart).filter((event) => event.type === "buy" && event.team === "red").length;
            applyCouncilSurge(st, "red", redBuys, Math.round(redCoins - st.coins.red));
        }
        roundOpen = true;
    };
    const finishRound = () => {
        if (st.snapshots[st.snapshots.length - 1]?.t !== st.t) st.snapshots.push(snapshot(st));
        round++;
        roundOpen = false;
        result.petStats = st.pets.map((pp) => ({ id: pp.id, name: pp.pet.name, team: pp.team, level: pp.wlevel, kills: pp.kills, assists: pp.assists, dmg: Math.round(pp.dmgDealt), coins: pp.coinsEarned }));
        if (st.winner !== null) result.winner = st.winner;
        else if (st.t >= MAX_TICKS) {
            // Timer verdict: structures destroyed, then coins.
            const downed = (team: Team) => st.statues[team].filter((s) => !s.alive).length + (st.cores[team].alive ? 0 : 1);
            const blueScore = downed("red"), redScore = downed("blue");
            result.winner = blueScore !== redScore
                ? (blueScore > redScore ? "blue" : "red")
                : st.coins.blue !== st.coins.red ? (st.coins.blue > st.coins.red ? "blue" : "red") : "draw";
        }
    };
    const simChunk = () => {
        const until = Math.min(MAX_TICKS, (round + 1) * ROUND_TICKS);
        while (st.t < until && st.winner === null) tick(st, snapshotEvery);
        result.ticks = st.t;
        finishRound();
    };
    return {
        get result() { return result; },
        get done() { return result.winner !== null; },
        get round() { return round; },
        coins: (team) => Math.floor(st.coins[team]),
        stances: () => ({ ...st.stance }),
        buyState: (team) => st.pets.filter((p) => p.team === team).map((p) => ({
            petId: p.id,
            petName: p.pet.name,
            stacks: { ...p.stacks },
            costs: {
                strike: wfPowerupCost(st.stacksBought[team][p.slot][0]),
                guard: wfPowerupCost(st.stacksBought[team][p.slot][1]),
                vitality: wfPowerupCost(st.stacksBought[team][p.slot][2]),
                swift: wfPowerupCost(st.stacksBought[team][p.slot][3]),
                mend: wfPowerupCost(st.stacksBought[team][p.slot][4]),
            },
        })),
        advanceRound(blueChoices?: WarfrontChoice[], blueStance?: WfStance) {
            if (result.winner !== null) return;
            if (!roundOpen) openRound(blueChoices, blueStance);
            simChunk();
        },
        advanceRoundPartial(maxTicks: number, blueChoices?: WarfrontChoice[], blueStance?: WfStance) {
            if (result.winner !== null) return true;
            if (!roundOpen) openRound(blueChoices, blueStance);
            const until = Math.min(MAX_TICKS, (round + 1) * ROUND_TICKS);
            let n = 0;
            while (st.t < until && st.winner === null && n < maxTicks) { tick(st, snapshotEvery); n++; }
            result.ticks = st.t;   // the frontier streams forward as ticks land
            if (st.t >= until || st.winner !== null) { finishRound(); return true; }
            return false;
        },
    };
}

/** Full-auto match (tests, AI previews, and shared co-op replays where both
 * sides' buy policies are locked at the lobby). Deterministic from arguments. */
export function runWarfrontMatch(
    blue: ArenaSlot[], red: ArenaSlot[], seed: number,
    bluePolicy: WfBuyPolicy = "balanced", redPolicy: WfBuyPolicy = "balanced", theme?: string,
    stances?: { blue?: WfStance; red?: WfStance; adapt?: boolean },
    doctrines?: { blue?: WfDoctrine; red?: WfDoctrine },
): WarfrontResult {
    const ctl = startWarfrontMatch(blue, red, seed, {
        bluePolicy, redPolicy, theme,
        blueStance: stances?.blue, redStance: stances?.red, adaptStances: stances?.adapt,
        blueDoctrine: doctrines?.blue, redDoctrine: doctrines?.red,
    });
    let guard = 0;
    while (!ctl.done && guard++ < Math.ceil(MAX_TICKS / ROUND_TICKS) + 2) ctl.advanceRound();
    return ctl.result;
}
