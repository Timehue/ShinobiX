"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _weekly_board_js_1 = require("./_weekly-board.js");
const _eligibility_js_1 = require("./_eligibility.js");
(0, node_test_1.test)('weekKey is stable within a week and advances across the Monday boundary', () => {
    const base = _weekly_board_js_1.WEEK_EPOCH_MS + _weekly_board_js_1.WEEK_MS * 100; // some Monday 00:00 UTC
    strict_1.default.equal((0, _weekly_board_js_1.weekIndex)(base), 100);
    strict_1.default.equal((0, _weekly_board_js_1.weekIndex)(base + _weekly_board_js_1.WEEK_MS - 1), 100); // last ms of the week
    strict_1.default.equal((0, _weekly_board_js_1.weekIndex)(base + _weekly_board_js_1.WEEK_MS), 101); // next week
    strict_1.default.equal((0, _weekly_board_js_1.weekKey)(base), 'w100');
    strict_1.default.equal((0, _weekly_board_js_1.weekEndsAt)(base), base + _weekly_board_js_1.WEEK_MS);
});
(0, node_test_1.test)('pickWeeklyBoard is deterministic per week and the right size', () => {
    const a = (0, _weekly_board_js_1.pickWeeklyBoard)('w42');
    const b = (0, _weekly_board_js_1.pickWeeklyBoard)('w42');
    strict_1.default.equal(a.length, _weekly_board_js_1.WEEKLY_BOARD_SIZE);
    strict_1.default.deepEqual(a.map((m) => m.id), b.map((m) => m.id));
});
(0, node_test_1.test)('pickWeeklyBoard returns distinct missions', () => {
    const ids = (0, _weekly_board_js_1.pickWeeklyBoard)('w7').map((m) => m.id);
    strict_1.default.equal(new Set(ids).size, ids.length);
});
(0, node_test_1.test)('different weeks generally yield different boards', () => {
    const w1 = (0, _weekly_board_js_1.pickWeeklyBoard)('w1').map((m) => m.id).join(',');
    const w2 = (0, _weekly_board_js_1.pickWeeklyBoard)('w2').map((m) => m.id).join(',');
    strict_1.default.notEqual(w1, w2);
});
(0, node_test_1.test)('every board mission references a real tracked counter', () => {
    for (const m of _weekly_board_js_1.WEEKLY_CLAIMABLE_CATALOG) {
        strict_1.default.ok(_weekly_board_js_1.WEEKLY_COUNTERS.includes(m.counter), `${m.id} has untracked counter ${m.counter}`);
        strict_1.default.ok(m.target > 0);
        const r = m.reward;
        strict_1.default.ok((r.ryo ?? 0) + (r.fateShards ?? 0) + (r.boneCharms ?? 0) > 0, `${m.id} has no reward`);
        // No aura stones anywhere (owner constraint).
        strict_1.default.ok(!('auraStones' in r));
    }
});
(0, node_test_1.test)('low-level players are never assigned Hollow Gate Warden missions', () => {
    const lowLevel = { level: 20, village: 'Leaf', rankTitle: 'Genin' };
    for (let i = 0; i < 100; i += 1) {
        const board = (0, _weekly_board_js_1.pickWeeklyBoardForPlayer)(`w${i}`, lowLevel, _weekly_board_js_1.WEEKLY_BOARD_SIZE, { systems: { hollowGate: false } });
        strict_1.default.equal(board.some((mission) => mission.id === 'wk-hollow-warden' || /hollow gate warden/i.test(mission.name)), false, `w${i} assigned Warden`);
        for (const mission of board)
            strict_1.default.equal((0, _eligibility_js_1.canPlayerReceiveMission)(lowLevel, mission, { systems: { hollowGate: false } }).ok, true, `${mission.id} should be eligible`);
    }
});
(0, node_test_1.test)('low-level players get eligible weekly replacements and fallbacks', () => {
    const wk = Array.from({ length: 100 }, (_, i) => `w${i}`).find((key) => (0, _weekly_board_js_1.pickWeeklyBoard)(key).some((mission) => mission.id === 'wk-hollow-warden'));
    strict_1.default.ok(wk, 'test needs a week whose raw board includes Warden');
    const lowLevel = { level: 5, village: 'Leaf', rankTitle: 'Academy Student' };
    const board = (0, _weekly_board_js_1.pickWeeklyBoardForPlayer)(wk, lowLevel, _weekly_board_js_1.WEEKLY_BOARD_SIZE, { systems: { hollowGate: false, ranked: false } });
    strict_1.default.equal(board.length, _weekly_board_js_1.WEEKLY_BOARD_SIZE);
    strict_1.default.equal(board.some((mission) => mission.id === 'wk-hollow-warden'), false);
    strict_1.default.ok(board.some((mission) => mission.id.startsWith('wk-safe-')), 'expected a safe fallback mission');
    for (const mission of board)
        strict_1.default.equal((0, _eligibility_js_1.canPlayerReceiveMission)(lowLevel, mission, { systems: { hollowGate: false, ranked: false } }).ok, true);
});
(0, node_test_1.test)('level 100 players can see Hollow Gate Warden if Hollow Gate is unlocked', () => {
    const board = (0, _weekly_board_js_1.pickWeeklyBoardForPlayer)('w-endgame', { level: 100, village: 'Leaf', rankTitle: 'Kage' }, _weekly_board_js_1.WEEKLY_CLAIMABLE_CATALOG.length, { systems: { hollowGate: true, ranked: true } });
    strict_1.default.ok(board.some((mission) => mission.id === 'wk-hollow-warden'));
});
(0, node_test_1.test)('computeProgress diffs current vs baseline, floored at 0', () => {
    const mission = _weekly_board_js_1.WEEKLY_CATALOG.find((m) => m.counter === 'rankedWins');
    strict_1.default.equal((0, _weekly_board_js_1.computeProgress)(mission, { rankedWins: 10 }, { rankedWins: 13 }), 3);
    strict_1.default.equal((0, _weekly_board_js_1.computeProgress)(mission, { rankedWins: 10 }, { rankedWins: 10 }), 0);
    // a counter that went DOWN (shouldn't happen) never yields negative progress
    strict_1.default.equal((0, _weekly_board_js_1.computeProgress)(mission, { rankedWins: 10 }, { rankedWins: 4 }), 0);
    // missing fields treated as 0
    strict_1.default.equal((0, _weekly_board_js_1.computeProgress)(mission, {}, { rankedWins: 5 }), 5);
});
(0, node_test_1.test)('snapshotCounters captures exactly the tracked counters as numbers', () => {
    const snap = (0, _weekly_board_js_1.snapshotCounters)({ rankedWins: 5, totalAiKills: 9, ryo: 99999, junk: 'x' });
    strict_1.default.equal(snap.rankedWins, 5);
    strict_1.default.equal(snap.totalMissionsCompleted, 0);
    strict_1.default.ok(!('totalAiKills' in snap));
    strict_1.default.equal(Object.keys(snap).length, _weekly_board_js_1.WEEKLY_COUNTERS.length);
    strict_1.default.ok(!('ryo' in snap));
});
