"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _profession_mastery_js_1 = require("./_profession-mastery.js");
const VAN_CAP = 32_850;
const HEAL_CAP = 49_275;
(0, node_test_1.test)('masteryBudget: 0 below the wall, scales, caps at 10, healer uses 1.5x wall', () => {
    strict_1.default.equal((0, _profession_mastery_js_1.masteryBudget)('vanguard', VAN_CAP), 0);
    strict_1.default.equal((0, _profession_mastery_js_1.masteryBudget)('vanguard', VAN_CAP + 15_000), 1);
    strict_1.default.equal((0, _profession_mastery_js_1.masteryBudget)('vanguard', VAN_CAP + 6 * 15_000), 6);
    strict_1.default.equal((0, _profession_mastery_js_1.masteryBudget)('vanguard', VAN_CAP + 999 * 15_000), 10);
    strict_1.default.equal((0, _profession_mastery_js_1.masteryBudget)('healer', VAN_CAP + 15_000), 0); // higher wall
    strict_1.default.equal((0, _profession_mastery_js_1.masteryBudget)('healer', HEAL_CAP + 15_000), 1);
    strict_1.default.equal((0, _profession_mastery_js_1.masteryBudget)('nope', 9e9), 0);
});
(0, node_test_1.test)('sanitizeMasterySpec clamps an over-budget forged spec', () => {
    // Forge everything; budget only 4.
    const forged = { 'heal-cooldown': 3, 'heal-amount': 3, 'mass-triage': 1, 'heal-power': 3 };
    const out = (0, _profession_mastery_js_1.sanitizeMasterySpec)('healer', forged, 4);
    const spent = Object.entries(out).reduce((s, [id, r]) => s + r * (id === 'mass-triage' ? 2 : 1), 0);
    strict_1.default.ok(spent <= 4, `spent ${spent} > 4`);
    strict_1.default.ok(!out['mass-triage'], 'ungated/over-budget capstone dropped');
});
(0, node_test_1.test)('sanitizeMasterySpec keeps a legal full path with capstone', () => {
    const out = (0, _profession_mastery_js_1.sanitizeMasterySpec)('petTamer', { 'exp-rewards': 3, 'exp-materials': 3, 'caravan-master': 1 }, 8);
    strict_1.default.equal(out['exp-rewards'], 3);
    strict_1.default.equal(out['exp-materials'], 3);
    strict_1.default.equal(out['caravan-master'], 1);
});
(0, node_test_1.test)('sanitizeMasterySpec drops a capstone whose path gate is not met', () => {
    // Only 3 points in the path (gate is 4) → capstone rejected even with budget.
    const out = (0, _profession_mastery_js_1.sanitizeMasterySpec)('vanguard', { 'seal-gap': 3, 'warmonger': 1 }, 10);
    strict_1.default.equal(out['seal-gap'], 3);
    strict_1.default.ok(!out['warmonger']);
});
(0, node_test_1.test)('sanitizeMasterySpec rejects unknown ids, bad profession, non-objects', () => {
    strict_1.default.deepEqual((0, _profession_mastery_js_1.sanitizeMasterySpec)('healer', { 'not-a-node': 5, 'heal-power': 2 }, 10), { 'heal-power': 2 });
    strict_1.default.deepEqual((0, _profession_mastery_js_1.sanitizeMasterySpec)('bogus', { 'heal-power': 2 }, 10), {});
    strict_1.default.deepEqual((0, _profession_mastery_js_1.sanitizeMasterySpec)('healer', null, 10), {});
});
(0, node_test_1.test)('sanitizeMasterySpec caps node ranks at their max', () => {
    const out = (0, _profession_mastery_js_1.sanitizeMasterySpec)('petTamer', { 'pet-damage': 99 }, 10);
    strict_1.default.equal(out['pet-damage'], 3);
});
