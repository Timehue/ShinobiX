import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pressureFight, pressurePlayerSave, PRESSURE_LEVELS, PRESSURE_BUILDS } from './pve-pressure-benchmark.js';
import { buildSoloPveAiEncounter } from '../api/solo-pve/_ai-encounter.js';
import { jutsuLevelCapForLevel } from '../api/combat-core/formulas.js';
import { ordinaryAiProfile } from '../api/missions/_ordinary-ai-encounter.js';
import { maxChakraForLevel, maxStaminaForLevel } from '../api/_xp-engine.js';
import { AI_PROFILE_CATALOG } from '../api/_ai-profile-catalog.js';
import { relevelAiProfile } from '../api/_ai-level-curves.js';
import { storyBossEnemyTemplate } from '../api/story/_authoritative-story-combat.js';
import type { applySoloPveAction } from '../api/solo-pve/_engine.js';

test('pressure fixtures use rank-legal mastery and authoritative equipment multipliers', () => {
    for (const level of PRESSURE_LEVELS) for (const build of PRESSURE_BUILDS) {
        const save = pressurePlayerSave(level, build);
        const session = buildSoloPveAiEncounter({ sessionId: `${level}-${build}`, playerName: 'fixture', save, now: 1, admin: null,
            profile: ordinaryAiProfile({ version: 1, id: 'ordinary-a', sourceId: 'fixture', displayName: 'Road Bruiser', level,
                difficulty: 'standard', archetype: 'bruiser', profileId: 'builtin-ai-rogue-ninja', portraitKey: 'bruiser', baseXp: 0, baseRyo: 0 }),
        });
        const mastery = session.player.character.jutsuMastery as Array<{ level: number }>;
        assert.ok(mastery.every(j => j.level <= jutsuLevelCapForLevel(level)));
        assert.ok((Number(session.player.character.armorRawDR) || 0) <= 1.5);
        if (level >= 40 && build !== 'starter') assert.equal(Number(session.player.character.armorRawDR).toFixed(2), '0.35');
        if (build === 'maxed' && level === 100) assert.equal(session.player.character.bloodlineMult, 1.2);
        assert.equal((session.enemy.character.jutsu as unknown[]).length <= 8, true);
        assert.equal(session.enemy.maxChakra, maxChakraForLevel(level));
        assert.equal(session.enemy.maxStamina, maxStaminaForLevel(level));
        const playerKit = session.player.character.jutsu as Array<Record<string, unknown>>;
        const npcKit = session.enemy.character.jutsu as Array<Record<string, unknown>>;
        for (const move of npcKit) {
            const same = playerKit.find(j => j.id === move.id);
            if (!same) continue;
            for (const field of ['ap', 'effectPower', 'cooldown', 'chakraCost', 'staminaCost']) assert.equal(move[field], same[field], `same legal ${field} for ${move.id}`);
        }
    }
});

test('pressure fixture natural encounter keeps its identity and progressive template kit', () => {
    const profile = ordinaryAiProfile({ version: 1, id: 'ordinary-a', sourceId: 'bandit-47', displayName: 'Road Bruiser', level: 100,
        difficulty: 'dangerous', archetype: 'bruiser', profileId: 'builtin-ai-rogue-ninja', portraitKey: 'bruiser', baseXp: 100, baseRyo: 75 });
    const session = buildSoloPveAiEncounter({ sessionId: 'natural-pressure', playerName: 'fixture', save: pressurePlayerSave(100, 'maxed'), now: 1, admin: null,
        profile: { ...profile, id: 'world-wanderer-bandit-47' },
    });
    const kit = session.enemy.character.jutsu as Array<{ ap: number }>;
    assert.equal(kit.filter(j => j.ap === 60).length, 6);
    assert.equal(session.encounter.id, 'world-wanderer-bandit-47');
    assert.ok((session.enemy.character.jutsuMastery as Array<{ level: number }>).every(j => j.level === 40));
});

test('benchmark before variants preserve the distinct original Explore and road constructors', () => {
    const calls: Parameters<typeof buildSoloPveAiEncounter>[0][] = [];
    const runtime = { catalog: AI_PROFILE_CATALOG, relevel: relevelAiProfile, story: storyBossEnemyTemplate,
        build: (params: Parameters<typeof buildSoloPveAiEncounter>[0]) => { calls.push(params); return buildSoloPveAiEncounter(params); },
        // Construction-only fixture: stop immediately after capturing the seal.
        act: ((session) => ({ applied: true, session: { ...session, status: 'done', outcome: 'win', winner: 'player' } })) as typeof applySoloPveAction,
    };
    pressureFight(runtime, { level: 50, build: 'midgame', difficulty: 'standard', seed: 0, variant: 'before' });
    assert.equal(calls.at(-1)!.profile.level, 47, 'Explore supplies the authored profile');
    assert.deepEqual(calls.at(-1)!.scaling, { level: 50 }, 'the old builder applies weighted scaling');
    pressureFight(runtime, { level: 100, build: 'midgame', difficulty: 'weaker', seed: 0, variant: 'before' });
    assert.deepEqual(calls.at(-1)!.scaling, { level: 100 }, 'actual before does not invent weaker rolls');
    pressureFight(runtime, { level: 50, build: 'midgame', difficulty: 'standard', seed: 1, variant: 'before', path: 'natural' });
    assert.equal(calls.at(-1)!.profile.level, 51, 'the old road fight rebuilds at player + 1');
    assert.equal(calls.at(-1)!.scaling, undefined);
    assert.deepEqual(calls.at(-1)!.profile.jutsuIds, AI_PROFILE_CATALOG['builtin-ai-ember-duelist'].jutsuIds, 'old nightblade uses the burst template');
    pressureFight(runtime, { level: 50, build: 'midgame', difficulty: 'standard', seed: 1, variant: 'before-matched-mastery', matchedMastery: true, path: 'natural' });
    assert.equal(calls.at(-1)!.profile.level, 50, 'isolation explicitly matches candidate level');
    pressureFight(runtime, { level: 50, build: 'midgame', difficulty: 'standard', seed: 1, variant: 'after', path: 'natural' });
    assert.equal(calls.at(-1)!.profile.id, 'world-wanderer-benchmark-1');
    assert.equal(calls.at(-1)!.profile.pveTemplateId, 'builtin-ai-shadow-weaver');
});
