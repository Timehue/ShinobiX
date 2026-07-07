"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _eligibility_js_1 = require("./_eligibility.js");
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
(0, node_test_1.describe)('pickDailyMissionsForPlayer eligibility filtering', () => {
    (0, node_test_1.it)('level 1 players cannot receive profession daily objectives', () => {
        const picks = (0, _pool_js_1.pickDailyMissionsForPlayer)({
            profession: 'healer',
            playerName: 'academy',
            dateKey: '2026-05-25',
            character: { level: 1, profession: 'healer', professionRank: 1 },
        });
        node_assert_1.strict.equal(picks.length, 0);
    });
    (0, node_test_1.it)('rank 1 healers get eligible fallback picks instead of high-rank objectives', () => {
        const character = { level: 13, profession: 'healer', professionRank: 1 };
        const picks = (0, _pool_js_1.pickDailyMissionsForPlayer)({
            profession: 'healer',
            playerName: 'jun',
            dateKey: '2026-05-25',
            character,
            count: 3,
        });
        node_assert_1.strict.equal(picks.length, 3);
        for (const pick of picks) {
            node_assert_1.strict.equal((0, _eligibility_js_1.canPlayerReceiveMission)(character, pick).ok, true);
            node_assert_1.strict.equal(pick.eligibility.minProfessionRank ?? 1, 1);
        }
    });
    (0, node_test_1.it)('players without pets cannot receive pet-training missions', () => {
        const picks = (0, _pool_js_1.pickDailyMissionsForPlayer)({
            profession: 'petTamer',
            playerName: 'no-pet',
            dateKey: '2026-05-25',
            character: { level: 30, profession: 'petTamer', professionRank: 10, pets: [] },
            context: { systems: { expedition: true } },
            count: 8,
        });
        node_assert_1.strict.ok(picks.length > 0);
        node_assert_1.strict.equal(picks.some((pick) => pick.kind === 'pet-tamer-pet-train'), false);
    });
    (0, node_test_1.it)('players without PvP unlock cannot receive Vanguard missions', () => {
        const picks = (0, _pool_js_1.pickDailyMissionsForPlayer)({
            profession: 'vanguard',
            playerName: 'no-pvp',
            dateKey: '2026-05-25',
            character: { level: 30, profession: 'vanguard', professionRank: 10 },
            context: { systems: { pvp: false } },
            count: 4,
        });
        node_assert_1.strict.equal(picks.length, 0);
    });
    (0, node_test_1.it)('profession mismatch cannot receive another profession pool', () => {
        const picks = (0, _pool_js_1.pickDailyMissionsForPlayer)({
            profession: 'healer',
            playerName: 'wrong-job',
            dateKey: '2026-05-25',
            character: { level: 30, profession: 'vanguard', professionRank: 10 },
            count: 3,
        });
        node_assert_1.strict.equal(picks.length, 0);
    });
});
(0, node_test_1.describe)('pickNewbieMissions', () => {
    (0, node_test_1.it)('returns exactly one battle task and one mission task', () => {
        const picks = (0, _pool_js_1.pickNewbieMissions)('alice', '2026-05-25');
        node_assert_1.strict.equal(picks.length, 2);
        const kinds = picks.map(m => m.kind).sort();
        node_assert_1.strict.deepEqual(kinds, ['newbie-battle-wins', 'newbie-missions']);
    });
    (0, node_test_1.it)('is deterministic per (player, date)', () => {
        const a = (0, _pool_js_1.pickNewbieMissions)('bob', '2026-05-25');
        const b = (0, _pool_js_1.pickNewbieMissions)('bob', '2026-05-25');
        node_assert_1.strict.deepEqual(a.map(m => m.templateId), b.map(m => m.templateId));
    });
    (0, node_test_1.it)('every newbie mission pays ryo (> 0) and has a positive target', () => {
        for (const m of (0, _pool_js_1.pickNewbieMissions)('carol', '2026-05-25')) {
            node_assert_1.strict.ok(m.ryoReward > 0);
            node_assert_1.strict.ok(m.target > 0);
        }
    });
    (0, node_test_1.it)('can vary across days for the same player', () => {
        // Sample a span of days; the seeded pick should not be frozen to a
        // single template per kind for all dates.
        const battleIds = new Set();
        const missionIds = new Set();
        for (let d = 1; d <= 28; d += 1) {
            const date = `2026-05-${String(d).padStart(2, '0')}`;
            const picks = (0, _pool_js_1.pickNewbieMissions)('dave', date);
            battleIds.add(picks.find(m => m.kind === 'newbie-battle-wins').templateId);
            missionIds.add(picks.find(m => m.kind === 'newbie-missions').templateId);
        }
        node_assert_1.strict.ok(battleIds.size >= 2);
        node_assert_1.strict.ok(missionIds.size >= 2);
    });
});
