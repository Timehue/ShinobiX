import { getAllTileCards } from "../data/tile-cards";
import { buildPlayableDeck, deriveCardClashCard, validateDeck } from "./card-clash";
import type { Character } from "../types/character";

/**
 * Build the fallback Card-Clash deck for a clan-war "tilecards" challenge and
 * pre-join the server session. Extracted verbatim from App.tsx's clan-war
 * launcher and loaded on demand: the card-clash deck math (./card-clash) and the
 * tile-card catalog (../data/tile-cards) together are ~50 KB and are needed
 * nowhere else in the App entry graph, so keeping this dynamic holds the boot
 * entry chunk down. Best-effort — the duel screen polls + retries, so callers
 * fire this and forget it (a slightly late or failed pre-join is harmless).
 */
export async function joinClanWarTileCards(character: Character, warId: string, challengeId: string): Promise<void> {
    const allCards = getAllTileCards([]);
    const clash = allCards.map(deriveCardClashCard);
    const byId = Object.fromEntries(clash.map(c => [c.id, c]));
    const saved = character.cardClashDeck ?? [];
    const deckIds = validateDeck(saved, byId).valid
        ? saved
        : buildPlayableDeck(character.tileCards ?? [], byId, clash);
    const deckPayload = deckIds.map(id => {
        const c = byId[id];
        const ability = c.abilityType === "ongoingElementBoostHere" ? "none" : c.abilityType;
        return { id: c.id, element: c.element, rarity: c.rarity, cost: c.cost, power: c.power, ability };
    });
    await fetch("/api/clan/war/tilecards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "join",
            warId,
            challengeId,
            defaultDeck: deckPayload,
        }),
    });
}
