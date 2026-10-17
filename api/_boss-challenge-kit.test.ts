import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bossChallengeCatalogKit, sealTeamBossChallengeKit } from './_boss-challenge-kit.js';
import { weeklyBossChallengeProfile } from './_weekly-boss-profile.js';
import { builtinAiProfile } from './_ai-profile-catalog.js';
import { buildSoloPveAiEncounter } from './solo-pve/_ai-encounter.js';
import { WEEKLY_BOSS_AI_POLICY } from './solo-pve/_ai-turn-policy.js';
import { ITEM_CATALOG } from './pvp/_item-catalog.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';
import { buildWorldBossTeamEncounter } from './world-boss-event/_encounter.js';
import { aiStatBudgetForLevel } from './_ai-level-curves.js';
import { buildTowerEncounter } from './towers/_encounter.js';
import { CLAN_BOSS_FLOORS } from './towers/_floor-catalog.js';
import { configureClanBossEncounter } from './clan-boss/_encounter-config.js';

test('catalog boss curriculum retains zero-damage utility and catalog action budgets', () => {
    for (const school of ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu']) {
        const kit = bossChallengeCatalogKit(school);
        assert.equal(kit.length, 9);
        assert.ok(kit.filter(j => Number(j.effectPower) > 1).every(j => j.ap === 60));
        assert.ok(kit.filter(j => j.ap === 40).every(j => j.effectPower === 0));
        assert.equal(new Set(kit.map(j => j.id)).size, kit.length);
    }
});

test('new clan kits honor both existing mastery rollback switches', () => {
    for (const key of ['DISABLE_PVE_AI_MASTERY', 'DISABLE_PVE_AI_MASTERY_CLAN_BOSS']) {
        const old = process.env[key]; process.env[key] = '1';
        try {
            const floor = CLAN_BOSS_FLOORS[0];
            const session = buildTowerEncounter({ floor, squad: [{ id: 'sq', name: 'Test', ownerSlug: 'test', ai: false, character: { level: 100, maxHp: 10000, stats: {}, jutsu: [] } }], runId: key, seed: 7, partySize: 1, now: 1 });
            configureClanBossEncounter(session, floor, 24000);
            assert.ok(session.actors.filter(a => a.side === 'enemy').every(a => a.character.jutsuMastery === undefined), key);
        } finally { if (old === undefined) delete process.env[key]; else process.env[key] = old; }
    }
});

test('weekly score attacks use fixed level-legal weapons and bounded trained kits without an apex policy', () => {
    for (const id of ['ashen-dragon', 'moonshadow-oni', 'frostfang-warlord', 'stormveil-beast', 'deathsgate-revenant']) {
        const p = weeklyBossChallengeProfile(builtinAiProfile(id), { id });
        const s = buildSoloPveAiEncounter({ sessionId: id, playerName: 'test', now: 1, save: { character: { level: 100, hp: 10000, maxHp: 10000, stats: {}, equippedJutsuIds: [], inventory: [], equipment: {} } }, profile: p, admin: null,
            difficultyMode: false, encounter: { kind: 'weekly-boss', id }, weeklyBossRoundBudget: 20, aiTurnPolicy: WEEKLY_BOSS_AI_POLICY });
        assert.equal(s.enemy.character.aiTurnPolicy, WEEKLY_BOSS_AI_POLICY);
        assert.notEqual(s.enemy.character.pveDifficulty, 'final-kage');
        assert.equal(s.enemy.unlimitedHealth, true);
        const kit = s.enemy.character.jutsu as Array<{ id: string; chakraCost?: number; staminaCost?: number }>;
        assert.ok(kit.length <= 12 && kit.length > 6);
        assert.ok(kit.some(j => j.id === `weekly-${id}-signature`));
        const weapon = (s.enemy.character.equipment as { hand: string }).hand;
        assert.ok(effectiveItemLevelReq(ITEM_CATALOG[weapon]) <= Number(s.enemy.character.level));
        assert.ok(kit.every(j => Number(j.chakraCost ?? 0) <= s.enemy.maxChakra && Number(j.staminaCost ?? 0) <= s.enemy.maxStamina));
    }
});

test('cooperative kit sealing preserves health, armor, level and telegraphs while spending the legal boss stat budget', () => {
    for (const bossId of ['hollow-beast', 'hollow-gate-bull', 'hollow-maze-minotaur'] as const) {
        const s = buildWorldBossTeamEncounter({ event: { eventId: 'test', bossId, bossName: 'Boss', hp: 547545, hpMax: 600000, hollowShardsDeposited: 0 }, matchId: 'test', runId: 'test', squad: [{ id: 'sq', name: 'Test', ownerSlug: 'test', ai: false, character: { level: 100, maxHp: 10000, maxChakra: 10000, maxStamina: 10000, stats: {}, jutsu: [] } }], seed: 7, now: 1 });
        const boss = s.actors.find(a => a.id === s.phaseState.bossId)!;
        assert.equal(boss.hp, 547545); assert.equal(boss.maxHp, 600000);
        assert.equal(boss.character.armorRawDR, .22);
        const stats = boss.character.stats as Record<string, number>;
        assert.ok(Object.values(stats).every(value => value <= 2500 && value >= 10));
        assert.equal(Object.values(stats).reduce((n, value) => n + value - 10, 0), aiStatBudgetForLevel(80));
        assert.equal(boss.character.level, 80);
        assert.equal(s.pveGuard?.enemyLevel, 80);
        assert.ok(s.towerTactics); assert.equal(s.towerTactics.signature, undefined, 'generic Tower marks must not override nova/slam/volley');
        assert.equal(s.encounterFloor?.boss?.strike?.everyRounds, 2);
        assert.equal(s.encounterFloor?.boss?.strike?.pct, 14);
        assert.equal((boss.character.jutsu as Array<{ id: string; effectPower: number }>).find(j => j.id === 'world-boss-quake')?.effectPower, 90);
        const before = structuredClone(boss);
        sealTeamBossChallengeKit(boss, true);
        assert.deepEqual(boss.character.stats, before.character.stats);
        assert.equal(boss.hp, before.hp); assert.equal(boss.maxHp, before.maxHp);
    }
});
