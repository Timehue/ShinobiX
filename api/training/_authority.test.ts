import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRAINING_TIERS } from '../_training-config.js';
import {
    MAX_TRAINING_RECEIPTS,
    activeTrainingBlocksStart,
    normalizeActiveTrainingSession,
    storedTrainingGrant,
    trustedTrainingRewards,
} from './_session.js';

const root = process.cwd();
const start = readFileSync(join(root, 'api', 'training', 'start.ts'), 'utf8');
const complete = readFileSync(join(root, 'api', 'training', 'complete.ts'), 'utf8');
const client = readFileSync(join(root, 'shinobij.client', 'src', 'screens', 'Training.tsx'), 'utf8');

test('training start debits trusted stamina and persists a versioned save', () => {
    assert.match(start, /withKvLock\(saveKey/);
    assert.match(start, /stamina < tier\.staminaCost/);
    assert.match(start, /stamina: stamina - tier\.staminaCost/);
    assert.match(start, /writeVersionedPlayerSave\(saveKey, \{ \.\.\.record, activeTraining \}, nextCharacter\)/);
});

test('training rewards ignore forged client modifiers and only one live lease can start', () => {
    assert.doesNotMatch(start, /trainingBonusPct|warMult/);
    const requestStart = client.indexOf("fetch('/api/training/start'");
    const requestEnd = client.indexOf('const data = await res.json()', requestStart);
    const startCall = client.slice(requestStart, requestEnd);
    assert.doesNotMatch(startCall, /trainingBonusPct|warMult/, 'the start request must not send client reward modifiers');
    const tier = TRAINING_TIERS[0];
    assert.deepEqual(trustedTrainingRewards(tier), { sealedGain: 6, sealedXp: 20 });

    const active = { token: 'abc123', startedAt: 1_000, endsAt: 2_000, expiresAt: 10_000 };
    assert.deepEqual(normalizeActiveTrainingSession(active), active);
    assert.equal(activeTrainingBlocksStart(active), true);
    assert.equal(activeTrainingBlocksStart({ ...active, expiresAt: 2_001 }), true, 'cache expiry cannot overwrite an unclaimed saved reward');
    assert.deepEqual(storedTrainingGrant({ ...active, stat: 'strength', statGain: 22, xp: 70 }, active.token), {
        stat: 'strength', startedAt: 1_000, endsAt: 2_000, sealedGain: 22, sealedXp: 70,
    });
    assert.equal(storedTrainingGrant({ ...active, stat: 'strength', statGain: 22, xp: 70 }, 'newer-token'), null, 'a stale request cannot use another lease');
    assert.match(start, /training-active:\$\{playerName\}/);
});

test('training completion credits the save once with a durable receipt', () => {
    assert.match(complete, /record\._trainingReceipts/);
    assert.match(complete, /receipts\.includes\(token\)/);
    assert.match(complete, /writeVersionedPlayerSave/);
    assert.match(complete, /_trainingReceipts: nextReceipts/);
    assert.match(complete, /gainXp\(/);
    assert.ok(MAX_TRAINING_RECEIPTS >= 256);
    assert.match(complete, /activeTraining: null/);
    assert.match(complete, /activeTrainingMatches\(record\.activeTraining, token\)/, 'a stale completion cannot clear a newly-started session');
    assert.match(complete, /storedTrainingGrant\(record\.activeTraining, token\)/, 'cache expiry falls back to the protected saved grant');
    assert.match(complete, /activeTraining: record\.activeTraining \?\? null/, 'an old idempotent retry preserves any newer lease');
    assert.match(complete, /activeTraining: result\.activeTraining/, 'the client receives the authoritative lease explicitly');
    assert.match(complete, /if \(!result\.activeTraining\)/, 'old retries cannot delete the compatibility marker for a newer lease');
    assert.match(complete, /active-session cleanup failed after durable receipt/);
});

test('client requires the server character and has no local reward fallback', () => {
    assert.doesNotMatch(client, /applyTrainingReward/);
    assert.doesNotMatch(client, /fall through to local/);
    assert.match(client, /!data\?\.token \|\| !data\?\.character/);
    assert.match(client, /updateCharacter\(data\.character as Character\)/);
    assert.match(client, /setActiveTraining\(data\.activeTraining \?\? null\)/, 'collect applies the server-cleared lease before another start');
});
