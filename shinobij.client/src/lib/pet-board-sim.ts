/*
 * pet-board-sim — the Pet Gauntlet BOARD auto-battler resolver.
 *
 * A purpose-built, deterministic engine for the Gauntlet's TFT/Super-Auto-Pets
 * style board: two lineups of up to BOARD_SQUAD_MAX pets each sit in fixed slots
 * (no roaming) and trade actions in speed order until one side is wiped. It is
 * NOT the continuous duel sim (that's spatial 1v1/2v2 for the Pet Coliseum) and
 * NOT the retired round engine — it's its own simple resolver so the board view
 * can natively hold a full squad of N pets.
 *
 * Each pet acts on its turn: it targets the opposing FRONT-most living unit and
 * either fires a ready jutsu (damage / heal / shield / buff / control, from the
 * pet's real kit) or makes a basic attack. Damage reuses the duel sim's shape
 * (attack-scaled × element × crit ÷ defense-mitigation) so balance reads
 * familiarly. Output is a per-round snapshot stream + a typed event stream the
 * renderer plays (lunge / hit / ability / faint).
 *
 * Determinism (so a run is reproducible + server-validatable later): seeded LCG,
 * fixed iteration order (speed desc, then slot, then id), no Math.random / Date,
 * sqrt/round-only math.
 */

import type { Pet, PetJutsu } from "../types/pet";

export const BOARD_SQUAD_MAX = 5;
const MAX_ROUNDS = 40;
const DMG_SCALE = 1.5;
const CRIT_CHANCE = 0.12;
const CRIT_MULT = 1.5;

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

// Classify a jutsu kind into the board's coarse action types.
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
    return "damage"; // damage/crush/burn/lifesteal/wound/pierce/etc.
}

interface BoardJutsu { name: string; kind: PetJutsu["kind"]; act: BoardActionKind; power: number; cd: number; maxCd: number; lifesteal: boolean; }
interface Unit {
    id: string; name: string; element?: string | null; team: "player" | "enemy"; slot: number;
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
export interface BoardResult {
    result: "win" | "loss" | "draw";
    winner: "player" | "enemy" | null;
    rounds: number;
    snapshots: BoardSnapshot[];
    events: BoardEvent[];
    // The lineups as they entered (id-stable), so the renderer can place slots.
    roster: { id: string; team: "player" | "enemy"; slot: number; pet: Pet }[];
}

function lcg(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function buildUnit(pet: Pet, team: "player" | "enemy", slot: number): Unit {
    const jutsus: BoardJutsu[] = (pet.jutsus ?? [])
        .filter((j) => j.kind !== "move")
        .slice(0, 4)
        .map((j) => ({
            name: j.name, kind: j.kind, act: actionKindOf(j.kind),
            power: j.power || 0, cd: 1, maxCd: Math.max(2, Math.round(j.cooldown || 3)),
            lifesteal: j.kind === "lifesteal",
        }));
    return {
        id: pet.id, name: pet.name, element: pet.element, team, slot,
        maxHp: Math.max(1, Math.round(pet.hp)), hp: Math.max(1, Math.round(pet.hp)),
        attack: Math.max(1, Math.round(pet.attack)), defense: Math.max(0, Math.round(pet.defense)),
        speed: Math.max(1, Math.round(pet.speed)),
        shield: 0, atkBuff: 0, stunned: false, jutsus,
    };
}

const alive = (u: Unit) => u.hp > 0;
const teamAlive = (units: Unit[], team: "player" | "enemy") => units.some((u) => u.team === team && alive(u));
/** The opposing front-most living unit (lowest slot) — the lineup's "front". */
function frontTarget(units: Unit[], team: "player" | "enemy"): Unit | null {
    const foes = units.filter((u) => u.team !== team && alive(u)).sort((a, b) => a.slot - b.slot);
    return foes[0] ?? null;
}
/** The lowest-HP-fraction living ally (heal/shield priority). */
function woundedAlly(units: Unit[], team: "player" | "enemy"): Unit | null {
    const allies = units.filter((u) => u.team === team && alive(u)).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    return allies[0] ?? null;
}

function dealDamage(target: Unit, raw: number, events: BoardEvent[], t: number, attackerId: string, crit: boolean, element?: string | null, kind?: PetJutsu["kind"]) {
    let dmg = Math.max(1, Math.round(raw));
    if (target.shield > 0) {
        const soak = Math.min(target.shield, dmg);
        target.shield -= soak; dmg -= soak;
    }
    target.hp = Math.max(0, target.hp - dmg);
    events.push({ t, type: "hit", actorId: attackerId, targetId: target.id, dmg, crit, element, kind });
}

/** Resolve one unit's action this round (it targets the enemy front). */
function act(u: Unit, units: Unit[], rng: () => number, t: number, events: BoardEvent[]) {
    if (!alive(u)) return;
    if (u.stunned) { u.stunned = false; return; } // skip a turn, then recover

    // Ready jutsu (lowest remaining cd, fires when cd hits 0)? else basic attack.
    const ready = u.jutsus.find((j) => j.cd <= 0);
    const crit = rng() < CRIT_CHANCE;
    const atk = u.attack + u.atkBuff;

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
        const target = frontTarget(units, u.team);
        if (!target) return;
        if (ready.act === "control") {
            target.stunned = true;
            const raw = atk * DMG_SCALE * 0.4 * elementMult(u.element, target.element);
            dealDamage(target, raw * defenseFactor(target.defense), events, t, u.id, crit, u.element, ready.kind);
            return;
        }
        // offensive jutsu
        const raw = atk * DMG_SCALE * (ready.power / 100 || 1) * elementMult(u.element, target.element) * (crit ? CRIT_MULT : 1);
        dealDamage(target, raw * defenseFactor(target.defense), events, t, u.id, crit, u.element, ready.kind);
        if (ready.lifesteal) u.hp = Math.min(u.maxHp, u.hp + Math.round(Math.max(1, raw * defenseFactor(target.defense)) * 0.4));
        return;
    }

    // Basic attack on the enemy front.
    const target = frontTarget(units, u.team);
    if (!target) return;
    events.push({ t, type: "attack", actorId: u.id, targetId: target.id, element: u.element });
    const raw = atk * DMG_SCALE * elementMult(u.element, target.element) * (crit ? CRIT_MULT : 1);
    dealDamage(target, raw * defenseFactor(target.defense), events, t, u.id, crit, u.element);
}

function defenseFactor(def: number): number {
    return Math.max(0.35, 1 - def * 0.0012);
}

function snapshot(t: number, units: Unit[]): BoardSnapshot {
    return { t, units: units.map((u) => ({ id: u.id, team: u.team, slot: u.slot, hp: Math.max(0, u.hp), maxHp: u.maxHp, shield: u.shield, alive: alive(u) })) };
}

/**
 * Resolve a board battle between two lineups (front = slot 0). Deterministic from
 * (teams, seed). Returns the round-by-round snapshot + event streams + the roster.
 */
export function runPetBoardBattle(playerTeam: Pet[], enemyTeam: Pet[], seed: number): BoardResult {
    const rng = lcg(seed);
    const units: Unit[] = [
        ...playerTeam.slice(0, BOARD_SQUAD_MAX).map((p, i) => buildUnit(p, "player", i)),
        ...enemyTeam.slice(0, BOARD_SQUAD_MAX).map((p, i) => buildUnit(p, "enemy", i)),
    ];
    const roster = units.map((u) => ({ id: u.id, team: u.team, slot: u.slot, pet: (u.team === "player" ? playerTeam : enemyTeam)[u.slot] })) as BoardResult["roster"];
    const events: BoardEvent[] = [];
    const snapshots: BoardSnapshot[] = [snapshot(0, units)];

    let rounds = 0;
    for (let r = 1; r <= MAX_ROUNDS; r++) {
        rounds = r;
        // Action order: fastest first; ties broken by slot then id (deterministic).
        // Deterministic, id-INDEPENDENT order: fastest first, then front slot, then
        // player-before-enemy (so structurally-identical lineups resolve identically
        // regardless of the run-pet instance ids).
        const order = units.filter(alive).sort((a, b) => b.speed - a.speed || a.slot - b.slot || (a.team === b.team ? 0 : a.team === "player" ? -1 : 1));
        for (const u of order) {
            act(u, units, rng, r, events);
            if (!teamAlive(units, "player") || !teamAlive(units, "enemy")) break;
        }
        // Tick cooldowns, surface faints.
        for (const u of units) {
            for (const j of u.jutsus) if (j.cd > 0) j.cd -= 1;
        }
        for (const u of units) {
            if (u.hp <= 0 && !events.some((e) => e.type === "faint" && e.targetId === u.id)) {
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
        // Timeout (or mutual wipe) → higher surviving HP fraction wins.
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
