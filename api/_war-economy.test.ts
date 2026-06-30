import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    sectorBenefitWr,
    sectorBenefitSeals,
    structureMaintenanceWr,
    totalMaintenanceWr,
    taxRateForSectors,
    comebackCostMultiplier,
    discountedWrCost,
    computeTax,
    wrMercTierById,
    WR_MERC_TIERS,
    TAX_EXEMPTION_RYO,
    TAX_DAILY_CAP_RYO,
    VILLAGE_STRUCTURE_MAX_LEVEL,
} from './_war-economy.js';

describe('war-economy: sector benefits', () => {
    it('WR scales 25/sector and is uncapped (conquest pays)', () => {
        assert.equal(sectorBenefitWr(0), 0);
        assert.equal(sectorBenefitWr(4), 100);
        assert.equal(sectorBenefitWr(8), 200);
        assert.equal(sectorBenefitWr(12), 300); // 8 own + 4 occupied
    });
    it('seals scale 1/sector', () => {
        assert.equal(sectorBenefitSeals(8), 8);
        assert.equal(sectorBenefitSeals(0), 0);
    });
    it('clamps negative / fractional sector counts', () => {
        assert.equal(sectorBenefitWr(-3), 0);
        assert.equal(sectorBenefitWr(3.9), 75);
    });
});

describe('war-economy: structure maintenance', () => {
    it('matches the §6.2 curve round(2·lvl^1.25)', () => {
        assert.equal(structureMaintenanceWr(0), 0);
        assert.equal(structureMaintenanceWr(1), 2);
        assert.equal(structureMaintenanceWr(3), 8);
        assert.equal(structureMaintenanceWr(4), 11);
        assert.equal(structureMaintenanceWr(5), 15);
        assert.equal(structureMaintenanceWr(8), 27);
        assert.equal(structureMaintenanceWr(10), 36);
    });
    it('clamps above the max level', () => {
        assert.equal(structureMaintenanceWr(999), structureMaintenanceWr(VILLAGE_STRUCTURE_MAX_LEVEL));
    });
    it('totals across 6 structures: full-L10 (216) just exceeds full-8 income (200)', () => {
        assert.equal(totalMaintenanceWr([5, 5, 5, 5, 5, 5]), 90);
        assert.equal(totalMaintenanceWr([8, 8, 8, 8, 8, 8]), 162);
        assert.equal(totalMaintenanceWr([10, 10, 10, 10, 10, 10]), 216);
    });
});

describe('war-economy: tax tiers', () => {
    it('anchors to the 0..8 range per §6.4', () => {
        assert.equal(taxRateForSectors(8), 0);
        assert.equal(taxRateForSectors(7), 0.01);
        assert.equal(taxRateForSectors(6), 0.01);
        assert.equal(taxRateForSectors(5), 0.02);
        assert.equal(taxRateForSectors(4), 0.02);
        assert.equal(taxRateForSectors(3), 0.035);
        assert.equal(taxRateForSectors(2), 0.035);
        assert.equal(taxRateForSectors(1), 0.05);
        assert.equal(taxRateForSectors(0), 0.05);
    });
    it('a conqueror holding >8 stays at the 0% reward', () => {
        assert.equal(taxRateForSectors(12), 0);
    });
});

describe('war-economy: comeback discount', () => {
    it('0 → free, 1 → 75% off, ≥2 → full price', () => {
        assert.equal(comebackCostMultiplier(0), 0);
        assert.equal(comebackCostMultiplier(1), 0.25);
        assert.equal(comebackCostMultiplier(2), 1);
        assert.equal(comebackCostMultiplier(8), 1);
    });
    it('applies to a sector-war/merc WR cost', () => {
        assert.equal(discountedWrCost(250, 0), 0);    // free
        assert.equal(discountedWrCost(250, 1), 63);   // 75% off (round)
        assert.equal(discountedWrCost(250, 2), 250);  // full
        assert.equal(discountedWrCost(60, 1), 15);    // tier-1 merc at 1 sector
    });
});

describe('war-economy: computeTax', () => {
    it('Academy Students (level < 15) pay nothing', () => {
        const t = computeTax({ ryo: 10_000_000, bankRyo: 0, sectors: 0, level: 14, daysOwed: 3 });
        assert.equal(t.owed, 0);
    });
    it('a full-8 village (0% tier) taxes nobody', () => {
        const t = computeTax({ ryo: 1_000_000, bankRyo: 1_000_000, sectors: 8, level: 80, daysOwed: 1 });
        assert.equal(t.owed, 0);
        assert.equal(t.rate, 0);
    });
    it('taxes wallet + bank, after the exemption, at the tier rate', () => {
        // 6 sectors → 1%; base = (600k + 0) − 5k = 595k → 5,950/day · 1 day.
        const t = computeTax({ ryo: 600_000, bankRyo: 0, sectors: 6, level: 50, daysOwed: 1 });
        assert.equal(t.rate, 0.01);
        assert.equal(t.taxable, 600_000 - TAX_EXEMPTION_RYO);
        assert.equal(t.owed, Math.floor(595_000 * 0.01));
        assert.equal(t.toBurn + t.toTreasury, t.owed);
        assert.equal(t.toBurn, Math.round(t.owed * 0.5));
    });
    it('banking is not a shelter — bank ryo is in the base', () => {
        const wallet = computeTax({ ryo: 600_000, bankRyo: 0, sectors: 6, level: 50, daysOwed: 1 });
        const banked = computeTax({ ryo: 0, bankRyo: 600_000, sectors: 6, level: 50, daysOwed: 1 });
        assert.equal(wallet.owed, banked.owed);
    });
    it('the per-day cap bounds a whale, multiplied by catch-up days', () => {
        // 50M at 5% = 2.5M/day, capped to 250k/day; 3 days catch-up → 750k.
        const t = computeTax({ ryo: 50_000_000, bankRyo: 0, sectors: 0, level: 100, daysOwed: 9 });
        assert.equal(t.days, 3);                 // catch-up capped to 3
        assert.equal(t.owed, TAX_DAILY_CAP_RYO * 3);
    });
    it('a near-broke Genin (under the exemption) pays nothing', () => {
        const t = computeTax({ ryo: 3_000, bankRyo: 1_000, sectors: 0, level: 20, daysOwed: 1 });
        assert.equal(t.owed, 0);
    });
    it('zero days owed → zero', () => {
        assert.equal(computeTax({ ryo: 1_000_000, bankRyo: 0, sectors: 0, level: 80, daysOwed: 0 }).owed, 0);
    });
});

describe('war-economy: merc tiers', () => {
    it('has the 5 sealed tiers with WR prices', () => {
        assert.equal(WR_MERC_TIERS.length, 5);
        assert.equal(wrMercTierById('merc-warlord')?.costWr, 420);
        assert.equal(wrMercTierById('merc-ronin')?.level, 75);
        assert.equal(wrMercTierById('nope'), null);
    });
});
