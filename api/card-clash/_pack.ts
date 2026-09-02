import type { PlayerCharacter } from '../save/_mutate-player-save.js';
import { BUILTIN_CLASH, isMarketplaceCard } from '../clan/war/_card-catalog.js';
import { countChronicleCardsWithStarter, deckLimitForCard } from '../../shared/chronicle-duel.js';
import { canAppendPackableChronicleCards, CARD_COLLECTION_CAP } from './_collection-cap.js';

export const CARD_PACK_TYPES = ['standard', 'epic', 'legendary'] as const;
export type CardPackType = typeof CARD_PACK_TYPES[number];

export type CardPackCurrency = 'ryo' | 'fateShards' | 'chroniclePoints';

type PackDefinition = {
    currency: CardPackCurrency;
    baseCost: number;
    count: number;
    rarities: string[];
    // Which storefront pool this pack draws from. 'shop' = the weaker half of
    // the catalog; 'marketplace' = the best 50% (premium Fate Shards).
    pool: 'shop' | 'marketplace';
};

const PACKS: Record<CardPackType, PackDefinition> = {
    // Basic Card Pack: Commons and the weaker Rares. Costs Chronicle Points,
    // earned only through Echoes of War (Celestial Tower) victories — it has
    // NO ryo price and must never regain one (owner handoff 2026-09-02).
    standard: { currency: 'chroniclePoints', baseCost: 100, count: 5, rarities: ['common', 'rare'], pool: 'shop' },
    // Grand Marketplace (Fate Shards): the best 50%. The Elite pack covers the
    // top Rares + Epics; the Legendary pack is the guaranteed top tier.
    epic: { currency: 'fateShards', baseCost: 10, count: 1, rarities: ['rare', 'epic'], pool: 'marketplace' },
    legendary: { currency: 'fateShards', baseCost: 30, count: 1, rarities: ['legendary'], pool: 'marketplace' },
};

export { CARD_COLLECTION_CAP } from './_collection-cap.js';

export function parseCardPackType(value: unknown): CardPackType | null {
    return typeof value === 'string' && (CARD_PACK_TYPES as readonly string[]).includes(value)
        ? value as CardPackType
        : null;
}

export function cardPackDiscountPercent(character: PlayerCharacter, type: CardPackType): number {
    // Chronicle Point packs have one fixed campaign price — no shop, clan or
    // elder discount applies (the currency sits outside the ryo economy).
    if (PACKS[type].currency === 'chroniclePoints') return 0;
    // Grand Marketplace packs use only the trade-focus discount in the client.
    if (type !== 'standard') return character.elderFocus === 'trade' ? 5 : 0;
    const village = character.villageUpgrades && typeof character.villageUpgrades === 'object'
        ? character.villageUpgrades as Record<string, unknown>
        : {};
    const clan = character.clanUpgradeLevels && typeof character.clanUpgradeLevels === 'object'
        ? character.clanUpgradeLevels as Record<string, unknown>
        : {};
    const shopLevel = Math.max(0, Math.min(50, Math.floor(Number(village.shop) || 0)));
    const blacksmithLevel = Math.max(0, Math.floor(Number(clan.blacksmith) || 0));
    const blacksmith = Math.min(10, blacksmithLevel * 0.2);
    const elder = character.elderFocus === 'trade' ? 5 : 0;
    const doctrine = character.clanDoctrine === 'merchant' ? 5 : 0;
    return shopLevel * 0.25 + blacksmith + elder + doctrine;
}

export function cardPackCost(character: PlayerCharacter, type: CardPackType): number {
    const def = PACKS[type];
    return Math.max(1, Math.floor(def.baseCost * Math.max(0, 1 - cardPackDiscountPercent(character, type) / 100)));
}

export type CardPackOpen =
    | { ok: true; character: PlayerCharacter; cards: string[]; currency: CardPackCurrency; cost: number; balance: number }
    | { ok: false; status: number; error: string };

export function applyCardPackOpen(
    character: PlayerCharacter,
    typeRaw: unknown,
    pickIndex: (maxExclusive: number) => number,
): CardPackOpen {
    const type = parseCardPackType(typeRaw);
    if (!type) return { ok: false, status: 400, error: 'Invalid card pack.' };
    const def = PACKS[type];
    const owned = Array.isArray(character.tileCards)
        ? (character.tileCards as unknown[]).filter((id): id is string => typeof id === 'string' && !!id)
        : [];
    if (!canAppendPackableChronicleCards(owned, def.count)) {
        return { ok: false, status: 409, error: `Card collection is capped at ${CARD_COLLECTION_CAP}.` };
    }
    const balance = Math.max(0, Math.floor(Number(character[def.currency]) || 0));
    const cost = cardPackCost(character, type);
    const currencyLabel = def.currency === 'chroniclePoints'
        ? 'Chronicle Points — win Showdowns in Echoes of War to earn more'
        : def.currency === 'fateShards' ? 'Fate Shards' : 'ryo';
    if (balance < cost) return { ok: false, status: 409, error: `Not enough ${currencyLabel}.` };
    const pool = Object.entries(BUILTIN_CLASH)
        .filter(([id, card]) =>
            def.rarities.includes(card.rarity) &&
            isMarketplaceCard(id) === (def.pool === 'marketplace'),
        )
        .map(([id]) => id);
    if (pool.length === 0) return { ok: false, status: 503, error: 'Card pack pool is unavailable.' };
    const cards: string[] = [];
    const ownedCounts = countChronicleCardsWithStarter(owned);
    const usefulCopiesRemaining = pool.reduce(
        (total, id) => total + Math.max(0, deckLimitForCard(id) - (ownedCounts.get(id) ?? 0)),
        0,
    );
    if (usefulCopiesRemaining < def.count) {
        return {
            ok: false,
            status: 409,
            error: `This pack tier cannot provide ${def.count === 1 ? 'another playable card' : `${def.count} playable cards`}. No currency was spent.`,
        };
    }
    for (let i = 0; i < def.count; i++) {
        // Duplicates remain useful until the card's format limit. Packs never
        // charge currency for a copy that cannot be added to a legal deck.
        const usefulPool = pool.filter((id) => (ownedCounts.get(id) ?? 0) < deckLimitForCard(id));
        const rawIndex = Math.floor(Number(pickIndex(usefulPool.length)) || 0);
        const id = usefulPool[Math.max(0, Math.min(usefulPool.length - 1, rawIndex))];
        cards.push(id);
        ownedCounts.set(id, (ownedCounts.get(id) ?? 0) + 1);
    }
    const nextBalance = balance - cost;
    return {
        ok: true,
        character: { ...character, [def.currency]: nextBalance, tileCards: [...owned, ...cards] },
        cards,
        currency: def.currency,
        cost,
        balance: nextBalance,
    };
}
