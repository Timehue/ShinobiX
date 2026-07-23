/** Compatibility catalog for pack, shop and ownership settlement. Duel logic
 * lives exclusively in shared/chronicle-duel; no retired stats are retained. */
import { CHRONICLE_CARD_CATALOG } from '../../../shared/chronicle-duel.js';

export type MarketplaceCardRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type ChronicleMarketplaceCard = { rarity: MarketplaceCardRarity };

export const BUILTIN_CLASH: Record<string, ChronicleMarketplaceCard> = Object.fromEntries(
    CHRONICLE_CARD_CATALOG
    // Story and Legacy cards are progression unlocks, never pack/shop rolls.
    .filter((card) => !card.id.startsWith('story-') && !card.id.startsWith('legacy-'))
    .map((card) => [
        card.id,
        { rarity: card.rarity === 'mythic' ? 'legendary' : card.rarity },
    ]),
);
