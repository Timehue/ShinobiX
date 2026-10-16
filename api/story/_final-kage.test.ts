import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORY_KAGE_ENCOUNTERS, storyKageForVillage, isFinalStoryKageId } from '../../shared/story-kage.js';
import { builtinAiProfile } from '../_ai-profile-catalog.js';
import { aiStatsForLevel } from '../_ai-level-curves.js';
import { maxChakraForLevel, maxStaminaForLevel } from '../_xp-engine.js';
import { COMBAT_RESOURCES_V2, v2JutsuCosts } from '../_combat-resources.js';
import { JUTSU_MAX_LEVEL, jutsuLevelCapForLevel } from '../combat-core/formulas.js';
import { hexNeighbors } from '../combat-core/grid.js';
import { JUTSU_CATALOG } from '../pvp/_jutsu-catalog.js';
import { raidVillageGuardOpponentId } from '../missions/_generic-ai-fight-authority.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { enemyTurnPolicy, enemyTurnPolicyForEncounter, STANDARD_PVE_AI_POLICY } from '../solo-pve/_ai-turn-policy.js';
import { applySoloPveAction, planStandardPveEnemyActionForTest } from '../solo-pve/_engine.js';
import type { SoloPveJutsu, SoloPveSession } from '../solo-pve/_session.js';
import { applyStoryBossSettlement, LIBERATOR_TITLES, STORY_LEVELS, STORY_REWARDS, storyOpponentId } from './_settle.js';
import {
    createStoryCombatBinding, settleStoryCombatBinding, storyBossEligibility,
    storyBossEnemyTemplate, validateCompletedStoryCombatSession,
} from './_authoritative-story-combat.js';

const NOW = 1_800_000_000_000;
const FINAL_INDEX = STORY_LEVELS.length - 1;

function character(village: string) {
    return {
        name: 'Hero', village, level: 100, storyProgress: FINAL_INDEX,
        hp: 10_000, maxHp: 10_000, chakra: maxChakraForLevel(100), maxChakra: maxChakraForLevel(100),
        stamina: maxStaminaForLevel(100), maxStamina: maxStaminaForLevel(100),
        specialty: 'Ninjutsu', stats: aiStatsForLevel(100), jutsuMastery: [],
        ryo: 100, auraDust: 0, unspentStats: 0, inventory: [], equipment: {},
    };
}

function encounter(village: string, runId = 'final-kage-run', env: NodeJS.ProcessEnv = {}) {
    const binding = createStoryCombatBinding({ runId, playerName: 'hero', village, progressIndex: FINAL_INDEX, now: NOW });
    return buildSoloPveAiEncounter({
        sessionId: runId, playerName: 'hero', save: { character: character(village) },
        profile: storyBossEnemyTemplate({ village, progressIndex: FINAL_INDEX }), now: NOW,
        admin: null, difficultyMode: 'STORY', aiTurnPolicy: STANDARD_PVE_AI_POLICY, env,
        encounter: { kind: 'story-boss', id: `${village}:${FINAL_INDEX}`, sourceId: binding.opponentId, bindingId: runId },
    });
}

test('all four story finales seal the highest legal policy, mastery and player catalog kit without HP inflation', () => {
    const originalCatalog = structuredClone(JUTSU_CATALOG);
    const legalMastery = Math.min(JUTSU_MAX_LEVEL, jutsuLevelCapForLevel(100));
    const highest = enemyTurnPolicyForEncounter({ level: 100, masterAi: true, kind: 'story-boss', difficulty: 'final-kage' });
    for (const [village, authored] of Object.entries(STORY_KAGE_ENCOUNTERS)) {
        const template = storyBossEnemyTemplate({ village, progressIndex: FINAL_INDEX });
        const session = encounter(village);
        assert.equal(template.hp, 14_000, `${village}: existing server HP is unchanged`);
        assert.equal(template.armorRawDR, 0.18, `${village}: existing armor is unchanged`);
        assert.equal(session.enemy.name, authored.name);
        assert.equal(session.enemy.character.visual, storyOpponentId(village, 100));
        assert.equal(session.enemy.character.masterAi, true);
        assert.equal(session.enemy.character.pveDifficulty, 'final-kage');
        assert.equal(session.enemy.character.avatarImage, authored.portrait);
        assert.match(String(session.enemy.character.pveDifficultyLabel), /Final Kage/);
        assert.ok(String(session.enemy.character.tacticalTell).includes(authored.tell));
        assert.equal(session.enemy.character.aiTurnPolicy, STANDARD_PVE_AI_POLICY);
        assert.deepEqual(enemyTurnPolicyForEncounter({ level: Number(session.enemy.character.level), masterAi: session.enemy.character.masterAi === true,
            kind: session.encounter.kind, difficulty: session.enemy.character.pveDifficulty }), highest);
        for (const level of [10, 25, 50, 75, 100]) {
            assert.ok(highest.lookahead >= enemyTurnPolicy(level).lookahead);
            assert.ok(highest.firstActionBeam >= enemyTurnPolicy(level).firstActionBeam);
        }
        assert.equal(session.enemy.maxChakra, maxChakraForLevel(100));
        assert.equal(session.enemy.maxStamina, maxStaminaForLevel(100));
        assert.ok(Object.values(session.enemy.character.stats as Record<string, number>).every((value) => value <= 2_500));
        const kit = session.enemy.character.jutsu as SoloPveJutsu[];
        assert.deepEqual(kit.map((move) => move.id), [...authored.jutsuIds]);
        assert.equal(kit.filter((move) => Number(move.effectPower) > 1).length, 5, 'five real damaging moves, independent of utility slots');
        assert.ok(kit.every((move) => !move.tags?.some((tag) => tag.name === 'Stun')), 'no stun loop in the authored kit');
        for (const move of kit) {
            const catalog = JUTSU_CATALOG[move.id];
            assert.ok(catalog, move.id);
            for (const field of ['effectPower', 'ap', 'cooldown'] as const) {
                assert.equal(move[field], catalog[field], `${move.id}: unchanged catalog ${field}`);
            }
            const costs = COMBAT_RESOURCES_V2 ? v2JutsuCosts(catalog, 100, authored.specialty) : catalog;
            assert.equal(move.chakraCost, costs.chakraCost, `${move.id}: shared player effective chakra cost`);
            assert.equal(move.staminaCost, costs.staminaCost, `${move.id}: shared player effective stamina cost`);
        }
        assert.deepEqual(session.enemy.character.jutsuMastery,
            kit.map((move) => ({ jutsuId: move.id, level: legalMastery })));
        const beforePreview = structuredClone(session);
        const planned = planStandardPveEnemyActionForTest(session, highest);
        assert.ok(planned.simulations <= 192, 'apex previews obey a deterministic work budget');
        assert.deepEqual(session, beforePreview, 'planning never changes the sealed combat state');
    }
    assert.deepEqual(JUTSU_CATALOG, originalCatalog, 'sealing effective costs never rewrites the shared player catalog');
});

test('apex chooser requires every final-story seal and preserves ordinary and protected master budgets', () => {
    const final = { level: 100, masterAi: true, kind: 'story-boss', difficulty: 'final-kage' };
    assert.deepEqual(enemyTurnPolicyForEncounter(final), { ...enemyTurnPolicy(100, true), tier: 'apex', firstActionBeam: 8, maxSimulations: 192 });
    for (const kind of ['generic-ai', 'world-ai', 'mission', 'village-war-garrison', 'weekly-boss', 'pvp']) {
        assert.deepEqual(enemyTurnPolicyForEncounter({ ...final, kind }), enemyTurnPolicy(100, true));
    }
    for (const difficulty of ['elite', 'standard', undefined]) {
        assert.deepEqual(enemyTurnPolicyForEncounter({ ...final, difficulty }), enemyTurnPolicy(100, true));
    }
    assert.deepEqual(enemyTurnPolicyForEncounter({ ...final, masterAi: false }), enemyTurnPolicy(100));
});

test('raid guards reused from the legacy catalog do not inherit the authored final story overhaul', () => {
    const legacyWindLightning = [
        'starter-nin-wind-1', 'starter-nin-wind-2', 'starter-nin-wind-3',
        'starter-nin-lightning-1', 'starter-nin-lightning-2', 'starter-nin-lightning-3',
    ];
    const legacyFireEarth = [
        'starter-nin-earth-1', 'starter-nin-earth-2', 'starter-nin-earth-3',
        'starter-nin-fire-1', 'starter-nin-fire-2', 'starter-nin-fire-3',
    ];
    for (const village of Object.keys(STORY_KAGE_ENCOUNTERS)) {
        const guardId = raidVillageGuardOpponentId(village, 100);
        assert.equal(guardId, storyOpponentId(village, 100));
        const profile = builtinAiProfile(guardId);
        assert.ok(profile);
        assert.equal(profile.masterAi, undefined, 'the guard does not acquire a final-story policy override');
        assert.equal('pveDifficulty' in profile, false, 'the guard does not acquire final-story mastery classification');
        assert.deepEqual(profile.jutsuIds, village === 'Ashen Leaf Village' ? legacyFireEarth : legacyWindLightning);
        assert.equal(profile.hp, 13_000, 'legacy guard HP is unchanged');
        assert.equal(profile.armorRawDR, 0.56, 'legacy guard armor is unchanged');
        assert.equal(profile.chakra, maxChakraForLevel(100));
        assert.equal(profile.stamina, maxStaminaForLevel(100));
        assert.ok(Object.values(profile.stats).every((value) => value === 2_500));
        const finale = storyBossEnemyTemplate({ village, progressIndex: FINAL_INDEX });
        assert.notDeepEqual(profile.jutsuIds, finale.jutsuIds, 'the story route explicitly owns the new finale kit');
        assert.equal(finale.masterAi, true);
        assert.equal(finale.pveDifficulty, 'final-kage');
    }
    assert.equal(isFinalStoryKageId('village-kage-player'), false);
    assert.equal(storyKageForVillage('constructor'), undefined);
    assert.equal(isFinalStoryKageId(storyOpponentId('Stormveil Village', 85)), false);
});

test('the final story policy still honors the planner rollback switch', () => {
    const session = encounter('Stormveil Village', 'rollback', { DISABLE_PVE_AI_PLANNER: '1' });
    assert.equal(session.enemy.character.aiTurnPolicy, undefined);
    assert.equal(session.enemy.character.masterAi, true, 'the authored identity remains sealed');
});

test('finale defeat cannot grant progress; a fresh retry can win once with the original title, reward and unlock', () => {
    for (const village of Object.keys(STORY_KAGE_ENCOUNTERS)) {
        const saved = character(village);
        const lost = applySoloPveAction(encounter(village, `lost-${village}`), { type: 'abandon' }).session;
        assert.equal(lost.status, 'done');
        assert.equal(lost.winner, 'enemy');
        const lostBinding = createStoryCombatBinding({ runId: lost.sessionId, playerName: 'hero', village, progressIndex: FINAL_INDEX, now: NOW });
        assert.deepEqual(validateCompletedStoryCombatSession({ binding: lostBinding, session: lost, playerName: 'hero', character: saved, now: NOW + 1 }),
            { ok: false, reason: 'not-won' });
        assert.equal(storyBossEligibility(saved).ok, true, 'the same milestone remains available after defeat');

        const retry = encounter(village, `retry-${village}`);
        // Place the real finale at one HP to exercise the engine's terminal
        // victory path without coupling progression tests to a balance result.
        retry.enemy.hp = 1;
        retry.enemy.pos = hexNeighbors(retry.player.pos)[0];
        const win = applySoloPveAction(retry, { type: 'basicAttack' }).session;
        assert.equal(win.status, 'done');
        assert.equal(win.winner, 'player');
        const binding = createStoryCombatBinding({ runId: win.sessionId, playerName: 'hero', village, progressIndex: FINAL_INDEX, now: NOW });
        assert.equal(validateCompletedStoryCombatSession({ binding, session: win, playerName: 'hero', character: saved, now: NOW + 1 }).ok, true);
        const settled = applyStoryBossSettlement(saved, { opponentId: binding.opponentId }, win.player.hp);
        assert.equal(settled.ok, true);
        if (!settled.ok) continue;
        assert.equal(settled.finale, true);
        assert.equal(settled.statPoints, STORY_REWARDS[FINAL_INDEX].statPoints);
        assert.equal(settled.ryo, STORY_REWARDS[FINAL_INDEX].ryo);
        assert.equal(settled.character.storyTitle, LIBERATOR_TITLES[village]);
        assert.equal(settled.character.storyProgress, STORY_LEVELS.length);
        assert.deepEqual(settled.character.inventory, ['hollow-gate-key']);
        assert.equal(applyStoryBossSettlement(settled.character, { opponentId: binding.opponentId }, win.player.hp).ok, false);
        const spent = settleStoryCombatBinding(binding, NOW + 2);
        assert.equal(validateCompletedStoryCombatSession({ binding: spent, session: win as SoloPveSession, playerName: 'hero', character: saved, now: NOW + 3 }).ok, false);
    }
});
