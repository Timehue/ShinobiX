import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
    applyWeeklyBossRunDamageReceipt,
    commitWeeklyBossRunDamageSettlement,
    compareWeeklyValueConfirmed,
    reconcileWeeklyBossDamageProofSnapshot,
    reserveWeeklyBossAttemptReceipt,
    reserveWeeklyBossRunDamageSettlement,
    rollbackWeeklyBossAttemptReceipt,
    weeklyBossUsageFingerprint,
    weeklyBossResetConflict,
} from './weekly-boss.js';

test('Weekly Boss is a one-human/one-AI Solo PvE score attack', () => {
    const api = readFileSync('api/weekly-boss.ts', 'utf8');
    const fight = readFileSync('shinobij.client/src/screens/WeeklyBossFight.tsx', 'utf8');
    const legacyArena = readFileSync('shinobij.client/src/screens/Arena.tsx', 'utf8');
    const towerEngine = readFileSync('api/towers/_engine.ts', 'utf8');
    const towerSession = readFileSync('api/towers/_tower-session.ts', 'utf8');
    const legacyBuilder = readFileSync('api/_authoritative-pve.ts', 'utf8');
    assert.match(api, /buildSoloPveAiEncounter/);
    assert.match(api, /readSoloPveSession/);
    assert.match(api, /writeSoloPveSession/);
    assert.doesNotMatch(api, /towers\/_tower-store/);
    assert.match(fight, /soloPveArenaTransport/);
    assert.doesNotMatch(fight, /towerArenaTransport|TowerSession/);
    assert.doesNotMatch(legacyArena, /weeklyBoss|WeeklyBoss/);
    assert.doesNotMatch(towerEngine, /weeklyBoss/);
    assert.doesNotMatch(towerSession, /weeklyBoss/);
    assert.doesNotMatch(legacyBuilder, /pveGuardKind/);
    assert.doesNotMatch(api, /cleanWeeklyBossDamageEvents|validateWeeklyBossFightClaim|WEEKLY_BOSS_DMG_ABSOLUTE_CAP/);
    assert.match(api, /weeklyBossActiveRunKey/);
    assert.match(api, /chargeWeeklyBossStart\(weeklyBossStartSeal\(run\)\)/);
    assert.match(readFileSync('api/_weekly-boss-start-authority.ts', 'utf8'), /WEEKLY_BOSS_START_SETTLEMENTS_FIELD/);
    assert.match(api, /reserveWeeklyBossAttemptReceipt\(fresh[\s\S]{0,500}compareWeeklyValueConfirmed\(WEEKLY_BOSS_STATE_KEY, fresh, applied\.boss\)/);
    assert.match(api, /reserveWeeklyBossRunDamageSettlement\([\s\S]{0,700}compareWeeklyValueConfirmed\(WEEKLY_BOSS_STATE_KEY, fresh, applied\.boss\)/);
    assert.match(api, /const usageSettlement = await mutatePlayerSave[\s\S]{0,5000}commitWeeklyBossRunDamageSettlement\(/,
        'the player-save usage/outcome CAS precedes distributable damage promotion');
    assert.match(api, /compareWriteSoloPveSession\(preparedSession, session\)[\s\S]{0,700}compareWeeklyValueConfirmed\([\s\S]{0,120}preparedRun/);
});

test('Weekly Boss attempt reservation is resumable and rolls back only its own receipt', () => {
    const state = {
        weekKey: '2026-W31', aiId: 'oni', hpMax: 1, hpRemaining: 1, scaleFactor: 1,
        damageByPlayer: {}, attemptsByPlayer: { alice: 2 }, startedAt: 1, expiresAt: 2,
    };
    const first = reserveWeeklyBossAttemptReceipt(state, 'weekly-a', 'alice');
    assert.ok(first);
    assert.equal(first.replayed, false);
    assert.equal(first.boss.attemptsByPlayer?.alice, 3);
    const replay = reserveWeeklyBossAttemptReceipt(first.boss, 'weekly-a', 'alice');
    assert.ok(replay);
    assert.equal(replay.replayed, true);
    assert.equal(replay.boss.attemptsByPlayer?.alice, 3);
    assert.equal(reserveWeeklyBossAttemptReceipt(replay.boss, 'weekly-b', 'alice'), null,
        'a different fourth attempt remains blocked at the cap after adding one more receipt');
    const rolledBack = rollbackWeeklyBossAttemptReceipt(replay.boss, 'weekly-a', 'alice');
    assert.equal(rolledBack.attemptsByPlayer?.alice, 2);
    assert.equal(rollbackWeeklyBossAttemptReceipt(rolledBack, 'weekly-a', 'alice'), rolledBack,
        'repeating cleanup cannot decrement an unrelated attempt');
});

test('Weekly Boss contribution banking is idempotent per authoritative run', () => {
    const state = {
        weekKey: '2026-W31', aiId: 'oni', hpMax: 1, hpRemaining: 1, scaleFactor: 1,
        damageByPlayer: { alice: 50 }, startedAt: 1, expiresAt: 2,
    };
    const first = applyWeeklyBossRunDamageReceipt(state, 'weekly-run-1', 'alice', 125);
    assert.equal(first.replayed, false);
    assert.equal(first.boss.damageByPlayer.alice, 175);
    const replay = applyWeeklyBossRunDamageReceipt(first.boss, 'weekly-run-1', 'alice', 999_999);
    assert.equal(replay.replayed, true);
    assert.equal(replay.damage, 125);
    assert.equal(replay.boss.damageByPlayer.alice, 175);
});

test('damage remains non-distributable until exact save proof promotes its journal', () => {
    const state = {
        weekKey: '2026-W31', aiId: 'oni', hpMax: 1, hpRemaining: 1, scaleFactor: 1,
        damageByPlayer: { alice: 50 }, attemptRunReceipts: { 'weekly-run-2': 'alice' },
        startedAt: 1, expiresAt: 10_000,
    };
    const fingerprint = weeklyBossUsageFingerprint({
        runId: 'weekly-run-2', playerName: 'alice', weekKey: state.weekKey,
        aiId: state.aiId, bossStartedAt: state.startedAt, damage: 125,
    });
    const pending = reserveWeeklyBossRunDamageSettlement(
        state, 'weekly-run-2', 'alice', 125, fingerprint, 9_000,
    );
    assert.ok(pending);
    assert.equal(pending.boss.damageByPlayer.alice, 50, 'reservation cannot enter the reward aggregate');
    assert.equal(reconcileWeeklyBossDamageProofSnapshot(pending.boss, {}, 10_001).blocked, true,
        'expiry waits for a possibly live save writer');

    const committed = commitWeeklyBossRunDamageSettlement(
        pending.boss, 'weekly-run-2', 'alice', 125, fingerprint,
    );
    assert.ok(committed);
    assert.equal(committed.boss.damageByPlayer.alice, 175);
    const promotedByDistributionReplay = commitWeeklyBossRunDamageSettlement(
        committed.boss, 'weekly-run-2', 'alice', 125, fingerprint,
    );
    assert.ok(promotedByDistributionReplay?.replayed);
    assert.equal(promotedByDistributionReplay?.boss, committed.boss,
        'a writer resuming after distribution promotion reports the exact committed state');
    const frozen = reconcileWeeklyBossDamageProofSnapshot(
        committed.boss, { 'weekly-run-2': fingerprint }, 99_999,
    );
    assert.equal(frozen.blocked, false);
    assert.equal(frozen.boss.damageByPlayer.alice, 175);
});

test('an old worker crash after banking damage but before usage save is quarantined after drain', () => {
    const state = {
        weekKey: '2026-W31', aiId: 'oni', hpMax: 1, hpRemaining: 1, scaleFactor: 1,
        damageByPlayer: { alice: 50 }, attemptRunReceipts: { 'weekly-old-run': 'alice' },
        startedAt: 1, expiresAt: 10_000,
    };
    const oldBank = applyWeeklyBossRunDamageReceipt(state, 'weekly-old-run', 'alice', 125).boss;
    assert.equal(oldBank.damageByPlayer.alice, 175, 'the rolling old worker exposed damage first');
    const duringDrain = reconcileWeeklyBossDamageProofSnapshot(oldBank, {}, 10_001);
    assert.equal(duringDrain.blocked, true);
    assert.equal(duringDrain.boss.damageByPlayer.alice, 175);
    const stillLive = reconcileWeeklyBossDamageProofSnapshot(
        oldBank, {}, 10_000 + 5 * 60 * 1_000, new Set(['weekly-old-run']),
    );
    assert.equal(stillLive.blocked, true, 'an exact live run prevents orphan cleanup even after the time grace');
    assert.equal(stillLive.boss.damageByPlayer.alice, 175);
    const afterDrain = reconcileWeeklyBossDamageProofSnapshot(oldBank, {}, 10_000 + 5 * 60 * 1_000);
    assert.equal(afterDrain.blocked, false);
    assert.equal(afterDrain.boss.damageByPlayer.alice, 50, 'unpaid usage can never reach the frozen summary');
    assert.equal(afterDrain.boss.discardedRunDamage?.['weekly-old-run'], 125);
});

test('reset cannot replace a partial distribution or respawn inside the same ISO week', () => {
    const expired = {
        weekKey: '2026-W31', aiId: 'oni', hpMax: 1, hpRemaining: 1, scaleFactor: 1,
        damageByPlayer: { alice: 100, bob: 50 }, startedAt: 1, expiresAt: 2,
        distributedAt: 3,
        distributionSummary: [
            { name: 'alice', damage: 100, rank: 1, ryo: 10, xp: 0, gotCore: true, gotKey: true, isMvp: true },
            { name: 'bob', damage: 50, rank: 2, ryo: 5, xp: 0, gotCore: true, gotKey: true, isMvp: false },
        ],
        creditedPlayers: ['alice'],
        payoutMarkersAcknowledgedPlayers: ['alice'],
    };
    assert.equal(weeklyBossResetConflict(expired, 4, '2026-W32')?.code, 'weekly-boss-settlement-pending');

    const distributedButAckPending = {
        ...expired,
        rewardsDistributed: true,
        creditedPlayers: ['alice', 'bob'],
    };
    assert.equal(weeklyBossResetConflict(distributedButAckPending, 4, '2026-W32')?.code, 'weekly-boss-settlement-pending');

    const complete = {
        ...distributedButAckPending,
        payoutMarkersAcknowledgedPlayers: ['alice', 'bob'],
    };
    assert.equal(weeklyBossResetConflict(complete, 4, '2026-W31')?.code, 'weekly-boss-same-week');
    assert.equal(weeklyBossResetConflict(complete, 4, '2026-W32'), null);
});

test('attempt, run-ready, and damage phases require exact CAS acknowledgement or committed readback', async () => {
    for (const phase of ['attempt', 'run-ready', 'damage'] as const) {
        const key = `weekly-${phase}`;
        const expected = { phase, version: 1 };
        const next = { phase, version: 2 };
        const data = new Map<string, unknown>([[key, structuredClone(expected)]]);
        let mode: 'null' | 'before' | 'after' | 'normal' = 'null';
        const store = {
            async get<T>(target: string) { return (data.get(target) ?? null) as T | null; },
            async compareSet(target: string, predecessor: unknown | null, value: unknown) {
                if (mode === 'before') throw new Error(`${phase}-precommit`);
                if (mode === 'null') return null as never;
                if (!isDeepStrictEqual(data.get(target) ?? null, predecessor)) return false;
                data.set(target, structuredClone(value));
                if (mode === 'after') throw new Error(`${phase}-commit-ack`);
                return true;
            },
        };

        assert.equal(await compareWeeklyValueConfirmed(key, expected, next, undefined, store), false, `${phase} null ack`);
        assert.deepEqual(data.get(key), expected, `${phase} cannot advance after null`);

        mode = 'before';
        await assert.rejects(
            compareWeeklyValueConfirmed(key, expected, next, undefined, store),
            new RegExp(`${phase}-precommit`),
        );
        assert.deepEqual(data.get(key), expected, `${phase} cannot advance before commit`);

        mode = 'after';
        assert.equal(await compareWeeklyValueConfirmed(key, expected, next, undefined, store), true, `${phase} exact readback`);
        assert.deepEqual(data.get(key), next);
    }
});
