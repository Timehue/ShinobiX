"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
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
    (0, node_test_1.it)('settleFinishedTraining leaves a still-running session untouched', () => {
        const training = { type: 'strength', endsAt: 10_000, sealedXp: 100 };
        const pet = { rarity: 'standard', level: 1, maxLevel: 100, xp: 0, hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [], training };
        const out = (0, _progress_js_1.settleFinishedTraining)(pet, 5_000); // now < endsAt
        strict_1.default.equal(out.settledFocus, null);
        strict_1.default.equal(out.pet, pet); // returned unchanged (same reference)
        strict_1.default.deepEqual(out.pet.training, training);
    });
    (0, node_test_1.it)('settleFinishedTraining pays out and clears a finished session', () => {
        const pet = { rarity: 'standard', level: 1, maxLevel: 100, xp: 0, hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [{ power: 50 }], training: { type: 'strength', endsAt: 10_000, sealedXp: 100 } };
        const out = (0, _progress_js_1.settleFinishedTraining)(pet, 20_000); // now >= endsAt
        strict_1.default.equal(out.settledFocus, 'strength');
        strict_1.default.equal(out.pet.training, undefined); // property removed, not `undefined`-valued
        strict_1.default.ok(!('training' in out.pet));
        strict_1.default.equal(out.pet.level, 2); // 100 XP = one level-up at level 1
        strict_1.default.equal(out.pet.attack, 42); // strength channels the growth into attack
    });
    (0, node_test_1.it)('settleFinishedTraining nudges happiness on a finished bond session', () => {
        const pet = { rarity: 'standard', level: 1, maxLevel: 100, xp: 0, happiness: 50, hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [], training: { type: 'bond', endsAt: 0, sealedXp: 60 } };
        const out = (0, _progress_js_1.settleFinishedTraining)(pet, 1);
        strict_1.default.equal(out.settledFocus, 'bond');
        strict_1.default.equal(out.pet.happiness, 55);
    });
    (0, node_test_1.it)('start-training self-heals a finished session instead of trapping the pet', () => {
        const progress = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'api', 'pet', 'progress.ts'), 'utf8');
        const helper = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'api', 'pet', '_progress.ts'), 'utf8');
        // Both the explicit collect AND the start-time self-heal settle via the one shared helper.
        strict_1.default.match(progress, /settleFinishedTraining/);
        // A still-running (not-yet-finished) session still blocks a fresh start.
        strict_1.default.match(progress, /Collect the previous training before starting another/);
        // The settle removes the property; it must NEVER persist `training: undefined`.
        strict_1.default.match(helper, /delete idle\.training/);
        strict_1.default.doesNotMatch(progress, /training: undefined/);
        strict_1.default.doesNotMatch(helper, /training: undefined/);
    });
});
