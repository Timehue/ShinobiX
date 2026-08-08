/*
 * Pet Showdown — server-authoritative turn engine.
 *
 * This engine exists ONLY on the server (there is no client mirror, no parity
 * generator, no input-log replay). Each round the handler feeds it the player's
 * validated commands plus the AI's commands and it returns the TURN SCRIPT
 * (ShowdownEvent[]) the client plays back. All combat numbers originate here.
 *
 * Determinism: pure function of (session state, commands). Randomness comes
 * only from the session's own mulberry32 rng state, which advances inside the
 * session object — so a persisted session replays identically after a crash,
 * and no Math.random/Date ever runs in combat.
 */

import {
    SHOWDOWN_COST_HEAVY,
    SHOWDOWN_COST_LIGHT,
    SHOWDOWN_COST_MEDIUM,
    SHOWDOWN_ELEMENT_ADVANTAGE,
    SHOWDOWN_ELEMENT_BEATS,
    SHOWDOWN_ELEMENT_DISADVANTAGE,
    SHOWDOWN_FORMAT_SIZE,
    SHOWDOWN_GUARD_COST,
    SHOWDOWN_GUARD_MULT,
    SHOWDOWN_MAX_ROUNDS,
    SHOWDOWN_MAX_STAMINA,
    SHOWDOWN_MAX_TEAM,
    SHOWDOWN_METER_MAX,
    SHOWDOWN_METER_ON_GUARDED_HIT,
    SHOWDOWN_METER_ON_HIT_DEALT,
    SHOWDOWN_METER_ON_HIT_TAKEN,
    SHOWDOWN_REST_HEAL_PCT,
    SHOWDOWN_REST_STAMINA,
    SHOWDOWN_STAMINA_REGEN,
    SHOWDOWN_SUPER_POWER_MULT,
    SHOWDOWN_SUPER_SPLASH_SCALE,
    SHOWDOWN_SYNERGY_MULT,
    SHOWDOWN_TIMING_MULTS,
    type ShowdownCommand,
    type ShowdownEvent,
    type ShowdownFormat,
    type ShowdownOutcome,
    type ShowdownPetView,
    type ShowdownStateView,
    type ShowdownTier,
} from '../../shared/pet-showdown-contract.js';
import { petJutsuPowerCeil, petStatCeil } from '../_pet-stat-ceil.js';
import { PET_CATALOG } from '../pet/_catalog.js';
import type { Pet } from '../_pet-sim/pet-types.js';

// ─── Internal state ──────────────────────────────────────────────────────────

export interface ShowdownStatus {
    kind: string;
    rounds: number;
    /** Multiplier magnitude for buffs/debuffs, absorb pool for shields. */
    magnitude: number;
    /** Round the status was applied — it must survive its birth round's upkeep
     *  so a stun/freeze landed mid-round still costs the target its NEXT turn. */
    bornRound: number;
}

export interface ShowdownMove {
    name: string;
    power: number;
    kind: string;
    cost: number;
    cooldown: number;
    currentCooldown: number;
    signature: boolean;
}

export interface ShowdownPet {
    id: string;
    name: string;
    element: string;
    role: string;
    rarity: string;
    templateId?: string;
    level: number;
    hp: number;
    maxHp: number;
    attack: number;
    defense: number;
    speed: number;
    stamina: number;
    meter: number;
    ko: boolean;
    guarding: boolean;
    /** On the bench: cannot act or be targeted; statuses are frozen. */
    benched: boolean;
    winded: boolean;
    statuses: ShowdownStatus[];
    moves: ShowdownMove[];
    /** The full-meter finisher — excluded from the normal move list. */
    signatureMove: ShowdownMove;
}

export interface ShowdownSession {
    sessionId: string;
    playerName: string;
    format: ShowdownFormat;
    tier: ShowdownTier;
    round: number;
    rng: number;
    finished: boolean;
    outcome: ShowdownOutcome | null;
    /** Reward magnitude sealed at start — the opponent actually fought. */
    sealedOpponentLevel: number;
    enemyTeamName: string;
    player: ShowdownPet[];
    enemy: ShowdownPet[];
    createdAt: number;
}

// ─── Seeded rng (integer-only mulberry32) ────────────────────────────────────
// Exported so ai.ts draws from the SAME implementation — a second copy of a
// determinism-critical PRNG is a silent-desync foot-gun.

export function nextRand(session: ShowdownSession): number {
    let t = (session.rng += 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    session.rng = session.rng | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ─── Pet sealing ─────────────────────────────────────────────────────────────

const clampInt = (n: unknown, lo: number, hi: number, fallback: number): number => {
    const v = Math.floor(Number(n));
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
};

export function moveStaminaCost(power: number): number {
    if (power <= 120) return SHOWDOWN_COST_LIGHT;
    if (power <= 220) return SHOWDOWN_COST_MEDIUM;
    return SHOWDOWN_COST_HEAVY;
}

const KNOWN_KINDS = new Set([
    'damage', 'buff', 'heal', 'debuff', 'dot', 'move', 'barrier', 'movelock', 'lifesteal',
    'shield', 'absorb', 'burn', 'freeze', 'confuse', 'stun', 'crush', 'wound', 'mark',
    'slow', 'haste', 'taunt', 'push', 'pull',
]);

/*
 * Species stat-budget normalization. Same-rarity catalog species differ by up
 * to ~65% in raw stat budget (Black Cat 297hp/37atk vs Frost Cub 515hp/65atk,
 * both "standard") — the continuous sims priced that with behavior levers
 * (kiting ranges, moveRange, positioning) that a turn-based duel doesn't have,
 * so raw budget would simply decide fights. At seal time each pet's combat
 * stats are scaled by (rarityMedianBudget / speciesBudget)^0.6 computed from
 * its CATALOG TEMPLATE — the damping keeps species personality (fast-vs-tanky
 * spreads survive) while compressing the innate budget gap, and because the
 * correction uses the template rather than the live stats, a player's TRAINING
 * gains keep their full value on top. Pets with no resolvable template
 * (admin-authored customs) are left untouched.
 */
const BUDGET_DAMPING = 0.6;

function speciesBudget(stats: { hp: number; attack: number; defense: number; speed: number }): number {
    // Weighted to the damage model's true marginal values: under
    // atk²/(atk+def), an attack point carries ~3x the value of a defense point
    // at parity (elasticity 1.5 vs 0.5), hp is the linear durability pool, and
    // speed only buys turn order. Pricing points at their real worth stops
    // glass cannons from getting a hidden subsidy in the normalization.
    return stats.hp / 8 + stats.attack * 1.2 + stats.defense * 0.45 + stats.speed * 0.5;
}

let rarityMedianBudget: Map<string, number> | null = null;
function medianBudgetFor(rarity: string): number | null {
    if (!rarityMedianBudget) {
        const byRarity = new Map<string, number[]>();
        for (const tpl of Object.values(PET_CATALOG)) {
            const r = String(tpl.rarity ?? '');
            if (!r) continue;
            const budget = speciesBudget({
                hp: Number(tpl.hp) || 0, attack: Number(tpl.attack) || 0,
                defense: Number(tpl.defense) || 0, speed: Number(tpl.speed) || 0,
            });
            if (budget > 0) (byRarity.get(r) ?? byRarity.set(r, []).get(r)!).push(budget);
        }
        rarityMedianBudget = new Map();
        for (const [r, list] of byRarity) {
            list.sort((a, b) => a - b);
            rarityMedianBudget.set(r, list[Math.floor(list.length / 2)]);
        }
    }
    return rarityMedianBudget.get(rarity) ?? null;
}

export function speciesNormalizationMult(templateId: string | undefined, petId: string, rarity: string): number {
    const canonical = String(templateId || petId).replace(/-\d{10,}$/, '').split(':')[0];
    const tpl = PET_CATALOG[canonical];
    const median = medianBudgetFor(rarity);
    if (!tpl || !median || String(tpl.rarity) !== rarity) return 1;
    const budget = speciesBudget({
        hp: Number(tpl.hp) || 0, attack: Number(tpl.attack) || 0,
        defense: Number(tpl.defense) || 0, speed: Number(tpl.speed) || 0,
    });
    if (!(budget > 0)) return 1;
    return Math.pow(median / budget, BUDGET_DAMPING);
}

/** Universal cheap opener every pet gets, so low stamina never means no play. */
function basicStrike(): ShowdownMove {
    return {
        name: 'Swift Strike',
        power: 55,
        kind: 'damage',
        cost: 20,
        cooldown: 0,
        currentCooldown: 0,
        signature: false,
    };
}

function synthesizedSignature(pet: { element?: string; name?: string }): ShowdownMove {
    const el = String(pet.element ?? 'None');
    return {
        name: el !== 'None' && el ? `${el} Overdrive` : 'Spirit Overdrive',
        power: 260,
        kind: 'damage',
        cost: 0,
        cooldown: 0,
        currentCooldown: 0,
        signature: true,
    };
}

/** Seal one save/catalog pet into showdown combat form, ceilings applied. */
export function sealShowdownPet(raw: Pet): ShowdownPet {
    const rarity = ['standard', 'rare', 'legendary', 'mythic'].includes(String(raw.rarity)) ? String(raw.rarity) : 'standard';
    const level = clampInt(raw.level, 1, 100, 1);
    const norm = speciesNormalizationMult(raw.templateId, String(raw.id), rarity);
    const scaled = (value: unknown, fallback: number) => Math.max(1, Math.round((Number(value) || fallback) * norm));
    const maxHp = clampInt(scaled(raw.hp, 320), 1, petStatCeil(rarity, 'hp'), 320);
    const powerCeil = petJutsuPowerCeil(rarity);

    const jutsus = Array.isArray(raw.jutsus) ? raw.jutsus : [];
    const sealedJutsus: ShowdownMove[] = jutsus
        .filter((j) => j && typeof j.name === 'string')
        .slice(0, 5)
        .map((j) => {
            const power = clampInt(j.power, 0, powerCeil, 0);
            return {
                name: String(j.name).slice(0, 48),
                power,
                kind: KNOWN_KINDS.has(String(j.kind)) ? String(j.kind) : 'damage',
                cost: moveStaminaCost(power),
                cooldown: clampInt(j.cooldown, 0, 8, 0),
                currentCooldown: 0,
                signature: j.signature === true,
            };
        });

    // The flagged signature is reserved for the super; everything else is the kit.
    const signatureMove = sealedJutsus.find((m) => m.signature)
        ?? synthesizedSignature({ element: raw.element, name: raw.name });
    const kit = sealedJutsus.filter((m) => m !== signatureMove && m.kind !== 'move').slice(0, 4);

    return {
        id: String(raw.id),
        name: String(raw.nickname || raw.name || 'Companion').slice(0, 32),
        ...(typeof raw.templateId === 'string' && raw.templateId ? { templateId: raw.templateId } : {}),
        element: typeof raw.element === 'string' ? raw.element : 'None',
        role: typeof raw.role === 'string' ? raw.role : 'defender',
        rarity,
        level,
        hp: maxHp,
        maxHp,
        attack: clampInt(scaled(raw.attack, 40), 1, petStatCeil(rarity, 'attack'), 40),
        defense: clampInt(scaled(raw.defense, 28), 1, petStatCeil(rarity, 'defense'), 28),
        speed: clampInt(scaled(raw.speed, 30), 1, petStatCeil(rarity, 'speed'), 30),
        stamina: SHOWDOWN_MAX_STAMINA,
        meter: 0,
        ko: false,
        guarding: false,
        benched: false,
        winded: false,
        statuses: [],
        moves: [basicStrike(), ...kit],
        signatureMove: { ...signatureMove, cost: 0 },
    };
}

export function createShowdownSession(input: {
    sessionId: string;
    playerName: string;
    format: ShowdownFormat;
    tier: ShowdownTier;
    seed: number;
    playerPets: Pet[];
    enemyPets: Pet[];
    enemyTeamName: string;
}): ShowdownSession {
    const size = SHOWDOWN_FORMAT_SIZE[input.format];
    const sealTeam = (pets: Pet[]): ShowdownPet[] =>
        pets.slice(0, SHOWDOWN_MAX_TEAM).map((raw, i) => ({ ...sealShowdownPet(raw), benched: i >= size }));
    return {
        sessionId: input.sessionId,
        playerName: input.playerName,
        format: input.format,
        tier: input.tier,
        round: 0,
        rng: input.seed | 0,
        finished: false,
        outcome: null,
        sealedOpponentLevel: clampInt(Math.max(1, ...input.enemyPets.map((p) => Number(p.level) || 1)), 1, 100, 1),
        enemyTeamName: input.enemyTeamName,
        player: sealTeam(input.playerPets),
        enemy: sealTeam(input.enemyPets),
        createdAt: Date.now(),
    };
}

// ─── Effective stats ─────────────────────────────────────────────────────────

function statusMult(pet: ShowdownPet, kinds: Record<string, number>): number {
    let mult = 1;
    for (const s of pet.statuses) {
        const m = kinds[s.kind];
        if (m !== undefined) mult *= m;
    }
    return mult;
}

const effAttack = (p: ShowdownPet) => p.attack * statusMult(p, { buff: 1.25, debuff: 0.8, burn: 0.9 });
const effDefense = (p: ShowdownPet) => p.defense * statusMult(p, { crush: 0.8, tauntGuard: 1.2 });
const effSpeed = (p: ShowdownPet) => p.speed * statusMult(p, { haste: 1.25, slow: 0.75, movelock: 0.7 });

function elementMult(attacker: string, defender: string): number {
    if (SHOWDOWN_ELEMENT_BEATS[attacker] === defender) return SHOWDOWN_ELEMENT_ADVANTAGE;
    if (SHOWDOWN_ELEMENT_BEATS[defender] === attacker) return SHOWDOWN_ELEMENT_DISADVANTAGE;
    return 1;
}

// ─── Round resolution ────────────────────────────────────────────────────────

type Side = 'player' | 'enemy';

/** Living FIELD pets — the ones who can act and be targeted. */
function livingOf(session: ShowdownSession, side: Side): ShowdownPet[] {
    return (side === 'player' ? session.player : session.enemy).filter((p) => !p.ko && !p.benched);
}

/** Living team members including the bench — the defeat/judge pool. */
function livingTeam(session: ShowdownSession, side: Side): ShowdownPet[] {
    return (side === 'player' ? session.player : session.enemy).filter((p) => !p.ko);
}

function hasStatus(pet: ShowdownPet, kind: string): boolean {
    return pet.statuses.some((s) => s.kind === kind);
}

function addStatus(session: ShowdownSession, pet: ShowdownPet, kind: string, rounds: number, magnitude: number): void {
    const existing = pet.statuses.find((s) => s.kind === kind);
    if (existing) {
        existing.rounds = Math.max(existing.rounds, rounds);
        existing.magnitude = Math.max(existing.magnitude, magnitude);
        existing.bornRound = session.round;
    } else {
        pet.statuses.push({ kind, rounds, magnitude, bornRound: session.round });
    }
}

function gainMeter(pet: ShowdownPet, amount: number): void {
    if (pet.ko) return;
    pet.meter = Math.min(SHOWDOWN_METER_MAX, Math.round(pet.meter + amount));
}

/** Absorb pools (shield/barrier/absorb) soak damage first. Returns unabsorbed. */
function soakThroughShields(pet: ShowdownPet, damage: number): number {
    let remaining = damage;
    for (const s of pet.statuses) {
        if (remaining <= 0) break;
        if (s.kind === 'shield' || s.kind === 'barrier' || s.kind === 'absorb') {
            const soaked = Math.min(s.magnitude, remaining);
            s.magnitude -= soaked;
            remaining -= soaked;
        }
    }
    pet.statuses = pet.statuses.filter((s) => !((s.kind === 'shield' || s.kind === 'barrier' || s.kind === 'absorb') && s.magnitude <= 0));
    return remaining;
}

function applyDamage(session: ShowdownSession, target: ShowdownPet, amount: number): { dealt: number; ko: boolean } {
    const dealt = Math.max(0, Math.round(soakThroughShields(target, amount)));
    target.hp = Math.max(0, target.hp - dealt);
    if (target.hp <= 0 && !target.ko) {
        target.ko = true;
        target.statuses = [];
        target.guarding = false;
    }
    if (dealt > 0) {
        gainMeter(target, target.guarding ? SHOWDOWN_METER_ON_GUARDED_HIT : SHOWDOWN_METER_ON_HIT_TAKEN);
    }
    return { dealt, ko: target.ko };
}

function applyHeal(target: ShowdownPet, amount: number): number {
    if (target.ko) return 0;
    const halved = hasStatus(target, 'wound') ? Math.round(amount * 0.5) : amount;
    const healed = Math.min(target.maxHp - target.hp, Math.max(0, Math.round(halved)));
    target.hp += healed;
    return healed;
}

/** Global damage pace. Tuned with scripts/showdown-balance.mjs: at 1.0 the
 * average same-rarity duel ran 12+ rounds and 56% of games went to the judge
 * (attrition meta — burst roles starved, chip roles dominated). 2.2 lands the
 * typical KO in 6-9 rounds with the judge as a genuine minority outcome. */
const DAMAGE_SCALE = 2.35;
/** Assassin execute instinct: bonus damage against bloodied targets — the
 * burst identity the role's glass-cannon statline pays for. */
const ASSASSIN_EXECUTE_HP = 0.4;
const ASSASSIN_EXECUTE_MULT = 1.15;

/** Role identity pricing. The catalog statlines were balanced for the
 * continuous sims, where a tracker paid for its superior hp/atk/speed with
 * kiting-range behavior and an assassin earned burst through positioning.
 * Turn-based combat has neither, so the engine restores the price mechanically:
 * trackers hit lighter per action, assassins hit far harder (plus the execute
 * below), sages swing harder and heal stronger (sageHealMult). Tuned against
 * scripts/showdown-balance.mjs until every role sits in the 40-60% band. */
const ROLE_DAMAGE_MULT: Record<string, number> = {
    tracker: 0.91,
    assassin: 1.1,
    sage: 1.12,
    defender: 1.02,
};
const SAGE_HEAL_MULT = 1.15;

/** Element identity pricing, same reasoning as the role table: the catalog's
 * Earth/Lightning species carry ~15% higher statlines than Fire/Water (paid
 * for in the continuous sims by mechanics that no longer exist), and the
 * atk²-scaled formula amplifies the gap. Fire burns hotter, stone hits duller.
 * Tuned against scripts/showdown-balance.mjs. */
const ELEMENT_DAMAGE_MULT: Record<string, number> = {
    Fire: 1.19,
    Water: 1.08,
    Wind: 1.0,
    Earth: 0.93,
    Lightning: 0.93,
};
/** Durability side of the same normalization — Fire/Water species carry the
 * lowest hp/def/speed lines, so out-damage alone can't level them. */
const ELEMENT_TAKEN_MULT: Record<string, number> = {
    Fire: 0.93,
    Water: 0.97,
    Wind: 1.0,
    Earth: 1.02,
    Lightning: 1.02,
};

function rawDamage(session: ShowdownSession, attacker: ShowdownPet, defender: ShowdownPet, power: number, timingMult: number, extraMult = 1): number {
    const atk = effAttack(attacker);
    const def = effDefense(defender);
    const base = DAMAGE_SCALE * (power / 100) * ((atk * atk) / (atk + def));
    // ±8% in 16 discrete steps — the genre-proven roll (Pokémon's 85-100 band):
    // wide enough that lethal isn't fully solvable, narrow enough to plan around.
    const variance = 0.92 + Math.floor(nextRand(session) * 16) * 0.01;
    let mult = elementMult(attacker.element, defender.element) * timingMult * variance * extraMult
        * (ROLE_DAMAGE_MULT[attacker.role] ?? 1)
        * (ELEMENT_DAMAGE_MULT[attacker.element] ?? 1)
        * (ELEMENT_TAKEN_MULT[defender.element] ?? 1);
    if (attacker.role === 'assassin' && defender.hp / defender.maxHp < ASSASSIN_EXECUTE_HP) {
        mult *= ASSASSIN_EXECUTE_MULT;
    }
    // Mark: the stored bonus hit is consumed by the first damage that lands.
    const mark = defender.statuses.find((s) => s.kind === 'mark');
    if (mark) {
        mult *= 1.25;
        defender.statuses = defender.statuses.filter((s) => s !== mark);
    }
    if (defender.guarding) mult *= SHOWDOWN_GUARD_MULT;
    return Math.max(power > 0 ? 1 : 0, Math.round(base * mult));
}

/** Retarget through taunt: 2v2+ taunters drag single-target hostiles onto themselves. */
function resolveTarget(session: ShowdownSession, actorSide: Side, requestedId: string): ShowdownPet | null {
    const foes = livingOf(session, actorSide === 'player' ? 'enemy' : 'player');
    if (!foes.length) return null;
    const taunter = foes.find((p) => hasStatus(p, 'taunt'));
    if (taunter) return taunter;
    return foes.find((p) => p.id === requestedId) ?? foes[0];
}

function resolveAllyTarget(session: ShowdownSession, actorSide: Side, requestedId: string, actor: ShowdownPet): ShowdownPet {
    const allies = livingOf(session, actorSide);
    return allies.find((p) => p.id === requestedId) ?? actor;
}

const SELF_KINDS = new Set(['buff', 'haste', 'move', 'shield', 'barrier', 'absorb', 'taunt']);
const ALLY_KINDS = new Set(['heal']);

function deliveryFor(kind: string, role: string): 'melee' | 'ranged' | 'self' {
    if (SELF_KINDS.has(kind) || ALLY_KINDS.has(kind)) return 'self';
    if ((role === 'assassin' || role === 'defender') && (kind === 'damage' || kind === 'crush' || kind === 'lifesteal' || kind === 'push' || kind === 'pull')) {
        return 'melee';
    }
    return 'ranged';
}

interface ExecutedAction {
    move: ShowdownMove;
    superCast: boolean;
    timing: number;
    targetId: string;
}

function executeMove(
    session: ShowdownSession,
    actor: ShowdownPet,
    actorSide: Side,
    action: ExecutedAction,
    events: ShowdownEvent[],
): void {
    const { move, superCast } = action;
    const timingIdx = clampInt(action.timing, 0, SHOWDOWN_TIMING_MULTS.length - 1, 0);
    const timingMult = SHOWDOWN_TIMING_MULTS[timingIdx];
    const kind = move.kind;
    const power = superCast ? Math.round(move.power * SHOWDOWN_SUPER_POWER_MULT) : move.power;

    // Costs and cooldowns — overexertion is allowed and priced in wind.
    let overexerted = false;
    if (superCast) {
        actor.meter = 0;
    } else {
        if (actor.stamina < move.cost) {
            overexerted = true;
            actor.winded = true;
            actor.stamina = 0;
        } else {
            actor.stamina -= move.cost;
        }
        move.currentCooldown = move.cooldown;
    }
    actor.guarding = false;

    const targets: Extract<ShowdownEvent, { t: 'action' }>['targets'] = [];

    const applyOffensiveHit = (target: ShowdownPet, powerScale: number, applied?: string, splash = false): void => {
        const guarded = target.guarding;
        // Temtem-style ally synergy: a LIVING teammate whose element beats the
        // target amplifies the hit. Solo formats have no ally, so no bonus.
        const synergy = livingOf(session, actorSide)
            .some((ally) => ally !== actor && SHOWDOWN_ELEMENT_BEATS[ally.element] === target.element);
        const dmg = rawDamage(session, actor, target, Math.round(power * powerScale), timingMult, synergy ? SHOWDOWN_SYNERGY_MULT : 1);
        const { dealt, ko } = applyDamage(session, target, dmg);
        if (dealt > 0) gainMeter(actor, SHOWDOWN_METER_ON_HIT_DEALT);
        const eff = elementMult(actor.element, target.element);
        targets.push({
            id: target.id,
            damage: dealt,
            heal: 0,
            effectiveness: eff > 1 ? 'super' : eff < 1 ? 'weak' : 'neutral',
            guarded,
            ko,
            ...(applied ? { applied } : {}),
            ...(synergy && dealt > 0 ? { synergy: true } : {}),
            ...(splash ? { splash: true } : {}),
        });
    };

    if (SELF_KINDS.has(kind)) {
        // Self moves: apply the status to the actor.
        switch (kind) {
            case 'buff': addStatus(session, actor, 'buff', move.power > 150 ? 3 : 2, 1.25); break;
            case 'haste':
            case 'move': addStatus(session, actor, 'haste', 2, 1.25); break;
            case 'shield':
            case 'barrier':
            case 'absorb': addStatus(session, actor, 'shield', 2, Math.max(40, Math.round(power * 1.1))); break;
            case 'taunt': {
                const foes = livingOf(session, actorSide === 'player' ? 'enemy' : 'player');
                if (foes.length > 1 || session.format !== '1v1') addStatus(session, actor, 'taunt', 1, 1);
                else addStatus(session, actor, 'tauntGuard', 1, 1.2);
                break;
            }
        }
        targets.push({ id: actor.id, damage: 0, heal: 0, effectiveness: 'neutral', guarded: false, ko: false, applied: kind === 'move' ? 'haste' : kind });
    } else if (kind === 'heal') {
        const ally = resolveAllyTarget(session, actorSide, action.targetId, actor);
        // power 120 ≈ 17% maxHp, capped at 30% — meaningful against the 2.2x
        // damage pace without enabling heal-stall (the judge counts HP%).
        const sageBonus = actor.role === 'sage' ? SAGE_HEAL_MULT : 1;
        const healed = applyHeal(ally, ally.maxHp * Math.min(0.3, (Math.max(60, power) / 700) * sageBonus));
        targets.push({ id: ally.id, damage: 0, heal: healed, effectiveness: 'neutral', guarded: false, ko: false, applied: 'heal' });
    } else {
        const target = resolveTarget(session, actorSide, action.targetId);
        if (target) {
            // Signature splash: in team formats the super also washes over every
            // OTHER living foe — collected before the primary hit can KO them.
            const splashTargets = superCast
                ? livingOf(session, actorSide === 'player' ? 'enemy' : 'player').filter((foe) => foe !== target)
                : [];
            switch (kind) {
                case 'damage':
                    applyOffensiveHit(target, 1);
                    break;
                case 'crush':
                    applyOffensiveHit(target, 1.1, 'crush');
                    if (!target.ko) addStatus(session, target, 'crush', 2, 0.8);
                    break;
                case 'lifesteal': {
                    const before = targets.length;
                    applyOffensiveHit(target, 1, 'lifesteal');
                    const dealt = targets[before]?.damage ?? 0;
                    const healed = applyHeal(actor, dealt * 0.5);
                    if (healed > 0) targets.push({ id: actor.id, damage: 0, heal: healed, effectiveness: 'neutral', guarded: false, ko: false });
                    break;
                }
                case 'dot':
                case 'burn':
                case 'wound': {
                    // 0.75 initial + 2 ticks of 20% ≈ 115% of a plain hit's power,
                    // paid over three rounds — the DoT premium for delayed value.
                    applyOffensiveHit(target, 0.75, kind);
                    if (!target.ko) addStatus(session, target, kind === 'dot' ? 'burn' : kind, 2, Math.round(power * 0.2));
                    break;
                }
                case 'stun':
                    applyOffensiveHit(target, 0.5, 'stun');
                    if (!target.ko) addStatus(session, target, 'stun', 1, 1);
                    break;
                case 'freeze':
                    applyOffensiveHit(target, 0.6, 'freeze');
                    if (!target.ko) addStatus(session, target, 'freeze', 1, 1);
                    break;
                case 'confuse':
                    applyOffensiveHit(target, 0.6, 'confuse');
                    if (!target.ko) addStatus(session, target, 'confuse', 2, 1);
                    break;
                case 'debuff':
                    applyOffensiveHit(target, 0.4, 'debuff');
                    if (!target.ko) addStatus(session, target, 'debuff', 2, 0.8);
                    break;
                case 'mark':
                    applyOffensiveHit(target, 0.4, 'mark');
                    if (!target.ko) addStatus(session, target, 'mark', 3, 1.25);
                    break;
                case 'slow':
                case 'movelock':
                    applyOffensiveHit(target, 0.4, 'slow');
                    if (!target.ko) addStatus(session, target, 'slow', 2, 0.75);
                    break;
                case 'push':
                case 'pull':
                    applyOffensiveHit(target, 0.7, kind);
                    target.stamina = Math.max(0, target.stamina - 12);
                    break;
                default:
                    applyOffensiveHit(target, 1);
                    break;
            }
            for (const foe of splashTargets) {
                if (!foe.ko) applyOffensiveHit(foe, SHOWDOWN_SUPER_SPLASH_SCALE, undefined, true);
            }
        }
    }

    events.push({
        t: 'action',
        actorId: actor.id,
        actorSide,
        moveName: move.name,
        moveKind: kind,
        element: actor.element,
        delivery: deliveryFor(kind, actor.role),
        super: superCast,
        timing: timingIdx,
        targets,
        staminaAfter: Math.round(actor.stamina),
        meterAfter: Math.round(actor.meter),
        overexerted,
    });
}

function sideDefeated(session: ShowdownSession, side: Side): boolean {
    // The BENCH counts: a wiped field with reserves is a reinforcement moment,
    // not a loss.
    return livingTeam(session, side).length === 0;
}

function judgeOutcome(session: ShowdownSession): ShowdownOutcome {
    const hpPct = (pets: ShowdownPet[]) => pets.reduce((sum, p) => sum + p.hp / p.maxHp, 0);
    const mine = hpPct(session.player);
    const theirs = hpPct(session.enemy);
    // Strictly-greater wins the decision; the tie goes to the challenger's foe so
    // stalling out the clock is never a free win. No draws by construction.
    return mine > theirs ? 'win' : 'loss';
}

function finish(session: ShowdownSession, outcome: ShowdownOutcome, byJudge: boolean, events: ShowdownEvent[]): void {
    session.finished = true;
    session.outcome = outcome;
    events.push({ t: 'end', outcome, byJudge });
}

/**
 * Resolve one full round: both sides' commands execute in speed order, then
 * end-of-round upkeep (DoTs, status decay, stamina regen).
 */
export function resolveShowdownRound(
    session: ShowdownSession,
    playerCommands: ShowdownCommand[],
    enemyCommands: ShowdownCommand[],
): ShowdownEvent[] {
    const events: ShowdownEvent[] = [];
    if (session.finished) return events;
    session.round += 1;
    events.push({ t: 'roundStart', round: session.round });

    const commandFor = (pet: ShowdownPet, side: Side): ShowdownCommand => {
        const list = side === 'player' ? playerCommands : enemyCommands;
        const found = list.find((c) => c.petId === pet.id);
        return found ?? { kind: 'guard', petId: pet.id };
    };

    // ── Switch phase: Pokémon priority — ALL switches resolve before any
    // attack, so a read on the incoming pet is a real prediction play. ──────
    const switchedIn = new Set<string>();
    for (const side of ['player', 'enemy'] as Side[]) {
        const commands = side === 'player' ? playerCommands : enemyCommands;
        for (const command of commands) {
            if (command.kind !== 'switch') continue;
            const team = side === 'player' ? session.player : session.enemy;
            const out = team.find((p) => p.id === command.petId && !p.ko && !p.benched);
            const inbound = team.find((p) => p.id === command.benchPetId && !p.ko && p.benched);
            if (!out || !inbound) continue;
            out.benched = true;
            out.guarding = false;
            // Field-presence effects end when the body leaves the arena.
            out.statuses = out.statuses.filter((s) => s.kind !== 'taunt' && s.kind !== 'tauntGuard');
            inbound.benched = false;
            switchedIn.add(inbound.id);
            events.push({ t: 'switch', side, outId: out.id, inId: inbound.id, reinforcement: false });
        }
    }

    // Speed order across BOTH sides' fields, seeded tiebreak, snapshot after
    // switches. Freshly switched-in pets spent their action arriving.
    const order = [
        ...session.player.filter((p) => !p.ko && !p.benched).map((pet) => ({ pet, side: 'player' as Side })),
        ...session.enemy.filter((p) => !p.ko && !p.benched).map((pet) => ({ pet, side: 'enemy' as Side })),
    ]
        .filter(({ pet }) => !switchedIn.has(pet.id))
        .map((entry) => ({ ...entry, sortKey: effSpeed(entry.pet) + nextRand(session) * 0.5 }))
        .sort((a, b) => b.sortKey - a.sortKey);

    for (const { pet, side } of order) {
        if (session.finished) break;
        if (pet.ko || pet.benched) continue;

        // Skips: overexertion wind, stun, freeze coin.
        if (pet.winded) {
            pet.winded = false;
            events.push({ t: 'skip', actorId: pet.id, actorSide: side, reason: 'winded' });
            continue;
        }
        if (hasStatus(pet, 'stun')) {
            pet.statuses = pet.statuses.filter((s) => s.kind !== 'stun');
            events.push({ t: 'skip', actorId: pet.id, actorSide: side, reason: 'stun' });
            continue;
        }
        if (hasStatus(pet, 'freeze') && nextRand(session) < 0.5) {
            events.push({ t: 'skip', actorId: pet.id, actorSide: side, reason: 'freeze' });
            continue;
        }

        const command = sanitizeCommand(session, pet, commandFor(pet, side));

        // Confusion: half chance the action becomes a self-hit.
        if (hasStatus(pet, 'confuse') && command.kind !== 'guard' && command.kind !== 'rest' && nextRand(session) < 0.5) {
            const selfDmg = Math.max(1, Math.round((effAttack(pet) * 0.55 * (0.95 + nextRand(session) * 0.1))));
            const { ko } = applyDamage(session, pet, selfDmg);
            events.push({ t: 'confused', actorId: pet.id, actorSide: side, selfDamage: selfDmg, ko });
        } else if (command.kind === 'guard') {
            pet.guarding = true;
            pet.stamina = Math.max(0, pet.stamina - SHOWDOWN_GUARD_COST);
            events.push({
                t: 'action', actorId: pet.id, actorSide: side, moveName: 'Guard', moveKind: 'guard',
                element: pet.element, delivery: 'self', super: false, timing: 0,
                targets: [{ id: pet.id, damage: 0, heal: 0, effectiveness: 'neutral', guarded: false, ko: false, applied: 'guard' }],
                staminaAfter: Math.round(pet.stamina), meterAfter: Math.round(pet.meter), overexerted: false,
            });
        } else if (command.kind === 'rest') {
            pet.stamina = Math.min(SHOWDOWN_MAX_STAMINA, pet.stamina + SHOWDOWN_REST_STAMINA);
            const healed = applyHeal(pet, pet.maxHp * SHOWDOWN_REST_HEAL_PCT);
            pet.guarding = false;
            events.push({
                t: 'action', actorId: pet.id, actorSide: side, moveName: 'Catch Breath', moveKind: 'rest',
                element: pet.element, delivery: 'self', super: false, timing: 0,
                targets: [{ id: pet.id, damage: 0, heal: healed, effectiveness: 'neutral', guarded: false, ko: false, applied: 'rest' }],
                staminaAfter: Math.round(pet.stamina), meterAfter: Math.round(pet.meter), overexerted: false,
            });
        } else if (command.kind === 'super') {
            executeMove(session, pet, side, {
                move: pet.signatureMove, superCast: true,
                timing: command.timing ?? 0, targetId: command.targetId,
            }, events);
        } else if (command.kind === 'move') {
            executeMove(session, pet, side, {
                move: pet.moves[command.moveIndex], superCast: false,
                timing: command.timing ?? 0, targetId: command.targetId,
            }, events);
        }
        // ('switch' never reaches here: successful swaps left the order, and
        // sanitizeCommand downgrades a failed swap to guard above.)

        if (sideDefeated(session, 'enemy')) { finish(session, 'win', false, events); }
        else if (sideDefeated(session, 'player')) { finish(session, 'loss', false, events); }
    }

    // ── End-of-round upkeep ──────────────────────────────────────────────────
    if (!session.finished) {
        for (const side of ['player', 'enemy'] as Side[]) {
            // Field pets: DoTs tick, statuses decay, cooldowns and stamina turn.
            for (const pet of livingOf(session, side)) {
                // Side defeat from a tick is detected after upkeep, so both
                // sides always take their full end-of-round damage.
                for (const s of pet.statuses) {
                    if ((s.kind === 'burn' || s.kind === 'wound') && s.magnitude > 0) {
                        const { dealt, ko } = applyDamage(session, pet, s.magnitude);
                        if (dealt > 0) events.push({ t: 'dot', targetId: pet.id, targetSide: side, kind: s.kind, damage: dealt, ko });
                    }
                }
                if (pet.ko) continue;
                // Status decay + cooldowns + regen. A status born THIS round is
                // exempt from this round's decay — a stun landed mid-round must
                // still cost the target its next-round action.
                pet.statuses = pet.statuses
                    .map((s) => (s.bornRound < session.round ? { ...s, rounds: s.rounds - 1 } : s))
                    .filter((s) => s.rounds > 0);
                for (const m of pet.moves) m.currentCooldown = Math.max(0, m.currentCooldown - 1);
                pet.stamina = Math.min(SHOWDOWN_MAX_STAMINA, pet.stamina + SHOWDOWN_STAMINA_REGEN);
            }
            // Bench pets rest: stamina + cooldowns recover, statuses stay frozen
            // (no ticks, no decay — you can't wait out a burn from the bench).
            for (const pet of livingTeam(session, side).filter((p) => p.benched)) {
                for (const m of pet.moves) m.currentCooldown = Math.max(0, m.currentCooldown - 1);
                pet.stamina = Math.min(SHOWDOWN_MAX_STAMINA, pet.stamina + SHOWDOWN_STAMINA_REGEN);
            }
        }
        if (sideDefeated(session, 'enemy')) finish(session, 'win', false, events);
        else if (sideDefeated(session, 'player')) finish(session, 'loss', false, events);
    }

    // ── Reinforcements: the bench fills empty field slots at round end ──────
    if (!session.finished) {
        const fieldSize = SHOWDOWN_FORMAT_SIZE[session.format];
        for (const side of ['player', 'enemy'] as Side[]) {
            const team = side === 'player' ? session.player : session.enemy;
            let fielded = livingOf(session, side).length;
            for (const pet of team) {
                if (fielded >= fieldSize) break;
                if (pet.ko || !pet.benched) continue;
                pet.benched = false;
                fielded += 1;
                const fallen = team.find((p) => p.ko && !p.benched);
                events.push({ t: 'switch', side, outId: fallen?.id ?? pet.id, inId: pet.id, reinforcement: true });
            }
        }
    }

    events.push({ t: 'roundEnd', round: session.round });

    if (!session.finished && session.round >= SHOWDOWN_MAX_ROUNDS) {
        finish(session, judgeOutcome(session), true, events);
    }
    return events;
}

/** Downgrade any illegal command to a safe Guard — never fail the whole turn. */
export function sanitizeCommand(session: ShowdownSession, pet: ShowdownPet, command: ShowdownCommand): ShowdownCommand {
    if (command.kind === 'guard' || command.kind === 'rest') return command;
    // Switch legality is enforced in the switch phase itself (an invalid swap
    // is simply skipped); by the time the action loop runs, any pet still
    // holding a switch command had its swap rejected — it guards instead.
    if (command.kind === 'switch') return { kind: 'guard', petId: pet.id };
    if (command.kind === 'super') {
        if (pet.meter >= SHOWDOWN_METER_MAX) return command;
        return { kind: 'guard', petId: pet.id };
    }
    const move = pet.moves[command.moveIndex];
    if (!move || move.currentCooldown > 0) return { kind: 'guard', petId: pet.id };
    return command;
}

// ─── Public view ─────────────────────────────────────────────────────────────

function petView(pet: ShowdownPet): ShowdownPetView {
    return {
        id: pet.id,
        name: pet.name,
        element: pet.element,
        role: pet.role,
        rarity: pet.rarity,
        ...(pet.templateId ? { templateId: pet.templateId } : {}),
        level: pet.level,
        hp: Math.round(pet.hp),
        maxHp: pet.maxHp,
        stamina: Math.round(pet.stamina),
        meter: Math.round(pet.meter),
        ko: pet.ko,
        guarding: pet.guarding,
        benched: pet.benched,
        winded: pet.winded || hasStatus(pet, 'stun'),
        statuses: pet.statuses
            .filter((s) => s.kind !== 'tauntGuard')
            .map((s) => ({ kind: s.kind, rounds: s.rounds })),
        moves: pet.moves.map((m) => ({
            name: m.name, power: m.power, kind: m.kind, cost: m.cost,
            cooldown: m.cooldown, currentCooldown: m.currentCooldown, signature: false,
        })).concat([{
            name: pet.signatureMove.name, power: pet.signatureMove.power, kind: pet.signatureMove.kind,
            cost: 0, cooldown: 0, currentCooldown: 0, signature: true,
        }]),
    };
}

export function showdownStateView(session: ShowdownSession): ShowdownStateView {
    return {
        sessionId: session.sessionId,
        format: session.format,
        tier: session.tier,
        round: session.round,
        maxRounds: SHOWDOWN_MAX_ROUNDS,
        finished: session.finished,
        outcome: session.outcome,
        player: session.player.map(petView),
        enemy: session.enemy.map(petView),
        enemyTeamName: session.enemyTeamName,
        // Projected order for the NEXT round: current haste/slow effects
        // applied, the per-round rng jitter deliberately excluded — a preview,
        // not a promise (ties can still flip on the tiebreak roll).
        nextOrder: [...session.player, ...session.enemy]
            .filter((p) => !p.ko && !p.benched)
            .sort((a, b) => effSpeed(b) - effSpeed(a))
            .map((p) => p.id),
    };
}
