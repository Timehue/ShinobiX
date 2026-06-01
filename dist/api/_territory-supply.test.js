"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _territory_supply_js_1 = require("./_territory-supply.js");
const DAY = _territory_supply_js_1.TERRITORY_SUPPLY_INTERVAL_MS;
const NOW = 1_000 * DAY; // a fixed "now" well past epoch so deltas are clean
(0, node_test_1.describe)('collectTerritorySupply', () => {
    (0, node_test_1.it)('collects stored supply plus whole-cycle accrual for an owned sector', () => {
        // 3 full days since lastSupplyAt, plus 250 already stored.
        const out = (0, _territory_supply_js_1.collectTerritorySupply)({ ownerClan: 'Storm', warSupply: 250, lastSupplyAt: NOW - 3 * DAY }, NOW);
        node_assert_1.strict.equal(out.collected, 250 + 3 * _territory_supply_js_1.TERRITORY_DAILY_WAR_SUPPLY); // 250 + 300
        node_assert_1.strict.equal(out.nextLastSupplyAt, NOW); // advanced by exactly 3 whole cycles
    });
    (0, node_test_1.it)('preserves the partial-period remainder when advancing lastSupplyAt', () => {
        const out = (0, _territory_supply_js_1.collectTerritorySupply)({ ownerClan: 'Storm', warSupply: 0, lastSupplyAt: NOW - (2 * DAY + DAY / 3) }, NOW);
        node_assert_1.strict.equal(out.collected, 2 * _territory_supply_js_1.TERRITORY_DAILY_WAR_SUPPLY); // only 2 whole cycles
        node_assert_1.strict.equal(out.nextLastSupplyAt, NOW - DAY / 3); // remainder (1/3 day) carried forward
    });
    (0, node_test_1.it)('collects only stored supply when less than a full cycle has elapsed', () => {
        const out = (0, _territory_supply_js_1.collectTerritorySupply)({ ownerClan: 'Storm', warSupply: 70, lastSupplyAt: NOW - DAY / 2 }, NOW);
        node_assert_1.strict.equal(out.collected, 70); // no new cycle yet
        node_assert_1.strict.equal(out.nextLastSupplyAt, NOW - DAY / 2); // unchanged (0 cycles)
    });
    (0, node_test_1.it)('never accrues for an unowned sector', () => {
        const out = (0, _territory_supply_js_1.collectTerritorySupply)({ warSupply: 999, lastSupplyAt: NOW - 10 * DAY }, NOW);
        node_assert_1.strict.equal(out.collected, 0);
    });
    (0, node_test_1.it)('falls back to updatedAt then now when lastSupplyAt is absent', () => {
        const viaUpdatedAt = (0, _territory_supply_js_1.collectTerritorySupply)({ ownerClan: 'Storm', warSupply: 0, updatedAt: NOW - 2 * DAY }, NOW);
        node_assert_1.strict.equal(viaUpdatedAt.collected, 2 * _territory_supply_js_1.TERRITORY_DAILY_WAR_SUPPLY);
        const viaNow = (0, _territory_supply_js_1.collectTerritorySupply)({ ownerClan: 'Storm', warSupply: 40 }, NOW);
        node_assert_1.strict.equal(viaNow.collected, 40); // base defaults to now → 0 cycles
    });
});
