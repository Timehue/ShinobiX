// ─────────────────────────────────────────────────────────────────────────────
// pet-duel-sim.ts — Phase A of the pet-combat redesign (docs/pet-combat-redesign-plan.md).
//
// A CONTINUOUS-feel, fixed-timestep, DETERMINISTIC melee duel. Two pets fight in
// real (sim) time: they approach, dash in, telegraph a wind-up, strike (hit or
// whiff), recover, get staggered/interrupted, and reactively dodge — instead of
// resolving discrete rounds. The renderer (Phase C) interpolates between tick
// snapshots for fully fluid visuals; this core stays bit-reproducible.
//
// DETERMINISM CONTRACT (load-bearing for ranked — see the plan §0/§6):
//   • The result is a pure function of (playerPet, enemyPet, seed). Same inputs
//     anywhere → byte-identical snapshots + events. NO Math.random, NO Date /
//     wall-clock, NO non-IEEE transcendentals (sin/cos/atan2/pow/exp/log are
//     BANNED — they vary across JS engines). Only +,-,*,/,Math.sqrt/min/max/
//     round/floor/abs are used (all IEEE-correctly-rounded → cross-machine
//     identical), plus a seeded LCG for all randomness.
//   • State is QUANTIZED to 1/256 each tick so float error can never accumulate
//     or diverge between machines.
//   • Iteration order is fixed (player stepped before enemy). Do not reorder.
//
// This engine is NOT wired to anything live. It runs PvE behind a flag once the
// renderer consumes it (Phase C); ranked stays on the old engine until balance
// (Phase D) and server validation (Phase E) are proven. Consumes only persisted
// Pet fields (hp/attack/defense/speed) so saves are untouched.
// ─────────────────────────────────────────────────────────────────────────────
import type { Pet } from "../types/pet";

export const DUEL_TPS = 30;                 // sim ticks per second
const MAX_TICKS = DUEL_TPS * 25;            // 25s hard cap (mirrors the old 30-round cap)
const Q = 256;                              // state quantization (1/256 unit)
const quant = (n: number) => Math.round(n * Q) / Q;
const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

// Arena footprint (world units), matching the coliseum (ARENA_HALF 7×4 → fights
// fit the existing stage). Pets spawn at opposite ends and close the distance.
const ARENA_X = 6.3;
const ARENA_Y = 3.4;
const SPAWN_X = 5.0;

// Stamina economy — gates dashes / dodges / attacks so the fight has an
// engage→spend→recover rhythm instead of constant mashing.
const STAM_MAX = 100;
const STAM_REGEN = 22 / DUEL_TPS;           // per tick
const COST_ATTACK = 14;
const COST_DASH = 24;
const COST_DODGE = 20;

const CRIT_CHANCE = 0.12;
const REACH = 1.2;                          // melee contact distance (center-to-center)
const MIN_SEP = REACH * 0.92;               // bodies never overlap closer than this

/** Deterministic LCG — same constants the old engine uses. Seed is the match
 *  seed; never Date.now() inside the sim. */
function makeRng(seed: number): () => number {
    let s = (Math.max(1, Math.floor(seed)) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

export type DuelState =
    | "idle"      // neutral / approach (the only state that re-decides)
    | "dash"      // committed burst toward the foe
    | "windup"    // telegraphed anticipation before a strike
    | "strike"    // the contact frame (1 tick)
    | "recover"   // post-swing lag
    | "stagger"   // hit-reaction / interrupted
    | "dodge"     // reactive sidestep
    | "dead";

interface Fighter {
    side: "player" | "enemy";
    pet: Pet;
    x: number; y: number;
    faceX: number; faceY: number;           // unit facing (locked during a commit)
    hp: number; maxHp: number;
    stamina: number;
    state: DuelState;
    stateLeft: number;                       // ticks remaining in the current state
    cdLeft: number;                          // attack cooldown
    moveSpeed: number;                       // units/tick
    dashSpeed: number;
    dmg: number;
    reach: number;
    windT: number; recovT: number; cdT: number; staggerT: number; dashT: number; dodgeT: number;
    dodgeChance: number;
    moveDx: number; moveDy: number;          // stored dir for dash/dodge states
}

function buildFighter(pet: Pet, side: "player" | "enemy", x: number): Fighter {
    const speed = Math.max(0, pet.speed || 0);
    const maxHp = Math.max(1, Math.round(pet.hp || 1));
    const atk = Math.max(0, pet.attack || 0);
    const moveSpeed = clamp(2.6 + speed * 0.02, 2.6, 6.5) / DUEL_TPS;
    const faceX = side === "player" ? 1 : -1;
    return {
        side, pet, x, y: 0, faceX, faceY: 0,
        hp: maxHp, maxHp,
        stamina: STAM_MAX,
        state: "idle", stateLeft: 0, cdLeft: 0,
        moveSpeed,
        dashSpeed: moveSpeed * 3.2,
        // Placeholder damage — real balance (element/def/jutsus) is Phase B/D.
        dmg: Math.max(1, Math.round(atk * 0.5)),
        reach: REACH,
        windT: Math.round(DUEL_TPS * clamp(0.42 - speed * 0.0012, 0.16, 0.42)),
        recovT: Math.round(DUEL_TPS * clamp(0.46 - speed * 0.0010, 0.20, 0.46)),
        cdT: Math.round(DUEL_TPS * 0.12),
        staggerT: Math.round(DUEL_TPS * 0.35),
        dashT: 7,
        dodgeT: 6,
        dodgeChance: clamp(0.12 + speed * 0.0008, 0.12, 0.5),
        moveDx: 0, moveDy: 0,
    };
}

export interface DuelActorSnap {
    x: number; y: number; hp: number; stamina: number; state: DuelState; faceX: number; faceY: number;
}
export interface DuelSnapshot { t: number; player: DuelActorSnap; enemy: DuelActorSnap; }

export type DuelEventType = "dash" | "dodge" | "windup" | "hit" | "whiff" | "stagger" | "ko";
export interface DuelEvent { t: number; type: DuelEventType; side: "player" | "enemy"; dmg?: number; crit?: boolean; }

export interface DuelResult {
    result: "win" | "loss" | "draw";   // from the PLAYER's perspective
    winner: "player" | "enemy" | null;
    ticks: number;
    snapshots: DuelSnapshot[];
    events: DuelEvent[];
}

function snap(t: number, p: Fighter, e: Fighter): DuelSnapshot {
    const a = (f: Fighter): DuelActorSnap => ({
        x: f.x, y: f.y, hp: Math.max(0, f.hp), stamina: f.stamina, state: f.state, faceX: f.faceX, faceY: f.faceY,
    });
    return { t, player: a(p), enemy: a(e) };
}

/** Move `f` toward (tx,ty) by up to `spd`, stopping `stopAt` short (so a melee
 *  attacker holds at reach instead of overlapping). Updates facing. */
function moveToward(f: Fighter, tx: number, ty: number, spd: number, stopAt: number) {
    const dx = tx - f.x, dy = ty - f.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 1e-6) return;
    f.faceX = dx / d; f.faceY = dy / d;
    const s = Math.min(spd, Math.max(0, d - stopAt));
    if (s <= 0) return;
    f.x += (dx / d) * s;
    f.y += (dy / d) * s;
}

/** Resolve a strike from `f` against `foe` at the contact frame. */
function resolveStrike(f: Fighter, foe: Fighter, rng: () => number, t: number, events: DuelEvent[]) {
    const dx = foe.x - f.x, dy = foe.y - f.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const facingOK = f.faceX * dx + f.faceY * dy > 0;     // foe is in front of the swing
    if (d <= f.reach + 0.35 && facingOK) {
        const crit = rng() < CRIT_CHANCE;
        const dmg = Math.max(1, Math.round(f.dmg * (crit ? 1.6 : 1)));
        foe.hp -= dmg;
        events.push({ t, type: "hit", side: f.side, dmg, crit });
        // Knockback + interrupt/stagger the victim (cancels their wind-up → swing).
        const kb = crit ? 0.9 : 0.55;
        if (d > 1e-6) { foe.x += (dx / d) * kb; foe.y += (dy / d) * kb; }
        if (foe.state === "idle" || foe.state === "dash" || foe.state === "windup") {
            foe.state = "stagger";
            foe.stateLeft = f.staggerT;
            events.push({ t, type: "stagger", side: foe.side });
        }
    } else {
        events.push({ t, type: "whiff", side: f.side });
    }
    f.stamina -= COST_ATTACK;
    f.cdLeft = f.cdT;
}

/** One tick of behavior + motion for `f` reacting to `foe`. */
function step(f: Fighter, foe: Fighter, rng: () => number, t: number, events: DuelEvent[]) {
    if (f.state === "dead") return;
    if (f.cdLeft > 0) f.cdLeft--;
    if (f.stamina < STAM_MAX) f.stamina = Math.min(STAM_MAX, f.stamina + STAM_REGEN);

    const dx = foe.x - f.x, dy = foe.y - f.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    switch (f.state) {
        case "idle": {
            // Reactive dodge: foe is telegraphing a strike at us within range.
            if (foe.state === "windup" && dist < f.reach + 0.7 && f.stamina >= COST_DODGE && rng() < f.dodgeChance) {
                // Sidestep perpendicular to the foe (deterministic 90° rotate),
                // sign chosen by which side has more room.
                const inv = dist > 1e-6 ? 1 / dist : 0;
                let px = -dy * inv, py = dx * inv;
                if (f.y + py * 1.5 > ARENA_Y || f.y + py * 1.5 < -ARENA_Y) { px = -px; py = -py; }
                f.moveDx = px; f.moveDy = py;
                f.stamina -= COST_DODGE;
                f.state = "dodge"; f.stateLeft = f.dodgeT;
                events.push({ t, type: "dodge", side: f.side });
                break;
            }
            if (dist <= f.reach + 0.05) {
                // In range → swing if ready, else hold the spacing.
                if (f.cdLeft === 0 && f.stamina >= COST_ATTACK) {
                    const inv = dist > 1e-6 ? 1 / dist : 0;
                    f.faceX = dx * inv || f.faceX; f.faceY = dy * inv;   // lock facing for the commit
                    f.state = "windup"; f.stateLeft = f.windT;
                    events.push({ t, type: "windup", side: f.side });
                }
                break;
            }
            // Out of range → dash in if far + fueled, else walk in.
            if (dist > f.reach + 1.6 && f.cdLeft === 0 && f.stamina >= COST_DASH) {
                const inv = dist > 1e-6 ? 1 / dist : 0;
                f.moveDx = dx * inv; f.moveDy = dy * inv;
                f.stamina -= COST_DASH;
                f.state = "dash"; f.stateLeft = f.dashT;
                events.push({ t, type: "dash", side: f.side });
                break;
            }
            moveToward(f, foe.x, foe.y, f.moveSpeed, f.reach * 0.85);
            break;
        }
        case "dash": {
            f.x += f.moveDx * f.dashSpeed;
            f.y += f.moveDy * f.dashSpeed;
            f.faceX = f.moveDx; f.faceY = f.moveDy;
            if (--f.stateLeft <= 0) f.state = "idle";
            break;
        }
        case "dodge": {
            f.x += f.moveDx * f.dashSpeed * 0.85;
            f.y += f.moveDy * f.dashSpeed * 0.85;
            if (--f.stateLeft <= 0) f.state = "idle";
            break;
        }
        case "windup": {
            if (--f.stateLeft <= 0) {
                resolveStrike(f, foe, rng, t, events);
                f.state = "strike"; f.stateLeft = 1;
            }
            break;
        }
        case "strike": {
            if (--f.stateLeft <= 0) { f.state = "recover"; f.stateLeft = f.recovT; }
            break;
        }
        case "recover":
        case "stagger": {
            if (--f.stateLeft <= 0) f.state = "idle";
            break;
        }
    }

    f.x = clamp(f.x, -ARENA_X, ARENA_X);
    f.y = clamp(f.y, -ARENA_Y, ARENA_Y);
}

/** Push two overlapping bodies apart equally so sprites never stack. */
function separate(a: Fighter, b: Fighter) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= MIN_SEP) return;
    const push = (MIN_SEP - d) / 2;
    if (d > 1e-6) {
        const ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
    } else {
        a.x -= push; b.x += push;     // exactly coincident → split on x deterministically
    }
    a.x = clamp(a.x, -ARENA_X, ARENA_X); a.y = clamp(a.y, -ARENA_Y, ARENA_Y);
    b.x = clamp(b.x, -ARENA_X, ARENA_X); b.y = clamp(b.y, -ARENA_Y, ARENA_Y);
}

function quantizeFighter(f: Fighter) {
    f.x = quant(f.x); f.y = quant(f.y);
    f.stamina = quant(f.stamina);
    f.faceX = quant(f.faceX); f.faceY = quant(f.faceY);
}

/**
 * Run a deterministic continuous melee duel. Pure function of
 * (playerPet, enemyPet, seed). Result is from the player's perspective.
 */
export function runPetDuel(playerPet: Pet, enemyPet: Pet, seed: number): DuelResult {
    const rng = makeRng(seed);
    const player = buildFighter(playerPet, "player", -SPAWN_X);
    const enemy = buildFighter(enemyPet, "enemy", SPAWN_X);
    const snapshots: DuelSnapshot[] = [];
    const events: DuelEvent[] = [];

    let ticks = 0;
    let winner: "player" | "enemy" | null = null;

    for (let t = 0; t < MAX_TICKS; t++) {
        ticks = t + 1;
        step(player, enemy, rng, t, events);     // fixed order — do not reorder
        step(enemy, player, rng, t, events);
        separate(player, enemy);
        quantizeFighter(player);
        quantizeFighter(enemy);
        snapshots.push(snap(t, player, enemy));

        const pDead = player.hp <= 0, eDead = enemy.hp <= 0;
        if (pDead || eDead) {
            if (pDead) player.state = "dead";
            if (eDead) enemy.state = "dead";
            winner = pDead && eDead ? null : pDead ? "enemy" : "player";
            events.push({ t, type: "ko", side: winner === "player" ? "enemy" : "player" });
            break;
        }
    }

    // Timeout → decide by remaining HP fraction (mirrors the old round-cap rule).
    if (winner === null && !(player.hp <= 0 || enemy.hp <= 0)) {
        const pf = player.hp / player.maxHp, ef = enemy.hp / enemy.maxHp;
        winner = Math.abs(pf - ef) < 1e-6 ? null : pf > ef ? "player" : "enemy";
    }

    const result: DuelResult["result"] = winner === "player" ? "win" : winner === "enemy" ? "loss" : "draw";
    return { result, winner, ticks, snapshots, events };
}
