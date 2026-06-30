"use strict";
/*
 * Village War Map economy — pure, IO-free constants + helpers (Phase 0).
 *
 * The single source of truth for the War-Resources (WR) economy numbers and the
 * pure math the daily pass (api/cron) and the lazy tax (api/game-state) will
 * call once the feature is wired. Behind `villageWarMap.v1` / `villageTax.v1` —
 * NOTHING imports this yet, so adding it changes no behavior.
 *
 * All values are v1 first-pass tunings (telemetry-tunable). Keep this file the
 * ONLY place the numbers live; a client display mirror must stay in sync.
 * Design: docs/village-war-map-economy-plan.md §6.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MERC_BAND_MAX = exports.MAX_HOME_SECTORS = exports.TAX_MIN_RANK_LEVEL = exports.TAX_BURN_SHARE = exports.TAX_CATCHUP_DAYS_MAX = exports.TAX_DAILY_CAP_RYO = exports.TAX_EXEMPTION_RYO = exports.WR_POOL_CAP = exports.WR_MERC_TIERS = exports.SECTOR_WAR_WR = exports.DECLARE_WAR_WR = exports.VILLAGE_STRUCTURE_COUNT = exports.VILLAGE_STRUCTURE_MAX_LEVEL = exports.MAINT_EXPONENT = exports.MAINT_BASE = exports.SEALS_PER_SECTOR_PER_DAY = exports.WR_PER_SECTOR_PER_DAY = void 0;
exports.sectorBenefitWr = sectorBenefitWr;
exports.sectorBenefitSeals = sectorBenefitSeals;
exports.structureMaintenanceWr = structureMaintenanceWr;
exports.totalMaintenanceWr = totalMaintenanceWr;
exports.taxRateForSectors = taxRateForSectors;
exports.comebackCostMultiplier = comebackCostMultiplier;
exports.discountedWrCost = discountedWrCost;
exports.computeTax = computeTax;
exports.wrMercTierById = wrMercTierById;
exports.mercBandSize = mercBandSize;
// ── Sector benefits (per controlled sector, per day → village pool) ── §6.1
exports.WR_PER_SECTOR_PER_DAY = 25;
exports.SEALS_PER_SECTOR_PER_DAY = 1;
// ── Structure maintenance (per village structure, per day, in WR) ── §6.2
exports.MAINT_BASE = 2;
exports.MAINT_EXPONENT = 1.25;
exports.VILLAGE_STRUCTURE_MAX_LEVEL = 10;
exports.VILLAGE_STRUCTURE_COUNT = 6;
// ── War / sector-war / mercenary costs (War Resources) ── §6.3
exports.DECLARE_WAR_WR = 800;
exports.SECTOR_WAR_WR = 250;
// Same 5 tiers as the live merc table, re-priced onto WR. §6.3 / §17.5.
exports.WR_MERC_TIERS = [
    { id: 'merc-ronin', level: 75, costWr: 60 },
    { id: 'merc-reaver', level: 80, costWr: 110 },
    { id: 'merc-shadow', level: 85, costWr: 170 },
    { id: 'merc-oni', level: 95, costWr: 280 },
    { id: 'merc-warlord', level: 100, costWr: 420 },
];
// ── WR pool storage cap (bounds passive hoarding at peace) ── §16c
exports.WR_POOL_CAP = 5_000;
// ── Tax (daily, on personal ryo = wallet + bank) ── §6.4
exports.TAX_EXEMPTION_RYO = 5_000;
exports.TAX_DAILY_CAP_RYO = 250_000;
exports.TAX_CATCHUP_DAYS_MAX = 3;
exports.TAX_BURN_SHARE = 0.5; // 50% burned, 50% to the village treasury
exports.TAX_MIN_RANK_LEVEL = 15; // Academy Students (level < 15) are exempt
// Home sectors per village (the tax-tier / income ceiling). 0..8.
exports.MAX_HOME_SECTORS = 8;
function clampNonNegInt(n) {
    return Math.max(0, Math.floor(Number(n) || 0));
}
/** WR a village accrues per day for the sectors it currently holds. Uncapped on
 *  input: a conqueror occupying enemy land scales past the 8-home figure. */
function sectorBenefitWr(sectorsHeld) {
    return clampNonNegInt(sectorsHeld) * exports.WR_PER_SECTOR_PER_DAY;
}
/** Honor Seals a village accrues per day (→ existing treasury seal pool). */
function sectorBenefitSeals(sectorsHeld) {
    return clampNonNegInt(sectorsHeld) * exports.SEALS_PER_SECTOR_PER_DAY;
}
/** Daily WR upkeep of a single village structure at `level` (0..MAX). */
function structureMaintenanceWr(level) {
    const lvl = Math.max(0, Math.min(exports.VILLAGE_STRUCTURE_MAX_LEVEL, Math.floor(Number(level) || 0)));
    if (lvl <= 0)
        return 0;
    return Math.round(exports.MAINT_BASE * Math.pow(lvl, exports.MAINT_EXPONENT));
}
/** Total daily WR upkeep across a set of structure levels. */
function totalMaintenanceWr(levels) {
    let sum = 0;
    for (const lvl of levels)
        sum += structureMaintenanceWr(lvl);
    return sum;
}
/** Tax rate (fraction, e.g. 0.015 = 1.5%) for a village holding `sectors`
 *  sectors. Tiers from §6.4, anchored to the 0..8 range; a conqueror holding
 *  >8 stays at the 0% reward (the tier never goes negative). */
function taxRateForSectors(sectors) {
    const s = clampNonNegInt(sectors);
    if (s >= 8)
        return 0;
    if (s >= 6)
        return 0.01;
    if (s >= 4)
        return 0.02;
    if (s >= 2)
        return 0.035;
    return 0.05; // 0..1 sectors — conquered, the heaviest tier
}
/** Rock-bottom comeback multiplier on a sector-war / mercenary WR cost, by how
 *  many sectors the SPENDING village currently holds: 0 → free, 1 → 75% off,
 *  ≥2 → full price. §6.3 / §4. */
function comebackCostMultiplier(sectorsHeld) {
    const s = clampNonNegInt(sectorsHeld);
    if (s <= 0)
        return 0; // free
    if (s === 1)
        return 0.25; // 75% off
    return 1; // full price
}
/** A WR cost after the comeback discount (rounded, floored at 0). */
function discountedWrCost(baseCost, sectorsHeld) {
    const base = Math.max(0, Math.floor(Number(baseCost) || 0));
    return Math.round(base * comebackCostMultiplier(sectorsHeld));
}
const ZERO_TAX = { taxable: 0, rate: 0, owed: 0, toBurn: 0, toTreasury: 0, days: 0 };
/** Pure tax math (§6.4 / §8.2). `level` gates the Academy exemption (< 15 = no
 *  tax). `daysOwed` is UTC days since lastTaxDate, capped to TAX_CATCHUP_DAYS_MAX.
 *  Base = (ryo + bankRyo) − exemption. Per-day owed = min(rate·base, dailyCap);
 *  total owed = perDay · days, split burn/treasury. Returns all-zero for Academy
 *  Students, a zero tier (full-8 village), or a non-positive base. */
function computeTax(args) {
    const level = Math.floor(Number(args.level) || 0);
    if (level < exports.TAX_MIN_RANK_LEVEL)
        return ZERO_TAX; // Academy exempt
    const days = Math.max(0, Math.min(exports.TAX_CATCHUP_DAYS_MAX, Math.floor(Number(args.daysOwed) || 0)));
    if (days <= 0)
        return ZERO_TAX;
    const rate = taxRateForSectors(args.sectors);
    if (rate <= 0)
        return { ...ZERO_TAX, rate, days }; // full-control reward: 0%
    const wealth = clampNonNegInt(args.ryo) + clampNonNegInt(args.bankRyo);
    const taxable = Math.max(0, wealth - exports.TAX_EXEMPTION_RYO);
    if (taxable <= 0)
        return { ...ZERO_TAX, rate, days };
    const perDay = Math.min(Math.floor(taxable * rate), exports.TAX_DAILY_CAP_RYO);
    const owed = perDay * days;
    const toBurn = Math.round(owed * exports.TAX_BURN_SHARE);
    const toTreasury = owed - toBurn;
    return { taxable, rate, owed, toBurn, toTreasury, days };
}
/** Find a WR mercenary tier by id (null if unknown). */
function wrMercTierById(id) {
    return exports.WR_MERC_TIERS.find((t) => t.id === id) ?? null;
}
// ── Mercenary band size (§17.5: a hire fields 3-5 AI mercs) ──
// How many AI mercs one hire deploys, escalating 3→5 with tier. Tunable.
exports.MERC_BAND_MAX = 5;
const MERC_BAND_SIZES = {
    'merc-ronin': 3, 'merc-reaver': 3, 'merc-shadow': 4, 'merc-oni': 4, 'merc-warlord': 5,
};
/** Band size for a merc tier (0 for an unknown tier — the caller rejects). */
function mercBandSize(tierId) {
    return MERC_BAND_SIZES[tierId] ?? 0;
}
