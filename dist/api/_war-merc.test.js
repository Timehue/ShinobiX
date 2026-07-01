"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _war_merc_js_1 = require("./_war-merc.js");
const _war_state_js_1 = require("./_war-state.js");
const _war_economy_js_1 = require("./_war-economy.js");
(0, node_test_1.test)('mercHireCost applies the comeback discount to the tier base', () => {
    const rec = (0, _war_state_js_1.normalizeVillageWarRecord)('Stormveil Village'); // all structures L0 → Barracks mult 1
    strict_1.default.equal((0, _war_merc_js_1.mercHireCost)('merc-ronin', 8, rec), 60); // >=2 sectors → full price
    strict_1.default.equal((0, _war_merc_js_1.mercHireCost)('merc-ronin', 1, rec), 15); // 1 sector → 75% off (60 × 0.25)
    strict_1.default.equal((0, _war_merc_js_1.mercHireCost)('merc-ronin', 0, rec), 0); // 0 sectors → free
    strict_1.default.equal((0, _war_merc_js_1.mercHireCost)('merc-warlord', 8, rec), 420);
    strict_1.default.equal((0, _war_merc_js_1.mercHireCost)('merc-nope', 8, rec), 0); // unknown tier → 0 (caller rejects)
});
(0, node_test_1.test)('mercHireCost: Barracks levels reduce the cost', () => {
    const base = (0, _war_state_js_1.normalizeVillageWarRecord)('Stormveil Village');
    const withBarracks = (0, _war_state_js_1.normalizeVillageWarRecord)('Stormveil Village');
    withBarracks.structures.barracks = 10; // max Barracks
    const full = (0, _war_merc_js_1.mercHireCost)('merc-warlord', 8, base);
    const discounted = (0, _war_merc_js_1.mercHireCost)('merc-warlord', 8, withBarracks);
    strict_1.default.ok(discounted < full, `Barracks should cut the cost: ${discounted} < ${full}`);
    strict_1.default.ok(discounted > 0, 'a max-Barracks discount is bounded, not free');
});
(0, node_test_1.test)('mercBandSize escalates 3->5 with tier, 0 for unknown', () => {
    strict_1.default.equal((0, _war_economy_js_1.mercBandSize)('merc-ronin'), 3);
    strict_1.default.equal((0, _war_economy_js_1.mercBandSize)('merc-warlord'), 5);
    strict_1.default.equal((0, _war_economy_js_1.mercBandSize)('merc-nope'), 0);
});
(0, node_test_1.test)('addOrRefreshLease keeps one active lease per (tier, player), restarting the clock', () => {
    const now = 1_000_000;
    let leases = (0, _war_merc_js_1.addOrRefreshLease)([], 'merc-ronin', 'akira', now);
    strict_1.default.equal(leases.length, 1);
    strict_1.default.equal(leases[0].expiresAt, now + _war_merc_js_1.MERC_LEASE_MS);
    strict_1.default.equal(leases[0].count, (0, _war_economy_js_1.mercBandSize)('merc-ronin')); // a 3-merc band
    // Re-hire the SAME tier → still one lease, the 2-day clock restarted.
    leases = (0, _war_merc_js_1.addOrRefreshLease)(leases, 'merc-ronin', 'akira', now + 5_000);
    strict_1.default.equal(leases.length, 1);
    strict_1.default.equal(leases[0].expiresAt, now + 5_000 + _war_merc_js_1.MERC_LEASE_MS);
    // A different tier → a second, independent lease.
    leases = (0, _war_merc_js_1.addOrRefreshLease)(leases, 'merc-oni', 'akira', now);
    strict_1.default.equal(leases.length, 2);
});
(0, node_test_1.test)('hasActiveLease respects expiry + player, consumeLease removes it', () => {
    const now = 1_000_000;
    const rec = (0, _war_state_js_1.normalizeVillageWarRecord)('Stormveil Village');
    rec.mercLeases = (0, _war_merc_js_1.addOrRefreshLease)([], 'merc-shadow', 'rin', now);
    strict_1.default.equal((0, _war_merc_js_1.hasActiveLease)(rec, 'merc-shadow', 'rin', now), true);
    strict_1.default.equal((0, _war_merc_js_1.hasActiveLease)(rec, 'merc-shadow', 'rin', now + _war_merc_js_1.MERC_LEASE_MS + 1), false); // expired
    strict_1.default.equal((0, _war_merc_js_1.hasActiveLease)(rec, 'merc-shadow', 'other', now), false); // wrong player
    strict_1.default.equal((0, _war_merc_js_1.hasActiveLease)(rec, 'merc-ronin', 'rin', now), false); // wrong tier
    const after = (0, _war_merc_js_1.consumeLease)(rec.mercLeases, 'merc-shadow', 'rin');
    strict_1.default.equal(after.length, 0);
});
(0, node_test_1.test)('claimMercFromBand spends one merc per deployment, dropping the lease at 0', () => {
    const now = 1_000_000;
    const leases = (0, _war_merc_js_1.addOrRefreshLease)([], 'merc-ronin', 'akira', now); // band of 3
    const c1 = (0, _war_merc_js_1.claimMercFromBand)(leases, 'merc-ronin', 'akira', now);
    strict_1.default.equal(c1.claimed, true);
    strict_1.default.equal(c1.remaining, 2);
    const c2 = (0, _war_merc_js_1.claimMercFromBand)(c1.leases, 'merc-ronin', 'akira', now);
    const c3 = (0, _war_merc_js_1.claimMercFromBand)(c2.leases, 'merc-ronin', 'akira', now);
    strict_1.default.equal(c3.remaining, 0);
    strict_1.default.equal(c3.leases.length, 0, 'lease is dropped once the band is spent');
    const c4 = (0, _war_merc_js_1.claimMercFromBand)(c3.leases, 'merc-ronin', 'akira', now);
    strict_1.default.equal(c4.claimed, false); // nothing left to deploy
    // An EXPIRED band can't be deployed.
    const exp = (0, _war_merc_js_1.claimMercFromBand)((0, _war_merc_js_1.addOrRefreshLease)([], 'merc-oni', 'b', now), 'merc-oni', 'b', now + _war_merc_js_1.MERC_LEASE_MS + 1);
    strict_1.default.equal(exp.claimed, false);
});
