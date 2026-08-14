import { CHRONICLE_LEGACY_SOURCES } from '../../shared/legacy-card-sources.js';
import { CHRONICLE_STORY_SOURCES } from '../../shared/story-card-sources.js';
import { CHRONICLE_PET_WITNESS_SOURCES } from '../../shared/pet-witness-card-sources.js';
import { getChronicleCard } from '../../shared/chronicle-duel.js';

/**
 * Chronicle cards that are evidence of server-owned progression, never shop or
 * pack inventory.  Keep this module pure so every settlement path can use the
 * same idempotent entitlement rules and tests can prove the complete catalog
 * has a legitimate source.
 */
const STORY_CARD_BY_OPPONENT = new Map<string, string>(
    CHRONICLE_STORY_SOURCES.map((source) => [source.aiProfileId, `story-${source.aiProfileId}`] as const),
);
const LEGACY_CARD_BY_ID = new Map<string, string>(
    CHRONICLE_LEGACY_SOURCES.map((source) => [source.id, `legacy-${source.id}`] as const),
);
const PET_WITNESS_CARD_BY_ELEMENT = new Map<string, string>(
    CHRONICLE_PET_WITNESS_SOURCES.map((source) => [source.element.toLowerCase(), source.id]),
);

export const STORY_PROGRESSION_CARD_IDS = Object.freeze([...STORY_CARD_BY_OPPONENT.values()]);
export const LEGACY_PROGRESSION_CARD_IDS = Object.freeze([...LEGACY_CARD_BY_ID.values()]);
export const SAGE_PROGRESSION_CARD_ID = 'story-wandering-sage' as const;
export const PET_WITNESS_PROGRESSION_CARD_IDS = Object.freeze([...PET_WITNESS_CARD_BY_ELEMENT.values()]);
export const CHRONICLE_PROGRESSION_CARD_IDS = Object.freeze([
    ...STORY_PROGRESSION_CARD_IDS,
    ...LEGACY_PROGRESSION_CARD_IDS,
    SAGE_PROGRESSION_CARD_ID,
    ...PET_WITNESS_PROGRESSION_CARD_IDS,
]);

const PROGRESSION_CARD_ID_SET = new Set<string>(CHRONICLE_PROGRESSION_CARD_IDS);
const PET_WITNESS_CARD_ID_SET = new Set<string>(PET_WITNESS_PROGRESSION_CARD_IDS);

/** Progression records are entitlements, so they do not consume pack capacity. */
export function isChronicleProgressionCardId(id: unknown): id is string {
    return typeof id === 'string' && PROGRESSION_CARD_ID_SET.has(id);
}

export function storyProgressionCardId(opponentId: unknown): string | null {
    return typeof opponentId === 'string' ? STORY_CARD_BY_OPPONENT.get(opponentId) ?? null : null;
}

export function legacyProgressionCardId(legacyId: unknown): string | null {
    return typeof legacyId === 'string' ? LEGACY_CARD_BY_ID.get(legacyId) ?? null : null;
}

export function petWitnessProgressionCardId(element: unknown): string | null {
    return typeof element === 'string' ? PET_WITNESS_CARD_BY_ELEMENT.get(element.toLowerCase()) ?? null : null;
}

export function storyProgressionCardsForCharacter(character: Record<string, unknown>): string[] {
    const village = typeof character.village === 'string' ? character.village : '';
    const completed = Math.max(0, Math.floor(Number(character.storyProgress) || 0));
    if (!village || completed <= 0) return [];
    return CHRONICLE_STORY_SOURCES
        .filter((source) => source.village === village)
        .slice(0, completed)
        .map((source) => `story-${source.aiProfileId}`);
}

export function chronicleProgressionCardsForCharacter(character: Record<string, unknown>): string[] {
    const storyCards = storyProgressionCardsForCharacter(character);
    const petCards = Array.isArray(character.chroniclePetWitnesses)
        ? (character.chroniclePetWitnesses as unknown[])
            .map((entry) => entry && typeof entry === 'object' ? (entry as Record<string, unknown>).cardId : null)
            .filter((id): id is string => typeof id === 'string' && PET_WITNESS_CARD_ID_SET.has(id))
        : [];
    const legacy = character.legacy && typeof character.legacy === 'object'
        ? character.legacy as Record<string, unknown>
        : null;
    if (!legacy || typeof legacy.legacyId !== 'string') return [...storyCards, ...petCards];
    const cards = [...storyCards, ...petCards, SAGE_PROGRESSION_CARD_ID];
    const legacyCard = Number(legacy.stage) >= 2 ? legacyProgressionCardId(legacy.legacyId) : null;
    if (legacyCard) cards.push(legacyCard);
    return cards;
}

export type ChronicleProgressionGrant = {
    character: Record<string, unknown>;
    granted: string[];
};

/**
 * Grant exactly one copy of each recognized progression card. Existing cards
 * are never removed or reordered, and unrecognized/client-supplied ids are
 * ignored. This makes retries and historical backfills safe by construction.
 */
export function grantChronicleProgressionCards(
    character: Record<string, unknown>,
    requestedIds: readonly string[],
): ChronicleProgressionGrant {
    const current = Array.isArray(character.tileCards)
        ? (character.tileCards as unknown[]).filter((id): id is string => typeof id === 'string')
        : [];
    const owned = new Set(current);
    const granted: string[] = [];
    for (const id of requestedIds) {
        if (!PROGRESSION_CARD_ID_SET.has(id) || owned.has(id) || !getChronicleCard(id)) continue;
        owned.add(id);
        granted.push(id);
    }
    return granted.length
        ? { character: { ...character, tileCards: [...current, ...granted] }, granted }
        : { character, granted };
}

/** Backfill all story records earned before the level-17 Scribe unlock. */
export function backfillStoryProgressionCards(character: Record<string, unknown>): ChronicleProgressionGrant {
    return grantChronicleProgressionCards(character, storyProgressionCardsForCharacter(character));
}

/** Repair/migrate the complete player-earned progression collection. */
export function backfillChronicleProgressionCards(character: Record<string, unknown>): ChronicleProgressionGrant {
    return grantChronicleProgressionCards(character, chronicleProgressionCardsForCharacter(character));
}
