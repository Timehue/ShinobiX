import { CARD_COLLECTION_CAP, trimChronicleCardsToPackableCap } from '../card-clash/_collection-cap.js';
import { CHRONICLE_STARTER_GRANT_IDS, countChronicleCardsWithStarter, validateDeckIds, CHRONICLE_RULES_VERSION } from '../../shared/chronicle-duel.js';
import { CHRONICLE_PROGRESSION_CARD_IDS, isChronicleProgressionCardId } from '../card-clash/_progression-cards.js';
import { preserveEntitledStringArray } from './_entitlement-guard.js';
import { normalizePetTutorialProgress } from '../../shared/pet-tutorial.js';

export function sanitizeCardsAndHistory(char: Record<string, unknown>, exChar: Record<string, unknown>) {

    // Pack inventory is bounded separately at 1,200. Progression records are
    // unique, non-packable entitlements and must survive a later client save,
    // even when earned after the pack inventory is already full.
    const TILE_CARD_CAP = CARD_COLLECTION_CAP + CHRONICLE_STARTER_GRANT_IDS.length + CHRONICLE_PROGRESSION_CARD_IDS.length;
    if (Array.isArray(char.tileCards) && (char.tileCards as unknown[]).length > TILE_CARD_CAP) {
        char.tileCards = (char.tileCards as unknown[]).slice(0, TILE_CARD_CAP);
    }
    const entitledTileCards = preserveEntitledStringArray(char.tileCards, exChar.tileCards, () => true);
    // Older clients did not always include the Chronicle field in a full-save
    // payload. Absence is not an explicit request to consume the collection:
    // retain the stored cards so a legacy tab cannot erase server-earned
    // records merely by saving another part of the character.
    const tileCardsToKeep = entitledTileCards ?? (Array.isArray(exChar.tileCards)
        ? (exChar.tileCards as unknown[]).filter((id): id is string => typeof id === 'string')
        : null);
    if (tileCardsToKeep) {
        // Generic saves may consume ordinary cards, but a stale tab, recovery
        // draft, or forged client must never erase a server-earned Chronicle
        // record. Keep one copy of every existing progression entitlement and
        // reserve the independent 1,200-card budget for packable inventory.
        const nextCards: string[] = [];
        const keptProgression = new Set<string>();
        for (const id of tileCardsToKeep) {
            if (isChronicleProgressionCardId(id)) {
                if (!keptProgression.has(id)) {
                    keptProgression.add(id);
                    nextCards.push(id);
                }
            } else nextCards.push(id);
        }
        if (Array.isArray(exChar.tileCards)) {
            for (const raw of exChar.tileCards) {
                if (typeof raw !== 'string' || !isChronicleProgressionCardId(raw) || keptProgression.has(raw)) continue;
                keptProgression.add(raw);
                nextCards.push(raw);
            }
        }
        char.tileCards = trimChronicleCardsToPackableCap(nextCards);
    }

    // A stale deck is preserved until the player explicitly saves a legal
    // current-rules replacement. Forged, malformed or unowned submissions can
    // never overwrite the last valid deck.
    if ('cardClashDeck' in char) {
        const requestedDeck = Array.isArray(char.cardClashDeck)
            ? char.cardClashDeck.filter((id): id is string => typeof id === 'string')
            : [];
        const ownedCards = countChronicleCardsWithStarter(
            Array.isArray(char.tileCards)
                ? char.tileCards.filter((id): id is string => typeof id === 'string')
                : [],
        );
        if (validateDeckIds(requestedDeck, ownedCards).valid) {
            char.cardClashDeck = requestedDeck;
        } else if (Array.isArray(exChar.cardClashDeck)) {
            char.cardClashDeck = structuredClone(exChar.cardClashDeck);
        } else {
            delete char.cardClashDeck;
        }
    }
    if ('cardClashTutorialVersion' in char) {
        char.cardClashTutorialVersion = Math.max(
            0,
            Math.min(
                CHRONICLE_RULES_VERSION,
                Math.floor(Number(char.cardClashTutorialVersion) || 0),
            ),
        );
    }
    if ('petTutorialProgress' in char) {
        char.petTutorialProgress = normalizePetTutorialProgress(char.petTutorialProgress);
    }

    // ─── battleHistory caps ───────────────────────────────────────────────────
    // Display-only "recent fights" reflection log (Profile → Battles). Carries no
    // rewards, so it needs no reward gating — just bound the size so a forged
    // save can't bloat KV: cap the number of battles kept and the actions per
    // battle. Keep the newest entries (client stores newest-first).
    const BATTLE_HISTORY_CAP = 10;
    const BATTLE_ACTIONS_CAP = 120;
    if ('battleHistory' in char) {
        if (!Array.isArray(char.battleHistory)) {
            delete (char as Record<string, unknown>).battleHistory;
        } else {
            char.battleHistory = (char.battleHistory as Array<Record<string, unknown>>)
                .slice(0, BATTLE_HISTORY_CAP)
                .map((b) => {
                    if (b && Array.isArray((b as { actions?: unknown }).actions) && (b.actions as unknown[]).length > BATTLE_ACTIONS_CAP) {
                        return { ...b, actions: (b.actions as unknown[]).slice(-BATTLE_ACTIONS_CAP) };
                    }
                    return b;
                });
        }
    }
}
