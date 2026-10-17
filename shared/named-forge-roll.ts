/** Roll bounds shared by the server and odds display. All bounds are inclusive. */
export const NAMED_WEAPON_EP_MIN = 24;
export const NAMED_WEAPON_EP_MAX = 27;
/** EP rolls in half-point steps (owner ruling 2026-10-06): 24, 24.5, ... 27. */
export const NAMED_WEAPON_EP_STEP = 0.5;
export const NAMED_WEAPON_EP_VALUES: readonly number[] = Array.from(
    { length: Math.round((NAMED_WEAPON_EP_MAX - NAMED_WEAPON_EP_MIN) / NAMED_WEAPON_EP_STEP) + 1 },
    (_, i) => NAMED_WEAPON_EP_MIN + i * NAMED_WEAPON_EP_STEP,
);
export const NAMED_WEAPON_RANGES = [3, 4, 5] as const;
export const NAMED_WEAPON_OFFENSE = { min: 168, max: 180 } as const;
export const NAMED_WEAPON_TAG_COUNTS = [1, 2] as const;
/**
 * Owner ruling 2026-10-16: a named blade's percent tags roll these ranges and
 * apply EXACTLY as rolled. No 35% weapon cap, no scaling. Wound rolls its own,
 * lower range. Heal, Shield and Drain are flat by tag count, and Poison is fixed
 * at WEAPON_POISON_TAG_CAP, so none of them read the roll.
 */
export const NAMED_WEAPON_TAG_STRENGTH = { single: { min: 30, max: 40 }, dual: { min: 12, max: 22 } } as const;
export const NAMED_WEAPON_WOUND_STRENGTH = { single: { min: 22, max: 30 }, dual: { min: 15, max: 20 } } as const;
/** The highest percent a named blade's tag can roll: combat's ceiling for one (a bound, not a cut). */
export const NAMED_WEAPON_TAG_MAX = NAMED_WEAPON_TAG_STRENGTH.single.max;
export const NAMED_WEAPON_WOUND_MAX = NAMED_WEAPON_WOUND_STRENGTH.single.max;

/** The range one tag rolls on a named blade with `tagCount` tags. */
export function namedWeaponTagStrength(name: string, tagCount: number): { min: number; max: number } {
    const table = name === 'Wound' ? NAMED_WEAPON_WOUND_STRENGTH : NAMED_WEAPON_TAG_STRENGTH;
    return tagCount <= 1 ? table.single : table.dual;
}
export const NAMED_WEAPON_TAGS = ['Siphon', 'Absorb', 'Poison', 'Wound', 'Reflect', 'Shield', 'Drain', 'Ignition', 'Heal', 'Increase Damage Given', 'Increase Generals', 'Decrease Damage Taken'] as const;
// Half draw one tag, half draw two, without replacement: (1 + 2) / 2 / 12.
export const NAMED_WEAPON_TAG_APPEARANCE_PERCENT = 100 * (NAMED_WEAPON_TAG_COUNTS.reduce((sum, count) => sum + count, 0) / NAMED_WEAPON_TAG_COUNTS.length) / NAMED_WEAPON_TAGS.length;
export const NAMED_ARMOR_STATS = { min: 25, max: 35 } as const;
/**
 * Named gauntlets roll their OFFENSE here instead (owner ruling 2026-10-16). The
 * built-in legendary gauntlets carry 75 offense / 30 defense, so on the shared
 * 25-35 every named pair lost to them. 65-85 averages the built-in 75, the way
 * the other named pieces average the legendary 30. Defense stays NAMED_ARMOR_STATS.
 */
export const NAMED_GAUNTLET_OFFENSE = { min: 65, max: 85 } as const;
export const NAMED_ARMOR_QUALITIES = ['Elite', 'Legendary', 'Mythic'] as const;
export const NAMED_ARMOR_SLOTS = ['head', 'body', 'waist', 'legs', 'feet', 'hand'] as const;
export const NAMED_ARMOR_SPECIALS = [
    { kind: 'Absorb', bonusKey: 'absorbPercent', min: 0.08, max: 2, decimals: 2 },
    { kind: 'Shield', bonusKey: 'shield', min: 75, max: 150, decimals: 0 },
    { kind: 'Reflect', bonusKey: 'reflectPercent', min: 0.08, max: 2, decimals: 2 },
    { kind: 'Life Steal', bonusKey: 'lifeStealPercent', min: 0.08, max: 2, decimals: 2 },
    { kind: 'Increase Damage', bonusKey: 'damagePercent', min: 0.75, max: 1.5, decimals: 2 },
] as const;

export const namedForgeUniformPercent = (min: number, max: number) => 100 / (max - min + 1);

/** Personal forged gear retains its server-minted identity across old and new UUID shapes. */
export const FORGED_ITEM_ID = /^named-(weapon|armor)-[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** True for a server-forged Named Weapon id (not named armor, not a built-in). */
export function isForgedNamedWeaponId(id: unknown): boolean {
    const s = String(id ?? '');
    return /^named-weapon-/i.test(s) && FORGED_ITEM_ID.test(s);
}
