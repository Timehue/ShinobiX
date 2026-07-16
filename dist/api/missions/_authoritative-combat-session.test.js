"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const _mission_catalog_js_1 = require("./_mission-catalog.js");
const _authoritative_combat_session_js_1 = require("./_authoritative-combat-session.js");
function rejectionReason(result) {
    strict_1.default.equal(result.ok, false);
    return result.ok ? 'unexpected-success' : result.reason;
}
const mission = (0, _mission_catalog_js_1.combatMissionByKey)('combat-c-patrol');
const now = Date.UTC(2026, 6, 14, 12);
const session = {
    runId: 'tower-mission-run-1',
    status: 'done',
    winner: 'squad',
    actors: [{ side: 'squad', ownerSlug: 'beta-cert-player' }],
};
(0, node_test_1.test)('sealed mission binding accepts only its completed winning server session', () => {
    const binding = (0, _authoritative_combat_session_js_1.createMissionCombatBinding)({
        runId: session.runId,
        playerName: 'beta-cert-player',
        mission,
        now,
        sessionId: 'mcombat-fixed',
    });
    const result = (0, _authoritative_combat_session_js_1.validateCompletedMissionCombatSession)({ binding, session, playerName: 'beta-cert-player', mission, now: now + 1000 });
    strict_1.default.equal(result.ok, true);
    strict_1.default.equal(binding.rewardFingerprint, (0, _authoritative_combat_session_js_1.missionCombatRewardFingerprint)(mission));
});
(0, node_test_1.test)('mission binding rejects wrong player, mission, run, expiry, unfinished and losing sessions', () => {
    const binding = (0, _authoritative_combat_session_js_1.createMissionCombatBinding)({ runId: session.runId, playerName: 'beta-cert-player', mission, now });
    const otherMission = (0, _mission_catalog_js_1.combatMissionByKey)('combat-b-escort');
    strict_1.default.equal(rejectionReason((0, _authoritative_combat_session_js_1.validateCompletedMissionCombatSession)({ binding, session, playerName: 'attacker', mission, now })), 'wrong-player');
    strict_1.default.equal(rejectionReason((0, _authoritative_combat_session_js_1.validateCompletedMissionCombatSession)({ binding, session, playerName: 'beta-cert-player', mission: otherMission, now })), 'wrong-mission');
    strict_1.default.equal(rejectionReason((0, _authoritative_combat_session_js_1.validateCompletedMissionCombatSession)({ binding, session: { ...session, runId: 'other' }, playerName: 'beta-cert-player', mission, now })), 'wrong-run');
    strict_1.default.equal(rejectionReason((0, _authoritative_combat_session_js_1.validateCompletedMissionCombatSession)({ binding, session, playerName: 'beta-cert-player', mission, now: binding.expiresAt })), 'expired');
    strict_1.default.equal(rejectionReason((0, _authoritative_combat_session_js_1.validateCompletedMissionCombatSession)({ binding, session: { ...session, status: 'active' }, playerName: 'beta-cert-player', mission, now })), 'not-complete');
    strict_1.default.equal(rejectionReason((0, _authoritative_combat_session_js_1.validateCompletedMissionCombatSession)({ binding, session: { ...session, winner: 'enemy' }, playerName: 'beta-cert-player', mission, now })), 'not-won');
});
(0, node_test_1.test)('mission binding rejects non-member settlement, reward drift, and replay', () => {
    const binding = (0, _authoritative_combat_session_js_1.createMissionCombatBinding)({ runId: session.runId, playerName: 'beta-cert-player', mission, now });
    strict_1.default.equal(rejectionReason((0, _authoritative_combat_session_js_1.validateCompletedMissionCombatSession)({
        binding,
        session: { ...session, actors: [{ side: 'squad', ownerSlug: 'someone-else' }] },
        playerName: 'beta-cert-player', mission, now,
    })), 'not-a-member');
    strict_1.default.equal(rejectionReason((0, _authoritative_combat_session_js_1.validateCompletedMissionCombatSession)({
        binding: { ...binding, rewardFingerprint: 'forged' }, session, playerName: 'beta-cert-player', mission, now,
    })), 'reward-drift');
    const settled = (0, _authoritative_combat_session_js_1.settleMissionCombatBinding)(binding, now + 5);
    strict_1.default.equal(rejectionReason((0, _authoritative_combat_session_js_1.validateCompletedMissionCombatSession)({ binding: settled, session, playerName: 'beta-cert-player', mission, now: now + 6 })), 'already-settled');
    strict_1.default.deepEqual((0, _authoritative_combat_session_js_1.settleMissionCombatBinding)(settled, now + 7), settled);
});
