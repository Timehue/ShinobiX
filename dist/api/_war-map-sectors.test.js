"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _war_map_sectors_js_1 = require("./_war-map-sectors.js");
(0, node_test_1.describe)('war-map-sectors: ownership invariants', () => {
    (0, node_test_1.it)('exactly 4 villages, 8 home sectors each, 32 total', () => {
        node_assert_1.strict.equal(_war_map_sectors_js_1.WAR_VILLAGES.length, 4);
        let total = 0;
        for (const v of _war_map_sectors_js_1.WAR_VILLAGES) {
            node_assert_1.strict.equal(_war_map_sectors_js_1.HOME_SECTORS[v].length, 8, `${v} should own 8 sectors`);
            total += _war_map_sectors_js_1.HOME_SECTORS[v].length;
        }
        node_assert_1.strict.equal(total, 32);
    });
    (0, node_test_1.it)('no sector is owned by two villages', () => {
        const seen = new Set();
        for (const v of _war_map_sectors_js_1.WAR_VILLAGES) {
            for (const s of _war_map_sectors_js_1.HOME_SECTORS[v]) {
                node_assert_1.strict.ok(!seen.has(s), `sector ${s} is double-owned`);
                seen.add(s);
            }
        }
        node_assert_1.strict.equal(seen.size, 32);
    });
    (0, node_test_1.it)('no home sector is a central or special (Hollow-Gate / Death\'s Gate) sector', () => {
        const banned = new Set([..._war_map_sectors_js_1.CENTRAL_SECTORS, ..._war_map_sectors_js_1.NON_WAR_SPECIAL_SECTORS]);
        for (const v of _war_map_sectors_js_1.WAR_VILLAGES) {
            for (const s of _war_map_sectors_js_1.HOME_SECTORS[v]) {
                node_assert_1.strict.ok(!banned.has(s), `sector ${s} (${v}) collides with a neutral/special sector`);
            }
        }
    });
    (0, node_test_1.it)('home sectors stay within each village\'s biome band', () => {
        const band = (s) => s <= 20 ? 'shadow' : s <= 35 ? 'forest' : s <= 45 ? 'volcano' : s <= 55 ? 'snow' : 'central';
        const expected = {
            'Moonshadow Village': 'shadow', 'Stormveil Village': 'forest',
            'Ashen Leaf Village': 'volcano', 'Frostfang Village': 'snow',
        };
        for (const v of _war_map_sectors_js_1.WAR_VILLAGES) {
            for (const s of _war_map_sectors_js_1.HOME_SECTORS[v]) {
                node_assert_1.strict.equal(band(s), expected[v], `sector ${s} of ${v} is outside its biome band`);
            }
        }
    });
});
(0, node_test_1.describe)('war-map-sectors: mappers', () => {
    (0, node_test_1.it)('homeVillageForSector / isWarSector round-trip every home sector', () => {
        for (const v of _war_map_sectors_js_1.WAR_VILLAGES) {
            for (const s of _war_map_sectors_js_1.HOME_SECTORS[v]) {
                node_assert_1.strict.equal((0, _war_map_sectors_js_1.homeVillageForSector)(s), v);
                node_assert_1.strict.ok((0, _war_map_sectors_js_1.isWarSector)(s));
            }
        }
    });
    (0, node_test_1.it)('central + special sectors are not war sectors', () => {
        for (const s of [..._war_map_sectors_js_1.CENTRAL_SECTORS, 99]) {
            node_assert_1.strict.equal((0, _war_map_sectors_js_1.homeVillageForSector)(s), undefined);
            node_assert_1.strict.equal((0, _war_map_sectors_js_1.isWarSector)(s), false);
        }
        node_assert_1.strict.ok((0, _war_map_sectors_js_1.isCentralSector)(58));
        node_assert_1.strict.equal((0, _war_map_sectors_js_1.isCentralSector)(8), false);
    });
    (0, node_test_1.it)('homeSectorsForVillage returns the table; unknown village → empty', () => {
        node_assert_1.strict.deepEqual([...(0, _war_map_sectors_js_1.homeSectorsForVillage)('Frostfang Village')], [..._war_map_sectors_js_1.HOME_SECTORS['Frostfang Village']]);
        node_assert_1.strict.deepEqual([...(0, _war_map_sectors_js_1.homeSectorsForVillage)('Nowhere')], []);
    });
    (0, node_test_1.it)('sector aliases are unique and match the village prefix', () => {
        const aliases = new Set();
        for (const v of _war_map_sectors_js_1.WAR_VILLAGES) {
            _war_map_sectors_js_1.HOME_SECTORS[v].forEach((s, i) => {
                const a = (0, _war_map_sectors_js_1.sectorAlias)(s);
                node_assert_1.strict.ok(a, `sector ${s} has no alias`);
                node_assert_1.strict.equal(a, `${{ 'Ashen Leaf Village': 'AL', 'Frostfang Village': 'FF', 'Stormveil Village': 'SV', 'Moonshadow Village': 'MS' }[v]}-${i + 1}`);
                node_assert_1.strict.ok(!aliases.has(a), `duplicate alias ${a}`);
                aliases.add(a);
            });
        }
        node_assert_1.strict.equal(aliases.size, 32);
        node_assert_1.strict.equal((0, _war_map_sectors_js_1.sectorAlias)(58), undefined); // central has no alias
    });
    (0, node_test_1.it)('isWarVillage type guard', () => {
        node_assert_1.strict.ok((0, _war_map_sectors_js_1.isWarVillage)('Frostfang Village'));
        node_assert_1.strict.equal((0, _war_map_sectors_js_1.isWarVillage)('Konoha'), false);
    });
});
