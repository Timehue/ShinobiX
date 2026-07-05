"use strict";
/*
 * Weekly mission board — a single GLOBAL set of cross-system missions that
 * rotates every week. Everyone sees the same board (seeded by the week key
 * only, not per-player), so a small population shares the same goals.
 *
 * Progress is measured by diffing existing lifetime counters against a per-week
 * baseline snapshot (see api/missions/weekly-board.ts). The rewardable catalog is
 * intentionally limited to counters updated by server-controlled flows. Client-
 * incremented counters stay out of the paid pool until they have server ledgers.
 *
 * Pure data + helpers — unit-tested. The handler does the kv + claim.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEEKLY_BOARD_SIZE = exports.WEEK_MS = exports.WEEK_EPOCH_MS = exports.WEEKLY_CATALOG = exports.WEEKLY_COUNTERS = void 0;
exports.weekIndex = weekIndex;
exports.weekKey = weekKey;
exports.weekEndsAt = weekEndsAt;
exports.pickWeeklyBoard = pickWeeklyBoard;
exports.computeProgress = computeProgress;
exports.snapshotCounters = snapshotCounters;
exports.WEEKLY_COUNTERS = [
    'rankedWins', 'totalMissionsCompleted',
];
exports.WEEKLY_CATALOG = [
    { id: 'wk-ranked-3', name: 'Ladder Climber', desc: 'Win 3 ranked matches.', counter: 'rankedWins', target: 3, reward: { ryo: 4000, fateShards: 1 } },
    { id: 'wk-ranked-7', name: 'Ranked Grinder', desc: 'Win 7 ranked matches.', counter: 'rankedWins', target: 7, reward: { ryo: 8000, fateShards: 2 } },
    { id: 'wk-missions-10', name: 'Dutiful', desc: 'Complete 10 missions.', counter: 'totalMissionsCompleted', target: 10, reward: { ryo: 4000, boneCharms: 2 } },
    { id: 'wk-missions-25', name: 'Tireless', desc: 'Complete 25 missions.', counter: 'totalMissionsCompleted', target: 25, reward: { ryo: 8000, fateShards: 2 } },
];
// Weekly board is anchored to Mondays 00:00 UTC. 2024-01-01 was a Monday.
exports.WEEK_EPOCH_MS = Date.UTC(2024, 0, 1);
exports.WEEK_MS = 7 * 24 * 60 * 60 * 1000;
exports.WEEKLY_BOARD_SIZE = 4;
function weekIndex(now) {
    return Math.floor((now - exports.WEEK_EPOCH_MS) / exports.WEEK_MS);
}
function weekKey(now) {
    return `w${weekIndex(now)}`;
}
/** ms timestamp when the current week ends (next Monday 00:00 UTC). */
function weekEndsAt(now) {
    return exports.WEEK_EPOCH_MS + (weekIndex(now) + 1) * exports.WEEK_MS;
}
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function stringHash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}
/** The week's board: a deterministic, GLOBAL pick (same for every player). */
function pickWeeklyBoard(wkKey, count = exports.WEEKLY_BOARD_SIZE) {
    const take = Math.min(count, exports.WEEKLY_CATALOG.length);
    const rng = mulberry32(stringHash(wkKey));
    const remaining = [...exports.WEEKLY_CATALOG];
    const chosen = [];
    for (let i = 0; i < take; i += 1) {
        chosen.push(remaining.splice(Math.floor(rng() * remaining.length), 1)[0]);
    }
    return chosen;
}
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
/** Progress on one mission = how much its counter rose since the week baseline. */
function computeProgress(mission, baseline, current) {
    return Math.max(0, n(current[mission.counter]) - n(baseline[mission.counter]));
}
/** Snapshot just the tracked counters from a character (the weekly baseline). */
function snapshotCounters(char) {
    const snap = {};
    for (const c of exports.WEEKLY_COUNTERS)
        snap[c] = n(char[c]);
    return snap;
}
