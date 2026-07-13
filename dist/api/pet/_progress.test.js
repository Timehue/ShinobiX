"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _progress_js_1 = require("./_progress.js");
(0, node_test_1.describe)('server pet progression', () => {
    (0, node_test_1.it)('levels from bounded XP and channels growth into the chosen stat', () => {
        const pet = { rarity: 'standard', level: 1, maxLevel: 100, xp: 0, hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [{ power: 50 }] };
        const out = (0, _progress_js_1.gainServerPetXp)(pet, 100, 'strength');
        strict_1.default.equal(out.level, 2);
        strict_1.default.equal(out.attack, 42);
        strict_1.default.equal(out.hp, 320);
    });
    (0, node_test_1.it)('consumes one counted or legacy inventory treat', () => {
        strict_1.default.deepEqual((0, _progress_js_1.removePetItem)({ itemStacks: [{ itemId: 'pet-treat', count: 2 }] }, 'pet-treat')?.itemStacks, [{ itemId: 'pet-treat', count: 1 }]);
        strict_1.default.deepEqual((0, _progress_js_1.removePetItem)({ inventory: ['pet-treat', 'x'] }, 'pet-treat')?.inventory, ['x']);
    });
    (0, node_test_1.it)('settles expedition combat growth and clears the server session', () => {
        const pet = { rarity: 'standard', level: 1, maxLevel: 100, xp: 0, hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [], expedition: { type: 'scout' } };
        const out = (0, _progress_js_1.settleServerPetExpedition)(pet, 'scout', 45, 1);
        strict_1.default.equal(out.pet.expedition, undefined);
        strict_1.default.equal(out.statGain, 1);
        strict_1.default.ok(Number(out.pet.attack) > 40);
    });
});
