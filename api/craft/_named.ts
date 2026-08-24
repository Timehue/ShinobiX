import { randomInt, randomUUID } from 'node:crypto';
import { NAMED_ITEM_LEVEL_REQ } from '../../shared/item-level-gate.js';

export const NAMED_FORGE_COST = 1000;
const CURRENCY_POINTS = { boneCharms: 5, fateShards: 5, auraStones: 25, mythicSeals: 75 } as const;
const WEAPON_TAGS = ['Siphon', 'Absorb', 'Poison', 'Wound', 'Reflect', 'Shield', 'Drain', 'Ignition', 'Heal', 'Increase Damage Given', 'Increase Generals', 'Decrease Damage Taken'];
const ARMOR_SPECIALS = [
    { kind: 'Absorb', bonusKey: 'absorbPercent', min: 0.08, max: 2, decimals: 2 },
    { kind: 'Shield', bonusKey: 'shield', min: 75, max: 150, decimals: 0 },
    { kind: 'Reflect', bonusKey: 'reflectPercent', min: 0.08, max: 2, decimals: 2 },
    { kind: 'Life Steal', bonusKey: 'lifeStealPercent', min: 0.08, max: 2, decimals: 2 },
    { kind: 'Increase Damage', bonusKey: 'damagePercent', min: 0.75, max: 1.5, decimals: 2 },
] as const;
const SLOTS = ['head', 'body', 'waist', 'legs', 'feet', 'hand'] as const;

/**
 * Receipts stay string-only for save-schema compatibility, but new entries also
 * carry the minted definition id. That gives a lost-response retry enough data
 * to return the exact item without re-rolling or charging the player again.
 */
export function makeNamedForgeReceipt(token: string, itemId: string): string {
    return `${token}:${itemId}`;
}

export function resolveNamedForgeReplay(
    receiptsRaw: unknown,
    token: string,
    creatorItemsRaw: unknown,
): { matched: boolean; item: Record<string, unknown> | null } {
    const receipts = Array.isArray(receiptsRaw) ? receiptsRaw.filter((value): value is string => typeof value === 'string') : [];
    const receipt = receipts.find((value) => value === token || value.startsWith(`${token}:`));
    if (!receipt) return { matched: false, item: null };

    // Legacy receipts contain only the token. They remain recognized as spent,
    // while every receipt minted from this version onward is fully recoverable.
    const itemId = receipt.slice(token.length + 1);
    if (!itemId) return { matched: true, item: null };
    const creatorItems = Array.isArray(creatorItemsRaw) ? creatorItemsRaw : [];
    const item = creatorItems.find((value): value is Record<string, unknown> =>
        !!value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).id === itemId,
    );
    return { matched: true, item: item ?? null };
}

export type NamedRoll =
    | { kind: 'weapon'; ep: number; range: 3 | 4 | 5; offenseVal: number; tags: Array<{ name: string; percent: number }> }
    | { kind: 'armor'; slot: typeof SLOTS[number]; armorQuality: 'Elite' | 'Legendary' | 'Mythic'; offenseVal: number; defenseVal: number; special: { kind: string; bonusKey: string; value: number } };

const pick = <T>(values: readonly T[]): T => values[randomInt(values.length)];
export function rollNamedForge(kind: 'weapon' | 'armor', slotRaw?: unknown): NamedRoll {
    if (kind === 'weapon') {
        const tags = [...WEAPON_TAGS].sort(() => randomInt(3) - 1);
        const single = randomInt(2) === 0;
        return { kind, ep: randomInt(30, 36), range: pick([3, 4, 5] as const), offenseVal: randomInt(168, 181), tags: single ? [{ name: tags[0], percent: randomInt(35, 41) }] : [{ name: tags[0], percent: randomInt(15, 21) }, { name: tags[1], percent: randomInt(15, 21) }] };
    }
    const slot = SLOTS.includes(slotRaw as typeof SLOTS[number]) ? slotRaw as typeof SLOTS[number] : 'body';
    const special = pick(ARMOR_SPECIALS);
    const raw = special.decimals === 0 ? randomInt(special.min, special.max + 1) : special.min + (randomInt(1_000_000) / 1_000_000) * (special.max - special.min);
    return { kind, slot, armorQuality: pick(['Elite', 'Legendary', 'Mythic'] as const), offenseVal: randomInt(25, 36), defenseVal: randomInt(25, 36), special: { kind: special.kind, bonusKey: special.bonusKey, value: Number(raw.toFixed(special.decimals)) } };
}

export function debitNamedForge(character: Record<string, unknown>): Record<string, unknown> | null {
    const total = Object.entries(CURRENCY_POINTS).reduce((sum, [key, points]) => sum + Math.max(0, Math.floor(Number(character[key]) || 0)) * points, 0);
    if (total < NAMED_FORGE_COST) return null;
    const next = { ...character }; let remaining = NAMED_FORGE_COST;
    for (const [key, points] of Object.entries(CURRENCY_POINTS)) {
        const held = Math.max(0, Math.floor(Number(next[key]) || 0));
        const used = Math.min(held, Math.ceil(remaining / points));
        next[key] = held - used; remaining -= used * points;
    }
    return next;
}

export function buildNamedItem(roll: NamedRoll, nameRaw: string, flavorRaw: string) {
    const id = `named-${roll.kind}-${randomUUID().replace(/-/g, '')}`;
    if (roll.kind === 'weapon') {
        const name = nameRaw || 'Named Weapon';
        const tagDesc = roll.tags.map((tag) => `${tag.name} ${tag.percent}%`).join(', ');
        return { id, name, slot: 'hand', rarity: 'legendary', cost: 0, description: flavorRaw || `A master-forged weapon. Tags: ${tagDesc}.`, weaponEp: roll.ep, apCost: 40, weaponRange: roll.range, weaponCooldown: 5, weaponTags: roll.tags, flavorText: flavorRaw || undefined, bonuses: { ninjutsuOffense: roll.offenseVal, taijutsuOffense: roll.offenseVal, bukijutsuOffense: roll.offenseVal, genjutsuOffense: roll.offenseVal } };
    }
    const slotLabel = roll.slot === 'hand' ? 'Gloves' : roll.slot[0].toUpperCase() + roll.slot.slice(1);
    let name = nameRaw || `Named ${slotLabel}`; if (roll.slot === 'hand' && !/glove|gauntlet/i.test(name)) name += ' Gauntlets';
    // Hand gear (gauntlets/gloves) grants stats + its special roll — NEVER damage
    // reduction. Owner ruling 2026-08-16, and it matches the built-in gloves, which
    // carry no armorQuality at all. The `gloves` equip slot is deliberately absent
    // from BOTH armour-DR sums (getCharacterArmorRawDR client-side, ARMOR_SLOTS in
    // api/pvp/_multipliers.ts), so stamping armorQuality on a gauntlet only ever
    // produced a description promising a reduction that nothing applied.
    const isGauntlet = roll.slot === 'hand';
    const reduction = roll.armorQuality === 'Elite' ? 6 : roll.armorQuality === 'Legendary' ? 7 : 8;
    const description = flavorRaw || (isGauntlet
        ? `A master-forged pair of gauntlets. ${roll.special.kind} ${roll.special.value}.`
        : `A master-forged ${slotLabel.toLowerCase()} piece. ${reduction}% damage reduction. ${roll.special.kind} ${roll.special.value}.`);
    // Forged gear sits ABOVE mythic on the ladder — it is the last equipment a
    // character earns, so it is gated at 90 (owner ruling 2026-08-17). The
    // `rarity` string stays 'legendary' because the rarity vocabulary is shared
    // with the shop/pack tables and a new value would ripple through both; the
    // `named-*` id prefix is what marks the tier, and shared/item-level-gate.ts
    // resolves it to NAMED_ITEM_LEVEL_REQ. Was 30.
    return { id, name, slot: roll.slot, rarity: 'legendary', ...(isGauntlet ? {} : { armorQuality: roll.armorQuality }), cost: 0, levelReq: NAMED_ITEM_LEVEL_REQ, description, flavorText: flavorRaw || undefined, bonuses: { ninjutsuOffense: roll.offenseVal, taijutsuOffense: roll.offenseVal, bukijutsuOffense: roll.offenseVal, genjutsuOffense: roll.offenseVal, ninjutsuDefense: roll.defenseVal, taijutsuDefense: roll.defenseVal, bukijutsuDefense: roll.defenseVal, genjutsuDefense: roll.defenseVal, [roll.special.bonusKey]: roll.special.value } };
}
