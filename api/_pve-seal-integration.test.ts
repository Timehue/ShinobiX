import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { missionEnemyTemplate, missionEnvironment } from './_authoritative-pve.js';
import { combatMissionByKey } from './missions/_mission-catalog.js';
import { buildSoloPveAiEncounter } from './solo-pve/_ai-encounter.js';
import {
    pveAiMasteryForLevel,
    pveDifficultyHpMultiplier,
    pveDifficultyStatMultiplier,
    scaleStatsForPveDifficulty,
} from './_pve-difficulty.js';
import { perRankStatCap } from './combat-core/formulas.js';

/*
 * Mission authority integration on the live Solo-PvE encounter shape.
 *
 * Earlier versions of this test built a TowerSession through a retired generic
 * PvE helper. That proved a dead constructor while the mounted mission route had
 * already moved to buildSoloPveAiEncounter. These
 * assertions now exercise the same template, difficulty mode, environment, and
 * session schema used by api/missions/combat-start.ts.
 */

const MISSION_KEY = 'combat-c-patrol';
const NOW = 1_770_000_000_000;
const CANONICAL_STATS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'taijutsuOffense', 'taijutsuDefense',
    'bukijutsuOffense', 'bukijutsuDefense',
    'ninjutsuOffense', 'ninjutsuDefense',
    'genjutsuOffense', 'genjutsuDefense',
] as const;

function completeStats(stats: Record<string, number>): Record<string, number> {
    return Object.fromEntries(CANONICAL_STATS.map((key) => [key, Math.max(0, Number(stats[key]) || 0)]));
}

function makeSave(): Record<string, unknown> {
    return {
        character: {
            name: 'Rill', level: 40, specialty: 'Ninjutsu', maxHp: 5_000, hp: 5_000,
            maxChakra: 2_000, chakra: 1_800, maxStamina: 2_000, stamina: 1_700,
            stats: {
                strength: 300, speed: 300, intelligence: 300, willpower: 300,
                ninjutsuOffense: 600, ninjutsuDefense: 300,
                taijutsuOffense: 300, taijutsuDefense: 300,
                bukijutsuOffense: 300, bukijutsuDefense: 300,
                genjutsuOffense: 300, genjutsuDefense: 300,
            },
            equippedJutsuIds: ['starter-universal-flicker'],
            equipment: {}, inventory: [],
        },
        savedBloodlines: [], creatorJutsus: [], creatorItems: [],
    };
}

function buildMissionEncounter(env: NodeJS.ProcessEnv = {}) {
    const mission = combatMissionByKey(MISSION_KEY);
    assert.ok(mission, `fixture check: ${MISSION_KEY} exists in the server catalog`);
    const profile = { ...missionEnemyTemplate(mission), id: mission.aiProfileId };
    const environment = missionEnvironment(mission.key);
    const session = buildSoloPveAiEncounter({
        sessionId: 'mission-seal-integration',
        playerName: 'rill',
        save: makeSave(),
        profile,
        now: NOW,
        admin: null,
        difficultyMode: 'MISSION',
        encounter: {
            kind: 'mission', id: mission.key, sourceId: mission.aiProfileId,
            bindingId: 'mission-seal-integration',
        },
        environment: {
            biome: environment.biome,
            weatherPositiveElement: environment.weather?.positiveElement,
            weatherNegativeElement: environment.weather?.negativeElement,
        },
        env,
    });
    return { mission, profile, session };
}

describe('PvE seals on the live Solo-PvE combat-mission encounter', () => {
    it('builds the mounted runtime shape with the server-owned mission binding', () => {
        const { mission, session } = buildMissionEncounter();
        assert.equal(session.runtime, 'solo-pve');
        assert.equal(session.ownerSlug, 'rill');
        assert.deepEqual(session.encounter, {
            kind: 'mission', id: mission.key, sourceId: mission.aiProfileId,
            bindingId: 'mission-seal-integration', level: Number(session.enemy.character.level),
        });
        assert.equal('towerId' in session, false);
        assert.equal('actors' in session, false);
        assert.equal(session.environment.biome, 'volcano');
        assert.equal(session.environment.weatherPositiveElement, 'Fire');
        assert.equal(session.environment.weatherNegativeElement, 'Water');
    });

    it('applies the mission difficulty band and arms the Solo guard', () => {
        const { profile, session } = buildMissionEncounter();
        const level = Number(profile.level);
        const rawStats = completeStats(profile.stats as Record<string, number>);
        const expectedStats = perRankStatCap(
            scaleStatsForPveDifficulty(rawStats, pveDifficultyStatMultiplier(level)),
            level,
        );
        assert.equal(
            session.enemy.maxHp,
            Math.max(50, Math.floor(Number(profile.hp) * pveDifficultyHpMultiplier(level))),
        );
        assert.deepEqual(session.enemy.character.stats, expectedStats);
        assert.deepEqual(session.difficultyGuard, {
            enemyLevel: level,
            playerHpTurnStart: session.player.hp,
            dealtThisTurn: 0,
        });
        assert.ok(pveDifficultyHpMultiplier(level) < 1, 'fixture check: this mission is below the peer band');
    });

    it('seals enemy mastery without overwriting the authoritative player', () => {
        const { session } = buildMissionEncounter();
        const enemyJutsu = session.enemy.character.jutsu as Array<{ id: string }>;
        const mastery = session.enemy.character.jutsuMastery as Array<{ jutsuId: string; level: number }>;
        assert.ok(enemyJutsu.length > 0, 'the mission enemy has a server-authored loadout');
        assert.deepEqual(mastery.map((entry) => entry.jutsuId), enemyJutsu.map((jutsu) => jutsu.id));
        assert.ok(mastery.every((entry) => entry.level === pveAiMasteryForLevel(Number(session.enemy.character.level))));
        assert.notDeepEqual(session.player.character.jutsuMastery, mastery);
    });

    it('keeps the rollback switch scoped to the live Solo difficulty seal', () => {
        const { profile, session } = buildMissionEncounter({ DISABLE_PVE_DIFFICULTY_GUARD: '1' });
        const level = Number(profile.level);
        assert.equal(session.enemy.maxHp, Number(profile.hp));
        assert.deepEqual(session.enemy.character.stats, perRankStatCap(completeStats(profile.stats as Record<string, number>), level));
        assert.equal(session.difficultyGuard, undefined);
        assert.ok(Array.isArray(session.enemy.character.jutsuMastery), 'AI mastery remains a separate live Solo seal');
    });
});
