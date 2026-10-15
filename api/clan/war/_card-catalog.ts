/** Compatibility catalog for pack, shop and ownership settlement. Duel logic
 * lives exclusively in shared/chronicle-duel; no retired stats are retained. */
import { CHRONICLE_CARD_CATALOG } from '../../../shared/chronicle-duel.js';

export type MarketplaceCardRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type ChronicleMarketplaceCard = { rarity: MarketplaceCardRarity };

// Story, Legacy, and living-witness cards are progression unlocks, never
// pack/shop rolls.
const PACKABLE = CHRONICLE_CARD_CATALOG.filter(
    (card) => !card.id.startsWith('story-')
        && !card.id.startsWith('legacy-')
        && !card.id.startsWith('pet-witness-'),
);

export const BUILTIN_CLASH: Record<string, ChronicleMarketplaceCard> = Object.fromEntries(
    PACKABLE.map((card) => [
        card.id,
        { rarity: card.rarity === 'mythic' ? 'legendary' : card.rarity },
    ]),
);

/**
 * Storefront tiering: the ranked catalog is split by quality into its best half
 * (Grand Marketplace, premium Fate Shard packs) and the rest (Shop, ryo pack).
 * STOREFRONT_ADDITIONS are placed by decision on top of that split, so the
 * Marketplace now holds slightly more than half of all packable cards.
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

/**
 * Cards added after the 2026-10-14 storefront snapshot, each placed by decision
 * rather than by rank. Ranking them in would move the median and push existing
 * Rares across the line (it would have moved tc-29 and tc-34 to the Shop).
 *
 * All eleven are Legendary and sit in the Grand Marketplace, so they come from
 * the Legendary packs (owner ruling). A Summoning Call and its Monster are
 * separate pulls, so owning a pair takes luck.
 */
export const STOREFRONT_ADDITIONS: Readonly<Record<string, 'marketplace' | 'shop'>> = {
    'chronicle-call-of-the-cinderhorn': 'marketplace',
    'chronicle-call-of-the-rimetide': 'marketplace',
    'chronicle-call-of-the-ironroot': 'marketplace',
    'chronicle-call-of-the-galewing': 'marketplace',
    'chronicle-call-of-the-stormcrown': 'marketplace',
    'summon-cinderhorn-qilin': 'marketplace',
    'summon-rimetide-leviathan': 'marketplace',
    'summon-ironroot-tortoise': 'marketplace',
    'summon-galewing-tengu': 'marketplace',
    'summon-stormcrown-raiju': 'marketplace',
    'chronicle-shadow-clone': 'marketplace',
};

const RANKED = PACKABLE.filter((card) => !(card.id in STOREFRONT_ADDITIONS)).sort(
    (a, b) => qualityScore(b) - qualityScore(a) || a.id.localeCompare(b.id),
);

/**
 * Cards held in the storefront they had before a balance pass moved them.
 *
 * The ranking reads live stats and Levels, so a card-balance change can push a
 * card across the median and silently move it between the ryo Shop and the
 * Fate Shard Marketplace. Which storefront sells a card is an economy decision,
 * not a balance one, so the 2026-10-14 pass (docs/chronicle-balance-pass-2026-10.md)
 * pins every card it would have moved. Pins come in equal Marketplace/Shop
 * numbers, so the ranked split stays exactly half. _card-catalog.test.ts holds the
 * full Marketplace list, so the next pass that moves a card fails a test.
 */
export const STOREFRONT_PINS: Readonly<Record<string, 'marketplace' | 'shop'>> = {
    // FLIP Monsters the pass moved from Level 7/8 to a free-summon Level, which
    // dropped them below the cut and lifted the next two Rares above it.
    'tc-24': 'marketplace',
    'tc-85': 'marketplace',
    'tc-39': 'shop',
    'tc-74': 'shop',
};

/** The best half of the ranked cards plus the Marketplace additions — Grand
 *  Marketplace exclusive. */
export const MARKETPLACE_CARD_IDS: ReadonlySet<string> = (() => {
    const ids = new Set(RANKED.slice(0, Math.round(RANKED.length / 2)).map((card) => card.id));
    for (const [id, storefront] of Object.entries({ ...STOREFRONT_PINS, ...STOREFRONT_ADDITIONS })) {
        if (storefront === 'marketplace') ids.add(id);
        else ids.delete(id);
    }
    return ids;
})();

/** True for Grand Marketplace cards; false for the Shop pool. */
export function isMarketplaceCard(id: string): boolean {
    return MARKETPLACE_CARD_IDS.has(id);
}
