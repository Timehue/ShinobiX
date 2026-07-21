import type { TowerActor } from './_tower-session.js';
import {
    petPveHealOnSummonPct, petPveLifestealPct, petPveLoyalty, petPveSummonDamageMult,
} from '../_pet-sim/pet-config.js';

// ─── Summoned companion (the player's pet) ───────────────────────────────────
// A combat mission can summon the player's active pet onto the field, matching
// the Arena's PvE summon. The pet is sealed server-side at combat-start (the
// client never supplies these numbers) and spawns as a SQUAD-side ai:true actor,
// so the engine's existing turn queue drives it for free.
//
// Its strike deliberately does NOT run through the shinobi stat/damage formula.
// The Arena's summon deals a FLAT petCombatDamage figure capped at a fraction of
// the target's max HP, so mirroring that keeps the pet feeling identical AND
// avoids inventing a pet-stat → shinobi-stat conversion (pure guesswork that
// would fork pet balance into a second implementation).

/** Mirrors the Arena's PET_PHASE_DAMAGE_MAX_FRAC — one pet strike can never exceed
 *  this fraction of the target's max HP, so a strong pet can't trivialize a boss. */
export const COMPANION_MAX_DAMAGE_FRAC = 0.16;
/** Mirrors the Arena's PET_FIELD_TURNS — rounds the summon stays on the field. */
export const COMPANION_FIELD_ROUNDS = 4;
/** Stable id for the single companion a solo mission can field. */
export const COMPANION_ACTOR_ID = 'companion-0';
/** Reach for the pet's strikes/casts. Tunable — the Arena uses a per-role range;
 *  a flat 2 keeps a 4-round summon from burning its life walking to the target. */
export const COMPANION_RANGE = 2;
/** Mirrors the Arena's disobey chance for an unhappy, non-loyal pet. */
export const COMPANION_DISOBEY_CHANCE = 0.35;
/** Happiness at/above which the pet always obeys (Arena parity). */
export const COMPANION_OBEDIENT_HAPPINESS = 71;

/** Self-targeted kinds — never chosen as an attack. */
const SELF_KINDS = new Set(['heal', 'shield', 'barrier', 'buff', 'haste', 'absorb', 'taunt', 'move']);
/** Kinds the pet reaches for when it's hurt. */
const SUPPORT_KINDS = new Set(['heal', 'shield', 'barrier']);

/** Per-kind damage scale, mirroring the Arena's castPetJutsu doDamage(scale) calls.
 *  0 = the kind deals no damage at all (pure support). */
const KIND_DAMAGE_SCALE: Record<string, number> = {
    heal: 0, shield: 0, barrier: 0, buff: 0, haste: 0, absorb: 0, taunt: 0, move: 0,
    stun: 0.6, freeze: 0.6, movelock: 0.6,
    wound: 0.5, dot: 0.5, burn: 0.5,
    crush: 1, lifesteal: 1, damage: 1,
    confuse: 0.6, debuff: 0.6, slow: 0.6,
    mark: 0.7, push: 0.6, pull: 0.6,
};

export type CompanionMove = {
    name: string;
    kind: string;
    power: number;
    cooldown: number;
    rounds: number;
    signature: boolean;
};

type PetJutsuLike = { name?: string; kind?: string; power?: number; cooldown?: number; rounds?: number; signature?: boolean };
type PetLike = {
    id?: string; name?: string; nickname?: string; level?: number; hp?: number;
    attack?: number; defense?: number; speed?: number; happiness?: number;
    jutsus?: PetJutsuLike[]; loadout?: { pve?: string };
};

/**
 * Byte-mirror of the client's petCombatDamage (shinobij.client/src/lib/pet.ts).
 * Pure and deterministic — no RNG — which is what lets a client-only Arena
 * behavior move into the strictly-deterministic tower engine unchanged.
 * KEEP IN SYNC with the client formula.
 */
export function companionStrikeDamage(pet: PetLike): number {
    const jutsus = Array.isArray(pet.jutsus) ? pet.jutsus : [];
    const powers = jutsus.filter(j => j?.kind === 'damage').map(j => Number(j?.power ?? 0));
    const bestDamageJutsu = powers.length ? Math.max(0, ...powers) : 0;
    return Math.max(20, Math.floor(
        Number(pet.attack ?? 0) * 1.25
        + bestDamageJutsu * 0.6
        + Number(pet.speed ?? 0) * 0.35
        + (Number(pet.hp ?? 0) + Number(pet.defense ?? 0)) * 0.025
        + Number(pet.level ?? 0) * 2,
    ));
}

export type CompanionSeal = {
    petId: string;
    name: string;
    hp: number;
    damage: number;
    happiness: number;
    loyal: boolean;
    moves: CompanionMove[];
    /** equipped PVE gear id — drives the summon-damage / lifesteal / heal-on-summon
     *  perks. Sealed as the ID (not the resolved numbers) because the damage bonus
     *  depends on live enemy/player HP% at strike time. */
    pveGearId: string;
};

/** Seal the save's ACTIVE pet into a companion profile. Returns null when the
 *  player has no usable active pet (then the mission simply has no Pet action). */
export function sealCompanionFromSave(char: Record<string, unknown>): CompanionSeal | null {
    const pets = Array.isArray(char.pets) ? char.pets as PetLike[] : [];
    const activeId = typeof char.activePetId === 'string' ? char.activePetId : '';
    if (!activeId) return null;
    const pet = pets.find(p => p && String(p.id ?? '') === activeId);
    if (!pet) return null;
    const moves: CompanionMove[] = (Array.isArray(pet.jutsus) ? pet.jutsus : [])
        .filter(j => j && typeof j.name === 'string' && j.name)
        .slice(0, 8)
        .map(j => ({
            name: String(j.name).slice(0, 40),
            kind: String(j.kind ?? 'damage'),
            power: Math.max(0, Math.floor(Number(j.power ?? 0)) || 0),
            cooldown: Math.max(1, Math.floor(Number(j.cooldown ?? 1)) || 1),
            rounds: Math.max(1, Math.floor(Number(j.rounds ?? 2)) || 2),
            signature: j.signature === true,
        }));
    return {
        petId: String(pet.id ?? ''),
        // Arena parity: petDisplayName = nickname (trimmed) falling back to the base
        // name, so a renamed pet shows ITS name on the board, not the species name.
        name: String(pet.nickname?.trim() || pet.name || 'Companion').slice(0, 40),
        hp: Math.max(1, Math.floor(Number(pet.hp ?? 0)) || 1),
        damage: companionStrikeDamage(pet),
        // Arena parity: clamp(floor(happiness)) and the PvE-gear loyalty flag.
        happiness: Math.max(0, Math.min(100, Math.floor(Number(pet.happiness ?? 0)) || 0)),
        loyal: petPveLoyalty(pet as never) === true,
        moves,
        pveGearId: String(pet.loadout?.pve ?? ''),
    };
}

// ── Equipped PVE-gear perks (Arena parity) ───────────────────────────────────
// The pet's PVE gear grants a summon-damage multiplier (plus execute/avenger
// conditionals), player lifesteal, and a heal-on-summon. All resolved from the
// SEALED gear id through the shared pet-config table, so the client can't forge
// them and Pet Coliseum / Tactical Pet Battles are untouched.
const asGearedPet = (gearId: string) => ({ loadout: { pve: gearId } }) as never;

/** Outgoing damage multiplier from PVE gear, incl. the execute (enemy low) and
 *  avenger (owner low) conditionals — hence the live HP percentages. */
export function companionGearDamageMult(gearId: string, enemyHpPct: number, ownerHpPct: number): number {
    if (!gearId) return 1;
    return petPveSummonDamageMult(asGearedPet(gearId), enemyHpPct, ownerHpPct);
}
/** % of the pet's dealt damage that heals its OWNER. */
export function companionOwnerLifestealPct(gearId: string): number {
    return gearId ? petPveLifestealPct(asGearedPet(gearId)) : 0;
}
/** % of the owner's max HP healed when the pet is summoned. */
export function companionHealOnSummonPct(gearId: string): number {
    return gearId ? petPveHealOnSummonPct(asGearedPet(gearId)) : 0;
}

/** Build the on-field companion actor. `companion: true` marks it so the squad
 *  wipe-check ignores it — a temporary pet must never hold a lost run open. */
export function companionActor(seal: CompanionSeal, pos: number, rounds = COMPANION_FIELD_ROUNDS): TowerActor {
    return {
        id: COMPANION_ACTOR_ID, side: 'squad', name: seal.name, ownerSlug: null, ai: true,
        hp: seal.hp, maxHp: seal.hp,
        // Resource pools are irrelevant to a companion, but keep them non-zero so
        // no resource gate can stall its turn.
        chakra: 999, maxChakra: 999, stamina: 999, maxStamina: 999,
        shield: 0, statuses: [], cooldowns: {}, pos,
        character: {
            companion: true,
            companionDamage: seal.damage,
            companionRoundsLeft: Math.max(1, Math.floor(rounds)),
            companionHappiness: seal.happiness,
            companionLoyal: seal.loyal,
            companionMoves: seal.moves,
            companionPveGear: seal.pveGearId,
            visual: seal.petId,
            specialty: 'Taijutsu',
            level: 1,
            stats: {},
        },
    };
}

/** True for a summoned pet actor (see companionActor). */
export function isCompanionActor(actor: Pick<TowerActor, 'character'>): boolean {
    return (actor.character as Record<string, unknown> | undefined)?.companion === true;
}

/** Arena parity: a happy OR loyal pet always obeys; otherwise it disobeys on a
 *  35% roll. `roll` comes from the engine's SEEDED rng, so this stays replayable. */
export function companionObeys(happiness: number, loyal: boolean, roll: number): boolean {
    return happiness >= COMPANION_OBEDIENT_HAPPINESS || loyal || roll >= COMPANION_DISOBEY_CHANCE;
}

/** Pick the pet's move for this turn, mirroring the Arena's two pickers:
 *  a heal/shield when below half HP, else the best offensive move (signature
 *  first, then highest power). Null → fall back to a plain strike. */
export function pickCompanionMove(
    moves: CompanionMove[], cooldowns: Record<string, number>, hpFrac: number,
): CompanionMove | null {
    const ready = (m: CompanionMove) => Number(cooldowns[m.name] ?? 0) <= 0;
    if (hpFrac < 0.5) {
        const support = moves.find(m => SUPPORT_KINDS.has(m.kind) && ready(m));
        if (support) return support;
    }
    const usable = moves.filter(m => !SELF_KINDS.has(m.kind) && ready(m));
    if (usable.length === 0) return null;
    return usable.find(m => m.signature) ?? usable.slice().sort((a, b) => b.power - a.power)[0] ?? null;
}

/** Damage a given move deals, from the pet's flat base figure. Mirrors the
 *  Arena's `doDamage(scale) * powerScale`; support kinds return 0. */
export function companionMoveDamage(baseDamage: number, move: CompanionMove | null): number {
    if (!move) return Math.max(0, Math.floor(baseDamage)); // plain strike
    const scale = KIND_DAMAGE_SCALE[move.kind] ?? 1;
    if (scale <= 0) return 0;
    const powerScale = Math.max(0.6, Math.min(1.4, (move.power || 40) / 45));
    return Math.max(0, Math.floor(baseDamage * scale * powerScale));
}
