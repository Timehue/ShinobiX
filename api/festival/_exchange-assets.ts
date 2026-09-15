import { EXCHANGE_RESOURCES, type ExchangeAsset, type ExchangeOwnedAsset, type ExchangeKind } from '../../shared/sunscar-exchange.js';
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

export function grantAsset(c: Obj, sealed: SealedExchangeAsset, quantity: number, returning = false): Obj {
    const { kind, id } = sealed.asset;
    if (kind === 'resource') { const n = balance(c[id] ?? 0) + quantity; return { ...c, [id]: balance(n) }; }
    if (kind === 'pet') {
        const pets = objects(c.pets);
        if (pets.some(p => p.id === id)) throw new ExchangeError('This companion is already in your roster.');
        if (!returning && pets.length >= maxPets(c)) throw new ExchangeError('Your companion roster is full. Move a pet to the Sanctuary first.');
        return { ...c, pets: [...pets, structuredClone(sealed.definition)] };
    }
    if (kind === 'card') {
        const cards = strings(c.tileCards);
        if (!canAppendPackableChronicleCards(cards, quantity)) throw new ExchangeError('Your card collection is full. Make room before collecting these cards.');
        return { ...c, tileCards: [...cards, ...Array<string>(quantity).fill(id)] };
    }
    if (!returning && Number(c.level ?? 0) < Number(sealed.asset.level ?? 1)) throw new ExchangeError(`This item requires level ${sealed.asset.level}.`);
    const inventory = strings(c.inventory);
    if (sealed.stackable) {
        const stacks = objects(c.itemStacks);
        const count = ownedQuantity(c, 'item', id) + quantity;
        if (count > 9999) throw new ExchangeError('There is not enough room in this item stack.');
        if (!stacks.some(s => s.itemId === id) && stacks.length >= 200) throw new ExchangeError('Your stack inventory is full.');
        return { ...c, inventory: inventory.filter(v => v !== id), itemStacks: [...stacks.filter(s => s.itemId !== id), { itemId: id, count }] };
    }
    if (!returning && inventory.length + quantity > INVENTORY_CAP) throw new ExchangeError('Your inventory is full.');
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
