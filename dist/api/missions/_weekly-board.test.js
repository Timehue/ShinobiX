"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _weekly_board_js_1 = require("./_weekly-board.js");
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
    for (const m of _weekly_board_js_1.WEEKLY_CATALOG) {
        strict_1.default.ok(_weekly_board_js_1.WEEKLY_COUNTERS.includes(m.counter), `${m.id} has untracked counter ${m.counter}`);
        strict_1.default.ok(m.target > 0);
        const r = m.reward;
        strict_1.default.ok((r.ryo ?? 0) + (r.fateShards ?? 0) + (r.boneCharms ?? 0) > 0, `${m.id} has no reward`);
        // No aura stones anywhere (owner constraint).
        strict_1.default.ok(!('auraStones' in r));
    }
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
    strict_1.default.equal(snap.totalAiKills, 9);
    strict_1.default.equal(snap.totalPetWins, 0); // absent → 0
    strict_1.default.equal(Object.keys(snap).length, _weekly_board_js_1.WEEKLY_COUNTERS.length);
    strict_1.default.ok(!('ryo' in snap));
});
