"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const _clan_points_js_1 = require("./_clan-points.js");
(0, node_test_1.default)('awardClanPoints refuses characters outside a clan', () => {
    const result = (0, _clan_points_js_1.awardClanPoints)({ name: 'solo' }, 'clanMissionContribution', 50, {}, new Date('2026-01-01T12:00:00Z'));
    strict_1.default.equal(result.awarded, 0);
    strict_1.default.equal(result.reason, 'not-in-clan');
});
(0, node_test_1.default)('awardClanPoints rejects unsupported sources', () => {
    const result = (0, _clan_points_js_1.awardClanPoints)({ name: 'donor', clan: 'Leaf' }, 'donation', 50, {}, new Date('2026-01-01T12:00:00Z'));
    strict_1.default.equal(result.awarded, 0);
    strict_1.default.equal(result.reason, 'invalid-source');
});
(0, node_test_1.default)('awardClanPoints applies an all-or-nothing weekly cap', () => {
    const weekKey = (0, _clan_points_js_1.clanPointWeekKey)(new Date('2026-01-01T12:00:00Z'));
    const result = (0, _clan_points_js_1.awardClanPoints)({ name: 'capper', clan: 'Leaf', clanPoints: 900, weeklyClanPoints: 990, weeklyClanPointsWeek: weekKey }, 'clanWarWin', 25, {}, new Date('2026-01-01T12:00:00Z'));
    strict_1.default.equal(result.awarded, 0);
    strict_1.default.equal(result.reason, 'weekly-cap');
    strict_1.default.equal(result.weeklyEarned, 990);
});
(0, node_test_1.default)('awardClanPoints ignores duplicate event IDs', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const weekKey = (0, _clan_points_js_1.clanPointWeekKey)(now);
    const result = (0, _clan_points_js_1.awardClanPoints)({
        name: 'retry',
        clan: 'Leaf',
        clanPoints: 100,
        weeklyClanPoints: 100,
        weeklyClanPointsWeek: weekKey,
        clanPointHistory: [{ id: 'mission:leaf:battle:claim:retry', ts: now.getTime(), source: 'clanMissionClaim', amount: 25, weekKey }],
    }, 'clanMissionClaim', 25, { eventId: 'mission:leaf:battle:claim:retry' }, now);
    strict_1.default.equal(result.awarded, 0);
    strict_1.default.equal(result.reason, 'duplicate-event');
    strict_1.default.equal(result.character.clanPoints, 100);
    strict_1.default.equal(result.weeklyEarned, 100);
});
(0, node_test_1.default)('awardClanPoints resets the weekly meter on a new ISO week', () => {
    const oldWeek = (0, _clan_points_js_1.clanPointWeekKey)(new Date('2026-01-01T12:00:00Z'));
    const nextWeek = new Date('2026-01-08T12:00:00Z');
    const result = (0, _clan_points_js_1.awardClanPoints)({ name: 'reset', clan: 'Leaf', clanPoints: 75, weeklyClanPoints: _clan_points_js_1.CLAN_POINTS_WEEKLY_CAP, weeklyClanPointsWeek: oldWeek }, 'mentorMilestone', 50, {}, nextWeek);
    strict_1.default.equal(result.awarded, 50);
    strict_1.default.equal(result.weeklyEarned, 50);
    strict_1.default.equal(result.character.clanPoints, 125);
    strict_1.default.equal(result.character.weeklyClanPointsWeek, (0, _clan_points_js_1.clanPointWeekKey)(nextWeek));
});
