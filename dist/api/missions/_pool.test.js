"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _pool_js_1 = require("./_pool.js");
(0, node_test_1.describe)('getMissionPool', () => {
    (0, node_test_1.it)('healer pool has at least 8 missions', () => {
        node_assert_1.strict.ok((0, _pool_js_1.getMissionPool)('healer').length >= 8);
    });
    (0, node_test_1.it)('vanguard pool has at least 8 missions', () => {
        node_assert_1.strict.ok((0, _pool_js_1.getMissionPool)('vanguard').length >= 8);
    });
    (0, node_test_1.it)('petTamer pool has at least 3 missions', () => {
        node_assert_1.strict.ok((0, _pool_js_1.getMissionPool)('petTamer').length >= 3);
    });
    (0, node_test_1.it)('every petTamer mission is profession=petTamer', () => {
        for (const m of (0, _pool_js_1.getMissionPool)('petTamer'))
            node_assert_1.strict.equal(m.profession, 'petTamer');
    });
    (0, node_test_1.it)('every healer mission is profession=healer', () => {
        for (const m of (0, _pool_js_1.getMissionPool)('healer'))
            node_assert_1.strict.equal(m.profession, 'healer');
    });
    (0, node_test_1.it)('every vanguard mission is profession=vanguard', () => {
        for (const m of (0, _pool_js_1.getMissionPool)('vanguard'))
            node_assert_1.strict.equal(m.profession, 'vanguard');
    });
});
(0, node_test_1.describe)('pickDailyMissions', () => {
    (0, node_test_1.it)('returns 3 missions by default', () => {
        const picks = (0, _pool_js_1.pickDailyMissions)('healer', 'alice', '2026-05-25');
        node_assert_1.strict.equal(picks.length, 3);
    });
    (0, node_test_1.it)('is deterministic per (player, date)', () => {
        const a = (0, _pool_js_1.pickDailyMissions)('vanguard', 'bob', '2026-05-25');
        const b = (0, _pool_js_1.pickDailyMissions)('vanguard', 'bob', '2026-05-25');
        node_assert_1.strict.deepEqual(a.map(m => m.templateId), b.map(m => m.templateId));
    });
    (0, node_test_1.it)('picks are unique within a day (no duplicates)', () => {
        const picks = (0, _pool_js_1.pickDailyMissions)('healer', 'carol', '2026-05-25');
        const ids = picks.map(m => m.templateId);
        node_assert_1.strict.equal(new Set(ids).size, ids.length);
    });
    (0, node_test_1.it)('returns 3 missions for petTamer', () => {
        const picks = (0, _pool_js_1.pickDailyMissions)('petTamer', 'dave', '2026-05-25');
        node_assert_1.strict.equal(picks.length, 3);
        for (const m of picks)
            node_assert_1.strict.equal(m.profession, 'petTamer');
    });
    (0, node_test_1.it)('different players on the same day usually get different picks', () => {
        const a = (0, _pool_js_1.pickDailyMissions)('healer', 'alice', '2026-05-25').map(m => m.templateId);
        const b = (0, _pool_js_1.pickDailyMissions)('healer', 'eve', '2026-05-25').map(m => m.templateId);
        node_assert_1.strict.notDeepEqual(a, b);
    });
});
