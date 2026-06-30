"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _war_structures_js_1 = require("./_war-structures.js");
const _war_state_js_1 = require("./_war-state.js");
const _war_economy_js_1 = require("./_war-economy.js");
function rec(levels = {}, dormant = false) {
    const r = (0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village');
    r.dormant = dormant;
    for (const [k, v] of Object.entries(levels))
        r.structures[k] = v;
    return r;
}
(0, node_test_1.describe)('war-structures: definitions + cost', () => {
    (0, node_test_1.it)('defines all 6 structures', () => {
        node_assert_1.strict.equal(Object.keys(_war_structures_js_1.STRUCTURE_DEFS).length, 6);
        for (const k of _war_state_js_1.STRUCTURE_KEYS)
            node_assert_1.strict.ok(_war_structures_js_1.STRUCTURE_DEFS[k], `def for ${k}`);
    });
    (0, node_test_1.it)('upgrade cost rises with level (round 5·(lvl+1)^1.4)', () => {
        node_assert_1.strict.equal((0, _war_structures_js_1.structureUpgradeCost)('ramparts', 0), 5); // L0→1
        node_assert_1.strict.equal((0, _war_structures_js_1.structureUpgradeCost)('ramparts', 4), 48); // L4→5
        node_assert_1.strict.equal((0, _war_structures_js_1.structureUpgradeCost)('ramparts', 9), 126); // L9→10
    });
});
(0, node_test_1.describe)('war-structures: effects (dormancy-aware)', () => {
    (0, node_test_1.it)('effective level is the built level when active, 0 when dormant', () => {
        node_assert_1.strict.equal((0, _war_structures_js_1.effectiveLevel)(rec({ ramparts: 7 }), 'ramparts'), 7);
        node_assert_1.strict.equal((0, _war_structures_js_1.effectiveLevel)(rec({ ramparts: 7 }, true), 'ramparts'), 0);
    });
    (0, node_test_1.it)('Ramparts raise village war HP up to +15% at L10', () => {
        node_assert_1.strict.equal((0, _war_structures_js_1.villageWarHpMax)(rec()), 5000);
        node_assert_1.strict.equal((0, _war_structures_js_1.villageWarHpMax)(rec({ ramparts: 10 })), 5750); // 5000 × 1.15
        node_assert_1.strict.equal((0, _war_structures_js_1.villageWarHpMax)(rec({ ramparts: 10 }, true)), 5000); // dormant → no bonus
    });
    (0, node_test_1.it)('Watchtower raises sector Control HP', () => {
        node_assert_1.strict.equal((0, _war_structures_js_1.sectorControlHpMax)(rec()), _war_state_js_1.SECTOR_CONTROL_HP_MAX);
        node_assert_1.strict.equal((0, _war_structures_js_1.sectorControlHpMax)(rec({ watchtower: 10 })), Math.round(_war_state_js_1.SECTOR_CONTROL_HP_MAX * 1.15));
    });
    (0, node_test_1.it)('Barracks discount mercenary cost; War Academy boosts sector-war damage', () => {
        node_assert_1.strict.ok(Math.abs((0, _war_structures_js_1.mercCostMultiplier)(rec({ barracks: 10 })) - 0.85) < 1e-9);
        node_assert_1.strict.ok(Math.abs((0, _war_structures_js_1.sectorWarDamageMultiplier)(rec({ warAcademy: 10 })) - 1.15) < 1e-9);
        node_assert_1.strict.equal((0, _war_structures_js_1.mercCostMultiplier)(rec()), 1);
    });
    (0, node_test_1.it)('Supply Depot raises per-sector WR income (+0.5/level)', () => {
        node_assert_1.strict.equal((0, _war_structures_js_1.wrPerSector)(rec()), 25);
        node_assert_1.strict.equal((0, _war_structures_js_1.wrPerSector)(rec({ supplyDepot: 10 })), 30);
        node_assert_1.strict.equal((0, _war_structures_js_1.wrPerSector)(rec({ supplyDepot: 10 }, true)), 25); // dormant → base
    });
    (0, node_test_1.it)('Treasury Vault softens the tax rate (×0.7 at L10)', () => {
        node_assert_1.strict.ok(Math.abs((0, _war_structures_js_1.taxRateMultiplier)(rec({ treasuryVault: 10 })) - 0.7) < 1e-9);
        node_assert_1.strict.equal((0, _war_structures_js_1.taxRateMultiplier)(rec()), 1);
    });
});
(0, node_test_1.describe)('war-structures: applyStructureUpgrade (pure)', () => {
    (0, node_test_1.it)('upgrades when affordable, debiting seals', () => {
        const r = (0, _war_structures_js_1.applyStructureUpgrade)(rec(), 100, 'ramparts');
        node_assert_1.strict.equal(r.ok, true);
        node_assert_1.strict.equal(r.cost, 5);
        node_assert_1.strict.equal(r.nextSeals, 95);
        node_assert_1.strict.equal(r.newLevel, 1);
        node_assert_1.strict.equal(r.record.structures.ramparts, 1);
    });
    (0, node_test_1.it)('rejects when seals are insufficient (reporting the cost)', () => {
        const r = (0, _war_structures_js_1.applyStructureUpgrade)(rec({ ramparts: 4 }), 10, 'ramparts');
        node_assert_1.strict.equal(r.ok, false);
        node_assert_1.strict.equal(r.error, 'insufficient-seals');
        node_assert_1.strict.equal(r.cost, 48);
    });
    (0, node_test_1.it)('rejects at max level', () => {
        const r = (0, _war_structures_js_1.applyStructureUpgrade)(rec({ ramparts: _war_economy_js_1.VILLAGE_STRUCTURE_MAX_LEVEL }), 99999, 'ramparts');
        node_assert_1.strict.equal(r.ok, false);
        node_assert_1.strict.equal(r.error, 'max-level');
    });
    (0, node_test_1.it)('rejects an unknown structure', () => {
        const r = (0, _war_structures_js_1.applyStructureUpgrade)(rec(), 99999, 'deathstar');
        node_assert_1.strict.equal(r.ok, false);
        node_assert_1.strict.equal(r.error, 'unknown-structure');
    });
    (0, node_test_1.it)('does not mutate the input record', () => {
        const base = rec();
        (0, _war_structures_js_1.applyStructureUpgrade)(base, 100, 'ramparts');
        node_assert_1.strict.equal(base.structures.ramparts, 0);
    });
});
