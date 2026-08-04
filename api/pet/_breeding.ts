import { createHash, randomInt } from 'node:crypto';
import { PET_CATALOG } from './_catalog.js';
import { BRED_APEX_TRAIT_CHANCE_PERCENT } from '../../shared/shrines.js';
import { PET_BREEDING_RULES_VERSION, resolvePetTemplateId, rollBredOwnedPetTrait, type SecureInt } from './_owned-pet.js';
import type { PetBreedingSession } from './_breeding-requirements.js';

export const PET_BREEDING_DURATION_MS = 24 * 60 * 60 * 1000;
export const PET_CHROMATIC_DENOMINATOR = 2_000;
export const PET_CHROMATIC_VARIANT_ID = 'chromatic-v1' as const;

export type BreedingOutcome = 'parent1' | 'parent2' | 'sameElementTier' | 'randomNonStandard';

export type OffspringSelection = {
    templateId: string;
    outcome: BreedingOutcome;
    speciesRoll: number;
    rarityAnchor?: 'parent1' | 'parent2';
    alternatePoolAvailable: boolean;
};

export type SealedPetBreedingResult = {
    sessionId: string;
    playerName: string;
    resultTemplateId: string;
    outcome: BreedingOutcome;
    chromatic: boolean;
    paletteVariantId?: typeof PET_CHROMATIC_VARIANT_ID;
    /** Optional only for recovery of pre-apex sealed eggs. New sessions always seal it. */
    trait?: string;
    parentIds: [string, string];
    parentTemplateIds: [string, string];
    parentGenerations: [number, number];
    requestId: string;
    rulesVersion: number;
    createdAt: number;
    speciesRoll: number;
};

type ParentPet = Record<string, unknown>;

function breedableEntries(): Array<[string, Record<string, unknown>]> {
    // Breeding eligibility is intentionally separate from wild encounter
    // eligibility. Some sealed alternatives are breedable but not encounter
    // species; excluding them here recreates the missing mythic 9% branch.
    return Object.entries(PET_CATALOG).filter(([, pet]) => pet.breedable !== false);
}

export function alternateSpeciesPool(parent1: ParentPet, parent2: ParentPet, rarity: string): string[] {
    const p1 = resolvePetTemplateId(parent1);
    const p2 = resolvePetTemplateId(parent2);
    const excluded = new Set([p1, p2].filter((id): id is string => Boolean(id)));
    const element = String(parent1.element ?? '');
    return breedableEntries()
        .filter(([id, pet]) => !excluded.has(id) && pet.rarity === rarity && pet.element === element)
        .map(([id]) => id);
}

export function randomNonStandardPool(parent1: ParentPet, parent2: ParentPet): string[] {
    const excluded = new Set([resolvePetTemplateId(parent1), resolvePetTemplateId(parent2)].filter((id): id is string => Boolean(id)));
    return breedableEntries()
        .filter(([id, pet]) => !excluded.has(id) && (pet.rarity === 'rare' || pet.rarity === 'legendary' || pet.rarity === 'mythic'))
        .map(([id]) => id);
}

function pick<T>(pool: readonly T[], secureInt: SecureInt): T {
    if (!pool.length) throw new Error('empty-breeding-pool');
    return pool[secureInt(0, pool.length)];
}

export function selectOffspringTemplate(
    parent1: ParentPet,
    parent2: ParentPet,
    speciesRoll: number,
    secureInt: SecureInt = randomInt,
): OffspringSelection {
    if (!Number.isInteger(speciesRoll) || speciesRoll < 0 || speciesRoll > 9_999) throw new Error('invalid-species-roll');
    const parent1TemplateId = resolvePetTemplateId(parent1);
    const parent2TemplateId = resolvePetTemplateId(parent2);
    if (!parent1TemplateId || !parent2TemplateId) throw new Error('unknown-parent-template');
    if (speciesRoll <= 4_499) return { templateId: parent1TemplateId, outcome: 'parent1', speciesRoll, alternatePoolAvailable: true };
    if (speciesRoll <= 8_999) return { templateId: parent2TemplateId, outcome: 'parent2', speciesRoll, alternatePoolAvailable: true };
    if (speciesRoll >= 9_900) {
        const pool = randomNonStandardPool(parent1, parent2);
        if (!pool.length) throw new Error('no-random-nonstandard-candidate');
        return { templateId: pick(pool, secureInt), outcome: 'randomNonStandard', speciesRoll, alternatePoolAvailable: true };
    }

    let rarityAnchor: 'parent1' | 'parent2' = 'parent1';
    let rarity = String(parent1.rarity ?? 'standard');
    if (parent1.rarity !== parent2.rarity) {
        rarityAnchor = secureInt(0, 2) === 0 ? 'parent1' : 'parent2';
        rarity = String((rarityAnchor === 'parent1' ? parent1 : parent2).rarity ?? 'standard');
    }
    const pool = alternateSpeciesPool(parent1, parent2, rarity);
    if (pool.length) return { templateId: pick(pool, secureInt), outcome: 'sameElementTier', speciesRoll, rarityAnchor, alternatePoolAvailable: true };
    // The unavailable 900-point branch is split exactly in half. Never reroll
    // the whole table, so the independent 1% branch remains exactly 100 points.
    return speciesRoll <= 9_449
        ? { templateId: parent1TemplateId, outcome: 'parent1', speciesRoll, rarityAnchor, alternatePoolAvailable: false }
        : { templateId: parent2TemplateId, outcome: 'parent2', speciesRoll, rarityAnchor, alternatePoolAvailable: false };
}

export function rollChromatic(chromaticRoll: number): boolean {
    if (!Number.isInteger(chromaticRoll) || chromaticRoll < 0 || chromaticRoll >= PET_CHROMATIC_DENOMINATOR) throw new Error('invalid-chromatic-roll');
    return chromaticRoll === 0;
}

export function deterministicBreedingSessionId(playerName: string, requestId: string): string {
    return `breed-${createHash('sha256').update(`pet-breeding-session-v1:${playerName.toLowerCase()}:${requestId}`).digest('hex').slice(0, 32)}`;
}

export function breedingResultKey(playerName: string, sessionId: string): string {
    return `pet-breeding-result:${playerName.toLowerCase()}:${sessionId}`;
}

export function buildSealedBreedingResult(args: {
    playerName: string;
    requestId: string;
    parent1: ParentPet;
    parent2: ParentPet;
    now?: number;
    secureInt?: SecureInt;
}): SealedPetBreedingResult {
    const secureInt = args.secureInt ?? randomInt;
    const parent1TemplateId = resolvePetTemplateId(args.parent1);
    const parent2TemplateId = resolvePetTemplateId(args.parent2);
    if (!parent1TemplateId || !parent2TemplateId) throw new Error('unknown-parent-template');
    const speciesRoll = secureInt(0, 10_000);
    const selection = selectOffspringTemplate(args.parent1, args.parent2, speciesRoll, secureInt);
    const chromatic = rollChromatic(secureInt(0, PET_CHROMATIC_DENOMINATOR));
    const trait = rollBredOwnedPetTrait(PET_CATALOG[selection.templateId]?.rarity, secureInt);
    const sessionId = deterministicBreedingSessionId(args.playerName, args.requestId);
    return {
        sessionId,
        playerName: args.playerName.toLowerCase(),
        resultTemplateId: selection.templateId,
        outcome: selection.outcome,
        chromatic,
        ...(chromatic ? { paletteVariantId: PET_CHROMATIC_VARIANT_ID } : {}),
        trait,
        parentIds: [String(args.parent1.id), String(args.parent2.id)],
        parentTemplateIds: [parent1TemplateId, parent2TemplateId],
        parentGenerations: [Math.max(0, Math.floor(Number(args.parent1.generation ?? 0))), Math.max(0, Math.floor(Number(args.parent2.generation ?? 0)))],
        requestId: args.requestId,
        rulesVersion: PET_BREEDING_RULES_VERSION,
        createdAt: Math.max(0, Math.floor(args.now ?? Date.now())),
        speciesRoll,
    };
}

export type BreedingOdds = { parent1: number; parent2: number; alternate: number; randomNonStandard: number; chromatic: number; apexTrait: number };

export function breedingOddsForParents(parent1: ParentPet, parent2: ParentPet): BreedingOdds {
    const rarities = parent1.rarity === parent2.rarity
        ? [String(parent1.rarity ?? 'standard')]
        : [String(parent1.rarity ?? 'standard'), String(parent2.rarity ?? 'standard')];
    const availableAnchors = rarities.filter((rarity) => alternateSpeciesPool(parent1, parent2, rarity).length > 0).length;
    const alternate = rarities.length === 1 ? (availableAnchors ? 9 : 0) : availableAnchors * 4.5;
    const fallback = 9 - alternate;
    return { parent1: 45 + fallback / 2, parent2: 45 + fallback / 2, alternate, randomNonStandard: 1, chromatic: 0.05, apexTrait: BRED_APEX_TRAIT_CHANCE_PERCENT };
}

export function publicPetBreedingSession(session: PetBreedingSession | null | undefined): Omit<PetBreedingSession, 'startRequestId'> | null {
    if (!session) return null;
    const { startRequestId: _privateRequestId, ...publicSession } = session;
    return publicSession;
}
