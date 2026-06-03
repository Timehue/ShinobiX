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
(0, node_test_1.describe)('resolveClaimedWarSupply', () => {
    (0, node_test_1.it)('carries prev warSupply + lastSupplyAt when the same clan keeps owning', () => {
        const prev = { ownerClan: 'Storm', ownerVillage: 'Leaf', warSupply: 250, lastSupplyAt: NOW - 3 * DAY };
        const out = (0, _territory_supply_js_1.resolveClaimedWarSupply)(prev, { ownerClan: 'Storm', ownerVillage: 'Leaf' }, NOW);
        node_assert_1.strict.equal(out.warSupply, 250);
        node_assert_1.strict.equal(out.lastSupplyAt, NOW - 3 * DAY);
    });
    (0, node_test_1.it)('drives the result entirely from prev — the client never supplies warSupply (anti-mint)', () => {
        // `incoming` only carries the owner identity; there is no field through
        // which a client could inject a warSupply value on a same-owner write.
        const prev = { ownerClan: 'Storm', ownerVillage: 'Leaf', warSupply: 80, lastSupplyAt: NOW - DAY };
        const out = (0, _territory_supply_js_1.resolveClaimedWarSupply)(prev, { ownerClan: 'Storm', ownerVillage: 'Leaf' }, NOW);
        node_assert_1.strict.equal(out.warSupply, 80);
        node_assert_1.strict.equal(out.lastSupplyAt, NOW - DAY);
    });
    (0, node_test_1.it)('resets to 0 and re-anchors on a cross-village ownership flip', () => {
        const prev = { ownerClan: 'Old', ownerVillage: 'Sand', warSupply: 9999, lastSupplyAt: NOW - 50 * DAY };
        const out = (0, _territory_supply_js_1.resolveClaimedWarSupply)(prev, { ownerClan: 'New', ownerVillage: 'Leaf' }, NOW);
        node_assert_1.strict.equal(out.warSupply, 0);
        node_assert_1.strict.equal(out.lastSupplyAt, NOW);
    });
    (0, node_test_1.it)('resets on a within-village clan capture (clan changes, village same)', () => {
        const prev = { ownerClan: 'Alpha', ownerVillage: 'Leaf', warSupply: 5000, lastSupplyAt: NOW - 9 * DAY };
        const out = (0, _territory_supply_js_1.resolveClaimedWarSupply)(prev, { ownerClan: 'Bravo', ownerVillage: 'Leaf' }, NOW);
        node_assert_1.strict.equal(out.warSupply, 0);
        node_assert_1.strict.equal(out.lastSupplyAt, NOW);
    });
    (0, node_test_1.it)('resets on a village-war capture (village changes, clan field stale)', () => {
        const prev = { ownerClan: 'Alpha', ownerVillage: 'Leaf', warSupply: 5000, lastSupplyAt: NOW - 9 * DAY };
        const out = (0, _territory_supply_js_1.resolveClaimedWarSupply)(prev, { ownerClan: 'Alpha', ownerVillage: 'Sand' }, NOW);
        node_assert_1.strict.equal(out.warSupply, 0);
        node_assert_1.strict.equal(out.lastSupplyAt, NOW);
    });
    (0, node_test_1.it)('resets when the sector was previously unowned', () => {
        const prev = { warSupply: 500, lastSupplyAt: NOW - 10 * DAY };
        const out = (0, _territory_supply_js_1.resolveClaimedWarSupply)(prev, { ownerClan: 'Storm', ownerVillage: 'Leaf' }, NOW);
        node_assert_1.strict.equal(out.warSupply, 0);
        node_assert_1.strict.equal(out.lastSupplyAt, NOW);
    });
    (0, node_test_1.it)('resets on a first write (no prev record)', () => {
        const out = (0, _territory_supply_js_1.resolveClaimedWarSupply)(null, { ownerClan: 'Storm', ownerVillage: 'Leaf' }, NOW);
        node_assert_1.strict.equal(out.warSupply, 0);
        node_assert_1.strict.equal(out.lastSupplyAt, NOW);
    });
    (0, node_test_1.it)('carries (no supply loss) when the owner write omits the village field', () => {
        const prev = { ownerClan: 'Storm', ownerVillage: 'Leaf', warSupply: 120, lastSupplyAt: NOW - 2 * DAY };
        const out = (0, _territory_supply_js_1.resolveClaimedWarSupply)(prev, { ownerClan: 'Storm' }, NOW);
        node_assert_1.strict.equal(out.warSupply, 120);
        node_assert_1.strict.equal(out.lastSupplyAt, NOW - 2 * DAY);
    });
    (0, node_test_1.it)('floors a negative/NaN prev warSupply and falls back to updatedAt for the anchor', () => {
        const prev = { ownerClan: 'Storm', ownerVillage: 'Leaf', warSupply: -5, updatedAt: NOW - DAY };
        const out = (0, _territory_supply_js_1.resolveClaimedWarSupply)(prev, { ownerClan: 'Storm', ownerVillage: 'Leaf' }, NOW);
        node_assert_1.strict.equal(out.warSupply, 0);
        node_assert_1.strict.equal(out.lastSupplyAt, NOW - DAY);
    });
    (0, node_test_1.it)('end-to-end: a same-owner write cannot inflate the eventual collect', () => {
        // Owner claimed 4 days ago, never collected. A malicious settings write
        // tries to set a huge warSupply — the server carries prev (0) + the old
        // anchor, so collect still yields only the true 4-day accrual.
        const claimedAt = NOW - 4 * DAY;
        const prev = { ownerClan: 'Storm', ownerVillage: 'Leaf', warSupply: 0, lastSupplyAt: claimedAt };
        const owned = (0, _territory_supply_js_1.resolveClaimedWarSupply)(prev, { ownerClan: 'Storm', ownerVillage: 'Leaf' }, NOW);
        const collected = (0, _territory_supply_js_1.collectTerritorySupply)({ ownerClan: 'Storm', warSupply: owned.warSupply, lastSupplyAt: owned.lastSupplyAt }, NOW);
        node_assert_1.strict.equal(collected.collected, 4 * _territory_supply_js_1.TERRITORY_DAILY_WAR_SUPPLY);
    });
});
