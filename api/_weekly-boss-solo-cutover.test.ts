import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyWeeklyBossRunDamageReceipt } from './weekly-boss.js';

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
