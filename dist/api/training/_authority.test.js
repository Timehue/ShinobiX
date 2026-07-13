"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const _training_config_js_1 = require("../_training-config.js");
const _session_js_1 = require("./_session.js");
const root = process.cwd();
const start = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'api', 'training', 'start.ts'), 'utf8');
const complete = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'api', 'training', 'complete.ts'), 'utf8');
const client = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'shinobij.client', 'src', 'screens', 'Training.tsx'), 'utf8');
(0, node_test_1.test)('training start debits trusted stamina and persists a versioned save', () => {
    strict_1.default.match(start, /withKvLock\(saveKey/);
    strict_1.default.match(start, /stamina < tier\.staminaCost/);
    strict_1.default.match(start, /stamina: stamina - tier\.staminaCost/);
    strict_1.default.match(start, /writeVersionedPlayerSave\(saveKey, \{ \.\.\.record, activeTraining \}, nextCharacter\)/);
});
(0, node_test_1.test)('training rewards ignore forged client modifiers and only one live lease can start', () => {
    strict_1.default.doesNotMatch(start, /trainingBonusPct|warMult/);
    strict_1.default.doesNotMatch(client, /trainingBonusPct|warMult/);
    const tier = _training_config_js_1.TRAINING_TIERS[0];
    strict_1.default.deepEqual((0, _session_js_1.trustedTrainingRewards)(tier), { sealedGain: 6, sealedXp: 20 });
    const active = { token: 'abc123', startedAt: 1_000, endsAt: 2_000, expiresAt: 10_000 };
    strict_1.default.deepEqual((0, _session_js_1.normalizeActiveTrainingSession)(active), active);
    strict_1.default.equal((0, _session_js_1.activeTrainingBlocksStart)(active, true, 5_000), true);
    strict_1.default.equal((0, _session_js_1.activeTrainingBlocksStart)(active, false, 5_000), false, 'a lost token must not strand the player');
    strict_1.default.equal((0, _session_js_1.activeTrainingBlocksStart)(active, true, 10_000), false, 'an expired lease must not block a new session');
    strict_1.default.match(start, /training-active:\$\{playerName\}/);
});
(0, node_test_1.test)('training completion credits the save once with a durable receipt', () => {
    strict_1.default.match(complete, /record\._trainingReceipts/);
    strict_1.default.match(complete, /receipts\.includes\(token\)/);
    strict_1.default.match(complete, /writeVersionedPlayerSave/);
    strict_1.default.match(complete, /_trainingReceipts: nextReceipts/);
    strict_1.default.match(complete, /gainXp\(/);
    strict_1.default.ok(_session_js_1.MAX_TRAINING_RECEIPTS >= 256);
    strict_1.default.match(complete, /activeTraining: null/);
    strict_1.default.match(complete, /active-session cleanup failed after durable receipt/);
});
(0, node_test_1.test)('client requires the server character and has no local reward fallback', () => {
    strict_1.default.doesNotMatch(client, /applyTrainingReward/);
    strict_1.default.doesNotMatch(client, /fall through to local/);
    strict_1.default.match(client, /!data\?\.token \|\| !data\?\.character/);
    strict_1.default.match(client, /updateCharacter\(data\.character as Character\)/);
});
