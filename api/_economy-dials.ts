/*
 * Economy tuning dials (2026-10 rebalance). Each dial is a server env var with
 * a code default, so a live economy lever can be turned on Railway without a
 * rebuild, the same way STAT_GAIN_MULTIPLIER already works (api/_stat-growth.ts).
 *
 * Fail-safe: a missing, non-numeric or out-of-range value falls back to the
 * code default, so a typo can never zero or explode a payout. Dials live next
 * to the payout they turn; this module only reads and clamps them.
 */

export interface EconomyDialRange {
    min: number;
    max: number;
}

/** Read a numeric economy dial: env value inside [min, max], else the default. */
export function economyDial(name: string, fallback: number, range: EconomyDialRange): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < range.min || value > range.max) return fallback;
    return value;
}

/** Read an on/off economy dial: '1'/'true'/'on' and '0'/'false'/'off', else the default. */
export function economySwitch(name: string, fallback: boolean): boolean {
    const raw = process.env[name]?.trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'off') return false;
    return fallback;
}
