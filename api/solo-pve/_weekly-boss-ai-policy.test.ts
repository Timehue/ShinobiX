import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_PVE_AI_POLICY, WEEKLY_BOSS_AI_POLICY, standardPvePlannerApplies, weeklyBossPlannerApplies } from './_ai-turn-policy.js';
import { buildSoloPveAiEncounter } from './_ai-encounter.js';
import { applySoloPveAction } from './_engine.js';
import { weeklyBossEnemyTemplate } from '../_authoritative-pve.js';
import { builtinAiProfile } from '../_ai-profile-catalog.js';

test('weekly planning requires its own policy, exact source and weekly guard; rollback remains available', () => {
    const input = { policy: WEEKLY_BOSS_AI_POLICY, kind: 'weekly-boss', weeklyBoss: true, missionTactics: false, env: {} };
    assert.equal(weeklyBossPlannerApplies(input), true);
    for (const change of [{ policy: undefined }, { policy: STANDARD_PVE_AI_POLICY }, { kind: 'generic-ai' }, { weeklyBoss: false }, { missionTactics: true }, { env: { DISABLE_PVE_AI_PLANNER: '1' } }])
        assert.equal(weeklyBossPlannerApplies({ ...input, ...change }), false);
    assert.equal(standardPvePlannerApplies({ ...input, policy: STANDARD_PVE_AI_POLICY }), false);
});

test('weekly planner keeps unlimited scoring, 20-round budget, legal AP and score-attack damage ceilings', () => {
    const profile = builtinAiProfile('deathsgate-revenant')!;
    const stats = Object.fromEntries(['strength', 'speed', 'intelligence', 'willpower', ...['taijutsu', 'bukijutsu', 'ninjutsu', 'genjutsu'].flatMap(s => [`${s}Offense`, `${s}Defense`])].map(key => [key, 2500]));
    const params = { sessionId: 'weekly-policy-test', playerName: 'offline', now: 1800000000000,
        save: { character: { name: 'Offline', level: 100, stats, hp: 10000, maxHp: 10000, chakra: 10000, maxChakra: 10000, stamina: 10000, maxStamina: 10000, equippedJutsuIds: [], jutsuMastery: [], inventory: [], equipment: {} } },
        profile: { id: profile.id, ...weeklyBossEnemyTemplate(profile, { id: profile.id }) }, admin: null, difficultyMode: false as const,
        encounter: { kind: 'weekly-boss', id: 'offline-week' }, weeklyBossRoundBudget: 20, aiTurnPolicy: WEEKLY_BOSS_AI_POLICY };
    let session = buildSoloPveAiEncounter(params);
    assert.equal(session.enemy.character.aiTurnPolicy, WEEKLY_BOSS_AI_POLICY);
    assert.equal(session.enemy.unlimitedHealth, true);
    assert.equal(session.weeklyBossGuard?.roundBudget, 20);
    const first = applySoloPveAction(session, { type: 'wait' });
    assert.equal(first.applied, true);
    assert.deepEqual(first, applySoloPveAction(buildSoloPveAiEncounter(params), { type: 'wait' }), 'same sealed state gives same legal turn');
    let seq = 0;
    const damagePerRound = new Map<number, number>();
    for (let index = 0; session.status === 'active' && index < 24; index++) {
        const result = applySoloPveAction(session, { type: 'wait' });
        assert.equal(result.applied, true);
        for (const event of result.session.events.filter(e => e.seq > seq && e.actor === 'enemy')) {
            assert.ok(event.combat.actorSpend.ap >= 0 && event.combat.actorSpend.ap <= 100);
            for (const damage of event.combat.damage.filter(d => d.target === 'player')) {
                assert.ok(damage.resolved <= 800, `weekly per-hit ceiling: ${damage.resolved}`);
                damagePerRound.set(event.round, (damagePerRound.get(event.round) ?? 0) + damage.resolved);
            }
        }
        seq = result.session.eventSeq; session = result.session;
    }
    assert.equal(session.status, 'done');
    assert.ok(session.round <= 20);
    assert.equal(session.enemy.unlimitedHealth, true);
    assert.ok(session.enemy.hp > 0, 'the score target cannot be killed');
    assert.ok([...damagePerRound.values()].every(damage => damage <= 1500));
});
