/** Roll bounds shared by the server and odds display. All bounds are inclusive. */
export const NAMED_WEAPON_EP_MIN = 24;
export const NAMED_WEAPON_EP_MAX = 27;
export const NAMED_WEAPON_RANGES = [3, 4, 5] as const;
export const NAMED_WEAPON_OFFENSE = { min: 168, max: 180 } as const;
export const NAMED_WEAPON_TAG_COUNTS = [1, 2] as const;
export const NAMED_WEAPON_TAG_STRENGTH = { single: { min: 35, max: 40 }, dual: { min: 15, max: 20 } } as const;
export const NAMED_WEAPON_TAGS = ['Siphon', 'Absorb', 'Poison', 'Wound', 'Reflect', 'Shield', 'Drain', 'Ignition', 'Heal', 'Increase Damage Given', 'Increase Generals', 'Decrease Damage Taken'] as const;
// Half draw one tag, half draw two, without replacement: (1 + 2) / 2 / 12.
export const NAMED_WEAPON_TAG_APPEARANCE_PERCENT = 100 * (NAMED_WEAPON_TAG_COUNTS.reduce((sum, count) => sum + count, 0) / NAMED_WEAPON_TAG_COUNTS.length) / NAMED_WEAPON_TAGS.length;
export const NAMED_ARMOR_STATS = { min: 25, max: 35 } as const;
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
