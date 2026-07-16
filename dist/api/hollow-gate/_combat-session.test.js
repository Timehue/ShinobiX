"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const _combat_session_js_1 = require("./_combat-session.js");
const token = 'sealed-hollow-gate-token';
const playerName = 'beta-player';
const binding = (0, _combat_session_js_1.createHollowGateCombatBinding)({
    playerName,
    token,
    floor: 3,
    nodeId: 'floor:3:tile:127',
    kind: 'elite',
    now: 1_000,
    runId: 'hgcombat-fixed',
});
const activeEncounter = {
    runId: binding.runId,
    nodeId: binding.nodeId,
    floor: binding.floor,
    kind: binding.kind,
    enemyProfileId: binding.enemyProfileId,
    createdAt: binding.createdAt,
};
const session = {
    runId: binding.runId,
    status: 'done',
    winner: 'squad',
    actors: [{ side: 'squad', ownerSlug: playerName }],
};
function reason(result) {
    strict_1.default.equal(result.ok, false);
    return result.ok ? 'unexpected-success' : result.reason;
}
(0, node_test_1.test)('Hollow Gate combat validates the exact player, token, run, node, floor, kind and enemy binding', () => {
    strict_1.default.equal((0, _combat_session_js_1.validateHollowGateCombatSession)({ binding, session, activeEncounter, playerName, token }).ok, true);
    strict_1.default.equal(reason((0, _combat_session_js_1.validateHollowGateCombatSession)({ binding, session, activeEncounter, playerName: 'attacker', token })), 'wrong-player');
    strict_1.default.equal(reason((0, _combat_session_js_1.validateHollowGateCombatSession)({ binding, session, activeEncounter, playerName, token: 'forged' })), 'wrong-token');
    strict_1.default.equal(reason((0, _combat_session_js_1.validateHollowGateCombatSession)({ binding, session: { ...session, runId: 'other' }, activeEncounter, playerName, token })), 'wrong-run');
    strict_1.default.equal(reason((0, _combat_session_js_1.validateHollowGateCombatSession)({ binding, session, activeEncounter: { ...activeEncounter, nodeId: 'floor:3:tile:128' }, playerName, token })), 'binding-drift');
    strict_1.default.equal(reason((0, _combat_session_js_1.validateHollowGateCombatSession)({ binding, session: { ...session, status: 'active' }, activeEncounter, playerName, token })), 'not-complete');
    strict_1.default.equal(reason((0, _combat_session_js_1.validateHollowGateCombatSession)({ binding, session: { ...session, actors: [] }, activeEncounter, playerName, token })), 'not-a-member');
});
(0, node_test_1.test)('Hollow Gate combat binding settles once and rejects replay', () => {
    const settled = (0, _combat_session_js_1.settleHollowGateCombatBinding)(binding, true, 2_000);
    strict_1.default.equal(settled.status, 'won');
    strict_1.default.equal(settled.settledAt, 2_000);
    strict_1.default.equal(reason((0, _combat_session_js_1.validateHollowGateCombatSession)({ binding: settled, session, activeEncounter, playerName, token })), 'already-settled');
    strict_1.default.deepEqual((0, _combat_session_js_1.settleHollowGateCombatBinding)(settled, false, 3_000), settled);
});
(0, node_test_1.test)('node ids are bounded and encounter receipts include kind to prevent boss replay on a second node', () => {
    strict_1.default.equal((0, _combat_session_js_1.normalizeHollowGateNodeId)('floor:5:tile:321'), 'floor:5:tile:321');
    strict_1.default.equal((0, _combat_session_js_1.normalizeHollowGateNodeId)('floor:5:ambush:threat-1'), 'floor:5:ambush:threat-1');
    strict_1.default.equal((0, _combat_session_js_1.normalizeHollowGateNodeId)('../tower:attacker'), '');
    strict_1.default.notEqual((0, _combat_session_js_1.hollowGateEncounterKey)(5, 'boss', 'floor:5:tile:1'), (0, _combat_session_js_1.hollowGateEncounterKey)(5, 'battle', 'floor:5:tile:1'));
});
(0, node_test_1.test)('server reward table preserves the shipped floor scaling and profession rules', () => {
    strict_1.default.deepEqual((0, _combat_session_js_1.hollowGateCombatReward)(1, 'battle'), {
        xp: 140, ryo: 380, auraDust: 5, honorSeals: 0, boneCharms: 0,
        fateShards: 0, hollowShards: 0, fragments: 0, veils: 0,
    });
    const boss = (0, _combat_session_js_1.hollowGateCombatReward)(5, 'boss', 'vanguard');
    strict_1.default.equal(boss.xp, 1080);
    strict_1.default.equal(boss.ryo, 4320);
    strict_1.default.equal(boss.auraDust, 54);
    strict_1.default.equal(boss.honorSeals, 120);
    strict_1.default.equal(boss.boneCharms, 14);
    strict_1.default.equal(boss.fateShards, 5);
    strict_1.default.equal(boss.hollowShards, 40);
    strict_1.default.equal(boss.fragments, 2);
    strict_1.default.equal(boss.veils, 1);
});
(0, node_test_1.test)('Second Wind is sealed into one combat binding and cannot be added at settlement', () => {
    strict_1.default.equal(binding.secondWindArmed, undefined);
    const armed = (0, _combat_session_js_1.createHollowGateCombatBinding)({
        playerName, token, floor: 2, nodeId: 'floor:2:tile:9', kind: 'battle', secondWindArmed: true,
    });
    strict_1.default.deepEqual((0, _combat_session_js_1.hollowGateCombatReward)(4, 'elite'), (0, _combat_session_js_1.hollowGateCombatReward)(4, 'battle'));
    strict_1.default.deepEqual((0, _combat_session_js_1.hollowGateCombatReward)(4, 'beast'), (0, _combat_session_js_1.hollowGateCombatReward)(4, 'battle'));
    strict_1.default.equal(armed.secondWindArmed, true);
    strict_1.default.equal((0, _combat_session_js_1.settleHollowGateCombatBinding)(armed, false).secondWindArmed, true);
});
(0, node_test_1.test)('server settlement preserves the shipped post-win HP recovery', () => {
    strict_1.default.equal((0, _combat_session_js_1.hollowGatePostWinHp)(500, 120, 'battle'), 140);
    strict_1.default.equal((0, _combat_session_js_1.hollowGatePostWinHp)(500, 120, 'boss'), 180);
    strict_1.default.equal((0, _combat_session_js_1.hollowGatePostWinHp)(150, 140, 'boss'), 150);
});
