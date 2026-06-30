"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _war_economy_js_1 = require("./_war-economy.js");
(0, node_test_1.describe)('war-economy: sector benefits', () => {
    (0, node_test_1.it)('WR scales 25/sector and is uncapped (conquest pays)', () => {
        node_assert_1.strict.equal((0, _war_economy_js_1.sectorBenefitWr)(0), 0);
        node_assert_1.strict.equal((0, _war_economy_js_1.sectorBenefitWr)(4), 100);
        node_assert_1.strict.equal((0, _war_economy_js_1.sectorBenefitWr)(8), 200);
        node_assert_1.strict.equal((0, _war_economy_js_1.sectorBenefitWr)(12), 300); // 8 own + 4 occupied
    });
    (0, node_test_1.it)('seals scale 1/sector', () => {
        node_assert_1.strict.equal((0, _war_economy_js_1.sectorBenefitSeals)(8), 8);
        node_assert_1.strict.equal((0, _war_economy_js_1.sectorBenefitSeals)(0), 0);
    });
    (0, node_test_1.it)('clamps negative / fractional sector counts', () => {
        node_assert_1.strict.equal((0, _war_economy_js_1.sectorBenefitWr)(-3), 0);
        node_assert_1.strict.equal((0, _war_economy_js_1.sectorBenefitWr)(3.9), 75);
    });
});
(0, node_test_1.describe)('war-economy: structure maintenance', () => {
    (0, node_test_1.it)('matches the §6.2 curve round(2·lvl^1.25)', () => {
        node_assert_1.strict.equal((0, _war_economy_js_1.structureMaintenanceWr)(0), 0);
        node_assert_1.strict.equal((0, _war_economy_js_1.structureMaintenanceWr)(1), 2);
        node_assert_1.strict.equal((0, _war_economy_js_1.structureMaintenanceWr)(3), 8);
        node_assert_1.strict.equal((0, _war_economy_js_1.structureMaintenanceWr)(4), 11);
        node_assert_1.strict.equal((0, _war_economy_js_1.structureMaintenanceWr)(5), 15);
        node_assert_1.strict.equal((0, _war_economy_js_1.structureMaintenanceWr)(8), 27);
        node_assert_1.strict.equal((0, _war_economy_js_1.structureMaintenanceWr)(10), 36);
    });
    (0, node_test_1.it)('clamps above the max level', () => {
        node_assert_1.strict.equal((0, _war_economy_js_1.structureMaintenanceWr)(999), (0, _war_economy_js_1.structureMaintenanceWr)(_war_economy_js_1.VILLAGE_STRUCTURE_MAX_LEVEL));
    });
    (0, node_test_1.it)('totals across 6 structures: full-L10 (216) just exceeds full-8 income (200)', () => {
        node_assert_1.strict.equal((0, _war_economy_js_1.totalMaintenanceWr)([5, 5, 5, 5, 5, 5]), 90);
        node_assert_1.strict.equal((0, _war_economy_js_1.totalMaintenanceWr)([8, 8, 8, 8, 8, 8]), 162);
        node_assert_1.strict.equal((0, _war_economy_js_1.totalMaintenanceWr)([10, 10, 10, 10, 10, 10]), 216);
    });
});
(0, node_test_1.describe)('war-economy: tax tiers', () => {
    (0, node_test_1.it)('anchors to the 0..8 range per §6.4', () => {
        node_assert_1.strict.equal((0, _war_economy_js_1.taxRateForSectors)(8), 0);
        node_assert_1.strict.equal((0, _war_economy_js_1.taxRateForSectors)(7), 0.01);
        node_assert_1.strict.equal((0, _war_economy_js_1.taxRateForSectors)(6), 0.01);
        node_assert_1.strict.equal((0, _war_economy_js_1.taxRateForSectors)(5), 0.02);
        node_assert_1.strict.equal((0, _war_economy_js_1.taxRateForSectors)(4), 0.02);
        node_assert_1.strict.equal((0, _war_economy_js_1.taxRateForSectors)(3), 0.035);
        node_assert_1.strict.equal((0, _war_economy_js_1.taxRateForSectors)(2), 0.035);
        node_assert_1.strict.equal((0, _war_economy_js_1.taxRateForSectors)(1), 0.05);
        node_assert_1.strict.equal((0, _war_economy_js_1.taxRateForSectors)(0), 0.05);
    });
    (0, node_test_1.it)('a conqueror holding >8 stays at the 0% reward', () => {
        node_assert_1.strict.equal((0, _war_economy_js_1.taxRateForSectors)(12), 0);
    });
});
(0, node_test_1.describe)('war-economy: comeback discount', () => {
    (0, node_test_1.it)('0 → free, 1 → 75% off, ≥2 → full price', () => {
        node_assert_1.strict.equal((0, _war_economy_js_1.comebackCostMultiplier)(0), 0);
        node_assert_1.strict.equal((0, _war_economy_js_1.comebackCostMultiplier)(1), 0.25);
        node_assert_1.strict.equal((0, _war_economy_js_1.comebackCostMultiplier)(2), 1);
        node_assert_1.strict.equal((0, _war_economy_js_1.comebackCostMultiplier)(8), 1);
    });
    (0, node_test_1.it)('applies to a sector-war/merc WR cost', () => {
        node_assert_1.strict.equal((0, _war_economy_js_1.discountedWrCost)(250, 0), 0); // free
        node_assert_1.strict.equal((0, _war_economy_js_1.discountedWrCost)(250, 1), 63); // 75% off (round)
        node_assert_1.strict.equal((0, _war_economy_js_1.discountedWrCost)(250, 2), 250); // full
        node_assert_1.strict.equal((0, _war_economy_js_1.discountedWrCost)(60, 1), 15); // tier-1 merc at 1 sector
    });
});
(0, node_test_1.describe)('war-economy: computeTax', () => {
    (0, node_test_1.it)('Academy Students (level < 15) pay nothing', () => {
        const t = (0, _war_economy_js_1.computeTax)({ ryo: 10_000_000, bankRyo: 0, sectors: 0, level: 14, daysOwed: 3 });
        node_assert_1.strict.equal(t.owed, 0);
    });
    (0, node_test_1.it)('a full-8 village (0% tier) taxes nobody', () => {
        const t = (0, _war_economy_js_1.computeTax)({ ryo: 1_000_000, bankRyo: 1_000_000, sectors: 8, level: 80, daysOwed: 1 });
        node_assert_1.strict.equal(t.owed, 0);
        node_assert_1.strict.equal(t.rate, 0);
    });
    (0, node_test_1.it)('taxes wallet + bank, after the exemption, at the tier rate', () => {
        // 6 sectors → 1%; base = (600k + 0) − 5k = 595k → 5,950/day · 1 day.
        const t = (0, _war_economy_js_1.computeTax)({ ryo: 600_000, bankRyo: 0, sectors: 6, level: 50, daysOwed: 1 });
        node_assert_1.strict.equal(t.rate, 0.01);
        node_assert_1.strict.equal(t.taxable, 600_000 - _war_economy_js_1.TAX_EXEMPTION_RYO);
        node_assert_1.strict.equal(t.owed, Math.floor(595_000 * 0.01));
        node_assert_1.strict.equal(t.toBurn + t.toTreasury, t.owed);
        node_assert_1.strict.equal(t.toBurn, Math.round(t.owed * 0.5));
    });
    (0, node_test_1.it)('banking is not a shelter — bank ryo is in the base', () => {
        const wallet = (0, _war_economy_js_1.computeTax)({ ryo: 600_000, bankRyo: 0, sectors: 6, level: 50, daysOwed: 1 });
        const banked = (0, _war_economy_js_1.computeTax)({ ryo: 0, bankRyo: 600_000, sectors: 6, level: 50, daysOwed: 1 });
        node_assert_1.strict.equal(wallet.owed, banked.owed);
    });
    (0, node_test_1.it)('the per-day cap bounds a whale, multiplied by catch-up days', () => {
        // 50M at 5% = 2.5M/day, capped to 250k/day; 3 days catch-up → 750k.
        const t = (0, _war_economy_js_1.computeTax)({ ryo: 50_000_000, bankRyo: 0, sectors: 0, level: 100, daysOwed: 9 });
        node_assert_1.strict.equal(t.days, 3); // catch-up capped to 3
        node_assert_1.strict.equal(t.owed, _war_economy_js_1.TAX_DAILY_CAP_RYO * 3);
    });
    (0, node_test_1.it)('a near-broke Genin (under the exemption) pays nothing', () => {
        const t = (0, _war_economy_js_1.computeTax)({ ryo: 3_000, bankRyo: 1_000, sectors: 0, level: 20, daysOwed: 1 });
        node_assert_1.strict.equal(t.owed, 0);
    });
    (0, node_test_1.it)('zero days owed → zero', () => {
        node_assert_1.strict.equal((0, _war_economy_js_1.computeTax)({ ryo: 1_000_000, bankRyo: 0, sectors: 0, level: 80, daysOwed: 0 }).owed, 0);
    });
});
(0, node_test_1.describe)('war-economy: merc tiers', () => {
    (0, node_test_1.it)('has the 5 sealed tiers with WR prices', () => {
        node_assert_1.strict.equal(_war_economy_js_1.WR_MERC_TIERS.length, 5);
        node_assert_1.strict.equal((0, _war_economy_js_1.wrMercTierById)('merc-warlord')?.costWr, 420);
        node_assert_1.strict.equal((0, _war_economy_js_1.wrMercTierById)('merc-ronin')?.level, 75);
        node_assert_1.strict.equal((0, _war_economy_js_1.wrMercTierById)('nope'), null);
    });
});
