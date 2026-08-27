import { HP_CAP } from '../_xp-engine.js';

export const PVP_LOW_LEVEL_HP_MAX_BONUS = 0.50;
export const PVP_LOW_LEVEL_HP_FULL_BONUS_THROUGH = 10;
export const PVP_LOW_LEVEL_HP_FADE_END = 25;

/**
 * PvP-only durability correction for low-level human fighters.
 *
 * Levels 1-10 receive the full 50% bonus. The bonus then fades linearly to
 * zero at level 25 so gaining a level can never remove a bracket-wide bonus.
 * Invalid/missing levels fail closed to no bonus; authoritative human saves
 * normally always carry a valid level.
 */
export function humanPvpHpMultiplier(level: unknown): number {
    const numeric = typeof level === 'number' ? level : Number.NaN;
    if (!Number.isFinite(numeric)) return 1;
    const safeLevel = Math.max(1, Math.floor(numeric));
    const fade = Math.max(0, Math.min(
        1,
        (PVP_LOW_LEVEL_HP_FADE_END - safeLevel)
            / (PVP_LOW_LEVEL_HP_FADE_END - PVP_LOW_LEVEL_HP_FULL_BONUS_THROUGH),
    ));
    return 1 + PVP_LOW_LEVEL_HP_MAX_BONUS * fade;
}

export type PvpSessionHpInput = {
    level: unknown;
    currentHp: unknown;
    maxHp: unknown;
    useCurrentVitals: boolean;
    humanPvp: boolean;
};

/**
 * Project canonical character HP into an ephemeral PvP fighter health bar.
 * The caller keeps the saved character object unchanged. Continuous-vitals
 * fights retain the same current/max ratio instead of receiving a free heal.
 */
export function pvpSessionHp(input: PvpSessionHpInput): { hp: number; maxHp: number } {
    const numericMax = Number(input.maxHp);
    const baseMaxHp = Math.max(1, Math.min(
        HP_CAP,
        Number.isFinite(numericMax) ? Math.floor(numericMax) : 1,
    ));
    const numericCurrent = Number(input.currentHp);
    const baseCurrentHp = Math.max(0, Math.min(
        baseMaxHp,
        Number.isFinite(numericCurrent) ? Math.floor(numericCurrent) : baseMaxHp,
    ));

    if (!input.humanPvp) {
        return {
            hp: input.useCurrentVitals ? baseCurrentHp : baseMaxHp,
            maxHp: baseMaxHp,
        };
    }

    const scaledMaxHp = Math.max(1, Math.min(
        HP_CAP,
        Math.floor(baseMaxHp * humanPvpHpMultiplier(input.level)),
    ));
    if (!input.useCurrentVitals) return { hp: scaledMaxHp, maxHp: scaledMaxHp };

    const scaledCurrentHp = Math.max(0, Math.min(
        scaledMaxHp,
        Math.round(scaledMaxHp * (baseCurrentHp / baseMaxHp)),
    ));
    return { hp: scaledCurrentHp, maxHp: scaledMaxHp };
}
