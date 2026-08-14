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
    assert.match(start, /writeVersionedPlayerSave\(saveKey, record, nextCharacter, \{ activeTraining \}\)/);
    assert.match(start, /isPlayerSaveVersionConflict\(error\)/, 'a racing autosave is retried from its successor');
    const durableWrite = start.indexOf('const written = await writeVersionedPlayerSave');
    const tokenPublish = start.indexOf('await publishTrainingCaches', durableWrite);
    assert.ok(durableWrite >= 0 && tokenPublish > durableWrite, 'token caches publish only after the durable save');
});

test('training rewards ignore forged client modifiers and only one live lease can start', () => {
    const requestStart = client.indexOf("fetch('/api/training/start'");
    const requestEnd = client.indexOf('const data = await res.json()', requestStart);
    const startCall = client.slice(requestStart, requestEnd);
    assert.doesNotMatch(startCall, /trainingBonusPct|warMult/, 'the start request must not send client reward modifiers');
    // The growth bonus is sealed INSIDE the save lock from the LOCKED character
    // (village/elder/clan fields on the save) — never from the request body.
    assert.match(start, /trustedTrainingRewards\(tier, character\)/);
    const tier = TRAINING_TIERS[0];
    const prevMult = process.env.STAT_GAIN_MULTIPLIER;
    try {
        delete process.env.STAT_GAIN_MULTIPLIER;
        // No character → no bonus; character XP is retired so sealedXp is 0.
        assert.deepEqual(trustedTrainingRewards(tier), { sealedGain: 6, sealedXp: 0, bonusPct: 0 });
        // Server-derived bonus: village Training 50 (×0.25 = 12.5%) + elder
        // training focus (+10%) → ×1.225 on the 15m tier's base 6 → 7.
        const boosted = trustedTrainingRewards(tier, {
            villageUpgrades: { training: 50 }, elderFocus: 'training',
        });
        assert.equal(boosted.bonusPct, 22.5);
        assert.equal(boosted.sealedGain, 7);
        assert.equal(boosted.sealedXp, 0);
    } finally {
        if (prevMult === undefined) delete process.env.STAT_GAIN_MULTIPLIER;
        else process.env.STAT_GAIN_MULTIPLIER = prevMult;
    }

    const active = { token: 'abc123', startedAt: 1_000, endsAt: 2_000, expiresAt: 10_000 };
    assert.deepEqual(normalizeActiveTrainingSession(active), active);
    assert.equal(activeTrainingBlocksStart(active), true);
    assert.equal(activeTrainingBlocksStart({ ...active, expiresAt: 2_001 }), true, 'cache expiry cannot overwrite an unclaimed saved reward');
    assert.deepEqual(storedTrainingGrant({ ...active, stat: 'strength', statGain: 22, xp: 70 }, active.token), {
        stat: 'strength', startedAt: 1_000, endsAt: 2_000, sealedGain: 22, sealedXp: 70,
    });
    assert.equal(storedTrainingGrant({ ...active, stat: 'strength', statGain: 22, xp: 70 }, 'newer-token'), null, 'a stale request cannot use another lease');
    assert.match(start, /training-active:\$\{params\.playerName\}/);
});

test('training completion credits the save once with a durable receipt', () => {
    assert.match(complete, /record\._trainingReceipts/);
    assert.match(complete, /receipts\.includes\(redemptionToken\)/);
    assert.match(complete, /writeVersionedPlayerSave\(saveKey, record, nextCharacter, \{/);
    assert.match(complete, /_trainingReceipts: nextReceipts/);
    // Character XP is retired: completion applies the sealed stat grant (with
    // the derived-level recompute inside) and never calls the old XP driver.
    assert.match(complete, /applyTrainingGrant\(character/);
    assert.doesNotMatch(complete, /gainXp\(/);
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
