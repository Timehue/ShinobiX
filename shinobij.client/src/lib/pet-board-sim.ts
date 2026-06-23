/*
 * pet-board-sim — the Pet Gauntlet BOARD auto-battler resolver (POSITIONAL).
 *
 * A purpose-built, deterministic engine for the Gauntlet's TFT-style board: each
 * unit sits in a grid cell (row, col) — row 0 = FRONT, row 2 = BACK — and acts in
 * speed order until one side is wiped. Placement is a real lever:
 *   • the FRONT row shields the BACK — melee must clear the front before reaching
 *     the back; only assassins (dive the back carries) and trackers (ranged, snipe
 *     lowest anywhere) reach past the front line;
 *   • a front-row DEFENDER TAUNTS — enemy melee must hit a living front defender
 *     before its squishier lane-mates (so a tank actually protects its row);
 *   • assassins/trackers HUNT the enemy SAGE (healer) first — a backlined sage is
 *     prey, so the player must protect or hide it;
 *   • POSITIONAL DAMAGE — the vanguard (row 0) presses for +dmg, and the back row
 *     fights from cover (reduced melee damage), so front/back is a risk/reward axis.
 * Support pets (heal/shield) tend the wounded.
 *
 * It is NOT the continuous duel sim (spatial 1v1/2v2 for the Pet Coliseum) and
 * NOT the retired round engine — it's its own simple resolver so the board view
 * natively holds a full squad of N pets. Damage reuses the duel sim's shape
 * (attack-scaled × element × crit ÷ defense-mitigation) so balance reads familiarly.
 *
 * Determinism (reproducible runs, server-validatable later): seeded LCG, fixed
 * iteration order (speed desc, then slot, then player-before-enemy — id-INDEPENDENT),
 * no Math.random / Date.
 */

import type { Pet, PetJutsu } from "../types/pet";
import { derivePetRole, type PetRole } from "./pet-roles";

export const BOARD_SQUAD_MAX = 5;
export const BOARD_ROWS_PER_SIDE = 3;   // grid depth per side (0 = front … 2 = back)
export const BOARD_COLS = 5;            // grid width
const MAX_ROUNDS = 40;
const DMG_SCALE = 1.5;
const CRIT_CHANCE = 0.12;
const CRIT_MULT = 1.5;
// Positional damage tilt (role + position synergy). Deterministic, no RNG.
const FRONT_DMG_BONUS = 1.12;   // vanguard (row 0) presses the attack → +12% out
const BACK_COVER_MULT = 0.82;   // the deepest row fights from cover → −18% in, vs MELEE only

// Fire > Wind > Lightning > Earth > Water > Fire (same cycle as the duel sim).
const ELEMENT_CYCLE = ["Fire", "Wind", "Lightning", "Earth", "Water"];
function elementMult(a?: string | null, b?: string | null): number {
    const ia = a ? ELEMENT_CYCLE.indexOf(a) : -1;
    const ib = b ? ELEMENT_CYCLE.indexOf(b) : -1;
    if (ia < 0 || ib < 0) return 1;
    if ((ia + 1) % ELEMENT_CYCLE.length === ib) return 1.25;   // a beats b
    if ((ib + 1) % ELEMENT_CYCLE.length === ia) return 0.8;    // b beats a
    return 1;
}

const HEAL_KINDS = new Set(["heal"]);
const SHIELD_KINDS = new Set(["shield", "barrier", "absorb"]);
const BUFF_KINDS = new Set(["buff", "haste"]);
const CONTROL_KINDS = new Set(["stun", "freeze", "slow", "movelock", "pull", "confuse", "mark", "taunt", "debuff"]);

type BoardActionKind = "attack" | "damage" | "heal" | "shield" | "buff" | "control";
function actionKindOf(kind: PetJutsu["kind"]): BoardActionKind {
    if (HEAL_KINDS.has(kind)) return "heal";
    if (SHIELD_KINDS.has(kind)) return "shield";
    if (BUFF_KINDS.has(kind)) return "buff";
    if (CONTROL_KINDS.has(kind)) return "control";
    return "damage";
}

/**
 * Combat-relic modifiers (Pet Gauntlet) — applied to the PLAYER team only, fully
 * deterministic (no extra RNG). Zero-valued by default, so a call without
 * `opts.playerMods` is byte-identical to the base sim.
 */
export interface BoardMods {
    shieldStartFrac: number;  // each player pet starts with this fraction of max HP as shield
    reflectPct: number;       // player FRONT-row pets reflect this fraction of damage taken
    chainPct: number;         // player basic attacks chain to a 2nd foe for this fraction
    lifestealPct: number;     // player damage heals the attacker by this fraction
    reviveCharges: number;    // shared player revives (consumed when a player pet falls)
    reviveHpFrac: number;     // a revived pet returns at this fraction of max HP
}
const NO_MODS: BoardMods = { shieldStartFrac: 0, reflectPct: 0, chainPct: 0, lifestealPct: 0, reviveCharges: 0, reviveHpFrac: 0 };
interface BoardCtx { units: Unit[]; mods: BoardMods; }

interface BoardJutsu { name: string; kind: PetJutsu["kind"]; act: BoardActionKind; power: number; cd: number; maxCd: number; lifesteal: boolean; }
interface Unit {
    id: string; name: string; element?: string | null; role: PetRole; team: "player" | "enemy"; slot: number;
    row: number; col: number;
    maxHp: number; hp: number; attack: number; defense: number; speed: number;
    shield: number; atkBuff: number; stunned: boolean; jutsus: BoardJutsu[];
}

export interface BoardEvent {
    t: number;                       // round index
    type: "attack" | "hit" | "ability" | "heal" | "shield" | "buff" | "faint";
    actorId?: string; targetId?: string;
    dmg?: number; crit?: boolean; kind?: PetJutsu["kind"]; element?: string | null;
}
export interface BoardUnitSnap { id: string; team: "player" | "enemy"; slot: number; hp: number; maxHp: number; shield: number; alive: boolean; }
export interface BoardSnapshot { t: number; units: BoardUnitSnap[]; }
/** A pet placed in a board cell. */
export interface GridUnit { pet: Pet; row: number; col: number; }
export interface BoardResult {
    result: "win" | "loss" | "draw";
    winner: "player" | "enemy" | null;
    rounds: number;
    snapshots: BoardSnapshot[];
    events: BoardEvent[];
    // The lineups as placed (id + grid cell), so the renderer can position slots.
    roster: { id: string; team: "player" | "enemy"; slot: number; row: number; col: number; pet: Pet }[];
}

function lcg(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function buildUnit(pet: Pet, team: "player" | "enemy", slot: number, row: number, col: number): Unit {
    const role: PetRole = (pet.role as PetRole | undefined) ?? derivePetRole(pet).role;
    const jutsus: BoardJutsu[] = (pet.jutsus ?? [])
        .filter((j) => j.kind !== "move")
        .slice(0, 4)
        .map((j) => ({
            name: j.name, kind: j.kind, act: actionKindOf(j.kind),
            power: j.power || 0, cd: 1, maxCd: Math.max(2, Math.round(j.cooldown || 3)),
            lifesteal: j.kind === "lifesteal",
        }));
    return {
        id: pet.id, name: pet.name, element: pet.element, role, team, slot, row, col,
        maxHp: Math.max(1, Math.round(pet.hp)), hp: Math.max(1, Math.round(pet.hp)),
        attack: Math.max(1, Math.round(pet.attack)), defense: Math.max(0, Math.round(pet.defense)),
        speed: Math.max(1, Math.round(pet.speed)),
        shield: 0, atkBuff: 0, stunned: false, jutsus,
    };
}

const alive = (u: Unit) => u.hp > 0;
const teamAlive = (units: Unit[], team: "player" | "enemy") => units.some((u) => u.team === team && alive(u));

/**
 * Position + role aware target selection — the heart of why placement matters:
 *   • assassin → dives the enemy BACK row, HUNTING the Sage (healer) there first,
 *     then the lowest-HP back carry, then the front;
 *   • tracker (ranged) → snipes the lowest-HP enemy SAGE, else lowest ANYWHERE;
 *   • everyone else (defender/sage melee) → hits the enemy FRONT row by nearest
 *     column, but a living front-row DEFENDER TAUNTS (is hit before its squishier
 *     lane-mates); only reaches the BACK once the front line is wiped.
 */
function pickTarget(u: Unit, units: Unit[]): Unit | null {
    const foes = units.filter((f) => f.team !== u.team && alive(f));
    if (!foes.length) return null;
    const minRow = Math.min(...foes.map((f) => f.row));   // the current front line (advances as it dies)
    const maxRow = Math.max(...foes.map((f) => f.row));   // the deepest back line (carries)
    const front = foes.filter((f) => f.row === minRow);
    const back = foes.filter((f) => f.row === maxRow);
    const byCol = (pool: Unit[]) => pool.length ? [...pool].sort((a, b) => Math.abs(a.col - u.col) - Math.abs(b.col - u.col) || a.slot - b.slot)[0] : null;
    const byLowHp = (pool: Unit[]) => pool.length ? [...pool].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.slot - b.slot)[0] : null;
    if (u.role === "assassin") {
        const backSages = back.filter((f) => f.role === "sage");   // dive the healer first
        return byLowHp(backSages) ?? byLowHp(back) ?? byLowHp(front);
    }
    if (u.role === "tracker") {
        const sages = foes.filter((f) => f.role === "sage");       // ranged healer-hunter
        return byLowHp(sages) ?? byLowHp(foes);
    }
    // Melee: a front-row defender taunts — soak it before the squishier front pets.
    const frontDefenders = front.filter((f) => f.role === "defender");
    return byCol(frontDefenders.length ? frontDefenders : front);
}

/** A 2nd foe for the chain relic — nearest column to the first target, then lowest HP. */
function pickChain(u: Unit, units: Unit[], exclude: Unit): Unit | null {
    const foes = units.filter((f) => f.team !== u.team && alive(f) && f.id !== exclude.id);
    if (!foes.length) return null;
    return [...foes].sort((a, b) => Math.abs(a.col - exclude.col) - Math.abs(b.col - exclude.col) || a.hp / a.maxHp - b.hp / b.maxHp || a.slot - b.slot)[0];
}

/** The lowest-HP-fraction living ally (heal/shield priority). */
function woundedAlly(units: Unit[], team: "player" | "enemy"): Unit | null {
    const allies = units.filter((u) => u.team === team && alive(u)).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    return allies[0] ?? null;
}

function defenseFactor(def: number): number {
    return Math.max(0.35, 1 - def * 0.0012);
}

/**
 * Positional damage tilt (deterministic): the vanguard (row 0) presses for +dmg,
 * and the deepest row fights from cover (−dmg) — but cover only blunts MELEE
 * (defender/sage), since assassins dive and trackers snipe past the formation.
 */
function positionalDmgMult(attacker: Unit, target: Unit): number {
    let m = 1;
    if (attacker.row === 0) m *= FRONT_DMG_BONUS;
    const meleeAttacker = attacker.role !== "assassin" && attacker.role !== "tracker";
    if (meleeAttacker && target.row >= BOARD_ROWS_PER_SIDE - 1) m *= BACK_COVER_MULT;
    return m;
}

function dealDamage(target: Unit, raw: number, events: BoardEvent[], t: number, attackerId: string, crit: boolean, element?: string | null, kind?: PetJutsu["kind"], ctx?: BoardCtx) {
    let dmg = Math.max(1, Math.round(raw));
    if (target.shield > 0) {
        const soak = Math.min(target.shield, dmg);
        target.shield -= soak; dmg -= soak;
    }
    target.hp = Math.max(0, target.hp - dmg);
    events.push({ t, type: "hit", actorId: attackerId, targetId: target.id, dmg, crit, element, kind });

    // ── Player combat relics that trigger on damage TAKEN ──────────────────────
    if (ctx && dmg > 0 && target.team === "player") {
        // Bramble Mail — front-line reflects a fraction of the damage to its attacker.
        if (ctx.mods.reflectPct > 0 && target.row === 0) {
            const attacker = ctx.units.find((f) => f.id === attackerId && f.team === "enemy" && alive(f));
            if (attacker) {
                const refl = Math.max(1, Math.round(dmg * ctx.mods.reflectPct));
                attacker.hp = Math.max(0, attacker.hp - refl);
                events.push({ t, type: "hit", actorId: target.id, targetId: attacker.id, dmg: refl, element: target.element });
            }
        }
        // Phoenix Plume — the squad's first fallen pet springs back once.
        if (target.hp <= 0 && ctx.mods.reviveCharges > 0) {
            ctx.mods.reviveCharges -= 1;
            target.hp = Math.max(1, Math.round(target.maxHp * ctx.mods.reviveHpFrac));
            target.shield = 0;
            events.push({ t, type: "heal", actorId: target.id, targetId: target.id, dmg: target.hp });
        }
    }
}

/** Resolve one unit's action this round. */
function act(u: Unit, units: Unit[], rng: () => number, t: number, events: BoardEvent[], ctx: BoardCtx) {
    if (!alive(u)) return;
    if (u.stunned) { u.stunned = false; return; }

    const ready = u.jutsus.find((j) => j.cd <= 0);
    const crit = rng() < CRIT_CHANCE;
    const atk = u.attack + u.atkBuff;
    const isPlayer = u.team === "player";
    // Vampiric Fang — player damage heals the attacker (relic lifesteal).
    const relicHeal = (raw: number) => { if (isPlayer && ctx.mods.lifestealPct > 0 && raw > 0) u.hp = Math.min(u.maxHp, u.hp + Math.max(1, Math.round(raw * ctx.mods.lifestealPct))); };

    if (ready) {
        ready.cd = ready.maxCd;
        events.push({ t, type: "ability", actorId: u.id, kind: ready.kind, element: u.element });
        if (ready.act === "heal") {
            const ally = woundedAlly(units, u.team);
            if (ally) {
                const heal = Math.max(1, Math.round(ally.maxHp * 0.12 * (ready.power / 100 || 0.5)));
                ally.hp = Math.min(ally.maxHp, ally.hp + heal);
                events.push({ t, type: "heal", actorId: u.id, targetId: ally.id, dmg: heal });
            }
            return;
        }
        if (ready.act === "shield") {
            const ally = woundedAlly(units, u.team) ?? u;
            const amount = Math.max(1, Math.round(ally.maxHp * 0.15 * (ready.power / 100 || 0.5)));
            ally.shield += amount;
            events.push({ t, type: "shield", actorId: u.id, targetId: ally.id, dmg: amount });
            return;
        }
        if (ready.act === "buff") {
            u.atkBuff += Math.max(1, Math.round(u.attack * 0.2));
            events.push({ t, type: "buff", actorId: u.id });
            return;
        }
        const target = pickTarget(u, units);
        if (!target) return;
        if (ready.act === "control") {
            target.stunned = true;
            const raw = atk * DMG_SCALE * 0.4 * elementMult(u.element, target.element) * defenseFactor(target.defense) * positionalDmgMult(u, target);
            dealDamage(target, raw, events, t, u.id, crit, u.element, ready.kind, ctx);
            relicHeal(raw);
            return;
        }
        const raw = atk * DMG_SCALE * (ready.power / 100 || 1) * elementMult(u.element, target.element) * (crit ? CRIT_MULT : 1) * defenseFactor(target.defense) * positionalDmgMult(u, target);
        dealDamage(target, raw, events, t, u.id, crit, u.element, ready.kind, ctx);
        if (ready.lifesteal) u.hp = Math.min(u.maxHp, u.hp + Math.round(Math.max(1, raw) * 0.4));
        else relicHeal(raw);
        return;
    }

    const target = pickTarget(u, units);
    if (!target) return;
    events.push({ t, type: "attack", actorId: u.id, targetId: target.id, element: u.element });
    const raw = atk * DMG_SCALE * elementMult(u.element, target.element) * (crit ? CRIT_MULT : 1) * defenseFactor(target.defense) * positionalDmgMult(u, target);
    dealDamage(target, raw, events, t, u.id, crit, u.element, undefined, ctx);
    relicHeal(raw);
    // Chain Lightning — the basic attack arcs to a 2nd foe for a fraction of the hit.
    if (isPlayer && ctx.mods.chainPct > 0) {
        const second = pickChain(u, units, target);
        if (second) {
            const craw = atk * DMG_SCALE * ctx.mods.chainPct * elementMult(u.element, second.element) * defenseFactor(second.defense) * positionalDmgMult(u, second);
            dealDamage(second, craw, events, t, u.id, false, u.element, undefined, ctx);
            relicHeal(craw);
        }
    }
}

function snapshot(t: number, units: Unit[]): BoardSnapshot {
    return { t, units: units.map((u) => ({ id: u.id, team: u.team, slot: u.slot, hp: Math.max(0, u.hp), maxHp: u.maxHp, shield: u.shield, alive: alive(u) })) };
}

/**
 * Resolve a positional board battle between two placed squads (row 0 = front).
 * Deterministic from (placements, seed). Returns round-by-round snapshots + the
 * typed event stream + the placed roster.
 */
export function runPetGridBattle(player: GridUnit[], enemy: GridUnit[], seed: number, opts?: { playerMods?: Partial<BoardMods> }): BoardResult {
    const rng = lcg(seed);
    const mods: BoardMods = { ...NO_MODS, ...(opts?.playerMods ?? {}) };
    const p = player.slice(0, BOARD_SQUAD_MAX), e = enemy.slice(0, BOARD_SQUAD_MAX);
    const units: Unit[] = [
        ...p.map((g, i) => buildUnit(g.pet, "player", i, g.row, g.col)),
        ...e.map((g, i) => buildUnit(g.pet, "enemy", i, g.row, g.col)),
    ];
    // Stoneward — player pets open the fight with a shield (before the first snapshot).
    if (mods.shieldStartFrac > 0) for (const u of units) if (u.team === "player") u.shield = Math.round(u.maxHp * mods.shieldStartFrac);
    const ctx: BoardCtx = { units, mods };
    const roster = units.map((u) => ({ id: u.id, team: u.team, slot: u.slot, row: u.row, col: u.col, pet: (u.team === "player" ? p : e)[u.slot].pet })) as BoardResult["roster"];
    const events: BoardEvent[] = [];
    const snapshots: BoardSnapshot[] = [snapshot(0, units)];

    let rounds = 0;
    for (let r = 1; r <= MAX_ROUNDS; r++) {
        rounds = r;
        // Fastest first; ties → front slot → player-before-enemy (id-independent).
        const order = units.filter(alive).sort((a, b) => b.speed - a.speed || a.slot - b.slot || (a.team === b.team ? 0 : a.team === "player" ? -1 : 1));
        for (const u of order) {
            act(u, units, rng, r, events, ctx);
            if (!teamAlive(units, "player") || !teamAlive(units, "enemy")) break;
        }
        for (const u of units) for (const j of u.jutsus) if (j.cd > 0) j.cd -= 1;
        for (const u of units) {
            if (u.hp <= 0 && !events.some((ev) => ev.type === "faint" && ev.targetId === u.id)) {
                events.push({ t: r, type: "faint", targetId: u.id });
            }
        }
        snapshots.push(snapshot(r, units));
        if (!teamAlive(units, "player") || !teamAlive(units, "enemy")) break;
    }

    const pAlive = teamAlive(units, "player");
    const eAlive = teamAlive(units, "enemy");
    let result: BoardResult["result"]; let winner: BoardResult["winner"];
    if (pAlive && !eAlive) { result = "win"; winner = "player"; }
    else if (eAlive && !pAlive) { result = "loss"; winner = "enemy"; }
    else {
        const frac = (team: "player" | "enemy") => {
            const t = units.filter((u) => u.team === team);
            const hp = t.reduce((s, u) => s + Math.max(0, u.hp), 0);
            const max = t.reduce((s, u) => s + u.maxHp, 0) || 1;
            return hp / max;
        };
        const pf = frac("player"), ef = frac("enemy");
        if (pf > ef + 0.02) { result = "win"; winner = "player"; }
        else if (ef > pf + 0.02) { result = "loss"; winner = "enemy"; }
        else { result = "draw"; winner = null; }
    }
    return { result, winner, rounds, snapshots, events, roster };
}

/** Lineup convenience — everyone in the front row, one per column. Back-compat
 *  for simple callers (and the dev harness); the Gauntlet uses runPetGridBattle. */
export function runPetBoardBattle(playerTeam: Pet[], enemyTeam: Pet[], seed: number): BoardResult {
    return runPetGridBattle(
        playerTeam.map((pet, i) => ({ pet, row: 0, col: i })),
        enemyTeam.map((pet, i) => ({ pet, row: 0, col: i })),
        seed,
    );
}
