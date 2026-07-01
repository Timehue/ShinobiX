"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _war_state_js_1 = require("./_war-state.js");
const _war_map_view_js_1 = require("./_war-map-view.js");
function recordWith(structures = {}, warResources = 0, dormant = false) {
    return (0, _war_state_js_1.normalizeVillageWarRecord)('Moonshadow Village', { warResources, structures, dormant });
}
(0, node_test_1.describe)('war-map-view: villageWarMapView', () => {
    (0, node_test_1.it)('assembles a fresh village view', () => {
        const v = (0, _war_map_view_js_1.villageWarMapView)({ village: 'Moonshadow Village', record: recordWith(), treasurySeals: 0, sectorsHeld: 8 });
        node_assert_1.strict.equal(v.village, 'Moonshadow Village');
        node_assert_1.strict.equal(v.biome, 'shadow');
        node_assert_1.strict.deepEqual(v.homeSectors, [11, 19, 15, 4, 5, 6, 16, 8]);
        node_assert_1.strict.equal(v.warResources, 0);
        node_assert_1.strict.equal(v.upkeepWr, 0);
        node_assert_1.strict.equal(v.dormant, false);
        node_assert_1.strict.equal(v.sectorsHeld, 8);
        node_assert_1.strict.equal(v.taxRatePct, 0); // full 8 sectors → 0% tier
        node_assert_1.strict.equal(v.wrPerSector, 25); // no Supply Depot
        node_assert_1.strict.equal(v.sectors.length, 8);
        node_assert_1.strict.equal(v.sectors[0].sector, 11);
        node_assert_1.strict.equal(v.sectors[0].alias, 'MS-1');
        node_assert_1.strict.equal(v.sectors[0].controlHpMax, 2000); // no Watchtower
        node_assert_1.strict.equal(v.sectors[0].winCondition, 'combat'); // defaults alternate combat/pet
        node_assert_1.strict.equal(v.sectors[1].winCondition, 'pet');
    });
    (0, node_test_1.it)('reflects Watchtower (Control HP cap) and Supply Depot (WR/sector)', () => {
        const v = (0, _war_map_view_js_1.villageWarMapView)({ village: 'Moonshadow Village', record: recordWith({ watchtower: 10, supplyDepot: 10 }), treasurySeals: 50, sectorsHeld: 8 });
        node_assert_1.strict.equal(v.sectors[0].controlHpMax, 2300); // 2000 × 1.15
        node_assert_1.strict.equal(v.wrPerSector, 30); // 25 + 0.5×10
        node_assert_1.strict.equal(v.treasurySeals, 50);
        node_assert_1.strict.equal(v.structures.watchtower, 10);
    });
    (0, node_test_1.it)('computes the effective tax tier (held count × Treasury-Vault softening)', () => {
        const v1 = (0, _war_map_view_js_1.villageWarMapView)({ village: 'Moonshadow Village', record: recordWith(), treasurySeals: 0, sectorsHeld: 1 });
        node_assert_1.strict.equal(v1.taxRatePct, 5); // 1 sector → heaviest tier
        const v2 = (0, _war_map_view_js_1.villageWarMapView)({ village: 'Moonshadow Village', record: recordWith({ treasuryVault: 10 }), treasurySeals: 0, sectorsHeld: 1 });
        node_assert_1.strict.equal(v2.taxRatePct, 3.5); // × Treasury-Vault L10 (×0.7)
    });
    (0, node_test_1.it)('suspends Control-HP/WR bonuses while dormant but still owes upkeep', () => {
        const v = (0, _war_map_view_js_1.villageWarMapView)({ village: 'Moonshadow Village', record: recordWith({ ramparts: 5, watchtower: 5, supplyDepot: 5 }, 0, true), treasurySeals: 0, sectorsHeld: 8 });
        node_assert_1.strict.equal(v.dormant, true);
        node_assert_1.strict.equal(v.sectors[0].controlHpMax, 2000); // Watchtower suspended
        node_assert_1.strict.equal(v.wrPerSector, 25); // Supply Depot suspended
        node_assert_1.strict.ok(v.upkeepWr > 0); // upkeep owed reflects built levels
    });
});
