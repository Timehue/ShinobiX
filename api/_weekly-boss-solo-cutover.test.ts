import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    WEEKLY_BOSS_BROKEN_HP_FRACTION,
    applyWeeklyBossRunDamageReceipt,
    isWeeklyBossBroken,
    reserveWeeklyBossAttemptReceipt,
    rollbackWeeklyBossAttemptReceipt,
    weeklyBossEncounterStartHp,
    weeklyBossSharedHpRemaining,
    weeklyBossSpawnIdentity,
} from './weekly-boss.js';

test('Weekly Boss spawn identity is explicit for new generations and stable for legacy state', () => {
    const fields = { weekKey: '2026-W31', aiId: 'oni', startedAt: 123 };
    assert.equal(weeklyBossSpawnIdentity({ ...fields, spawnId: ' spawn-new ' }), 'spawn-new');
    const legacy = weeklyBossSpawnIdentity(fields);
    assert.match(legacy, /^legacy-[a-f0-9]{32}$/);
    assert.equal(weeklyBossSpawnIdentity(fields), legacy);
    assert.notEqual(weeklyBossSpawnIdentity({ ...fields, startedAt: 124 }), legacy);
});

test('Weekly Boss is a one-human/one-AI Solo PvE fight against the shared world boss', () => {
    const api = readFileSync('api/weekly-boss.ts', 'utf8');
    const arena = readFileSync('shinobij.client/src/screens/WeeklyBossArena.tsx', 'utf8');
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
    assert.match(api, /weekly-start-/);
    assert.match(api, /req\.query\.recoverFight === '1'/);
    assert.match(api, /kind === 'startFight' \|\| kind === 'resumeFight'/);
    assert.match(api, /if \(recoveryOnly && \(!run \|\| !session\)\)/,
        'resume-only recovery must stop before the new-run creation branch');
    assert.match(arena, /recoverFight=1&weekKey=/);
    assert.match(arena, /kind: "resumeFight"/);
    assert.match(arena, /onClick=\{\(\) => \{ void recoverAuthoritativeFight\(\); \}\}/);
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

const sharedBoss = (hpMax: number, damageByPlayer: Record<string, number> = {}) => ({
    weekKey: '2026-W31', aiId: 'oni', hpMax, hpRemaining: hpMax, scaleFactor: 1,
    damageByPlayer, startedAt: 1, expiresAt: 2,
});

test('Weekly Boss attempt settlement decrements the ONE shared HP pool', () => {
    const state = sharedBoss(10_000);
    assert.equal(weeklyBossSharedHpRemaining(state), 10_000);
    const settled = applyWeeklyBossRunDamageReceipt(state, 'run-a', 'alice', 2_500);
    assert.equal(settled.boss.hpRemaining, 7_500);
    assert.equal(weeklyBossSharedHpRemaining(settled.boss), 7_500);
    assert.equal(isWeeklyBossBroken(settled.boss), false);
    const replay = applyWeeklyBossRunDamageReceipt(settled.boss, 'run-a', 'alice', 2_500);
    assert.equal(replay.boss.hpRemaining, 7_500, 'a replayed receipt never double-decrements the pool');
});

test('Weekly Boss shared pool is the sum of every player\'s damage', () => {
    const state = sharedBoss(10_000);
    const afterAlice = applyWeeklyBossRunDamageReceipt(state, 'run-a', 'alice', 3_000).boss;
    const afterBob = applyWeeklyBossRunDamageReceipt(afterAlice, 'run-b', 'bob', 4_000).boss;
    assert.equal(afterBob.hpRemaining, 3_000);
    assert.deepEqual(afterBob.damageByPlayer, { alice: 3_000, bob: 4_000 });
    assert.equal(weeklyBossEncounterStartHp(afterBob), 3_000,
        'the next attempt opens where the world left the boss');
});

test('Weekly Boss shared pool clamps at 0 and leaderboard damage still counts', () => {
    const state = sharedBoss(10_000, { alice: 9_000 });
    assert.equal(weeklyBossSharedHpRemaining(state), 1_000);
    const overkill = applyWeeklyBossRunDamageReceipt(state, 'run-b', 'bob', 1_500);
    assert.equal(overkill.boss.hpRemaining, 0);
    assert.equal(overkill.damage, 1_500, 'leaderboard damage is not clamped to the pool');
    assert.equal(overkill.boss.damageByPlayer.bob, 1_500);
    assert.equal(isWeeklyBossBroken(overkill.boss), true);
});

test('A Broken Weekly Boss still accepts attempts and still scores', () => {
    const broken = sharedBoss(10_000, { alice: 10_000 });
    assert.equal(isWeeklyBossBroken(broken), true);
    assert.equal(weeklyBossEncounterStartHp(broken), Math.floor(10_000 * WEEKLY_BOSS_BROKEN_HP_FRACTION),
        'a broken boss fights at the fixed floor, never at 0');
    const reserved = reserveWeeklyBossAttemptReceipt(broken, 'run-c', 'carol');
    assert.ok(reserved, 'attempt reservation ignores the pool');
    const scored = applyWeeklyBossRunDamageReceipt(reserved.boss, 'run-c', 'carol', 800);
    assert.equal(scored.boss.damageByPlayer.carol, 800);
    assert.equal(scored.boss.hpRemaining, 0);
    assert.equal(weeklyBossEncounterStartHp(scored.boss), Math.floor(10_000 * WEEKLY_BOSS_BROKEN_HP_FRACTION));
    assert.equal(weeklyBossEncounterStartHp(sharedBoss(5, { x: 5 })), 1, 'floor is never below 1 HP');
});

test('Weekly Boss shared HP survives across attempts and heals legacy pinned states', () => {
    let boss = sharedBoss(10_000);
    for (const [i, dmg] of [1_000, 2_000, 500].entries()) {
        boss = applyWeeklyBossRunDamageReceipt(boss, `run-${i}`, 'alice', dmg).boss;
    }
    assert.equal(boss.hpRemaining, 6_500);
    assert.equal(weeklyBossEncounterStartHp(boss), 6_500);
    // A pre-cutover state pinned hpRemaining to hpMax; the derived read ignores it.
    const legacy = { ...sharedBoss(10_000, { alice: 4_000 }), hpRemaining: 10_000 };
    assert.equal(weeklyBossSharedHpRemaining(legacy), 6_000);
});

test('Weekly Boss settle path clamps reported damage to the HP the encounter opened with', () => {
    const api = readFileSync('api/weekly-boss.ts', 'utf8');
    assert.match(api, /Math\.min\(validation\.damage, Math\.floor\(Number\(run\.initialBossHp\)/);
    assert.match(api, /session\.enemy\.hp = weeklyBossEncounterStartHp\(boss!\)/);
    assert.doesNotMatch(api, /session\.enemy\.hp = Math\.max\(1, Math\.floor\(enemyTemplate\.hp\)\)/,
        'the 99,999,999 sentinel must not be restored onto the encounter');
});
