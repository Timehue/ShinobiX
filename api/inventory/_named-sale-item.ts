import { kv } from '../_storage.js';
import { forgedItemKey } from '../_forged-item-registry.js';
import { isNamedGearId } from '../../shared/named-gear-rules.js';
import type { SettlementItem } from '../shop/_catalog.js';

type Obj = Record<string, unknown>;

/**
 * The shop's view of a player forged named weapon or armor piece.
 *
 * Named gear is minted into the owner's own `creatorItems` and the durable forged
 * item registry, never into the built in or admin catalogs the shop reads, so it
 * is resolved here. The definition has to exist in one of those two server
 * minted places; the sale itself still requires the player to own the id.
 */
export async function namedGearSaleItem(playerName: string, itemId: string): Promise<SettlementItem | null> {
    if (!isNamedGearId(itemId)) return null;
    const wanted = itemId.toLowerCase();
    const matches = (def: unknown): def is Obj => !!def && typeof def === 'object' && String((def as Obj).id ?? '').toLowerCase() === wanted;
    let definition: unknown = await kv.get<Obj>(forgedItemKey(itemId)).catch(() => null);
    if (!matches(definition)) {
        const record = await kv.get<Obj>(`save:${playerName}`).catch(() => null);
        const mine = Array.isArray(record?.creatorItems) ? (record!.creatorItems as unknown[]) : [];
        definition = mine.find(matches);
    }
    if (!matches(definition)) return null;
    const slot = typeof definition.slot === 'string' ? definition.slot : '';
    const name = typeof definition.name === 'string' && definition.name.trim() ? definition.name.trim() : 'Named gear';
    if (!slot) return null;
    // Named gear costs 0; the flat sale price comes from shared/named-gear-rules.ts.
    return { id: itemId, name, slot, rarity: 'legendary', cost: 0 } as SettlementItem;
}
