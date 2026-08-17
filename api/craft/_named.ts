import { randomInt, randomUUID } from 'node:crypto';

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
    return { id, name, slot: roll.slot, rarity: 'legendary', ...(isGauntlet ? {} : { armorQuality: roll.armorQuality }), cost: 0, levelReq: 30, description, flavorText: flavorRaw || undefined, bonuses: { ninjutsuOffense: roll.offenseVal, taijutsuOffense: roll.offenseVal, bukijutsuOffense: roll.offenseVal, genjutsuOffense: roll.offenseVal, ninjutsuDefense: roll.defenseVal, taijutsuDefense: roll.defenseVal, bukijutsuDefense: roll.defenseVal, genjutsuDefense: roll.defenseVal, [roll.special.bonusKey]: roll.special.value } };
}
