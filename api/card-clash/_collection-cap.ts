import { isChronicleProgressionCardId } from './_progression-cards.js';
import { CHRONICLE_STARTER_GRANT_IDS, countChronicleCards } from '../../shared/chronicle-duel.js';

/** Purchased, packed, and field-found cards share one bounded inventory. The
 * fixed Traveler's Codex floor is an onboarding entitlement, not a purchase;
 * only copies beyond that exact quantity floor consume this budget. */
export const CARD_COLLECTION_CAP = 1_200;

function createPackableCounter() {
    const starterRemaining = countChronicleCards(CHRONICLE_STARTER_GRANT_IDS);
    let count = 0;
    const admit = (id: string, cap = Number.POSITIVE_INFINITY): boolean => {
        if (isChronicleProgressionCardId(id)) return true;
        const reserved = starterRemaining.get(id) ?? 0;
        if (reserved > 0) {
            starterRemaining.set(id, reserved - 1);
            return true;
        }
        if (count >= cap) return false;
        count += 1;
        return true;
    };
    return { admit, count: () => count };
}

export function countPackableChronicleCards(cardIds: unknown): number {
    if (!Array.isArray(cardIds)) return 0;
    const counter = createPackableCounter();
    for (const raw of cardIds) {
        if (typeof raw === 'string' && raw.length > 0) counter.admit(raw);
    }
    return counter.count();
}

export function canAppendPackableChronicleCards(cardIds: unknown, amount: number): boolean {
    return Number.isSafeInteger(amount)
        && amount >= 0
        && countPackableChronicleCards(cardIds) + amount <= CARD_COLLECTION_CAP;
}

/**
 * Admit a server-authored grant without ever consuming more than the bounded
 * packable inventory. Progression records remain outside that economy cap;
 * malformed candidate values are ignored rather than persisted.
 */
export function takeChronicleCardsWithinPackableCap(
    cardIds: unknown,
    candidates: readonly unknown[],
): string[] {
    const counter = createPackableCounter();
    if (Array.isArray(cardIds)) {
        for (const raw of cardIds) {
            if (typeof raw === 'string' && raw.length > 0) counter.admit(raw);
        }
    }
    const accepted: string[] = [];
    for (const raw of candidates) {
        if (typeof raw !== 'string' || raw.length === 0) continue;
        if (counter.admit(raw, CARD_COLLECTION_CAP)) accepted.push(raw);
    }
    return accepted;
}

/** Preserve input order while trimming only ordinary inventory overflow. */
export function trimChronicleCardsToPackableCap(cardIds: unknown): string[] {
    if (!Array.isArray(cardIds)) return [];
    const counter = createPackableCounter();
    const accepted: string[] = [];
    for (const raw of cardIds) {
        if (typeof raw !== 'string' || raw.length === 0) continue;
        if (counter.admit(raw, CARD_COLLECTION_CAP)) accepted.push(raw);
    }
    return accepted;
}
