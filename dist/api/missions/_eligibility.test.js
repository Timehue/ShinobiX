"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _eligibility_js_1 = require("./_eligibility.js");
(0, node_test_1.test)('Hollow Gate Warden missions normalize to level 100 plus Hollow Gate access', () => {
    const eligibility = (0, _eligibility_js_1.normalizeMissionEligibility)({
        id: 'custom-warden',
        name: 'Kill Hollow Gate Warden',
        levelReq: 1,
    });
    strict_1.default.equal(eligibility.minLevel, 100);
    strict_1.default.equal(eligibility.requiresHollowGateUnlocked, true);
});
(0, node_test_1.test)('level 20 players cannot receive level 100 endgame objectives', () => {
    const result = (0, _eligibility_js_1.canPlayerReceiveMission)({ level: 20, village: 'Leaf' }, { id: 'custom-warden', name: 'Kill Hollow Gate Warden', levelReq: 1 }, { systems: { hollowGate: false } });
    strict_1.default.equal(result.ok, false);
    strict_1.default.equal(result.reason, 'level-too-low');
    strict_1.default.equal(result.requiredLevel, 100);
});
(0, node_test_1.test)('level 100 players still need Hollow Gate access for Warden objectives', () => {
    const result = (0, _eligibility_js_1.canPlayerReceiveMission)({ level: 100, village: 'Leaf' }, { id: 'custom-warden', name: 'Kill Hollow Gate Warden' }, { systems: { hollowGate: false } });
    strict_1.default.equal(result.ok, false);
    strict_1.default.equal(result.reason, 'system-locked');
    strict_1.default.equal(result.requiredSystem, 'hollowGate');
});
(0, node_test_1.test)('level 100 players can receive Warden objectives only with Hollow Gate unlocked', () => {
    const result = (0, _eligibility_js_1.canPlayerReceiveMission)({ level: 100, village: 'Leaf' }, { id: 'custom-warden', name: 'Kill Hollow Gate Warden' }, { systems: { hollowGate: true } });
    strict_1.default.equal(result.ok, true);
});
(0, node_test_1.test)('profession, pet, and ranked gates return machine-readable reasons', () => {
    strict_1.default.equal((0, _eligibility_js_1.canPlayerReceiveMission)({ level: 20, profession: 'vanguard', professionRank: 4 }, { name: 'Triage Run', eligibility: { minLevel: 13, requiredProfession: 'healer' } }).reason, 'profession-mismatch');
    strict_1.default.equal((0, _eligibility_js_1.canPlayerReceiveMission)({ level: 20, profession: 'petTamer', professionRank: 4, pets: [] }, { name: 'Coach', eligibility: { minLevel: 13, requiredProfession: 'petTamer', requiresPet: true } }).reason, 'missing-pet');
    strict_1.default.equal((0, _eligibility_js_1.canPlayerReceiveMission)({ level: 20, profession: 'vanguard', professionRank: 4 }, { name: 'Ranked Grinder', eligibility: { minLevel: 10, requiresRankedUnlocked: true } }, { systems: { ranked: false } }).reason, 'system-locked');
});
(0, node_test_1.test)('claim rejects ineligible weekly Warden mission even if posted manually', () => {
    const result = (0, _eligibility_js_1.canPlayerClaimMission)({ level: 37, village: 'Leaf' }, { id: 'wk-hollow-warden', name: 'Hollow Gate Warden', eligibility: { minLevel: 100, requiresHollowGateUnlocked: true } }, { systems: { hollowGate: false } });
    strict_1.default.equal(result.ok, false);
    strict_1.default.equal(result.reason, 'level-too-low');
    strict_1.default.equal(result.requiredLevel, 100);
});
(0, node_test_1.test)('creator mission validation blocks Warden publishing below level 100', () => {
    const result = (0, _eligibility_js_1.validateCreatorMissionEligibility)({
        id: 'admin-warden',
        name: 'Kill Hollow Gate Warden',
        description: 'Defeat the endgame shrine keeper.',
        levelReq: 1,
    });
    strict_1.default.equal(result.ok, false);
    strict_1.default.equal(result.reason, 'missing-hollow-gate-requirement');
    strict_1.default.equal(result.requiredLevel, 100);
    strict_1.default.equal(result.requiredSystem, 'hollowGate');
});
