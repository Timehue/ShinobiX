"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _claim_js_1 = require("./_claim.js");
(0, node_test_1.describe)('built-in event claims', () => {
    (0, node_test_1.it)('grants the Aura Sphere once at level nine', () => {
        const first = (0, _claim_js_1.claimBuiltinEvent)({ level: 9, inventory: [], equipment: {} }, 'builtin-aura-sphere-lv9');
        strict_1.default.equal(first.ok, true);
        if (!first.ok)
            return;
        strict_1.default.deepEqual(first.character.inventory, [_claim_js_1.AURA_SPHERE_ITEM_ID]);
        const replay = (0, _claim_js_1.claimBuiltinEvent)(first.character, 'builtin-aura-sphere-lv9');
        strict_1.default.equal(replay.ok, true);
        if (replay.ok)
            strict_1.default.equal(replay.alreadyClaimed, true);
    });
    (0, node_test_1.it)('rejects early and user-authored reward payload ids', () => {
        strict_1.default.equal((0, _claim_js_1.claimBuiltinEvent)({ level: 8 }, 'builtin-aura-sphere-lv9').ok, false);
        strict_1.default.equal((0, _claim_js_1.claimBuiltinEvent)({ level: 100 }, 'event-forged-million-ryo').ok, false);
    });
});
