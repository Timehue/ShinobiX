import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    buildAuthoritativeSoloEncounter,
    dynamicBossFloor,
    missionEnemyTemplate,
} from './_authoritative-pve.js';
import { combatMissionByKey } from './missions/_mission-catalog.js';
import { sealPveDifficultyBand } from './_pve-band-seal.js';
import { sealPveAiMastery } from './_pve-ai-mastery.js';
import { pveDifficultyHpMultiplier, pveDifficultyStatMultiplier } from './_pve-difficulty.js';
import type { TowerSession } from './towers/_tower-session.js';

/*
 * Steps B + C on a REAL encounter, not a synthetic one.
 *
 * The unit tests for both seals build hand-made sessions, and the wiring tests
 * assert the handlers still call them. Neither proves the seals actually bite on
 * the encounter shape the mission handler really produces. The failure modes
 * that gap hides are concrete and silent: a boss actor that is not
 * `side === 'enemy'`, a template that carries no `jutsu` array (so mastery seals
 * nothing), or a stats object the band cannot reach. This builds the encounter
 * exactly as api/missions/combat-start.ts does and asserts the result.
 */

const MISSION_KEY = 'combat-c-patrol';

function makeSave(): Record<string, unknown> {
    return {
        character: {
            name: 'Rill', level: 40, specialty: 'Ninjutsu', maxHp: 5000, hp: 5000,
            stats: {
                strength: 300, speed: 300, intelligence: 300, willpower: 300,
                ninjutsuOffense: 600, ninjutsuDefense: 300,
                taijutsuOffense: 300, taijutsuDefense: 300,
                bukijutsuOffense: 300, bukijutsuDefense: 300,
                genjutsuOffense: 300, genjutsuDefense: 300,
            },
            equippedJutsuIds: ['starter-universal-flicker'],
        },
        savedBloodlines: [], creatorJutsus: [],
    };
}

/** Build a combat-mission encounter the way api/missions/combat-start.ts does. */
function buildMissionEncounter(): TowerSession {
    const mission = combatMissionByKey(MISSION_KEY);
    assert.ok(mission, `fixture check: ${MISSION_KEY} exists in the server catalog`);
    return buildAuthoritativeSoloEncounter({
        playerName: 'Rill',
        save: makeSave(),
        floor: dynamicBossFloor({
            id: 9_102, name: mission.key, bossAiId: mission.aiProfileId,
            objective: 'defeat-boss', roundBudget: 24, biome: 'volcano',
        }),
        bossTemplate: missionEnemyTemplate(mission),
        runId: 'mission-seal-integration',
        seed: 99,
        now: 1_770_000_000_000,
        towerId: 'combat-mission',
    });
}

const bossOf = (s: TowerSession) => s.actors.find(a => a.side === 'enemy')!;

describe('PvE seals on a REAL combat-mission encounter', () => {
    it('the encounter has an enemy-side boss the seals can actually reach', () => {
        // Every assertion below depends on this, and all three properties have
        // been assumed rather than checked until now.
        const boss = bossOf(buildMissionEncounter());
        assert.ok(boss, 'the encounter produces an enemy-side actor');
        assert.ok(Number(boss.character.level) > 0, 'the boss carries a level for the band');
        assert.ok(Array.isArray(boss.character.jutsu) && boss.character.jutsu.length > 0,
            'the boss carries a jutsu array — without one, mastery seals nothing');
        assert.ok(boss.character.stats && typeof boss.character.stats === 'object',
            'the boss carries a stats object the band can scale');
    });

    it('the band scales the real boss and arms the guard', () => {
        const session = buildMissionEncounter();
        const before = {
            maxHp: bossOf(session).maxHp,
            stats: { ...(bossOf(session).character.stats as Record<string, number>) },
            level: Number(bossOf(session).character.level),
        };
        assert.equal(sealPveDifficultyBand(session, { mode: 'MISSION', env: {} }), true);

        const boss = bossOf(session);
        const hpMult = pveDifficultyHpMultiplier(before.level);
        const statMult = pveDifficultyStatMultiplier(before.level);
        assert.equal(boss.maxHp, Math.max(1, Math.floor(before.maxHp * hpMult)), 'HP banded');
        assert.equal(
            (boss.character.stats as Record<string, number>).ninjutsuOffense,
            Math.round(before.stats.ninjutsuOffense * statMult),
            'stats banded',
        );
        assert.equal(session.pveGuard?.enemyLevel, before.level, 'guard armed on the boss level');
        // NON-VACUITY: a level-40 mission foe is the MEDIUM band, so both
        // multipliers are genuinely below 1 and this test could fail.
        assert.ok(hpMult < 1 && statMult < 1, `fixture check: level ${before.level} must be a scaled band`);
    });

    it('mastery seals onto the real boss, and only the boss', () => {
        const session = buildMissionEncounter();
        assert.equal(bossOf(session).character.jutsuMastery, undefined, 'fixture check: unsealed to begin with');
        assert.equal(sealPveAiMastery(session, { mode: 'MISSION', env: {} }), 1, 'exactly one actor sealed');

        const mastery = bossOf(session).character.jutsuMastery as Array<{ jutsuId: string; level: number }>;
        assert.ok(Array.isArray(mastery) && mastery.length > 0, 'the boss got a mastery entry per jutsu');
        assert.equal(mastery.length, (bossOf(session).character.jutsu as unknown[]).length, 'one entry per jutsu');
        for (const entry of mastery) assert.ok(entry.level > 0, 'mastery is above the 0 that caused the 30% bug');

        const player = session.actors.find(a => a.ai === false)!;
        assert.equal(player.character.jutsuMastery === mastery, false, 'the player was not handed the boss mastery');
    });

    it('both seals compose in the handler order, and stay idempotent together', () => {
        // combat-start seals the band THEN mastery. Re-running both must be a
        // complete no-op — the settle path and any retry depend on it.
        const session = buildMissionEncounter();
        sealPveDifficultyBand(session, { mode: 'MISSION', env: {} });
        sealPveAiMastery(session, { mode: 'MISSION', env: {} });
        const snapshot = JSON.stringify({
            hp: bossOf(session).maxHp,
            stats: bossOf(session).character.stats,
            mastery: bossOf(session).character.jutsuMastery,
            guard: session.pveGuard,
        });

        assert.equal(sealPveDifficultyBand(session, { mode: 'MISSION', env: {} }), false);
        assert.equal(sealPveAiMastery(session, { mode: 'MISSION', env: {} }), 0);
        assert.equal(
            JSON.stringify({
                hp: bossOf(session).maxHp,
                stats: bossOf(session).character.stats,
                mastery: bossOf(session).character.jutsuMastery,
                guard: session.pveGuard,
            }),
            snapshot,
            'a second pass changed the sealed encounter',
        );
    });

    it('the global kill switch leaves a real encounter completely untouched', () => {
        const session = buildMissionEncounter();
        const before = JSON.stringify(bossOf(session));
        sealPveDifficultyBand(session, { mode: 'MISSION', env: { DISABLE_PVE_DIFFICULTY_GUARD: '1' } });
        sealPveAiMastery(session, { mode: 'MISSION', env: { DISABLE_PVE_AI_MASTERY: '1' } });
        assert.equal(JSON.stringify(bossOf(session)), before, 'the boss is byte-identical');
        assert.equal(session.pveGuard, undefined, 'and no guard was armed');
    });
});
