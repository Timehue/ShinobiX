/*
 * Village War Map economy — pure, IO-free constants + helpers (Phase 0).
 *
 * The single source of truth for the War-Resources (WR) economy numbers and the
 * pure math used by the daily pass and lazy tax application paths. Feature
 * gates still control whether the Village War Map systems run.
 *
 * All values are v1 first-pass tunings (telemetry-tunable). Keep this file the
 * ONLY place the numbers live; a client display mirror must stay in sync.
 * Design: docs/village-war-map-economy-plan.md §6.
 */

// ── Sector benefits (per controlled sector, per day → village pool) ── §6.1
export const WR_PER_SECTOR_PER_DAY = 25;
export const SEALS_PER_SECTOR_PER_DAY = 1;

// ── Structure maintenance (per village structure, per day, in WR) ── §6.2
export const MAINT_BASE = 2;
export const MAINT_EXPONENT = 1.25;
export const VILLAGE_STRUCTURE_MAX_LEVEL = 10;
export const VILLAGE_STRUCTURE_COUNT = 6;

// ── War / sector-war / mercenary costs (War Resources) ── §6.3
export const DECLARE_WAR_WR = 800;
export const SECTOR_WAR_WR = 250;

export interface WrMercTier {
    /** stable id — same ids as the existing Honor-Seal table (api/village/_mercenaries.ts) */
    id: string;
    level: number;
    /** War Resources to hire, at full price (before the comeback discount) */
    costWr: number;
}
// Same 5 tiers as the live merc table, re-priced onto WR. §6.3 / §17.5.
export const WR_MERC_TIERS: readonly WrMercTier[] = [
    { id: 'merc-ronin', level: 75, costWr: 60 },
    { id: 'merc-reaver', level: 80, costWr: 110 },
    { id: 'merc-shadow', level: 85, costWr: 170 },
    { id: 'merc-oni', level: 95, costWr: 280 },
    { id: 'merc-warlord', level: 100, costWr: 420 },
];

// ── WR pool storage cap (bounds passive hoarding at peace) ── §16c
export const WR_POOL_CAP = 5_000;

// ── Tax (daily, on personal ryo = wallet + bank) ── §6.4
export const TAX_EXEMPTION_RYO = 5_000;
export const TAX_DAILY_CAP_RYO = 250_000;
export const TAX_CATCHUP_DAYS_MAX = 3;
export const TAX_BURN_SHARE = 0.5;        // 50% burned, 50% to the village treasury
export const TAX_MIN_RANK_LEVEL = 15;     // Academy Students (level < 15) are exempt

// Home sectors per village (the tax-tier / income ceiling). 0..8.
export const MAX_HOME_SECTORS = 8;

function clampNonNegInt(n: number): number {
    return Math.max(0, Math.floor(Number(n) || 0));
}

/** WR a village accrues per day for the sectors it currently holds. Uncapped on
 *  input: a conqueror occupying enemy land scales past the 8-home figure. */
export function sectorBenefitWr(sectorsHeld: number): number {
    return clampNonNegInt(sectorsHeld) * WR_PER_SECTOR_PER_DAY;
}
/** Honor Seals a village accrues per day (→ existing treasury seal pool). */
export function sectorBenefitSeals(sectorsHeld: number): number {
    return clampNonNegInt(sectorsHeld) * SEALS_PER_SECTOR_PER_DAY;
}

/** Daily WR upkeep of a single village structure at `level` (0..MAX). */
export function structureMaintenanceWr(level: number): number {
    const lvl = Math.max(0, Math.min(VILLAGE_STRUCTURE_MAX_LEVEL, Math.floor(Number(level) || 0)));
    if (lvl <= 0) return 0;
    return Math.round(MAINT_BASE * Math.pow(lvl, MAINT_EXPONENT));
}
/** Total daily WR upkeep across a set of structure levels. */
export function totalMaintenanceWr(levels: Iterable<number>): number {
    let sum = 0;
    for (const lvl of levels) sum += structureMaintenanceWr(lvl);
    return sum;
}

/** Daily occupation-tax rate. Losing home territory never taxes the losing
 *  village; the levy begins only above the original eight home sectors. */
export function taxRateForSectors(sectors: number): number {
    const s = clampNonNegInt(sectors);
    if (s <= MAX_HOME_SECTORS) return 0;
    if (s <= 10) return 0.01;
    if (s <= 12) return 0.015;
    return 0.02;
}

/** Comeback multiplier on sector-war / mercenary WR cost. The discount fades
 *  through four held sectors instead of disappearing immediately after one. */
export function comebackCostMultiplier(sectorsHeld: number): number {
    const s = clampNonNegInt(sectorsHeld);
    if (s <= 0) return 0;       // free
    if (s === 1) return 0.25;   // 75% off
    if (s === 2) return 0.5;    // 50% off
    if (s === 3) return 0.75;   // 25% off
    return 1;                   // full price at four or more
}
/** A WR cost after the comeback discount (rounded, floored at 0). */
export function discountedWrCost(baseCost: number, sectorsHeld: number): number {
    const base = Math.max(0, Math.floor(Number(baseCost) || 0));
    return Math.round(base * comebackCostMultiplier(sectorsHeld));
}

export interface TaxComputation {
    taxable: number;     // wealth base after the exemption
    rate: number;        // tier fraction applied
    owed: number;        // total ryo debited from the player (capped)
    toBurn: number;      // share destroyed (anti-inflation sink)
    toTreasury: number;  // share credited to the village treasury
    days: number;        // catch-up days applied (0..MAX)
}

const ZERO_TAX: TaxComputation = { taxable: 0, rate: 0, owed: 0, toBurn: 0, toTreasury: 0, days: 0 };

/** Pure tax math (§6.4 / §8.2). `level` gates the Academy exemption (< 15 = no
 *  tax). `daysOwed` is UTC days since lastTaxDate, capped to TAX_CATCHUP_DAYS_MAX.
 *  Base = (ryo + bankRyo) − exemption. Per-day owed = min(rate·base, dailyCap);
 *  total owed = perDay · days, split burn/treasury. Returns all-zero for Academy
 *  Students, a zero tier (full-8 village), or a non-positive base. */
export function computeTax(args: {
    ryo: number; bankRyo: number; sectors: number; level: number; daysOwed: number;
    /** Treasury-Vault discount (api/_war-structures taxRateMultiplier). Defaults to
     *  1. Passing it here keeps the rate the player is CHARGED identical to the one
     *  the War Map displays, which reads the same multiplier. */
    rateMultiplier?: number;
}): TaxComputation {
    const level = Math.floor(Number(args.level) || 0);
    if (level < TAX_MIN_RANK_LEVEL) return ZERO_TAX;            // Academy exempt
    const days = Math.max(0, Math.min(TAX_CATCHUP_DAYS_MAX, Math.floor(Number(args.daysOwed) || 0)));
    if (days <= 0) return ZERO_TAX;
    const mult = Math.max(0, Number(args.rateMultiplier ?? 1) || 0);
    const rate = taxRateForSectors(args.sectors) * mult;
    if (rate <= 0) return { ...ZERO_TAX, rate, days };          // full-control reward: 0%
    const wealth = clampNonNegInt(args.ryo) + clampNonNegInt(args.bankRyo);
    const taxable = Math.max(0, wealth - TAX_EXEMPTION_RYO);
    if (taxable <= 0) return { ...ZERO_TAX, rate, days };
    // Avoid a binary-float undercharge at exact integer boundaries (for example,
    // 995,000 × 1% × 0.7 can be represented as 6,964.999999999999).
    const perDay = Math.min(Math.floor(taxable * rate + 1e-7), TAX_DAILY_CAP_RYO);
    const owed = perDay * days;
    const toBurn = Math.round(owed * TAX_BURN_SHARE);
    const toTreasury = owed - toBurn;
    return { taxable, rate, owed, toBurn, toTreasury, days };
}

/** Find a WR mercenary tier by id (null if unknown). */
export function wrMercTierById(id: string): WrMercTier | null {
    return WR_MERC_TIERS.find((t) => t.id === id) ?? null;
}

// ── Mercenary band size (§17.5: a hire fields 3-5 AI mercs) ──
// How many AI mercs one hire deploys, escalating 3→5 with tier. Tunable.
export const MERC_BAND_MAX = 5;
const MERC_BAND_SIZES: Record<string, number> = {
    'merc-ronin': 3, 'merc-reaver': 3, 'merc-shadow': 4, 'merc-oni': 4, 'merc-warlord': 5,
};
/** Band size for a merc tier (0 for an unknown tier — the caller rejects). */
export function mercBandSize(tierId: string): number {
    return MERC_BAND_SIZES[tierId] ?? 0;
}
