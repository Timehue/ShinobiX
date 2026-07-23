import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    CHRONICLE_STARTER_GRANT_IDS,
    countChronicleCards,
    migrateLegacyDeck,
    validateDeckIds,
} from '../../shared/chronicle-duel.js';

/** Grants the fixed starter unlocks once and resolves a submitted/saved deck
 * against server-owned collection data. Invalid legacy lists are never trusted. */
export type ChronicleDeckResolution = {
    deck: string[];
    saveVersion?: number;
    usedRequested: boolean;
};

export async function resolveChronicleDeckWithSave(playerName: string, requested: readonly string[], admin = false): Promise<ChronicleDeckResolution | null> {
    const resolved = await mutatePlayerSave(playerName, ({ character }) => {
        const current = Array.isArray(character.tileCards)
            ? character.tileCards.filter((id): id is string => typeof id === 'string')
            : [];
        const currentCounts = countChronicleCards(current);
        const starterCounts = countChronicleCards(CHRONICLE_STARTER_GRANT_IDS);
        const missingStarterCopies = [...starterCounts].flatMap(([id, required]) =>
            Array.from({ length: Math.max(0, required - (currentCounts.get(id) ?? 0)) }, () => id));
        const owned = [...current, ...missingStarterCopies];
        const ownedCounts = countChronicleCards(owned);
        const saved = Array.isArray(character.cardClashDeck)
            ? character.cardClashDeck.filter((id): id is string => typeof id === 'string')
            : [];
        // A current client may submit its just-saved selection before the normal
        // autosave debounce lands. Admit it only when every card, copy limit and
        // deck-size rule validates against the server-owned collection. A bad
        // submission never influences migration; fall back to the persisted deck.
        const usedRequested = Boolean(requested.length && validateDeckIds(requested, ownedCounts).valid);
        const deck = usedRequested
            ? [...requested]
            : validateDeckIds(saved, ownedCounts).valid
                ? [...saved]
                : migrateLegacyDeck(saved, owned, true).deck;
        if (!validateDeckIds(deck, ownedCounts).valid) {
            return { ok: false as const, status: 400, error: 'No legal 40-card Chronicle deck is available.' };
        }
        return {
            ok: true as const,
            // Persist the exact server-approved list in the same locked write as
            // starter grants, closing the local-save/PvP-join race.
            character: { ...character, tileCards: owned, cardClashDeck: deck },
            value: { deck, usedRequested },
        };
    });
    if (!resolved.ok) {
        if (!admin) return null;
        return {
            deck: [...migrateLegacyDeck(requested, [], true).deck],
            usedRequested: false,
        };
    }
    return { ...resolved.value, saveVersion: resolved._saveVersion };
}

export async function resolveChronicleDeck(playerName: string, requested: readonly string[], admin = false): Promise<string[] | null> {
    return (await resolveChronicleDeckWithSave(playerName, requested, admin))?.deck ?? null;
}
