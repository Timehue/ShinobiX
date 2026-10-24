import type { PlayerCharacter } from '../save/_mutate-player-save.js';
import { BUILTIN_CLASH, isMarketplaceCard, type MarketplaceCardRarity } from '../clan/war/_card-catalog.js';
import { getChronicleCard, MAX_COPIES_PER_CARD, type ChronicleElement } from '../../shared/chronicle-duel.js';
import { canAppendPackableChronicleCards, CARD_COLLECTION_CAP } from './_collection-cap.js';

export const CARD_PACK_TYPES = ['standard', 'fire', 'water', 'earth', 'wind', 'lightning', 'snare', 'jutsu', 'epic', 'legendary', 'epic-five', 'legendary-five'] as const;
export type CardPackType = typeof CARD_PACK_TYPES[number];

export type CardPackCurrency = 'ryo' | 'fateShards' | 'chroniclePoints';

type PackDefinition = {
    currency: CardPackCurrency;
    baseCost: number;
    count: number;
    rarities: string[];
    // Which storefront pool this pack draws from. The Basic side reserves a
    // Rare Tribute ladder; the premium side is the quality-ranked half.
    pool: 'shop' | 'marketplace';
    /** Elemental Basic packs contain only matching Monster cards. */
    element?: ChronicleElement;
    /** Focused Basic packs contain only Snares or Jutsu cards. */
    cardClass?: 'trap' | 'magic';
};

const BASIC_PACK: PackDefinition = { currency: 'chroniclePoints', baseCost: 100, count: 5, rarities: ['common', 'rare'], pool: 'shop' };
const PACKS: Record<CardPackType, PackDefinition> = {
    // Basic Card Pack: Commons and the weaker Rares. Costs Chronicle Points,
    // earned from Echoes of War victories and, since 2026-10-22, PvP card duels
    // and won Dungeon, Rift and garrison card battles (api/card-clash/_card-cp.ts).
    // It has NO ryo price and must never regain one (owner handoff 2026-09-02).
    standard: BASIC_PACK,
    fire: { ...BASIC_PACK, element: 'Fire' },
    water: { ...BASIC_PACK, element: 'Water' },
    earth: { ...BASIC_PACK, element: 'Earth' },
    wind: { ...BASIC_PACK, element: 'Wind' },
    lightning: { ...BASIC_PACK, element: 'Lightning' },
    snare: { ...BASIC_PACK, cardClass: 'trap' },
    jutsu: { ...BASIC_PACK, cardClass: 'magic' },
    // Grand Marketplace (Fate Shards): the ranked premium half. The Elite pack
    // covers top Rares + Epics; the Legendary pack guarantees the top rarity.
    // Singles are priced per card at the Quintet rate (economy rebalance
    // 2026-10): Elite 6 / 0.842 Epic share = 7.1 FS per Epic against the Epic
    // Quintet's 7, and Legendary 20 equals the Legendary Quintet's 100 / 5.
    epic: { currency: 'fateShards', baseCost: 6, count: 1, rarities: ['rare', 'epic'], pool: 'marketplace' },
    legendary: { currency: 'fateShards', baseCost: 20, count: 1, rarities: ['legendary'], pool: 'marketplace' },
    'epic-five': { currency: 'fateShards', baseCost: 35, count: 5, rarities: ['epic'], pool: 'marketplace' },
    'legendary-five': { currency: 'fateShards', baseCost: 100, count: 5, rarities: ['legendary'], pool: 'marketplace' },
};

export { CARD_COLLECTION_CAP } from './_collection-cap.js';

/** Copies of one card id a pack keeps before a further pulled copy converts
 *  (economy rebalance 2026-10, framework 3.6). One playset for every card, not
 *  the card's own deck limit, so the 2nd and 3rd copy of a limit-1 card stay
 *  tradeable. Kill switch: Number.POSITIVE_INFINITY keeps every copy again. */
export const CARD_PLAYSET_COPIES: number = MAX_COPIES_PER_CARD;

/** What a pulled copy beyond the playset pays instead of joining the
 *  collection. A never-pay-zero floor, not pity: the draw itself never looks at
 *  ownership. Keyed by BUILTIN_CLASH rarity (the Mythic-tier card is
 *  `legendary` there). The rebate stays under a quarter of what the pack cost,
 *  so opening packs for it can never pay for the next one. */
export const CARD_DUPLICATE_CONVERSION: Readonly<Record<MarketplaceCardRarity, Readonly<{ chroniclePoints: number; fateShards: number }>>> = Object.freeze({
    common: Object.freeze({ chroniclePoints: 5, fateShards: 0 }),
    rare: Object.freeze({ chroniclePoints: 5, fateShards: 0 }),
    epic: Object.freeze({ chroniclePoints: 0, fateShards: 1 }),
    legendary: Object.freeze({ chroniclePoints: 0, fateShards: 3 }),
});

/** One drawn copy that converted; `index` is its position in the draw. */
export type CardDuplicateConversion = { index: number; cardId: string; chroniclePoints: number; fateShards: number };
export type CardDuplicateRefund = { chroniclePoints: number; fateShards: number };

/** Split drawn ids into kept copies and converted surplus, in draw order.
 *  Owned copies (starter-codex copies included) and copies kept earlier in the
 *  same pack both count toward the playset. An id with no known rarity is
 *  always kept, so a catalog gap can never silently destroy a card. */
export function splitSurplusCardCopies(
    owned: readonly string[],
    drawn: readonly string[],
    rarityOf: (id: string) => string | undefined,
): { kept: string[]; converted: CardDuplicateConversion[]; refund: CardDuplicateRefund } {
    const counts = new Map<string, number>();
    for (const id of owned) counts.set(id, (counts.get(id) ?? 0) + 1);
    const kept: string[] = [];
    const converted: CardDuplicateConversion[] = [];
    const refund: CardDuplicateRefund = { chroniclePoints: 0, fateShards: 0 };
    drawn.forEach((cardId, index) => {
        const have = counts.get(cardId) ?? 0;
        const rarity = rarityOf(cardId);
        const value = rarity && Object.prototype.hasOwnProperty.call(CARD_DUPLICATE_CONVERSION, rarity)
            ? CARD_DUPLICATE_CONVERSION[rarity as MarketplaceCardRarity]
            : undefined;
        if (value && have >= CARD_PLAYSET_COPIES) {
            converted.push({ index, cardId, chroniclePoints: value.chroniclePoints, fateShards: value.fateShards });
            refund.chroniclePoints += value.chroniclePoints;
            refund.fateShards += value.fateShards;
            return;
        }
        kept.push(cardId);
        counts.set(cardId, have + 1);
    });
    return { kept, converted, refund };
}

/** The undiscounted price, for the legacy /shop/settle table and tests. */
export function cardPackBaseCost(type: CardPackType): number {
    return PACKS[type].baseCost;
}

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
    // Nearest shard avoids turning 5% off a six-shard pack into 16.7%.
    // Chronicle Point packs retain their fixed, undiscounted campaign price.
    return Math.max(1, Math.round(def.baseCost * Math.max(0, 1 - cardPackDiscountPercent(character, type) / 100)));
}

export type CardPackOpen =
    | {
        ok: true; character: PlayerCharacter;
        /** Every drawn id in draw order, converted copies included (the reveal shows them all). */
        cards: string[];
        currency: CardPackCurrency; cost: number;
        /** Pack-currency balance after the debit and any rebate in that currency. */
        balance: number;
        converted: CardDuplicateConversion[]; refund: CardDuplicateRefund;
    }
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
        ? 'Chronicle Points — win card duels, Echoes of War, or Dungeon and Rift card battles to earn more'
        : def.currency === 'fateShards' ? 'Fate Shards' : 'ryo';
    if (balance < cost) return { ok: false, status: 409, error: `Not enough ${currencyLabel}.` };
    const pool = Object.entries(BUILTIN_CLASH)
        .filter(([id, card]) => {
            if (!def.rarities.includes(card.rarity) || isMarketplaceCard(id) !== (def.pool === 'marketplace')) return false;
            const source = getChronicleCard(id);
            if (def.element) return source?.cardClass === 'monster' && source.element === def.element;
            if (def.cardClass) return source?.cardClass === def.cardClass;
            return true;
        })
        .map(([id]) => id);
    if (pool.length === 0) return { ok: false, status: 503, error: 'Card pack pool is unavailable.' };
    const cards: string[] = [];
    for (let i = 0; i < def.count; i++) {
        // Each slot draws from the full eligible pool with replacement. Owned
        // copies never change the odds. A copy beyond the 3-copy playset
        // converts after the draw (CARD_DUPLICATE_CONVERSION).
        const rawIndex = Math.floor(Number(pickIndex(pool.length)) || 0);
        const id = pool[Math.max(0, Math.min(pool.length - 1, rawIndex))];
        cards.push(id);
    }
    const split = splitSurplusCardCopies(owned, cards, (id) => BUILTIN_CLASH[id]?.rarity);
    // Debit, kept cards and rebate ride one character, so mutatePlayerSave
    // commits both currency ledgers in the same write.
    const next: PlayerCharacter = { ...character, [def.currency]: balance - cost, tileCards: [...owned, ...split.kept] };
    if (split.refund.chroniclePoints > 0) {
        next.chroniclePoints = Math.max(0, Math.floor(Number(next.chroniclePoints) || 0)) + split.refund.chroniclePoints;
    }
    if (split.refund.fateShards > 0) {
        next.fateShards = Math.max(0, Math.floor(Number(next.fateShards) || 0)) + split.refund.fateShards;
    }
    return {
        ok: true,
        character: next,
        cards,
        currency: def.currency,
        cost,
        balance: Math.max(0, Math.floor(Number(next[def.currency]) || 0)),
        converted: split.converted,
        refund: split.refund,
    };
}
