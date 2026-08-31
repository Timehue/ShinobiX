import {
    petPveHealOnSummonPct,
    petPveLifestealPct,
    petPveLoyalty,
    petPveSummonDamageMult,
    PET_CONSUMABLE_PVE_HEAL_PCT,
} from '../_pet-sim/pet-config.js';
import { activeCarriedPets } from '../_entitlements.js';
import { petCombatBusyReason } from '../pet/_pet-busy.js';
import { currentPetHappiness } from '../pet/_happiness.js';
import {
    PET_HAPPINESS_OBEDIENT,
    PET_HAPPINESS_RESTLESS,
    petHappinessCombatMult,
    petHappinessDisobeyChance,
} from '../../shared/pet-happiness.js';

export const COMPANION_MAX_DAMAGE_FRAC = 0.16;
export const COMPANION_FIELD_ROUNDS = 4;
export const COMPANION_ACTOR_ID = 'companion-0';
export const COMPANION_RANGE = 2;
/** The disobey chance of the RESTLESS band (50-70). Below 50 it is steeper —
 *  see petHappinessDisobeyChance, which `companionObeys` actually rolls against. */
export const COMPANION_DISOBEY_CHANCE = petHappinessDisobeyChance(PET_HAPPINESS_RESTLESS);
export const COMPANION_OBEDIENT_HAPPINESS = PET_HAPPINESS_OBEDIENT;

const SELF_KINDS = new Set(['heal', 'shield', 'barrier', 'buff', 'haste', 'absorb', 'taunt', 'move']);
const SUPPORT_KINDS = new Set(['heal', 'shield', 'barrier']);
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
    id?: string;
    name?: string;
    nickname?: string;
    level?: number;
    hp?: number;
    attack?: number;
    defense?: number;
    speed?: number;
    happiness?: number;
    happinessDay?: number;
    happinessPets?: number;
    unlockedForPve?: boolean;
    training?: unknown;
    expedition?: unknown;
    jutsus?: PetJutsuLike[];
    loadout?: { pve?: string; pveDurability?: number; consumable?: string };
};

export function companionStrikeDamage(pet: PetLike): number {
    const jutsus = Array.isArray(pet.jutsus) ? pet.jutsus : [];
    const powers = jutsus.filter((jutsu) => jutsu?.kind === 'damage').map((jutsu) => Number(jutsu?.power ?? 0));
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
    pveGearId: string;
    consumableId?: string;
};

export function sealCompanionFromSave(char: Record<string, unknown>, now = Date.now()): CompanionSeal | null {
    const pets = activeCarriedPets<PetLike>(char);
    const activeId = typeof char.activePetId === 'string' ? char.activePetId : '';
    if (!activeId) return null;
    const pet = pets.find((candidate) => candidate && String(candidate.id ?? '') === activeId);
    if (!pet) return null;
    const level = Math.max(0, Math.floor(Number(pet.level ?? 0)) || 0);
    if (level < 50) return null;
    if (petCombatBusyReason(char, pet as Record<string, unknown>, now)) return null;
    const moves: CompanionMove[] = (Array.isArray(pet.jutsus) ? pet.jutsus : [])
        .filter((jutsu) => jutsu && typeof jutsu.name === 'string' && jutsu.name)
        .slice(0, 8)
        .map((jutsu) => ({
            name: String(jutsu.name).slice(0, 40),
            kind: String(jutsu.kind ?? 'damage'),
            power: Math.max(0, Math.floor(Number(jutsu.power ?? 0)) || 0),
            cooldown: Math.max(1, Math.floor(Number(jutsu.cooldown ?? 1)) || 1),
            rounds: Math.max(1, Math.floor(Number(jutsu.rounds ?? 2)) || 2),
            signature: jutsu.signature === true,
        }));
    // PROJECT the pending bond decay rather than reading `pet.happiness` raw:
    // the owner may not have re-read their save since the UTC rollover, and a
    // fight must never resolve against a happiness the player no longer has.
    // Nothing is written here — the durable tick happens on the owner's save
    // read and on any pet action (api/pet/_happiness.ts).
    const happiness = currentPetHappiness(pet as Record<string, unknown>, now);
    return {
        petId: String(pet.id ?? ''),
        name: String(pet.nickname?.trim() || pet.name || 'Companion').slice(0, 40),
        hp: Math.max(1, Math.floor(Number(pet.hp ?? 0)) || 1),
        // A neglected companion hits softer (x0.9 unhappy / x0.8 neglected).
        // The multiplier is 1 at 50+, so a maintained pet is untouched.
        damage: Math.max(1, Math.floor(companionStrikeDamage(pet) * petHappinessCombatMult(happiness))),
        happiness,
        loyal: petPveLoyalty(pet as never) === true,
        moves,
        pveGearId: Number(pet.loadout?.pveDurability ?? 0) > 0 ? String(pet.loadout?.pve ?? '') : '',
        ...(pet.loadout?.consumable ? { consumableId: String(pet.loadout.consumable) } : {}),
    };
}

export function companionConsumableHealPct(consumableId: string | undefined): number {
    return consumableId ? PET_CONSUMABLE_PVE_HEAL_PCT : 0;
}

const asGearedPet = (gearId: string) => ({ loadout: { pve: gearId } }) as never;

export function companionGearDamageMult(gearId: string, enemyHpPct: number, ownerHpPct: number): number {
    return gearId ? petPveSummonDamageMult(asGearedPet(gearId), enemyHpPct, ownerHpPct) : 1;
}

export function companionOwnerLifestealPct(gearId: string): number {
    return gearId ? petPveLifestealPct(asGearedPet(gearId)) : 0;
}

export function companionHealOnSummonPct(gearId: string): number {
    return gearId ? petPveHealOnSummonPct(asGearedPet(gearId)) : 0;
}

/**
 * Does the companion follow its owner's command this round?
 *
 * The disobey chance now SCALES with happiness (shared/pet-happiness.ts) instead
 * of being one flat 35% below the 71 cliff: 35% restless, 50% unhappy, 65%
 * neglected. At or above 71 the chance is 0, so `roll >= 0` is always true and
 * the pre-existing "happy pets always obey" rule is preserved exactly. A Loyal
 * pet (or loyalty gear) still bypasses the roll entirely.
 */
export function companionObeys(happiness: number, loyal: boolean, roll: number): boolean {
    return loyal || roll >= petHappinessDisobeyChance(happiness);
}

export function pickCompanionMove(
    moves: CompanionMove[],
    cooldowns: Record<string, number>,
    hpFrac: number,
): CompanionMove | null {
    const ready = (move: CompanionMove) => Number(cooldowns[move.name] ?? 0) <= 0;
    if (hpFrac < 0.5) {
        const support = moves.find((move) => SUPPORT_KINDS.has(move.kind) && ready(move));
        if (support) return support;
    }
    const usable = moves.filter((move) => !SELF_KINDS.has(move.kind) && ready(move));
    if (usable.length === 0) return null;
    return usable.find((move) => move.signature)
        ?? usable.slice().sort((a, b) => b.power - a.power || a.name.localeCompare(b.name))[0]
        ?? null;
}

export function companionMoveDamage(baseDamage: number, move: CompanionMove | null): number {
    if (!move) return Math.max(0, Math.floor(baseDamage));
    const scale = KIND_DAMAGE_SCALE[move.kind] ?? 1;
    if (scale <= 0) return 0;
    const powerScale = Math.max(0.6, Math.min(1.4, (move.power || 40) / 45));
    return Math.max(0, Math.floor(baseDamage * scale * powerScale));
}
