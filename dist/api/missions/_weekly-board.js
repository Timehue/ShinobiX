"use strict";
/*
 * Weekly mission board - a global rotating catalog filtered per player.
 *
 * The raw weekly pick is seeded by the week key only, but the handler returns a
 * player-eligible view. If a global mission is locked for the player, safe
 * mission-completion fallbacks fill the visible slots so low-level players never
 * lose weekly capacity to impossible endgame objectives.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEEKLY_BOARD_SIZE = exports.WEEK_MS = exports.WEEK_EPOCH_MS = exports.WEEKLY_CLAIMABLE_CATALOG = exports.WEEKLY_FALLBACK_CATALOG = exports.WEEKLY_CATALOG = exports.WEEKLY_COUNTERS = void 0;
exports.weekIndex = weekIndex;
exports.weekKey = weekKey;
exports.weekEndsAt = weekEndsAt;
exports.pickWeeklyBoard = pickWeeklyBoard;
exports.pickWeeklyBoardForPlayer = pickWeeklyBoardForPlayer;
exports.computeProgress = computeProgress;
exports.snapshotCounters = snapshotCounters;
const _eligibility_js_1 = require("./_eligibility.js");
exports.WEEKLY_COUNTERS = [
    'rankedWins',
    'totalMissionsCompleted',
    'hollowGateWardenKills',
];
const rankedEligibility = { minLevel: 10, requiresRankedUnlocked: true };
const safeEligibility = { minLevel: 1 };
const hollowGateWardenEligibility = {
    minLevel: 100,
    requiresHollowGateUnlocked: true,
};
exports.WEEKLY_CATALOG = [
    { id: 'wk-ranked-3', name: 'Ladder Climber', desc: 'Win 3 ranked matches.', counter: 'rankedWins', target: 3, reward: { ryo: 4000, fateShards: 1 }, eligibility: rankedEligibility },
    { id: 'wk-ranked-7', name: 'Ranked Grinder', desc: 'Win 7 ranked matches.', counter: 'rankedWins', target: 7, reward: { ryo: 8000, fateShards: 2 }, eligibility: rankedEligibility },
    { id: 'wk-missions-10', name: 'Dutiful', desc: 'Complete 10 missions.', counter: 'totalMissionsCompleted', target: 10, reward: { ryo: 4000, boneCharms: 2 }, eligibility: safeEligibility },
    { id: 'wk-missions-25', name: 'Tireless', desc: 'Complete 25 missions.', counter: 'totalMissionsCompleted', target: 25, reward: { ryo: 8000, fateShards: 2 }, eligibility: safeEligibility },
    { id: 'wk-hollow-warden', name: 'Hollow Gate Warden', desc: 'Defeat the Hollow Gate Warden once.', counter: 'hollowGateWardenKills', target: 1, reward: { ryo: 12000, fateShards: 3, boneCharms: 4 }, eligibility: hollowGateWardenEligibility },
];
exports.WEEKLY_FALLBACK_CATALOG = [
    { id: 'wk-safe-missions-5', name: 'Reliable Shinobi', desc: 'Complete 5 missions.', counter: 'totalMissionsCompleted', target: 5, reward: { ryo: 2500, boneCharms: 1 }, eligibility: safeEligibility },
    { id: 'wk-safe-missions-15', name: 'Steady Service', desc: 'Complete 15 missions.', counter: 'totalMissionsCompleted', target: 15, reward: { ryo: 5500, boneCharms: 2 }, eligibility: safeEligibility },
    { id: 'wk-safe-missions-20', name: 'Village Backbone', desc: 'Complete 20 missions.', counter: 'totalMissionsCompleted', target: 20, reward: { ryo: 6500, fateShards: 1 }, eligibility: safeEligibility },
];
exports.WEEKLY_CLAIMABLE_CATALOG = [
    ...exports.WEEKLY_CATALOG,
    ...exports.WEEKLY_FALLBACK_CATALOG,
];
exports.WEEK_EPOCH_MS = Date.UTC(2024, 0, 1);
exports.WEEK_MS = 7 * 24 * 60 * 60 * 1000;
exports.WEEKLY_BOARD_SIZE = 4;
function weekIndex(now) {
    return Math.floor((now - exports.WEEK_EPOCH_MS) / exports.WEEK_MS);
}
function weekKey(now) {
    return `w${weekIndex(now)}`;
}
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
function pickFromWeeklyPool(pool, seed, count) {
    const take = Math.min(count, pool.length);
    const rng = mulberry32(stringHash(seed));
    const remaining = [...pool];
    const chosen = [];
    for (let i = 0; i < take; i += 1) {
        chosen.push(remaining.splice(Math.floor(rng() * remaining.length), 1)[0]);
    }
    return chosen;
}
function pickWeeklyBoard(wkKey, count = exports.WEEKLY_BOARD_SIZE) {
    return pickFromWeeklyPool(exports.WEEKLY_CATALOG, wkKey, count);
}
function pickWeeklyBoardForPlayer(wkKey, character, count = exports.WEEKLY_BOARD_SIZE, context = {}) {
    const selected = pickWeeklyBoard(wkKey, count);
    const visible = selected.filter((mission) => (0, _eligibility_js_1.canPlayerReceiveMission)(character ?? {}, mission, context).ok);
    const used = new Set(visible.map((mission) => mission.id));
    if (visible.length >= count)
        return visible.slice(0, count);
    const fillerPool = pickFromWeeklyPool(exports.WEEKLY_CLAIMABLE_CATALOG.filter((mission) => !used.has(mission.id) && (0, _eligibility_js_1.canPlayerReceiveMission)(character ?? {}, mission, context).ok), `${wkKey}:fallback`, exports.WEEKLY_CLAIMABLE_CATALOG.length);
    for (const mission of fillerPool) {
        if (used.has(mission.id))
            continue;
        visible.push(mission);
        used.add(mission.id);
        if (visible.length >= count)
            break;
    }
    return visible;
}
function n(v) {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
}
function computeProgress(mission, baseline, current) {
    return Math.max(0, n(current[mission.counter]) - n(baseline[mission.counter]));
}
function snapshotCounters(char) {
    const snap = {};
    for (const c of exports.WEEKLY_COUNTERS)
        snap[c] = n(char[c]);
    return snap;
}
