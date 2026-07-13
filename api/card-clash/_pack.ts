import type { PlayerCharacter } from '../save/_mutate-player-save.js';
import { BUILTIN_CLASH } from '../clan/war/_card-catalog.js';

export const CARD_PACK_TYPES = ['standard', 'epic', 'legendary'] as const;
export type CardPackType = typeof CARD_PACK_TYPES[number];

type PackDefinition = {
    currency: 'ryo' | 'fateShards';
    baseCost: number;
    count: number;
    rarities: string[];
};

const PACKS: Record<CardPackType, PackDefinition> = {
    standard: { currency: 'ryo', baseCost: 250, count: 5, rarities: ['common', 'rare'] },
    epic: { currency: 'fateShards', baseCost: 10, count: 1, rarities: ['epic'] },
    legendary: { currency: 'fateShards', baseCost: 30, count: 1, rarities: ['legendary'] },
};

const CARD_COLLECTION_CAP = 1_200;

export function parseCardPackType(value: unknown): CardPackType | null {
    return typeof value === 'string' && (CARD_PACK_TYPES as readonly string[]).includes(value)
        ? value as CardPackType
        : null;
}

export function cardPackDiscountPercent(character: PlayerCharacter, type: CardPackType): number {
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
    | { ok: true; character: PlayerCharacter; cards: string[]; currency: 'ryo' | 'fateShards'; cost: number; balance: number }
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
    if (owned.length + def.count > CARD_COLLECTION_CAP) {
        return { ok: false, status: 409, error: `Card collection is capped at ${CARD_COLLECTION_CAP}.` };
    }
    const balance = Math.max(0, Math.floor(Number(character[def.currency]) || 0));
    const cost = cardPackCost(character, type);
    if (balance < cost) return { ok: false, status: 409, error: `Not enough ${def.currency}.` };
    const pool = Object.entries(BUILTIN_CLASH)
        .filter(([, card]) => def.rarities.includes(card.rarity))
        .map(([id]) => id);
    if (pool.length === 0) return { ok: false, status: 503, error: 'Card pack pool is unavailable.' };
    const cards: string[] = [];
    for (let i = 0; i < def.count; i++) {
        const rawIndex = Math.floor(Number(pickIndex(pool.length)) || 0);
        cards.push(pool[Math.max(0, Math.min(pool.length - 1, rawIndex))]);
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
