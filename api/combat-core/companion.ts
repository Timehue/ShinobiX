import {
    petConsumableById,
    petPveHealOnSummonPct,
    petPveLifestealPct,
    petPveLoyalty,
    petPveSummonDamageMult,
    PET_CONSUMABLE_PVE_HEAL_PCT,
} from '../_pet-sim/pet-config.js';
import { activeCarriedPets } from '../_entitlements.js';
import { petCombatBusyReason } from '../pet/_pet-busy.js';
import { currentPetHappiness } from '../pet/_happiness.js';
import { petBattleJutsus } from '../../shared/pet-battle-loadout.js';
import { petSignatureMastery, petUnmasteredPower } from '../../shared/pet-ability-mastery.js';
import { petBattleChannels } from '../../shared/pet-battle-stats.js';
import { petSummonApCost } from '../../shared/pet-summon.js';
import { masteryBonus, masteryHasCapstone } from '../_profession-mastery.js';
import { derivePetGrowthStats, sanitizeGrowthAllocation } from '../pet/_growth.js';
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

const SELF_KINDS = new Set(['heal', 'shield', 'barrier', 'buff', 'haste', 'absorb', 'taunt', 'move', 'cleanse']);
const SUPPORT_KINDS = new Set(['heal', 'shield', 'barrier']);
const boundedDefense = (value: unknown): number => Number.isFinite(Number(value)) ? Math.max(0, Math.min(10000, Number(value))) : 0;
const KIND_DAMAGE_SCALE: Record<string, number> = {
    heal: 0, shield: 0, barrier: 0, buff: 0, haste: 0, absorb: 0, taunt: 0, move: 0, cleanse: 0,
    stun: 0.6, freeze: 0.6, movelock: 0.6,
    wound: 0.5, dot: 0.5, burn: 0.5,
    crush: 1, lifesteal: 1, damage: 1,
    confuse: 0.6, debuff: 0.6, slow: 0.6,
    mark: 0.7, push: 0.6, pull: 0.6,
};

export type CompanionMove = {
    rulesetVersion?: 'progression-v3';
    signatureMastery?: boolean;
    offenseMastery?: boolean;
    name: string;
    kind: string;
    power: number;
    cooldown: number;
    rounds: number;
    signature: boolean;
};

type PetJutsuLike = { name?: string; kind?: string; power?: number; cooldown?: number; rounds?: number; signature?: boolean; upgrade?: string };
type PetLike = {
    id?: string;
    templateId?: unknown;
    evolutionStage?: unknown;
    rarity?: unknown;
    role?: string;
    growthBaseStats?: unknown;
    growthAllocation?: unknown;
    rankedBuild?: unknown;
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
    const jutsus = petBattleJutsus(pet, { forceProgression: true });
    const powers = jutsus.filter((jutsu) => jutsu?.kind === 'damage').map((jutsu) => petUnmasteredPower(Number(jutsu?.power ?? 0), jutsu?.upgrade));
    const bestDamageJutsu = powers.length ? Math.max(0, ...powers) : 0;
    return Math.max(20, Math.floor(
        Number(pet.attack ?? 0) * 1.25
        + bestDamageJutsu * 0.6
        + Number(pet.level ?? 0) * 2,
    ));
}

export type CompanionSeal = {
    summonApCost?: number;
    /** Alpha Bond belongs to this admitted summon, once for the whole fight. */
    reviveOnce?: boolean;
    petId: string;
    name: string;
    hp: number;
    damage: number;
    happiness: number;
    loyal: boolean;
    moves: CompanionMove[];
    rulesetVersion?: 'progression-v3';
    defense?: number;
    spDefense?: number;
    referenceHp?: number;
    /** Absent on retained sessions, which keep their original movement cost. */
    speed?: number;
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
    const moves: CompanionMove[] = petBattleJutsus(pet, { forceProgression: true })
        .filter((jutsu) => jutsu && typeof jutsu.name === 'string' && jutsu.name)
        .slice(0, 8)
        .map((jutsu) => ({
            rulesetVersion: 'progression-v3' as const,
            ...(jutsu.signature && jutsu.upgrade === 'signature-mastery' ? { signatureMastery: true } : {}),
            ...(!jutsu.signature && jutsu.upgrade === 'offense-mastery' ? { offenseMastery: true } : {}),
            name: String(jutsu.name).slice(0, 40),
            kind: String(jutsu.kind ?? 'damage'),
            power: Math.max(0, Math.floor(Number(jutsu.power ?? 0)) || 0),
            cooldown: Math.max(['heal', 'shield', 'barrier', 'stun', 'freeze', 'movelock'].includes(String(jutsu.kind))
                ? jutsu.upgrade === 'utility-mastery' ? 2 : 3 : 1, Math.floor(Number(jutsu.cooldown ?? 1)) || 1),
            rounds: Math.min(2, Math.max(1, Math.floor(Number(jutsu.rounds ?? 2)) || 2)),
            signature: jutsu.signature === true,
        }));
    // PROJECT the pending bond decay rather than reading `pet.happiness` raw:
    // the owner may not have re-read their save since the UTC rollover, and a
    // fight must never resolve against a happiness the player no longer has.
    // Nothing is written here — the durable tick happens on the owner's save
    // read and on any pet action (api/pet/_happiness.ts).
    const happiness = currentPetHappiness(pet as Record<string, unknown>, now);
    // Spent PvE gear (durability 0) grants nothing, loyalty included: the Bell and
    // the Crest used to stay loyal for good once worn out (2026-10 item-use pass).
    const pveGearId = Number(pet.loadout?.pveDurability ?? 0) > 0 ? String(pet.loadout?.pve ?? '') : '';
    // Only a real battle consumable heals on summon; a stray id in the slot is inert.
    const consumableId = petConsumableById(pet.loadout?.consumable) ? String(pet.loadout?.consumable) : '';
    // Match the existing PvE pet-battle profession/mastery bonuses. Seal them
    // once so neither reconnects nor later save edits can stack the benefits.
    const rank = Math.max(0, Math.min(10, Number(char.professionRank) || 0));
    const damageMult = char.profession === 'petTamer'
        ? 1 + (5 + rank * 1.5 + masteryBonus(char.profession, char.masterySpec, 'petPveDamagePct')) / 100 : 1;
    const hpMult = 1 + masteryBonus(char.profession, char.masterySpec, 'petPveHpPct') / 100;
    return {
        petId: String(pet.id ?? ''),
        summonApCost: petSummonApCost(char),
        ...(masteryHasCapstone(char.profession, char.masterySpec, 'alpha-bond') ? { reviveOnce: true } : {}),
        rulesetVersion: 'progression-v3',
        speed: boundedDefense(pet.speed),
        defense: boundedDefense(pet.defense),
        spDefense: petBattleChannels({ attack: Number(pet.attack) || 1, defense: boundedDefense(pet.defense), role: pet.role }).spDefense,
        // Opponent threat uses the same species/level/trait baseline. Vitality
        // increases actual survival instead of increasing every incoming hit.
        referenceHp: pet.growthBaseStats ? derivePetGrowthStats({ ...pet,
            growthAllocation: { ...sanitizeGrowthAllocation(pet.growthAllocation, pet.level), vitality: 0 } }).hp
            : Math.max(1, Math.floor(Number(pet.hp) || 1)),
        name: String(pet.nickname?.trim() || pet.name || 'Companion').slice(0, 40),
        hp: Math.max(1, Math.round((Math.max(1, Math.floor(Number(pet.hp ?? 0)) || 1)) * hpMult)),
        // A neglected companion hits softer (x0.9 unhappy / x0.8 neglected).
        // The multiplier is 1 at 50+, so a maintained pet is untouched.
        damage: Math.max(1, Math.floor(companionStrikeDamage(pet) * petHappinessCombatMult(happiness) * damageMult)),
        happiness,
        loyal: pveGearId ? petPveLoyalty(asGearedPet(pveGearId)) === true : false,
        moves,
        pveGearId,
        ...(consumableId ? { consumableId } : {}),
    };
}

/** Alpha Bond restores the same 40% HP used by the standalone PvE pet simulator. */
export function companionReviveHp(maxHp: number): number {
    return Math.max(1, Math.round(maxHp * 0.4));
}

export function companionConsumableHealPct(consumableId: string | undefined): number {
    return petConsumableById(consumableId) ? PET_CONSUMABLE_PVE_HEAL_PCT : 0;
}

function asGearedPet(gearId: string) { return ({ loadout: { pve: gearId } }) as never; }

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

/** Kind, not rounded damage, decides whether a cast needs an enemy in range. */
export function isCompanionSupportMove(move: CompanionMove | null): boolean {
    return !!move && SELF_KINDS.has(move.kind);
}

/** Speed discounts movement only: one AP per 20 Speed, bounded to ten AP.
 * The turn's AP, action limit, strike cost and four-phase lifespan stay fixed. */
export function companionMoveAp(speed: unknown, baseCost = 30): number {
    const discount = Math.min(10, Math.floor(boundedDefense(speed) / 20));
    return Math.max(1, baseCost - discount);
}

export function pickCompanionMove(
    moves: CompanionMove[],
    cooldowns: Record<string, number>,
    hpFrac: number,
    needsCleanse = false,
    preparation?: { ordinaryActions: number; requiredActions: number },
): CompanionMove | null {
    const ready = (move: CompanionMove) => Number(cooldowns[move.name] ?? 0) <= 0
        && (!move.signature || !preparation || preparation.ordinaryActions >= preparation.requiredActions);
    if (needsCleanse) {
        const cleanse = moves.find(move => move.kind === 'cleanse' && ready(move));
        if (cleanse) return cleanse;
    }
    if (hpFrac < 0.5) {
        const support = moves.find((move) => SUPPORT_KINDS.has(move.kind) && ready(move));
        if (support) return support;
    }
    const usable = moves.filter((move) => !SELF_KINDS.has(move.kind) && ready(move));
    return usable.find((move) => move.signature)
        ?? moves.find(move => ['buff', 'haste', 'absorb', 'taunt'].includes(move.kind) && ready(move))
        ?? usable.slice().sort((a, b) => b.power - a.power || a.name.localeCompare(b.name))[0]
        ?? null;
}

export function companionMoveDamage(baseDamage: number, move: CompanionMove | null): number {
    if (!move) return Math.max(0, Math.floor(baseDamage));
    const scale = KIND_DAMAGE_SCALE[move.kind] ?? 1;
    if (scale <= 0) return 0;
    const mastery = petSignatureMastery(move, move.rulesetVersion === 'progression-v3' && move.signature);
    const advancedMastery = move.rulesetVersion === 'progression-v3' && !move.signature && move.offenseMastery === true;
    const power = petUnmasteredPower(move.power, mastery.mastered ? 'signature-mastery' : advancedMastery ? 'offense-mastery' : undefined);
    const powerScale = Math.max(0.6, Math.min(1.4, (power || 40) / 45));
    const budget = move.rulesetVersion === 'progression-v3' && move.kind === 'lifesteal' ? .75 : 1;
    return Math.max(0, Math.floor(baseDamage * scale * powerScale * budget * mastery.offenseMult * (advancedMastery ? 1.08 : 1)));
}

/** New summoned companions use a sealed species/level threat baseline.
 * Guard gives bounded mitigation; Vitality can therefore buy additional hits. */
export function companionIncomingDamage(referenceHp: number, defense: number, threatFraction: number): number {
    const guard = boundedDefense(defense);
    return Math.max(1, Math.floor(Math.max(1, Number(referenceHp) || 1) * threatFraction
        * (1 - .3 * guard / (guard + 100))));
}
