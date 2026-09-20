import { EXCHANGE_RESOURCES, type ExchangeAsset, type ExchangeOwnedAsset, type ExchangeKind, type ExchangeReadinessReasonCode } from '../../shared/sunscar-exchange.js';
import { effectiveItemLevelReq } from '../../shared/item-level-gate.js';
import { CHRONICLE_CARD_CATALOG, CHRONICLE_STARTER_GRANT_IDS } from '../../shared/chronicle-duel.js';
import { isChronicleProgressionCardId } from '../card-clash/_progression-cards.js';
import { canAppendPackableChronicleCards } from '../card-clash/_collection-cap.js';
import { maxPets } from '../_entitlements.js';
import { INVENTORY_CAP } from '../_inventory-capacity.js';
import { FORGED_ITEM_ID, forgedItemKey } from '../_forged-item-registry.js';
import { kv } from '../_storage.js';
import { petBusyReason, petBusyMessage } from '../pet/_pet-busy.js';
import type { SettlementCatalogs } from '../shop/_catalog.js';

type Obj = Record<string, unknown>;
export type SealedExchangeAsset = { asset: ExchangeAsset; definition: Obj; stackable: boolean; attunement?: string };
export type ExchangeGrantBlocker = { code: Extract<ExchangeReadinessReasonCode,
    'invalid-balance' | 'level-required' | 'duplicate-companion' | 'companion-capacity' | 'card-capacity' | 'inventory-capacity' | 'stack-quantity' | 'stack-capacity'>; message: string };
export class ExchangeError extends Error {
    constructor(message: string, public status = 409, public pending = false) { super(message); }
}
export const objects = (value: unknown): Obj[] => Array.isArray(value) ? value.filter((v): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)) : [];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
export function balance(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ExchangeError('Your stored balance could not be verified.');
    return value;
}
const title = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());

/** Recover owned named gear whose client-mirrored definition went missing. */
export async function recoverExchangeDefinitions(record: Obj): Promise<Obj> {
    const c = record.character as Obj;
    const definitions = objects(record.creatorItems);
    const ids = [...new Set([...strings(c.inventory), ...objects(c.itemStacks).map(s => String(s.itemId))])]
        .filter(id => FORGED_ITEM_ID.test(id) && !definitions.some(d => d.id === id));
    if (!ids.length) return record;
    const restored = await Promise.all(ids.map(id => kv.get<Obj>(forgedItemKey(id))));
    const verified = restored.filter((item, i): item is Obj => !!item && item.id === ids[i]);
    return verified.length ? { ...record, creatorItems: [...definitions, ...verified] } : record;
}

export function sealAsset(record: Obj, catalogs: SettlementCatalogs, kind: ExchangeKind, id: string): SealedExchangeAsset {
    const c = record.character as Obj;
    let definition: Obj | undefined;
    if (kind === 'pet') definition = objects(c.pets).find(p => p.id === id);
    if (kind === 'item') {
        definition = catalogs.items.get(id) as Obj | undefined;
        if (FORGED_ITEM_ID.test(id)) definition = objects(record.creatorItems).find(i => i.id === id);
    }
    if (kind === 'card') {
        definition = CHRONICLE_CARD_CATALOG.find(card => card.id === id) as unknown as Obj | undefined;
        if (!definition && catalogs.cards.has(id)) definition = { ...catalogs.cards.get(id), name: title(id) };
    }
    if (kind === 'resource' && Object.hasOwn(EXCHANGE_RESOURCES, id)) definition = { id, name: EXCHANGE_RESOURCES[id], rarity: 'rare' };
    if (!definition || definition.serviceItem) throw new ExchangeError('This asset could not be verified in the game catalog.', 400);
    definition = structuredClone(definition);
    const attunement = kind === 'item' && FORGED_ITEM_ID.test(id) ? (c.weaponElements as Obj | undefined)?.[id] : undefined;
    if (typeof attunement === 'string') definition.weaponElement = attunement;
    const slot = String(definition.slot ?? '');
    const category: ExchangeAsset['category'] = kind === 'pet' ? 'pets' : kind === 'card' ? 'cards' : kind === 'resource' ? 'resources'
        : ['hand', 'weapon', 'thrown'].includes(slot) ? 'weapons'
        : ['head', 'body', 'armor', 'gloves', 'waist', 'legs', 'feet'].includes(slot) ? 'armor'
        : ['aura', 'relic', 'accessory'].includes(slot) ? 'accessories'
        : /^(hunt-|.*(?:shard|fragment|core|ore|material))/.test(id) ? 'materials' : 'consumables';
    const stats: ExchangeAsset['stats'] = [];
    for (const key of ['attack', 'defense', 'hp', 'speed', 'element', 'trait', 'breedingUsesRemaining', 'generation', 'weaponElement', 'weaponEp', 'weaponRange', 'weaponCooldown', 'apCost', 'armorQuality']) {
        if (typeof definition[key] === 'number' || typeof definition[key] === 'string') stats.push({ label: title(key), value: String(definition[key]) });
    }
    if (definition.bonuses && typeof definition.bonuses === 'object') {
        for (const [key, value] of Object.entries(definition.bonuses)) if (typeof value === 'number' && value) stats.push({ label: title(key), value: `${value > 0 ? '+' : ''}${value}` });
    }
    for (const tag of objects(definition.weaponTags)) stats.push({ label: 'Weapon tag', value: `${tag.name}${tag.percent ? ` ${tag.percent}%` : ''}` });
    const asset: ExchangeAsset = { kind, id, name: String(definition.nickname || definition.name || title(id)), category,
        rarity: FORGED_ITEM_ID.test(id) ? 'named' : String(definition.rarity ?? 'common'),
        description: String(definition.description || definition.flavorText || (kind === 'pet' ? 'A companion with its own history. Level, traits, growth and lineage travel with this pet.' : 'Offered by a fellow traveler at Sunscar Exchange.')),
        stats, ...(typeof definition.image === 'string' ? { image: definition.image } : {}),
        ...(kind === 'pet' ? { level: Number(definition.level ?? 1) } : kind === 'item' ? { level: effectiveItemLevelReq(definition) } : {}),
    };
    return { asset, definition, stackable: definition.stackable === true || objects(c.itemStacks).some(s => s.itemId === id), ...(typeof attunement === 'string' ? { attunement } : {}) };
}

export function ownedQuantity(c: Obj, kind: ExchangeKind, id: string): number {
    if (kind === 'resource') return typeof c[id] === 'number' ? balance(c[id]) : 0;
    if (kind === 'pet') return objects(c.pets).filter(p => p.id === id).length;
    if (kind === 'card') return Math.max(0, strings(c.tileCards).filter(s => s === id).length - CHRONICLE_STARTER_GRANT_IDS.filter(s => s === id).length);
    return strings(c.inventory).filter(s => s === id).length + objects(c.itemStacks).filter(s => s.itemId === id).reduce((n, s) => n + balance(s.count), 0);
}

export function unavailableReason(c: Obj, sealed: SealedExchangeAsset): string | undefined {
    const { kind, id } = sealed.asset;
    if (kind === 'card' && isChronicleProgressionCardId(id)) return 'This Chronicle record is an account progression unlock.';
    if (kind === 'pet') {
        const pet = objects(c.pets).find(p => p.id === id);
        if (!pet) return 'This pet is no longer in your roster.';
        const busy = petBusyReason(c, pet);
        if (busy) return petBusyMessage(busy).replace('before breeding', 'before listing');
        if (pet.loadout && Object.values(pet.loadout as Obj).some(v => typeof v === 'string' && v)) return 'Remove this pet’s equipment before listing it.';
    }
    if (kind === 'card' && [...strings(c.savedTileDeck), ...strings(c.cardClashDeck)].includes(id)) return 'Remove this card from your saved decks before listing it.';
    return undefined;
}

export function removeAsset(c: Obj, sealed: SealedExchangeAsset, quantity: number): Obj {
    const reason = unavailableReason(c, sealed);
    if (reason) throw new ExchangeError(reason);
    const { kind, id } = sealed.asset;
    if (ownedQuantity(c, kind, id) < quantity) throw new ExchangeError('You no longer own that quantity. Refresh your inventory.');
    if (kind === 'pet' && quantity !== 1) throw new ExchangeError('List one companion at a time.', 400);
    if (kind === 'resource') return { ...c, [id]: balance(c[id]) - quantity };
    if (kind === 'pet') return { ...c, pets: objects(c.pets).filter(p => p.id !== id) };
    let remaining = quantity;
    const drain = (values: string[]) => values.filter(value => { if (value === id && remaining > 0) { remaining--; return false; } return true; });
    if (kind === 'card') return { ...c, tileCards: drain(strings(c.tileCards)) };
    const itemStacks = objects(c.itemStacks).map(s => {
        if (s.itemId !== id) return s;
        const take = Math.min(remaining, balance(s.count)); remaining -= take;
        return { ...s, count: balance(s.count) - take };
    }).filter(s => Number(s.count) > 0);
    const inventory = drain(strings(c.inventory));
    const equipment = { ...(c.equipment as Obj ?? {}) };
    if (!inventory.includes(id) && !itemStacks.some(s => s.itemId === id)) {
        for (const slot of ['item', 'item1', 'item2', 'item3', 'thrown', 'potion']) if (equipment[slot] === id) equipment[slot] = null;
    }
    return { ...c, inventory, itemStacks, equipment, ...(sealed.attunement ? { weaponElements: { ...(c.weaponElements as Obj ?? {}), [id]: null } } : {}) };
}

/** Pure authoritative projection shared by purchase preview and final grant. */
export function exchangeGrantBlocker(c: Obj, sealed: SealedExchangeAsset, quantity: number, returning = false): ExchangeGrantBlocker | null {
    const { kind, id } = sealed.asset;
    if (kind === 'resource') {
        try { balance(balance(c[id] ?? 0) + quantity); return null; }
        catch { return { code: 'invalid-balance', message: 'Your stored balance could not be verified.' }; }
    }
    if (kind === 'pet') {
        const pets = objects(c.pets);
        if (pets.some(p => p.id === id)) return { code: 'duplicate-companion', message: 'This companion is already in your roster.' };
        if (!returning && pets.length >= maxPets(c)) return { code: 'companion-capacity', message: 'Your companion roster is full. Move a companion to the Sanctuary before buying.' };
        return null;
    }
    if (kind === 'card') {
        const cards = strings(c.tileCards);
        if (!canAppendPackableChronicleCards(cards, quantity)) return { code: 'card-capacity', message: 'Your card collection is full. Make room before buying these cards.' };
        return null;
    }
    if (!returning && Number(c.level ?? 0) < Number(sealed.asset.level ?? 1)) return { code: 'level-required', message: `This item requires level ${sealed.asset.level}.` };
    const inventory = strings(c.inventory);
    if (sealed.stackable) {
        const stacks = objects(c.itemStacks);
        let count: number;
        try { count = ownedQuantity(c, 'item', id) + quantity; }
        catch { return { code: 'invalid-balance', message: 'Your stored inventory could not be verified.' }; }
        if (count > 9999) return { code: 'stack-quantity', message: 'There is not enough room in this item stack.' };
        if (!stacks.some(s => s.itemId === id) && stacks.length >= 200) return { code: 'stack-capacity', message: 'Your stack inventory is full.' };
        return null;
    }
    if (!returning && inventory.length + quantity > INVENTORY_CAP) return { code: 'inventory-capacity', message: 'Your inventory is full.' };
    return null;
}

export function grantAsset(c: Obj, sealed: SealedExchangeAsset, quantity: number, returning = false): Obj {
    const blocker = exchangeGrantBlocker(c, sealed, quantity, returning);
    if (blocker) throw new ExchangeError(blocker.message);
    const { kind, id } = sealed.asset;
    if (kind === 'resource') return { ...c, [id]: balance(balance(c[id] ?? 0) + quantity) };
    if (kind === 'pet') return { ...c, pets: [...objects(c.pets), structuredClone(sealed.definition)] };
    if (kind === 'card') return { ...c, tileCards: [...strings(c.tileCards), ...Array<string>(quantity).fill(id)] };
    const inventory = strings(c.inventory);
    if (sealed.stackable) {
        const stacks = objects(c.itemStacks);
        const count = ownedQuantity(c, 'item', id) + quantity;
        return { ...c, inventory: inventory.filter(v => v !== id), itemStacks: [...stacks.filter(s => s.itemId !== id), { itemId: id, count }] };
    }
    return { ...c, inventory: [...inventory, ...Array<string>(quantity).fill(id)], ...(sealed.attunement ? { weaponElements: { ...(c.weaponElements as Obj ?? {}), [id]: sealed.attunement } } : {}) };
}

export function exchangeInventory(record: Obj, catalogs: SettlementCatalogs): ExchangeOwnedAsset[] {
    const c = record.character as Obj;
    const refs: Array<[ExchangeKind, string]> = [
        ...[...new Set([...strings(c.inventory), ...objects(c.itemStacks).map(s => String(s.itemId))])].map(id => ['item', id] as [ExchangeKind, string]),
        ...objects(c.pets).map(p => ['pet', String(p.id)] as [ExchangeKind, string]),
        ...[...new Set(strings(c.tileCards))].map(id => ['card', id] as [ExchangeKind, string]),
        ...Object.keys(EXCHANGE_RESOURCES).filter(id => Number(c[id]) > 0).map(id => ['resource', id] as [ExchangeKind, string]),
    ];
    return refs.flatMap(([kind, id]) => {
        try { const sealed = sealAsset(record, catalogs, kind, id); const quantity = ownedQuantity(c, kind, id); return quantity > 0 ? [{ ...sealed.asset, quantity, unavailable: unavailableReason(c, sealed) }] : []; }
        catch (error) { if (error instanceof ExchangeError) return []; throw error; }
    });
}
