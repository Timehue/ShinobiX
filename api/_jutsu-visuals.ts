export const JUTSU_VISUAL_EFFECT_KEYS = [
    'fire60', 'wind60', 'water60', 'lightning60', 'earth60',
    'fire', 'water', 'wind', 'lightning', 'earth',
    'blood', 'shadow', 'poison', 'magma', 'metal',
    'slash', 'impact', 'pierce', 'throwable', 'weapon', 'namedWeapon', 'heavy',
    'heal', 'shield', 'reflect', 'absorb', 'spark', 'seal', 'cleanse', 'buff', 'debuff', 'drain',
    'wound', 'burn', 'poisonCloud', 'ko',
] as const;

export type JutsuVisualEffect = (typeof JUTSU_VISUAL_EFFECT_KEYS)[number];

const VALID_JUTSU_VISUAL_EFFECTS = new Set<string>(JUTSU_VISUAL_EFFECT_KEYS);

/** Server-side allowlist for the cosmetic Bloodline Builder choice. The field
 * is valid only on offensive 60 AP jutsu; everything else resolves automatically. */
export function sanitizeJutsuVisualEffect(value: unknown, ap: unknown, target: unknown): JutsuVisualEffect | undefined {
    if (Number(ap) !== 60 || target === 'SELF' || typeof value !== 'string' || !VALID_JUTSU_VISUAL_EFFECTS.has(value)) return undefined;
    return value as JutsuVisualEffect;
}
