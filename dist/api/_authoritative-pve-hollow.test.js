"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const _authoritative_pve_js_1 = require("./_authoritative-pve.js");
function statTotal(template) {
    return Object.values(template.stats).reduce((sum, value) => sum + Number(value || 0), 0);
}
(0, node_test_1.test)('one-floor event bosses reach the same sealed final-floor strength', () => {
    const oneFloor = (0, _authoritative_pve_js_1.hollowGateEnemyTemplate)({ playerLevel: 30, floor: 1, maxFloor: 1, kind: 'boss', profileId: 'boss' });
    const standardFinal = (0, _authoritative_pve_js_1.hollowGateEnemyTemplate)({ playerLevel: 30, floor: 5, maxFloor: 5, kind: 'boss', profileId: 'boss' });
    strict_1.default.equal(oneFloor.level, 45);
    strict_1.default.equal(oneFloor.level, standardFinal.level);
    strict_1.default.equal(oneFloor.hp, standardFinal.hp);
});
(0, node_test_1.test)('sealed augments and pet assistance preserve their shipped Hollow Gate combat effects', () => {
    const base = (0, _authoritative_pve_js_1.hollowGateEnemyTemplate)({ playerLevel: 30, floor: 3, maxFloor: 5, kind: 'battle', profileId: 'mob' });
    const greedy = (0, _authoritative_pve_js_1.hollowGateEnemyTemplate)({ playerLevel: 30, floor: 3, maxFloor: 5, kind: 'battle', profileId: 'mob', combatEffect: { kind: 'enemyPower', value: 0.3 } });
    const warded = (0, _authoritative_pve_js_1.hollowGateEnemyTemplate)({ playerLevel: 30, floor: 3, maxFloor: 5, kind: 'battle', profileId: 'mob', combatEffect: { kind: 'roleShield', value: 0.15 } });
    const assisted = (0, _authoritative_pve_js_1.hollowGateEnemyTemplate)({ playerLevel: 30, floor: 3, maxFloor: 5, kind: 'battle', profileId: 'mob', petLevel: 50 });
    strict_1.default.ok(greedy.hp > base.hp);
    strict_1.default.ok(statTotal(greedy) > statTotal(base));
    strict_1.default.ok(statTotal(warded) < statTotal(base));
    strict_1.default.ok(assisted.hp < base.hp);
});
(0, node_test_1.test)('rift non-boss encounters keep the shipped gentle scaling', () => {
    const base = (0, _authoritative_pve_js_1.hollowGateEnemyTemplate)({ playerLevel: 40, floor: 2, maxFloor: 2, kind: 'ambush', profileId: 'mob' });
    const gentle = (0, _authoritative_pve_js_1.hollowGateEnemyTemplate)({ playerLevel: 40, floor: 2, maxFloor: 2, kind: 'ambush', profileId: 'mob', gentleNonBoss: true });
    strict_1.default.ok(gentle.hp < base.hp);
    strict_1.default.ok(statTotal(gentle) < statTotal(base));
});
