import { MAIN_DECK_SIZE, countChronicleCardsWithStarter, validateDeckIds } from './chronicle-duel.js';

export type RiftEntryReadiness = {
    petCount: number;
    hasFourPets: boolean;
    hasLegalDeck: boolean;
    ready: boolean;
};

/** Check an actual selected deck, not the auto-generated Chronicle fallback. */
export function riftEntryReadiness(petCount: number, selectedDeck: unknown, tileCards: unknown): RiftEntryReadiness {
    const hasFourPets = petCount >= 4;
    const hasLegalDeck = Array.isArray(selectedDeck)
        && selectedDeck.length === MAIN_DECK_SIZE
        && selectedDeck.every((id) => typeof id === 'string')
        && validateDeckIds(
            selectedDeck,
            countChronicleCardsWithStarter(Array.isArray(tileCards)
                ? tileCards.filter((id): id is string => typeof id === 'string')
                : []),
        ).valid;
    return { petCount, hasFourPets, hasLegalDeck, ready: hasFourPets && hasLegalDeck };
}

export function riftEntryRequirementMessage(readiness: RiftEntryReadiness): string {
    const missing: string[] = [];
    if (!readiness.hasFourPets) missing.push(`4 carried pets (you have ${readiness.petCount})`);
    if (!readiness.hasLegalDeck) missing.push('a legal 40-card Chronicle deck from Card Hall');
    return `The rift requires ${missing.join(' and ')} before you can descend. Prepare your party and deck, then return. No daily entry was used.`;
}
