import type { Character } from "../types/character";
import type { TileCard } from "../data/tile-cards";
import {
    CHRONICLE_CARD_CATALOG,
    MAIN_DECK_SIZE,
    countChronicleCardsWithStarter,
    deckLimitForCard,
    getChronicleCard,
    migrateLegacyDeck,
    previewChronicleBattle,
    tributeCountForLevel,
    validateDeckIds,
    type ChronicleActionIntent,
    type ChronicleAiDifficulty,
    type ChronicleCard,
    type ChronicleProjection,
} from "../../../shared/chronicle-duel";

export type ChronicleDisplayCard = ChronicleCard & { image?: string };
export type ChronicleAiResult = {
    ok: boolean;
    error?: string;
    /** Save version accompanying a server-owned deck write or terminal settlement. */
    _saveVersion?: number;
    matchId?: string;
    session?: ChronicleProjection & {
        matchId: string;
        aiDifficulty: ChronicleAiDifficulty;
        aiDeckName: string;
        winnerResult?: "player" | "opponent" | "draw";
    };
    /** Board snapshots after each individual AI action; the client replays
     *  these with pacing beats so the Keeper's turn reads move by move. */
    aiSteps?: ChronicleProjection[];
    reward?: { result: "player" | "opponent" | "draw"; ryo: number; dailyBonus: boolean };
    character?: Character;
    migratedDeck?: string[];
};

export function displayCatalog(tileCards: readonly TileCard[]): ChronicleDisplayCard[] {
    const art = new Map(tileCards.filter((card) => card.image).map((card) => [card.id, card.image!]));
    return CHRONICLE_CARD_CATALOG.map((card) => art.has(card.id) ? { ...card, image: art.get(card.id) } : { ...card });
}

export function displayCardsById(tileCards: readonly TileCard[]): Record<string, ChronicleDisplayCard> {
    return Object.fromEntries(displayCatalog(tileCards).map((card) => [card.id, card]));
}

export function ownedChronicleCounts(tileCardIds: readonly string[]): Map<string, number> {
    return countChronicleCardsWithStarter(tileCardIds);
}

export function buildChronicleDeck(savedIds: readonly string[], ownedIds: readonly string[]): string[] {
    return migrateLegacyDeck(savedIds, ownedIds, true).deck;
}

export function canAddChronicleCard(deck: readonly string[], id: string, owned: ReadonlyMap<string, number>): string | null {
    if (!getChronicleCard(id)) return "That card is not in the Chronicle catalog.";
    const ownedCopies = owned.get(id) ?? 0;
    if (ownedCopies <= 0) return "You do not own that card.";
    if (deck.length >= MAIN_DECK_SIZE) return `Your Main Deck already has ${MAIN_DECK_SIZE} cards.`;
    const limit = deckLimitForCard(id);
    const included = deck.filter((entry) => entry === id).length;
    if (included >= ownedCopies) return `You own only ${ownedCopies} ${ownedCopies === 1 ? "copy" : "copies"} of that card.`;
    if (included >= limit) return `You may include at most ${limit} ${limit === 1 ? "copy" : "copies"} of that card.`;
    return null;
}

export function validateOwnedChronicleDeck(deck: readonly string[], owned: ReadonlyMap<string, number>) {
    return validateDeckIds(deck, owned);
}

export async function startChronicleAi(
    playerName: string,
    deck: readonly string[],
    difficulty: ChronicleAiDifficulty = "medium",
    externalStakes = false,
): Promise<ChronicleAiResult> {
    try {
        const response = await fetch("/api/card-clash/ai-start", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, deck, difficulty, externalStakes }),
        });
        const body = await response.json().catch(() => ({})) as ChronicleAiResult;
        return response.ok && body.ok ? body : { ...body, ok: false, error: body.error ?? "Could not start the duel." };
    } catch {
        return { ok: false, error: "Could not start the duel." };
    }
}

export async function chronicleAiAction(matchId: string, intent: ChronicleActionIntent): Promise<ChronicleAiResult> {
    try {
        const response = await fetch("/api/card-clash/ai-move", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ matchId, ...intent }),
        });
        const body = await response.json().catch(() => ({})) as ChronicleAiResult;
        return response.ok && body.ok ? body : { ...body, ok: false, error: body.error ?? "That action was not legal." };
    } catch {
        return { ok: false, error: "The duel server could not be reached." };
    }
}

export {
    CHRONICLE_CARD_CATALOG,
    MAIN_DECK_SIZE,
    countChronicleCardsWithStarter,
    deckLimitForCard,
    getChronicleCard,
    migrateLegacyDeck,
    previewChronicleBattle,
    tributeCountForLevel,
    validateDeckIds,
};
export {
    CHRONICLE_FOUNDING_FORMAT,
    CHRONICLE_ELEMENTS,
    CHRONICLE_FIXED_FALLBACK_DECK,
    CHRONICLE_ROOM_TITLE,
    CHRONICLE_RULES_VERSION,
    MAX_COPIES_PER_CARD,
    STARTING_LIFE_POINTS,
    TURN_TIMEOUT_MS,
    createMatch,
    projectMatchForViewer,
} from "../../../shared/chronicle-duel";
export type {
    ChronicleActionIntent,
    ChronicleAiDifficulty,
    ChronicleBattlePreview,
    ChronicleCard,
    ChroniclePresentationEvent,
    ChronicleProjection,
} from "../../../shared/chronicle-duel";
