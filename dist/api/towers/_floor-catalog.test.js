"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _floor_catalog_js_1 = require("./_floor-catalog.js");
const _floor_validate_js_1 = require("./_floor-validate.js");
(0, node_test_1.describe)('Battle Towers floor catalog', () => {
    (0, node_test_1.it)('the shipped catalog is valid (no shape or cross-field errors)', () => {
        const errs = (0, _floor_validate_js_1.validateCatalog)(_floor_catalog_js_1.FLOOR_CATALOG);
        node_assert_1.strict.deepEqual(errs, [], `catalog errors:\n${errs.join('\n')}`);
    });
    // Drift detector: a hand-maintained replica of catalog invariants, so an
    // accidental edit to the catalog data trips this test (mirrors _mission-catalog).
    (0, node_test_1.it)('matches the expected v1 shape (drift detector)', () => {
        node_assert_1.strict.equal(_floor_catalog_js_1.TOWER_FLOOR_COUNT, 5, 'v1 ships 5 seed floors');
        node_assert_1.strict.deepEqual(_floor_catalog_js_1.FLOOR_CATALOG.map(f => f.id), [1, 2, 3, 4, 5]);
        node_assert_1.strict.deepEqual(_floor_catalog_js_1.FLOOR_CATALOG.map(f => f.objective), ['defeat-all', 'defeat-all', 'reach-tile', 'protect-npc', 'defeat-boss']);
        // Floor 5 is the boss + milestone floor.
        const f5 = (0, _floor_catalog_js_1.getFloor)(5);
        node_assert_1.strict.ok(f5?.boss, 'floor 5 has a boss');
        node_assert_1.strict.equal(f5?.firstClearReward.milestone, 'tower-floor-5');
    });
    (0, node_test_1.it)('every map fits the board bounds and boss/npc/goal cross-fields hold', () => {
        for (const f of _floor_catalog_js_1.FLOOR_CATALOG) {
            node_assert_1.strict.ok(f.map.width >= 8 && f.map.width <= 24, `floor ${f.id} width`);
            node_assert_1.strict.ok(f.map.height >= 8 && f.map.height <= 24, `floor ${f.id} height`);
            if (f.objective === 'reach-tile') {
                node_assert_1.strict.ok(typeof f.goalTile === 'number' && f.goalTile < f.map.width * f.map.height, `floor ${f.id} goalTile`);
            }
            if (f.objective === 'protect-npc')
                node_assert_1.strict.ok(f.npc?.aiId, `floor ${f.id} npc`);
        }
    });
    (0, node_test_1.it)('milestone reward keys are unique', () => {
        const keys = _floor_catalog_js_1.FLOOR_CATALOG.map(f => f.firstClearReward.milestone).filter(Boolean);
        node_assert_1.strict.equal(new Set(keys).size, keys.length);
    });
    // ── validator negative tests ──────────────────────────────────────────────
    function baseFloor() {
        return {
            id: 1, name: 'Test', biome: 'forest', objective: 'defeat-all',
            roundBudget: 8, map: { width: 20, height: 16 }, fieldRule: { kind: 'none' },
            enemies: [{ aiId: 'grunt', count: 2 }], firstClearReward: { ryo: 100 },
        };
    }
    (0, node_test_1.it)('rejects an invalid objective', () => {
        const f = { ...baseFloor(), objective: 'nuke-everything' };
        node_assert_1.strict.ok((0, _floor_validate_js_1.validateFloor)(f).some(e => e.includes('invalid objective')));
    });
    (0, node_test_1.it)('rejects an out-of-bounds map', () => {
        const f = { ...baseFloor(), map: { width: 64, height: 64 } };
        node_assert_1.strict.ok((0, _floor_validate_js_1.validateFloor)(f).length > 0);
    });
    (0, node_test_1.it)('requires a boss for boss objectives', () => {
        const f = { ...baseFloor(), objective: 'defeat-boss' };
        node_assert_1.strict.ok((0, _floor_validate_js_1.validateFloor)(f).some(e => e.includes('requires a boss')));
    });
    (0, node_test_1.it)('requires a goalTile (in bounds) for reach-tile', () => {
        const f = { ...baseFloor(), objective: 'reach-tile' };
        node_assert_1.strict.ok((0, _floor_validate_js_1.validateFloor)(f).some(e => e.includes('goalTile')));
        const f2 = { ...baseFloor(), objective: 'reach-tile', goalTile: 99999 };
        node_assert_1.strict.ok((0, _floor_validate_js_1.validateFloor)(f2).some(e => e.includes('goalTile')));
    });
    (0, node_test_1.it)('flags duplicate + non-contiguous ids at the catalog level', () => {
        const dup = [baseFloor(), { ...baseFloor(), id: 1 }];
        node_assert_1.strict.ok((0, _floor_validate_js_1.validateCatalog)(dup).some(e => e.includes('duplicate floor id')));
        const gap = [baseFloor(), { ...baseFloor(), id: 3 }];
        node_assert_1.strict.ok((0, _floor_validate_js_1.validateCatalog)(gap).some(e => e.includes('contiguous')));
    });
    (0, node_test_1.it)('accepts a valid balanceFor and rejects an out-of-range one', () => {
        const ok = { ..._floor_catalog_js_1.FLOOR_CATALOG[0], balanceFor: 2 };
        node_assert_1.strict.deepEqual((0, _floor_validate_js_1.validateFloor)(ok), []);
        const bad = { ..._floor_catalog_js_1.FLOOR_CATALOG[0], balanceFor: 7 };
        node_assert_1.strict.ok((0, _floor_validate_js_1.validateFloor)(bad).some(e => e.includes('balanceFor')));
    });
});
(0, node_test_1.describe)('Battle Towers party scaling (2–4 squad)', () => {
    (0, node_test_1.it)('a full party (>= balanceFor) gets no scaling', () => {
        node_assert_1.strict.equal((0, _floor_catalog_js_1.partyScaleFactor)(4, 4), 1);
        node_assert_1.strict.equal((0, _floor_catalog_js_1.partyScaleFactor)(3, 3), 1);
        node_assert_1.strict.equal((0, _floor_catalog_js_1.partyScaleFactor)(2, 2), 1);
        node_assert_1.strict.equal((0, _floor_catalog_js_1.partyScaleFactor)(5, 4), 1, 'clamped party >= base → 1, never scales up');
    });
    (0, node_test_1.it)('smaller parties scale enemies down, sub-linearly with a floor', () => {
        node_assert_1.strict.equal((0, _floor_catalog_js_1.partyScaleFactor)(2, 4), 0.6, 'duo hits the PARTY_SCALE_FLOOR');
        node_assert_1.strict.equal((0, _floor_catalog_js_1.partyScaleFactor)(3, 4), 0.75, 'trio is linear above the floor');
        node_assert_1.strict.ok((0, _floor_catalog_js_1.partyScaleFactor)(2, 4) < (0, _floor_catalog_js_1.partyScaleFactor)(3, 4));
        node_assert_1.strict.ok((0, _floor_catalog_js_1.partyScaleFactor)(2, 4) <= 1);
    });
    (0, node_test_1.it)('clamps party size to [2,4]', () => {
        node_assert_1.strict.equal((0, _floor_catalog_js_1.partyScaleFactor)(1, 4), (0, _floor_catalog_js_1.partyScaleFactor)(_floor_catalog_js_1.MIN_PARTY_SIZE, 4));
        node_assert_1.strict.equal((0, _floor_catalog_js_1.partyScaleFactor)(99, 4), 1);
    });
    (0, node_test_1.it)('scaleEnemyStat applies the factor, floor of 1, never above the base value', () => {
        node_assert_1.strict.equal((0, _floor_catalog_js_1.scaleEnemyStat)(1000, 0.6), 600);
        node_assert_1.strict.equal((0, _floor_catalog_js_1.scaleEnemyStat)(1000, 1), 1000);
        node_assert_1.strict.equal((0, _floor_catalog_js_1.scaleEnemyStat)(1000, 2), 1000, 'factor clamped to <= 1');
        node_assert_1.strict.equal((0, _floor_catalog_js_1.scaleEnemyStat)(1, 0.1), 1, 'floor at 1 (no zero-HP enemies)');
    });
    (0, node_test_1.it)('getFloorBalanceFor defaults to 4 and honours an explicit value', () => {
        node_assert_1.strict.equal((0, _floor_catalog_js_1.getFloorBalanceFor)({ ..._floor_catalog_js_1.FLOOR_CATALOG[0] }), _floor_catalog_js_1.DEFAULT_PARTY_SIZE);
        node_assert_1.strict.equal((0, _floor_catalog_js_1.getFloorBalanceFor)({ ..._floor_catalog_js_1.FLOOR_CATALOG[0], balanceFor: 2 }), 2);
    });
});
