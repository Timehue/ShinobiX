import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pveChallengeWeapon } from './_pve-challenge-weapon.js';
import { ITEM_CATALOG } from './pvp/_item-catalog.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';
import { buildSoloPveAiEncounter } from './solo-pve/_ai-encounter.js';
import { STANDARD_PVE_AI_POLICY } from './solo-pve/_ai-turn-policy.js';
import { ordinaryAiProfile } from './missions/_ordinary-ai-encounter.js';
import { worldRuntimeAiProfile } from './missions/_world-ai-fight.js';
import { aiStatsForLevel } from './_ai-level-curves.js';
import { resolveAiProfileJutsu } from './_ai-opponent-loadout.js';
import { storyBossEnemyTemplate } from './story/_authoritative-story-combat.js';

test('challenge weapons are fixed legal catalog equipment, scoped away from weak/early/unclassified hosts', () => {
    for (let level = 1; level <= 100; level++) {
        for (const difficulty of ['standard', 'dangerous', 'elite', 'final-kage']) {
            const item = pveChallengeWeapon(level, difficulty, true);
            assert.equal(!!item, level >= 61);
            if (item) { assert.deepEqual(item, ITEM_CATALOG[item.id]); assert.ok(effectiveItemLevelReq(item) <= level); }
            assert.equal(pveChallengeWeapon(level, difficulty, false), null);
        }
        assert.equal(pveChallengeWeapon(level, 'weaker', true), null);
        assert.equal(pveChallengeWeapon(level, undefined, true), null);
    }
});

const build = (profile: Parameters<typeof buildSoloPveAiEncounter>[0]['profile'], planner = true) => buildSoloPveAiEncounter({
    sessionId: 'scope', playerName: 'a', now: 1, admin: null,
    save: { character: { name: 'A', level: 100, stats: {}, hp: 10000, maxHp: 10000, equipment: {} } }, profile,
    ...(planner ? { aiTurnPolicy: STANDARD_PVE_AI_POLICY } : {}),
});

test('server classification seals veteran gear without ratcheting HP, altering identities or arming reused raid profiles', () => {
    const descriptor = { version: 1 as const, id: 'receipt', sourceId: 'explore', displayName: 'Specialist', level: 94,
        archetype: 'elementalist' as const, profileId: 'builtin-ai-frost-sealer', portraitKey: 'elementalist', baseXp: 0, baseRyo: 0 };
    const standard = build(ordinaryAiProfile({ ...descriptor, difficulty: 'standard' }));
    const weaker = build(ordinaryAiProfile({ ...descriptor, difficulty: 'weaker' }));
    assert.equal(standard.enemy.maxHp, weaker.enemy.maxHp);
    assert.equal(standard.enemy.name, 'Specialist');
    assert.equal((standard.enemy.character.equipment as Record<string, unknown>)?.hand, 'worldsplitter-katana');
    assert.equal(weaker.enemy.character.equipment, undefined);
    assert.equal(build({ ...ordinaryAiProfile({ ...descriptor, difficulty: 'standard' }), pveDifficulty: undefined }).enemy.character.equipment, undefined);
    assert.equal(build(ordinaryAiProfile({ ...descriptor, difficulty: 'standard' }), false).enemy.character.equipment, undefined);
    assert.ok((standard.enemy.character.jutsu as unknown[]).length <= 12);
});

test('named source opt-in restores specialty allocation and preserves low-level and nonchallenge construction', () => {
    const original = worldRuntimeAiProfile('world-ambush-a-0', 'A', 75, 0, 'bruiser');
    const challenge = worldRuntimeAiProfile('world-ambush-a-3', 'Warlord', 75, 0, 'bruiser', true);
    assert.equal(challenge.name, 'Warlord');
    assert.ok(Number(challenge.hp) < Number(original.hp), 'full rotations replace the old attrition shell');
    assert.equal(challenge.armorRawDR, Math.min(Number(original.armorRawDR), .35));
    assert.equal(challenge.pveNamedChallenge, true);
    assert.equal(challenge.pveDifficulty, 'elite');
    assert.equal(original.pveNamedChallenge, undefined);
    assert.deepEqual(challenge.stats, aiStatsForLevel(75, resolveAiProfileJutsu(['starter-tai-water-2'])));
    assert.deepEqual(worldRuntimeAiProfile('world-low', 'Low', 17, 0, 'boss', true), worldRuntimeAiProfile('world-low', 'Low', 17, 0, 'boss'));
    assert.equal((build(challenge).enemy.character.equipment as Record<string, unknown>)?.hand, 'elderbranch-katana');
});

test('each final Kage keeps its exclusive policy, legal full rotation and original HP', () => {
    for (const village of ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village']) {
        const profile = storyBossEnemyTemplate({ village, progressIndex: 8 });
        const s = build(profile);
        assert.equal(s.enemy.maxHp, 14000);
        assert.equal(profile.pveDifficulty, 'final-kage');
        assert.equal(s.enemy.character.masterAi, true);
        assert.equal((s.enemy.character.jutsu as unknown[]).length, 12);
        assert.equal((s.enemy.character.equipment as Record<string, unknown>)?.hand, 'worldsplitter-katana');
    }
});
