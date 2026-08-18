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
        // No character → no bonus, and an absent level reads as level 1, so the
        // rookie curve is at its peak (×5 on the 15m tier's base 3 → 15).
        // Character XP is retired so sealedXp is 0.
        assert.deepEqual(trustedTrainingRewards(tier), { sealedGain: 15, sealedXp: 0, bonusPct: 0, rookieMult: 5 });
        // Server-derived bonus, isolated from the rookie curve by carrying the
        // LEDGER for the taper end (earnedForLevel(35) = 7,550 points): village
        // Training 50 (×0.25 = 12.5%) + elder training focus (+10%) → ×1.225 on
        // the 15m tier's base 3 → 4.
        const boosted = trustedTrainingRewards(tier, {
            villageUpgrades: { training: 50 }, elderFocus: 'training', unspentStats: 7550,
        });
        assert.equal(boosted.bonusPct, 22.5);
        assert.equal(boosted.rookieMult, 1);
        assert.equal(boosted.sealedGain, 4);
        assert.equal(boosted.sealedXp, 0);
        // The rookie multiplier is a SEPARATE factor from combinedStatBoost, so
        // it still applies to a player who already carries a village bonus
        // (folding it into bonusPct would let the 2.5 aggregate cap swallow it).
        const rookieBoosted = trustedTrainingRewards(tier, {
            villageUpgrades: { training: 50 }, elderFocus: 'training', unspentStats: 0,
        });
        assert.equal(rookieBoosted.rookieMult, 5);
        assert.equal(rookieBoosted.sealedGain, 18); // 3 × 1.225 × 5 = 18.375
        // The curve reads the SERVER-derived level off the locked character, and
        // it only ever falls with level — so a forged higher level cannot buy a
        // bigger grant, and a genuinely low level is the only way to a big one.
        const forgedHigh = trustedTrainingRewards(tier, { level: 99, unspentStats: 27500 });
        assert.equal(forgedHigh.rookieMult, 1);
        assert.ok(forgedHigh.sealedGain < trustedTrainingRewards(tier, { level: 1 }).sealedGain);

        // ⛔ EXAM-HOLD REGRESSION. examLevelCap freezes character.level at 20
        // (Genin) / 39 (Chunin) until the exam is passed. If the multiplier read
        // character.level, refusing the exam would farm the level-20 rate
        // (2.76x) forever — measured at +146% lifetime stat points over 600
        // days. It must read the earned-points LEDGER, which cannot be frozen.
        const examBlocked = trustedTrainingRewards(tier, { level: 20, unspentStats: 27500, examsPassed: [] });
        assert.equal(examBlocked.rookieMult, 1, 'an exam-held player must NOT keep the level-20 multiplier');
        const genuinelyLow = trustedTrainingRewards(tier, { level: 20, unspentStats: 3933, examsPassed: [] });
        assert.ok(genuinelyLow.rookieMult > 1, 'a player who genuinely has few points still gets the curve');
        // Stored level is irrelevant; only the ledger decides.
        assert.equal(
            trustedTrainingRewards(tier, { level: 1, unspentStats: 27500 }).rookieMult,
            trustedTrainingRewards(tier, { level: 100, unspentStats: 27500 }).rookieMult,
            'the same ledger must yield the same multiplier regardless of stored level',
        );
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
    assert.match(complete, /writeVersionedPlayerSave/);
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
    assert.match(client, /if \(!onVersionedCharacter\(data\.character, data\._saveVersion\)\) return;\s*setActiveTraining\(data\.activeTraining \?\? null\)/,
        'collect accepts the committed save/version before applying the server-cleared lease');
});
