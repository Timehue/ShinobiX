import { kv } from '../_storage.js';
import { BUILTIN_CLASH } from '../clan/war/_card-catalog.js';
import { ITEM_CATALOG, type CatalogItem } from '../pvp/_item-catalog.js';
import { loadPublishedContent } from '../_content-store.js';

const ADMIN_DELETED_ITEM_MARKER = '__ADMIN_DELETED_ITEM__';
const ADMIN_SAVE_KEYS = ['save:admin1', 'save:admin2'] as const;
const ITEM_SLOTS = new Set(['aura', 'hand', 'gloves', 'body', 'waist', 'legs', 'feet', 'head', 'item', 'item1', 'item2', 'item3', 'thrown', 'potion', 'weapon', 'armor', 'accessory']);
const ITEM_RARITIES = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']);
const CARD_RARITIES = new Set(['common', 'rare', 'epic', 'legendary']);

export type SettlementItem = CatalogItem & { cost: number; levelReq?: number };
export type SettlementCard = { id: string; rarity: 'common' | 'rare' | 'epic' | 'legendary' };
export type SettlementCatalogs = { items: Map<string, SettlementItem>; cards: Map<string, SettlementCard> };

type AdminContentRecord = { creatorItems?: unknown; creatorCards?: unknown };

function cleanItem(raw: unknown): SettlementItem | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const slot = typeof item.slot === 'string' ? item.slot : '';
    const rarity = typeof item.rarity === 'string' ? item.rarity : '';
    const cost = Number(item.cost);
    if (!id || id.length > 120 || !name || !ITEM_SLOTS.has(slot) || !ITEM_RARITIES.has(rarity)) return null;
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > 100_000_000) return null;
    const levelReq = item.levelReq == null ? undefined : Number(item.levelReq);
    if (levelReq !== undefined && (!Number.isSafeInteger(levelReq) || levelReq < 1 || levelReq > 100)) return null;
    return { ...(item as SettlementItem), id, name, slot, rarity, cost, ...(levelReq === undefined ? {} : { levelReq }) };
}

function cleanCard(raw: unknown): SettlementCard | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const card = raw as Record<string, unknown>;
    const id = typeof card.id === 'string' ? card.id.trim() : '';
    const rarity = typeof card.rarity === 'string' ? card.rarity : '';
    if (!id || id.length > 120 || !CARD_RARITIES.has(rarity)) return null;
    return { id, rarity: rarity as SettlementCard['rarity'] };
}

/** Reproduce the client merge: built-in item definitions win, admin deletions hide them, Admin 2 wins custom-id collisions. */
export function buildSettlementCatalogs(adminRecords: readonly AdminContentRecord[]): SettlementCatalogs {
    const deleted = new Set<string>();
    const customItems = new Map<string, SettlementItem>();
    const customCards = new Map<string, SettlementCard>();
    const builtinIds = new Set(Object.keys(ITEM_CATALOG));

    for (const record of adminRecords) {
        for (const raw of Array.isArray(record?.creatorItems) ? record.creatorItems : []) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            const value = raw as Record<string, unknown>;
            const id = typeof value.id === 'string' ? value.id.trim() : '';
            if (!id) continue;
            if (value.name === ADMIN_DELETED_ITEM_MARKER) {
                deleted.add(id);
                customItems.delete(id);
                continue;
            }
            if (builtinIds.has(id)) continue;
            const item = cleanItem(value);
            if (item && !deleted.has(id)) customItems.set(id, item);
        }
        for (const raw of Array.isArray(record?.creatorCards) ? record.creatorCards : []) {
            const card = cleanCard(raw);
            if (card) customCards.set(card.id, card);
        }
    }

    const items = new Map<string, SettlementItem>();
    for (const [id, raw] of Object.entries(ITEM_CATALOG)) {
        if (!deleted.has(id)) items.set(id, raw as SettlementItem);
    }
    for (const [id, item] of customItems) items.set(id, item);

    const cards = new Map<string, SettlementCard>();
    for (const [id, raw] of Object.entries(BUILTIN_CLASH)) {
        cards.set(id, { id, rarity: raw.rarity });
    }
    for (const [id, card] of customCards) cards.set(id, card);
    return { items, cards };
}

export async function loadSettlementCatalogs(): Promise<SettlementCatalogs> {
    // Dual-read (P0-4): the canonical content store is appended LAST, matching
    // this builder's Admin-2-wins-collisions rule. Empty until the first
    // publish, so shop/sell settlement resolves exactly as before until then.
    // NOTE: this builder's tombstone semantics differ from the combat item
    // catalog (a deletion here also blocks a later live copy) — that
    // divergence is pre-existing and deliberately left alone; see
    // docs/audits/shared-content-audit.md finding 6.
    const [slots, published] = await Promise.all([
        Promise.all(ADMIN_SAVE_KEYS.map((key) => kv.get<AdminContentRecord>(key))),
        loadPublishedContent().catch(() => ({}) as Record<string, unknown>),
    ]);
    const records = [...slots, published as AdminContentRecord];
    return buildSettlementCatalogs(records.filter((record): record is AdminContentRecord => !!record));
}
