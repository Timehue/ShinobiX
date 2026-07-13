"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _locked_door_js_1 = require("./_locked-door.js");
(0, node_test_1.describe)('Hollow Gate locked-door authority', () => {
    (0, node_test_1.it)('keeps the canonical outcome and rarity bands', () => {
        const chestValues = [0.1, 0.4, 0.5, 0.1, 0.5];
        let chestIndex = 0;
        const chest = (0, _locked_door_js_1.rollHollowLockedDoor)(() => chestValues[chestIndex++] ?? 0.5, 1, 5);
        strict_1.default.equal(chest.outcome, 'chest');
        strict_1.default.equal(chest.loot?.xp, 150);
        strict_1.default.equal(chest.loot?.hollowShards, 15);
        strict_1.default.equal((0, _locked_door_js_1.rollHollowLockedDoor)(() => 0.6).outcome, 'trap');
        for (const [roll, rarity] of [[0.8, 'rare'], [0.995, 'legendary'], [0.999, 'mythic']]) {
            const values = [roll, 0];
            let i = 0;
            const result = (0, _locked_door_js_1.rollHollowLockedDoor)(() => values[i++] ?? 0, 123);
            strict_1.default.equal(result.outcome, 'pet');
            strict_1.default.equal(result.rarity, rarity);
            strict_1.default.equal(result.pet?.rarity, rarity);
            strict_1.default.match(String(result.pet?.id), /-hg-123$/);
        }
    });
    (0, node_test_1.it)('bounds distinct locked-door rolls by sealed depth', () => {
        strict_1.default.equal((0, _locked_door_js_1.maxLockedDoorsForDepth)(1), 3);
        strict_1.default.equal((0, _locked_door_js_1.maxLockedDoorsForDepth)(5), 15);
        strict_1.default.equal((0, _locked_door_js_1.maxLockedDoorsForDepth)(999), 60);
    });
});
