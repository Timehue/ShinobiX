import { ITEM_CATALOG, type CatalogItem } from '../pvp/_item-catalog.js';
import type { PvpStatus } from '../pvp/session.js';

const NPC_ITEMS = ['thrown-shuriken', 'item-attack-pill', 'item-defense-pill', 'item-smoke-bomb'] as const;

/** One of each per fight, in existing equipment/inventory fields. These are
 * server NPC supplies, never a debit from or reward to a player save. */
export function equipPveAiItems(character: Record<string, unknown>): void {
    const equipment = { ...(character.equipment as Record<string, string> ?? {}) };
    const items = [...(Array.isArray(character.pvpItems) ? character.pvpItems as CatalogItem[] : [])];
    const inventory = [...(Array.isArray(character.inventory) ? character.inventory as string[] : [])];
    for (const [index, id] of NPC_ITEMS.entries()) {
        const slot = index === 0 ? 'thrown' : `item${index}`;
        if (equipment[slot] && equipment[slot] !== id) continue;
        equipment[slot] = id;
        if (!items.some(item => item.id === id)) items.push(structuredClone(ITEM_CATALOG[id]!));
        if (!inventory.includes(id)) inventory.push(id);
    }
    character.equipment = equipment;
    character.pvpItems = items;
    character.inventory = inventory;
}

export function pveAiItemCharges(character: Record<string, unknown>): Record<string, number> {
    const inventory = Array.isArray(character.inventory) ? character.inventory : [];
    return Object.fromEntries(NPC_ITEMS.map(id => [id, inventory.filter(item => item === id).length]));
}

/** A narrative roster splits one legacy enemy's HP and pressure budget. Split
 * its finite pouch too, rather than manufacturing a full pouch for every clone. */
export function distributePveAiItems(actors: Array<{character:Record<string,unknown>; itemCharges?:Record<string,number>}>, stock: Record<string,number>): void {
    if (!actors.length) return;
    for (const actor of actors) actor.itemCharges = Object.fromEntries(NPC_ITEMS.map(id => [id,0]));
    for (const [index,id] of NPC_ITEMS.entries()) {
        const owner = id === 'thrown-shuriken' ? actors.find(a=>a.character.specialty === 'Bukijutsu') ?? actors[0]! : actors[index % actors.length]!;
        owner.itemCharges![id] = Math.max(0,Math.floor(stock[id] ?? 0));
    }
    for (const actor of actors) {
        const original = Array.isArray(actor.character.inventory) ? actor.character.inventory : [];
        actor.character.inventory = [...original.filter(id => !NPC_ITEMS.includes(id as typeof NPC_ITEMS[number])),
            ...NPC_ITEMS.flatMap(id => Array.from({length:actor.itemCharges![id] ?? 0},()=>id))];
    }
}

/** A tactical shortlist; each engine still enforces equipment, AP, charges,
 * cooldowns and targeting through its ordinary item/weapon resolver. */
export function pveAiFillerItems(input: {
    ap: number; distance: number; round: number; canRecoverSoon: boolean;
    self: { hp: number; maxHp: number; statuses: PvpStatus[] };
    foe: { hp: number; maxHp: number; statuses: PvpStatus[] };
}): string[] {
    if (input.ap <= 0 || input.ap >= 40) return [];
    const present = (statuses: PvpStatus[], name: string, percent = 0) => statuses.some(s => s.rounds > 0
        && s.name === name && Number(s.percent ?? 0) >= percent);
    const smoked = [input.self, input.foe].some(f => f.statuses.some(s => s.rounds > 0 && s.source === 'item-smoke-bomb'));
    const smokedNow = [input.self, input.foe].some(f => f.statuses.some(s => s.rounds > 0
        && s.source === 'item-smoke-bomb' && (s.activeRound ?? 1) <= input.round));
    const smokePersists = [input.self, input.foe].some(f => f.statuses.some(s => s.rounds > 0
        && s.source === 'item-smoke-bomb' && ((s.activeRound ?? 1) > input.round || s.rounds > 1)));
    const hp = input.self.hp / Math.max(1, input.self.maxHp);
    const outmatched = hp <= .35 && input.foe.hp / Math.max(1, input.foe.maxHp) > hp + .2;
    const bleedingThroughSmoke = input.self.statuses.some(s=>s.rounds>0&&['Wound','Drain','Poison'].includes(s.name));
    const result: string[] = [];
    if (!smoked && outmatched && input.canRecoverSoon && !bleedingThroughSmoke
        && !present(input.self.statuses, 'Increase Damage Given', 15)) result.push('item-smoke-bomb');
    if (!smokedNow && input.distance <= Number(ITEM_CATALOG['thrown-shuriken']!.weaponRange)) result.push('thrown-shuriken');
    if (hp <= .6 && !present(input.self.statuses, 'Decrease Damage Taken', 15)) result.push('item-defense-pill');
    if (!smokePersists && !present(input.self.statuses, 'Increase Damage Given', 15)) result.push('item-attack-pill');
    if (hp > .6 && !present(input.self.statuses, 'Decrease Damage Taken', 15)) result.push('item-defense-pill');
    return result;
}
