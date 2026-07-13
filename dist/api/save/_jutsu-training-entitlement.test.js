"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _name__js_1 = require("./[name].js");
(0, node_test_1.test)('generic saves cannot forge a refundable jutsu-training descriptor or erase action receipts', () => {
    const stored = {
        character: { ryo: 5000, redeemedJutsuTrainingActions: [{ requestId: 'server-request-123', action: 'start' }] },
        activeJutsuTraining: { serverToken: 'server-token', jutsuId: 'fireball', fromLevel: 1, toLevel: 2, ryoCost: 3000, startedAt: 1, endsAt: 2 },
    };
    const incoming = {
        character: { ryo: 5000, redeemedJutsuTrainingActions: [] },
        activeJutsuTraining: { serverToken: 'forged', jutsuId: 'fireball', fromLevel: 1, toLevel: 2, ryoCost: 999999, startedAt: 1, endsAt: 2 },
    };
    const out = (0, _name__js_1.sanitizeCharacterSave)(incoming, stored);
    strict_1.default.deepEqual(out.activeJutsuTraining, stored.activeJutsuTraining);
    strict_1.default.deepEqual(out.character.redeemedJutsuTrainingActions, stored.character.redeemedJutsuTrainingActions);
});
(0, node_test_1.test)('generic saves cannot forge jutsu mastery levels or XP', () => {
    const stored = { character: { jutsuMastery: [{ jutsuId: 'fireball', level: 3, xp: 40 }] } };
    const incoming = { character: { jutsuMastery: [{ jutsuId: 'fireball', level: 50, xp: 999999 }, { jutsuId: 'forged', level: 50, xp: 999999 }] } };
    const out = (0, _name__js_1.sanitizeCharacterSave)(incoming, stored);
    strict_1.default.deepEqual(out.character.jutsuMastery, stored.character.jutsuMastery);
});
(0, node_test_1.test)('first save can only seed normalized level-one mastery rows', () => {
    const out = (0, _name__js_1.sanitizeCharacterSave)({ character: { jutsuMastery: [{ jutsuId: 'Starter-Fire-1', level: 50, xp: 999999 }] } }, null);
    strict_1.default.deepEqual(out.character.jutsuMastery, [{ jutsuId: 'starter-fire-1', level: 1, xp: 0 }]);
});
