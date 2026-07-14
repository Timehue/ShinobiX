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
    const requestStart = client.indexOf("fetch('/api/training/start'");
    const requestEnd = client.indexOf('const data = await res.json()', requestStart);
    const startCall = client.slice(requestStart, requestEnd);
    strict_1.default.doesNotMatch(startCall, /trainingBonusPct|warMult/, 'the start request must not send client reward modifiers');
    const tier = _training_config_js_1.TRAINING_TIERS[0];
    strict_1.default.deepEqual((0, _session_js_1.trustedTrainingRewards)(tier), { sealedGain: 6, sealedXp: 20 });
    const active = { token: 'abc123', startedAt: 1_000, endsAt: 2_000, expiresAt: 10_000 };
    strict_1.default.deepEqual((0, _session_js_1.normalizeActiveTrainingSession)(active), active);
    strict_1.default.equal((0, _session_js_1.activeTrainingBlocksStart)(active), true);
    strict_1.default.equal((0, _session_js_1.activeTrainingBlocksStart)({ ...active, expiresAt: 2_001 }), true, 'cache expiry cannot overwrite an unclaimed saved reward');
    strict_1.default.deepEqual((0, _session_js_1.storedTrainingGrant)({ ...active, stat: 'strength', statGain: 22, xp: 70 }, active.token), {
        stat: 'strength', startedAt: 1_000, endsAt: 2_000, sealedGain: 22, sealedXp: 70,
    });
    strict_1.default.equal((0, _session_js_1.storedTrainingGrant)({ ...active, stat: 'strength', statGain: 22, xp: 70 }, 'newer-token'), null, 'a stale request cannot use another lease');
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
    strict_1.default.match(complete, /activeTrainingMatches\(record\.activeTraining, token\)/, 'a stale completion cannot clear a newly-started session');
    strict_1.default.match(complete, /storedTrainingGrant\(record\.activeTraining, token\)/, 'cache expiry falls back to the protected saved grant');
    strict_1.default.match(complete, /activeTraining: record\.activeTraining \?\? null/, 'an old idempotent retry preserves any newer lease');
    strict_1.default.match(complete, /activeTraining: result\.activeTraining/, 'the client receives the authoritative lease explicitly');
    strict_1.default.match(complete, /if \(!result\.activeTraining\)/, 'old retries cannot delete the compatibility marker for a newer lease');
    strict_1.default.match(complete, /active-session cleanup failed after durable receipt/);
});
(0, node_test_1.test)('client requires the server character and has no local reward fallback', () => {
    strict_1.default.doesNotMatch(client, /applyTrainingReward/);
    strict_1.default.doesNotMatch(client, /fall through to local/);
    strict_1.default.match(client, /!data\?\.token \|\| !data\?\.character/);
    strict_1.default.match(client, /updateCharacter\(data\.character as Character\)/);
    strict_1.default.match(client, /setActiveTraining\(data\.activeTraining \?\? null\)/, 'collect applies the server-cleared lease before another start');
});
