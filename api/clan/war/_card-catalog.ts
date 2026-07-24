/** Compatibility catalog for pack, shop and ownership settlement. Duel logic
 * lives exclusively in shared/chronicle-duel; no retired stats are retained. */
import { CHRONICLE_CARD_CATALOG } from '../../../shared/chronicle-duel.js';

export type MarketplaceCardRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type ChronicleMarketplaceCard = { rarity: MarketplaceCardRarity };

// Story and Legacy cards are progression unlocks, never pack/shop rolls.
const PACKABLE = CHRONICLE_CARD_CATALOG.filter(
    (card) => !card.id.startsWith('story-') && !card.id.startsWith('legacy-'),
);

export const BUILTIN_CLASH: Record<string, ChronicleMarketplaceCard> = Object.fromEntries(
    PACKABLE.map((card) => [
        card.id,
        { rarity: card.rarity === 'mythic' ? 'legendary' : card.rarity },
    ]),
);

/**
 * Storefront tiering: the catalog is split by quality into the best 50%
 * (Grand Marketplace, premium Fate Shard packs) and the rest (Shop, ryo pack).
 *
 * Quality score = rarity tier first (the game's own quality signal), then
 * in-tier power — Monsters by (ATK + DEF)/20 + Level×5, Jutsu/Snares by effect
 * tier. Cards are ranked and cut at the median; ties break by id so the split
 * is deterministic across builds. With the current catalog the boundary lands
 * inside the Rare tier, so the strongest Rares join the Marketplace while the
 * rest stay in the Shop.
 */
const RARITY_RANK: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
function qualityScore(card: (typeof CHRONICLE_CARD_CATALOG)[number]): number {
    let score = (RARITY_RANK[card.rarity] ?? 0) * 1000;
    if (card.cardClass === 'monster') score += (card.attack + card.defense) / 20 + card.level * 5;
    else score += card.effectTier === 'advanced' ? 40 : 10;
    return score;
}

const RANKED = [...PACKABLE].sort(
    (a, b) => qualityScore(b) - qualityScore(a) || a.id.localeCompare(b.id),
);

/** The best 50% of packable cards — Grand Marketplace exclusive. */
export const MARKETPLACE_CARD_IDS: ReadonlySet<string> = new Set(
    RANKED.slice(0, Math.round(RANKED.length / 2)).map((card) => card.id),
);

/** True for the best-50% cards (Grand Marketplace); false for the Shop pool. */
export function isMarketplaceCard(id: string): boolean {
    return MARKETPLACE_CARD_IDS.has(id);
}
