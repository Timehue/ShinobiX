import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ordinaryAiProfile } from './_ordinary-ai-encounter.js';
import { builtinAiProfile } from '../_ai-profile-catalog.js';
import { relevelAiProfile, type RelevelableProfile } from '../_ai-level-curves.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import { maxHpForLevel } from '../_xp-engine.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { STANDARD_PVE_AI_POLICY } from '../solo-pve/_ai-turn-policy.js';
import { storyBossEnemyTemplate } from '../story/_authoritative-story-combat.js';
import { missionPlayerSave } from '../../scripts/mission-encounter-sim.js';
import { ORDINARY_PVE_ROLES, ORDINARY_PVE_DIFFICULTIES, type OrdinaryPveEncounter, type OrdinaryPveArchetype } from '../../shared/ordinary-pve-encounter.js';

function descriptor(level: number, archetype: OrdinaryPveArchetype = 'bruiser', difficulty: OrdinaryPveEncounter['difficulty'] = 'standard'): OrdinaryPveEncounter {
    return { version: 1, id: 'ordinary-d', sourceId: 'durability-fixture', displayName: ORDINARY_PVE_ROLES[archetype].name,
        level, difficulty, archetype, profileId: ORDINARY_PVE_ROLES[archetype].profileId, portraitKey: archetype, baseXp: 100, baseRyo: 75 };
}
function legacyProfile(encounter: OrdinaryPveEncounter) {
    const template = builtinAiProfile(encounter.profileId)!;
    return relevelAiProfile(structuredClone(template) as unknown as RelevelableProfile, encounter.level, 0, 0,
        resolveAiProfileJutsu(template.jutsuIds));
}
function seal(profile: Parameters<typeof buildSoloPveAiEncounter>[0]['profile']) {
    return buildSoloPveAiEncounter({ sessionId: 'ordinary-durability', playerName: 'fixture', save: missionPlayerSave(100),
        profile, now: 1, admin: null, difficultyMode: 'AI_FIGHT', aiTurnPolicy: STANDARD_PVE_AI_POLICY }).enemy;
}

test('advanced ordinary roles seal exact player-curve HP at every level despite subsequent band scaling', () => {
    for (let level = 36; level <= 100; level++) for (const archetype of Object.keys(ORDINARY_PVE_ROLES) as OrdinaryPveArchetype[]) {
        const enemy = seal(ordinaryAiProfile(descriptor(level, archetype)));
        assert.equal(enemy.maxHp, maxHpForLevel(level), `${archetype}@${level}: effective HP after the combat seal`);
        assert.equal(enemy.hp, enemy.maxHp);
        assert.ok(Number(enemy.character.armorRawDR) <= (level < 65 ? .25 : .35), `${archetype}@${level}: ordinary armor ceiling`);
    }
});

test('all four ordinary difficulties share HP and armor at the 35/36 and 64/65 boundaries', () => {
    for (const level of [35, 36, 64, 65, 90, 95, 98, 100]) {
        const enemies = ORDINARY_PVE_DIFFICULTIES.map(difficulty => seal(ordinaryAiProfile(descriptor(level, 'bruiser', difficulty))));
        for (const enemy of enemies) {
            assert.equal(enemy.maxHp, enemies[0].maxHp, `${level}: difficulty cannot add HP`);
            assert.equal(enemy.character.armorRawDR, enemies[0].character.armorRawDR, `${level}: difficulty cannot add armor`);
        }
    }
    assert.equal(seal(ordinaryAiProfile(descriptor(36))).maxHp, 4000);
    assert.equal(seal(ordinaryAiProfile(descriptor(36))).character.armorRawDR, .24, 'a ceiling cannot increase existing lighter armor');
    assert.equal(seal(ordinaryAiProfile(descriptor(64))).maxHp, 6800);
    assert.equal(seal(ordinaryAiProfile(descriptor(64))).character.armorRawDR, .25);
    assert.equal(seal(ordinaryAiProfile(descriptor(65))).maxHp, 6900);
    assert.equal(seal(ordinaryAiProfile(descriptor(65))).character.armorRawDR, .35);
    assert.equal(seal(ordinaryAiProfile(descriptor(98))).maxHp, 10000);
});

test('ordinary levels through 35 retain their previous durability, stats, resources and authored kit', () => {
    for (const level of [1, 15, 16, 30, 35]) for (const archetype of Object.keys(ORDINARY_PVE_ROLES) as OrdinaryPveArchetype[]) {
        const encounter = descriptor(level, archetype);
        const current = ordinaryAiProfile(encounter), previous = legacyProfile(encounter);
        for (const field of ['hp', 'armorRawDR', 'stats', 'chakra', 'stamina', 'jutsuIds'] as const)
            assert.deepEqual(current[field], previous[field], `${archetype}@${level}.${field}`);
    }
});

test('ordinary durability adapter preserves legal combat budgets and leaves published/protected profiles intact', () => {
    const encounter = descriptor(100), templateBefore = structuredClone(builtinAiProfile(encounter.profileId));
    const previous = legacyProfile(encounter), ordinary = ordinaryAiProfile(encounter);
    for (const field of ['stats', 'chakra', 'stamina', 'jutsuIds'] as const) assert.deepEqual(ordinary[field], previous[field], field);
    assert.deepEqual(builtinAiProfile(encounter.profileId), templateBefore, 'published source remains unchanged');
    const unclassified = seal(previous);
    assert.equal(unclassified.maxHp, 14700, 'unclassified authored hosts keep the prior HP curve');
    assert.equal(unclassified.character.armorRawDR, .56, 'unclassified authored hosts keep their armor');
    const finalProfile = storyBossEnemyTemplate({ village: 'Stormveil Village', progressIndex: 8 });
    const finalKage = seal(finalProfile);
    assert.equal(finalKage.maxHp, finalProfile.hp, 'story finale bypasses the ordinary adapter');
    assert.equal(finalKage.character.armorRawDR, .18);
});
