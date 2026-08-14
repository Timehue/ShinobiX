import type { Pet, PetJutsu } from '../_pet-sim/pet-types.js';
import type { SealedDuelParams } from './_duel-replay.js';

/**
 * Versioned proof payload for a commanded casual PvE duel.  The start endpoint
 * stores this projection inside the one-use reward token and the result
 * endpoint replays only this projection.  Save-owned art, care timers, breeding
 * state, and other unbounded fields never enter the receipt.
 */
export const CASUAL_PVE_SEAL_VERSION = 1 as const;
const MAX_SEALED_JUTSUS = 16;

export type CasualPveBattleSeal = {
    version: typeof CASUAL_PVE_SEAL_VERSION;
    playerPets: Pet[];
    opponentPets: Pet[];
    params: SealedDuelParams;
};

const finite = (value: unknown, fallback: number): number => (
    Number.isFinite(Number(value)) ? Number(value) : fallback
);

function sealJutsu(jutsu: PetJutsu): PetJutsu {
    return {
        name: String(jutsu.name ?? '').slice(0, 80),
        power: finite(jutsu.power, 0),
        cooldown: finite(jutsu.cooldown, 0),
        currentCooldown: finite(jutsu.currentCooldown, 0),
        kind: jutsu.kind,
        ...(jutsu.rounds !== undefined ? { rounds: finite(jutsu.rounds, 0) } : {}),
        ...(jutsu.signature === true ? { signature: true } : {}),
        ...(jutsu.aoe === true ? { aoe: true } : {}),
    };
}

/** Only fields consulted by the cinematic duel, plus bounded identity used by
 * its result presentation and Living Witness provenance. */
export function casualPvePetSnapshot(pet: Pet): Pet {
    const loadout = pet.loadout
        ? {
            ...(typeof pet.loadout.pvp === 'string' ? { pvp: pet.loadout.pvp.slice(0, 80) } : {}),
            ...(typeof pet.loadout.consumable === 'string' ? { consumable: pet.loadout.consumable.slice(0, 80) } : {}),
        }
        : undefined;
    return {
        id: String(pet.id ?? '').slice(0, 64),
        name: String(pet.name ?? '').slice(0, 80),
        rarity: pet.rarity,
        level: finite(pet.level, 1),
        xp: finite(pet.xp, 0),
        maxLevel: finite(pet.maxLevel, 100),
        hp: finite(pet.hp, 1),
        attack: finite(pet.attack, 1),
        defense: finite(pet.defense, 1),
        speed: finite(pet.speed, 1),
        jutsus: (Array.isArray(pet.jutsus) ? pet.jutsus : [])
            .slice(0, MAX_SEALED_JUTSUS)
            .map(sealJutsu),
        unlockedForPve: pet.unlockedForPve === true,
        ...(typeof pet.nickname === 'string' && pet.nickname
            ? { nickname: pet.nickname.slice(0, 80) }
            : {}),
        ...(pet.element ? { element: pet.element } : {}),
        ...(pet.trait ? { trait: pet.trait } : {}),
        ...(pet.moveRange !== undefined ? { moveRange: finite(pet.moveRange, 2) } : {}),
        ...(loadout && Object.keys(loadout).length ? { loadout } : {}),
        ...(pet.evolutionStage !== undefined ? { evolutionStage: pet.evolutionStage } : {}),
        ...(pet.role ? { role: pet.role } : {}),
        ...(pet.subRole ? { subRole: pet.subRole } : {}),
        ...(typeof pet.templateId === 'string' && pet.templateId
            ? { templateId: pet.templateId.slice(0, 64) }
            : {}),
        ...(pet.origin ? { origin: pet.origin } : {}),
        ...(typeof pet.paletteVariantId === 'string' && pet.paletteVariantId
            ? { paletteVariantId: pet.paletteVariantId.slice(0, 64) }
            : {}),
    };
}

export function createCasualPveBattleSeal(
    playerPets: readonly Pet[],
    opponentPets: readonly Pet[],
    params: SealedDuelParams,
): CasualPveBattleSeal {
    return {
        version: CASUAL_PVE_SEAL_VERSION,
        playerPets: playerPets.map(casualPvePetSnapshot),
        opponentPets: opponentPets.map(casualPvePetSnapshot),
        params: { ...params },
    };
}

const validPet = (value: unknown): value is Pet => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const pet = value as Partial<Pet>;
    return typeof pet.id === 'string' && pet.id.length > 0 && pet.id.length <= 64
        && typeof pet.name === 'string' && pet.name.length > 0 && pet.name.length <= 80
        && (pet.rarity === 'standard' || pet.rarity === 'rare' || pet.rarity === 'legendary' || pet.rarity === 'mythic')
        && Number.isFinite(Number(pet.level))
        && Number.isFinite(Number(pet.hp)) && Number(pet.hp) > 0
        && Number.isFinite(Number(pet.attack)) && Number(pet.attack) > 0
        && Number.isFinite(Number(pet.defense)) && Number(pet.defense) >= 0
        && Number.isFinite(Number(pet.speed)) && Number(pet.speed) > 0
        && Array.isArray(pet.jutsus) && pet.jutsus.length <= MAX_SEALED_JUTSUS
        && !('image' in pet) && !('bodyImage' in pet)
        && !('training' in pet) && !('expedition' in pet);
};

/** Parse an ordered bounded pet projection embedded by a trusted start route.
 * The expected ids bind it to the participating roster and prevent a damaged
 * receipt from attributing Chronicle provenance to a different companion. */
export function parseSealedPetSnapshots(
    value: unknown,
    expectedIds: readonly string[],
): Pet[] | null {
    if (expectedIds.length < 1 || expectedIds.length > 4 || new Set(expectedIds).size !== expectedIds.length) return null;
    if (!Array.isArray(value) || value.length !== expectedIds.length || !value.every(validPet)) return null;
    const pets = value as Pet[];
    return pets.every((pet, index) => pet.id === expectedIds[index]) ? pets : null;
}

const validParams = (value: unknown): value is SealedDuelParams => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const params = value as Partial<SealedDuelParams>;
    return (params.mode === '1v1' || params.mode === '2v2')
        && Number.isSafeInteger(Number(params.seed)) && Number(params.seed) > 0
        && Number.isFinite(Number(params.damageMult)) && Number(params.damageMult) > 0
        && Number.isFinite(Number(params.hpMult)) && Number(params.hpMult) > 0
        && typeof params.revive === 'boolean'
        && typeof params.applyItems === 'boolean'
        && typeof params.accuracy === 'boolean'
        && (params.terrain === null || typeof params.terrain === 'string');
};

/** Fail closed for a malformed versioned seal.  Callers distinguish `undefined`
 * (a pre-v1 receipt, safely settled from its already-sealed baseline outcome)
 * from a present payload that fails this parser. */
export function parseCasualPveBattleSeal(value: unknown): CasualPveBattleSeal | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const seal = value as Partial<CasualPveBattleSeal>;
    if (seal.version !== CASUAL_PVE_SEAL_VERSION || !validParams(seal.params)) return null;
    const expected = seal.params.mode === '2v2' ? 2 : 1;
    if (!Array.isArray(seal.playerPets) || !Array.isArray(seal.opponentPets)
        || seal.playerPets.length !== expected || seal.opponentPets.length !== expected) return null;
    if (!parseSealedPetSnapshots(seal.playerPets, seal.playerPets.map((pet) => String(pet?.id ?? '')))
        || !parseSealedPetSnapshots(seal.opponentPets, seal.opponentPets.map((pet) => String(pet?.id ?? '')))) return null;
    return seal as CasualPveBattleSeal;
}
