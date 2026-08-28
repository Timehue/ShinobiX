import { createHash, randomInt, randomUUID } from 'node:crypto';
import { BRED_ULTRA_TRAIT_DENOMINATOR, ULTRA_PET_TRAITS } from '../../shared/shrines.js';
import { PET_CATALOG } from './_catalog.js';
import { normalizePetGrowth } from './_growth.js';

export const PET_BREEDING_MIGRATION_VERSION = 1;
// V2 seals the apex/ordinary trait when the 24-hour session starts. V1 eggs
// remain hatchable through the compatibility fallback in breeding-hatch.ts.
export const PET_BREEDING_RULES_VERSION = 2;
export const PET_BREEDING_USES_MIN = 5;
export const PET_BREEDING_USES_MAX = 10;
export { BRED_ULTRA_TRAIT_DENOMINATOR };

export type PetOrigin = 'starter' | 'wild' | 'bred' | 'event' | 'admin';
export type SecureInt = (minInclusive: number, maxExclusive: number) => number;

export type OwnedPetLineage = {
    generation?: number;
    parentInstanceIds?: [string, string];
    parentTemplateIds?: [string, string];
    hatchedAt?: number;
    breedingSessionId?: string;
};

export type CreateOwnedPetOptions = OwnedPetLineage & {
    origin: PetOrigin;
    existingIds?: Iterable<string>;
    instanceId?: string;
    basePet?: Record<string, unknown>;
    trait?: string;
    traitAlreadyApplied?: boolean;
    paletteVariantId?: string;
    secureInt?: SecureInt;
};

const NORMAL_TRAITS = ['Loyal', 'Aggressive', 'Guardian', 'Swift', 'Lucky', 'Battleborn'] as const;
const TRAITS = [...NORMAL_TRAITS, ...ULTRA_PET_TRAITS] as const;

function whole(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function cleanPair(value: unknown): [string, string] | undefined {
    if (!Array.isArray(value) || value.length !== 2) return undefined;
    const first = typeof value[0] === 'string' ? value[0].slice(0, 96) : '';
    const second = typeof value[1] === 'string' ? value[1].slice(0, 96) : '';
    return first && second ? [first, second] : undefined;
}

function inferredOrigin(pet: Record<string, unknown>, templateId?: string): PetOrigin {
    if (pet.origin === 'starter' || pet.origin === 'wild' || pet.origin === 'bred' || pet.origin === 'event' || pet.origin === 'admin') return pet.origin;
    if (pet.parentInstanceIds || pet.hatchedAt || pet.breedingSessionId) return 'bred';
    if (templateId?.startsWith('starter-')) return 'starter';
    const id = String(pet.id ?? '').toLowerCase();
    if (id.includes('event')) return 'event';
    if (id.includes('admin') || id.includes('test')) return 'admin';
    return 'wild';
}

export function secureBreedingUses(secureInt: SecureInt = randomInt): number {
    return secureInt(PET_BREEDING_USES_MIN, PET_BREEDING_USES_MAX + 1);
}

export function deterministicLegacyBreedingUses(playerName: string, petInstanceId: string): number {
    const digest = createHash('sha256')
        .update(`pet-breeding-v1:${playerName.trim().toLowerCase()}:${petInstanceId}`)
        .digest();
    return PET_BREEDING_USES_MIN + (digest.readUInt32BE(0) % 6);
}

export function resolvePetTemplateId(pet: Record<string, unknown>): string | null {
    const explicit = typeof pet.templateId === 'string' ? pet.templateId : '';
    if (explicit && PET_CATALOG[explicit]) return explicit;
    const id = typeof pet.id === 'string' ? pet.id : '';
    if (!id) return null;
    if (PET_CATALOG[id]) return id;
    const withoutTimestamp = id.replace(/-\d{10,}$/, '');
    if (PET_CATALOG[withoutTimestamp]) return withoutTimestamp;
    // Catalog-aware legacy clone resolution. Longest keys first prevents a
    // protected id such as starter-fire-r from being mistaken for starter-fire.
    const prefixed = Object.keys(PET_CATALOG)
        .sort((a, b) => b.length - a.length)
        .find((candidate) => id.startsWith(`${candidate}-`) || id.startsWith(`${candidate}:`));
    return prefixed ?? null;
}

export function canonicalPetTemplate(templateId: string): Record<string, unknown> | null {
    const template = PET_CATALOG[templateId];
    return template ? structuredClone(template) : null;
}

export function isBreedableTemplate(templateId: string | null | undefined): boolean {
    return Boolean(templateId && PET_CATALOG[templateId] && PET_CATALOG[templateId].breedable !== false);
}

export function rollOwnedPetTrait(rarity: unknown, secureInt: SecureInt = randomInt): string {
    const pool = rarity === 'mythic' ? NORMAL_TRAITS : NORMAL_TRAITS.filter((trait) => trait !== 'Guardian');
    return pool[secureInt(0, pool.length)];
}

/** Bred offspring get one independent 0.5% apex roll. The 0.5% is total,
 * followed by an even one-of-three selection; it is not 0.5% per trait. */
export function rollBredOwnedPetTrait(rarity: unknown, secureInt: SecureInt = randomInt): string {
    if (secureInt(0, BRED_ULTRA_TRAIT_DENOMINATOR) === 0) {
        return ULTRA_PET_TRAITS[secureInt(0, ULTRA_PET_TRAITS.length)];
    }
    return rollOwnedPetTrait(rarity, secureInt);
}

export function applyOwnedPetTrait(pet: Record<string, unknown>, traitRaw: unknown): Record<string, unknown> {
    const trait = TRAITS.includes(traitRaw as typeof TRAITS[number]) ? traitRaw as typeof TRAITS[number] : undefined;
    const n = (key: string) => Math.max(0, whole(pet[key]));
    const base = { ...pet, ...(trait ? { trait } : {}) };
    if (trait === 'Aggressive') return { ...base, attack: Math.round(n('attack') * 1.15) };
    if (trait === 'Battleborn') return { ...base, attack: Math.round(n('attack') * 1.1), hp: Math.round(n('hp') * 1.1), defense: Math.round(n('defense') * 1.1), speed: Math.round(n('speed') * 1.1) };
    if (trait === 'Guardian') return { ...base, hp: Math.round(n('hp') * 1.2), defense: Math.round(n('defense') * 1.2) };
    if (trait === 'Swift') return { ...base, speed: Math.round(n('speed') * 1.2) };
    if (trait === 'Fateweaver') return { ...base, attack: Math.round(n('attack') * 1.2), hp: Math.round(n('hp') * 1.2), defense: Math.round(n('defense') * 1.2), speed: Math.round(n('speed') * 1.2) };
    if (trait === 'Hollowborn') return { ...base, attack: Math.round(n('attack') * 1.05), hp: Math.round(n('hp') * 1.05), defense: Math.round(n('defense') * 1.05), speed: Math.round(n('speed') * 1.05) };
    return base;
}

function uniqueInstanceId(templateId: string, existingIds: Iterable<string> = []): string {
    const used = new Set(existingIds);
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = `${templateId}:${randomUUID()}`;
        if (!used.has(candidate)) return candidate;
    }
    throw new Error('pet-instance-id-collision');
}

export function createOwnedPet(templateId: string, options: CreateOwnedPetOptions): Record<string, unknown> {
    const template = canonicalPetTemplate(templateId);
    if (!template) throw new Error('unknown-pet-template');
    const secureIntFn = options.secureInt ?? randomInt;
    const source = structuredClone(options.basePet ?? template);
    const trait = options.trait ?? rollOwnedPetTrait(template.rarity, secureIntFn);
    const traitApplied = options.traitAlreadyApplied ? { ...source, trait } : applyOwnedPetTrait(source, trait);
    const breedingUsesMax = secureBreedingUses(secureIntFn);
    const id = options.instanceId || uniqueInstanceId(templateId, options.existingIds);
    const generation = Math.max(0, whole(options.generation));
    const owned = {
        ...traitApplied,
        id,
        templateId,
        origin: options.origin,
        level: 1,
        xp: 0,
        breedingUsesMax,
        breedingUsesRemaining: breedingUsesMax,
        generation,
        breedable: template.breedable !== false,
        ...(options.paletteVariantId ? { paletteVariantId: options.paletteVariantId } : {}),
        ...(options.parentInstanceIds ? { parentInstanceIds: [...options.parentInstanceIds] } : {}),
        ...(options.parentTemplateIds ? { parentTemplateIds: [...options.parentTemplateIds] } : {}),
        ...(options.hatchedAt ? { hatchedAt: options.hatchedAt } : {}),
        ...(options.breedingSessionId ? { breedingSessionId: options.breedingSessionId } : {}),
        nickname: undefined,
        happiness: 0,
        training: undefined,
        expedition: undefined,
        loadout: undefined,
        doctrine: undefined,
    };
    // Starter validation hands us a trait-applied snapshot; the signed catalog
    // template remains its pre-trait species baseline. Other acquisition paths
    // provide an unmodified source directly.
    const growthSource = options.traitAlreadyApplied ? template : source;
    return normalizePetGrowth(owned, {
        hp: whole(growthSource.hp, 1),
        attack: whole(growthSource.attack, 1),
        defense: whole(growthSource.defense, 1),
        speed: whole(growthSource.speed, 1),
    });
}

export function migrateOwnedPet(
    playerName: string,
    petRaw: Record<string, unknown>,
    index = 0,
): { pet: Record<string, unknown>; changed: boolean } {
    const original = petRaw;
    const templateId = resolvePetTemplateId(original);
    const originalId = typeof original.id === 'string' && original.id ? original.id : '';
    const id = originalId || `legacy-pet-${createHash('sha256').update(`${playerName}:${index}:${templateId ?? 'unknown'}`).digest('hex').slice(0, 24)}`;
    const validMax = Number.isInteger(Number(original.breedingUsesMax)) && Number(original.breedingUsesMax) >= PET_BREEDING_USES_MIN && Number(original.breedingUsesMax) <= PET_BREEDING_USES_MAX;
    const breedingUsesMax = validMax ? Number(original.breedingUsesMax) : deterministicLegacyBreedingUses(playerName, id);
    const rawRemaining = Number(original.breedingUsesRemaining);
    const breedingUsesRemaining = Number.isInteger(rawRemaining)
        ? Math.max(0, Math.min(breedingUsesMax, rawRemaining))
        : breedingUsesMax;
    const origin = inferredOrigin(original, templateId ?? undefined);
    const generation = Math.max(0, whole(original.generation));
    const templateBreedable = templateId ? isBreedableTemplate(templateId) : false;
    const parentInstanceIds = cleanPair(original.parentInstanceIds);
    const parentTemplateIds = cleanPair(original.parentTemplateIds);
    const next: Record<string, unknown> = {
        ...original,
        id,
        ...(templateId ? { templateId } : {}),
        origin,
        generation,
        breedingUsesMax,
        breedingUsesRemaining,
        breedable: templateBreedable,
        ...(parentInstanceIds ? { parentInstanceIds } : {}),
        ...(parentTemplateIds ? { parentTemplateIds } : {}),
    };
    const stableFields = ['id', 'templateId', 'origin', 'generation', 'breedingUsesMax', 'breedingUsesRemaining', 'breedable'] as const;
    const changed = stableFields.some((field) => next[field] !== original[field])
        || JSON.stringify(parentInstanceIds) !== JSON.stringify(original.parentInstanceIds)
        || JSON.stringify(parentTemplateIds) !== JSON.stringify(original.parentTemplateIds);
    return { pet: changed ? next : original, changed };
}

export function migrateCharacterOwnedPets(
    playerName: string,
    character: Record<string, unknown>,
): { character: Record<string, unknown>; changed: boolean } {
    const pets = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
    let petsChanged = false;
    const migratedPets = pets.map((pet, index) => {
        const migrated = migrateOwnedPet(playerName, pet, index);
        petsChanged ||= migrated.changed;
        return migrated.pet;
    });
    const versionChanged = whole(character.petBreedingMigrationVersion) < PET_BREEDING_MIGRATION_VERSION;
    if (!petsChanged && !versionChanged) return { character, changed: false };
    return {
        character: {
            ...character,
            pets: migratedPets,
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
        },
        changed: true,
    };
}
