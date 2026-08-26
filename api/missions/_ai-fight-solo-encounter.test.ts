import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import {
    pveAiMasteryForLevel,
    pveDifficultyHpMultiplier,
    pveDifficultyStatMultiplier,
    scaleStatsForPveDifficulty,
} from '../_pve-difficulty.js';
import { perRankStatCap } from '../combat-core/formulas.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import type { AiFightProfile, AiFightScaling } from './_ai-fight-encounter.js';

const NOW = 1_770_000_000_000;
const profile = AI_PROFILE_CATALOG['builtin-ai-ember-duelist'] as unknown as AiFightProfile;

function makeSave(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        character: {
            name: 'Rill',
            level: 30,
            specialty: 'Ninjutsu',
            maxHp: 3_000,
            hp: 3_000,
            stats: {
                strength: 300, speed: 300, intelligence: 400, willpower: 350,
                ninjutsuOffense: 800, ninjutsuDefense: 600,
                taijutsuOffense: 200, taijutsuDefense: 200,
                bukijutsuOffense: 200, bukijutsuDefense: 200,
                genjutsuOffense: 200, genjutsuDefense: 200,
            },
            equippedJutsuIds: ['starter-universal-flicker'],
            ...overrides,
        },
        savedBloodlines: [],
        creatorJutsus: [],
    };
}

function build(params: {
    sessionId?: string;
    save?: Record<string, unknown>;
    profile?: AiFightProfile;
    scaling?: AiFightScaling;
    env?: NodeJS.ProcessEnv;
} = {}) {
    return buildSoloPveAiEncounter({
        sessionId: params.sessionId ?? 'aifight-live-test',
        playerName: 'Rill',
        save: params.save ?? makeSave(),
        profile: params.profile ?? profile,
        now: NOW,
        admin: null,
        ...(params.scaling ? { scaling: params.scaling } : {}),
        env: params.env ?? {},
    });
}

describe('live generic-AI Solo-PvE encounter', () => {
    it('seals the authored opponent, its resolved kit and a neutral battlefield', () => {
        const session = build();
        const level = Number(profile.level);
        const expectedStats = perRankStatCap(
            scaleStatsForPveDifficulty(
                profile.stats as Record<string, number>,
                pveDifficultyStatMultiplier(level),
            ),
            level,
        );

        assert.equal(session.runtime, 'solo-pve');
        assert.deepEqual(session.encounter, {
            kind: 'generic-ai',
            id: profile.id,
            sourceId: profile.id,
            level,
        });
        assert.equal(session.environment.biome, 'central');
        assert.equal(session.enemy.name, profile.name);
        assert.equal(session.enemy.character.level, level);
        assert.equal(session.enemy.character.boss, undefined);
        assert.equal(
            session.enemy.maxHp,
            Math.max(50, Math.floor(Number(profile.hp) * pveDifficultyHpMultiplier(level))),
        );
        assert.deepEqual(session.enemy.character.stats, expectedStats);
        assert.deepEqual(
            (session.enemy.character.jutsu as Array<{ id: string }>).map((jutsu) => jutsu.id),
            profile.jutsuIds,
        );
        assert.equal(session.player.name, 'Rill');
        assert.equal('towerId' in session, false);
        assert.equal('actors' in session, false);
    });

    it('rebuilds level, stats and HP from server scaling without mutating the catalog', () => {
        const before = JSON.stringify(profile);
        const authored = build({ sessionId: 'authored' });
        const scaled = build({ sessionId: 'scaled', scaling: { level: 60 } });
        const plainThirty = build({ sessionId: 'plain-thirty', scaling: { level: 30 } });
        const bonusThirty = build({ sessionId: 'bonus-thirty', scaling: { level: 30, statBonus: 55 } });
        const floored = build({ sessionId: 'floored', scaling: { level: 2, hpFloor: 1_400 } });
        const highFloor = build({ sessionId: 'high-floor', scaling: { level: 60, hpFloor: 1_400 } });

        assert.equal(scaled.enemy.character.level, 60);
        assert.ok(scaled.enemy.maxHp > authored.enemy.maxHp, 'the level rebuild must move HP');
        assert.ok(
            Number((scaled.enemy.character.stats as Record<string, number>).ninjutsuOffense)
                > Number((authored.enemy.character.stats as Record<string, number>).ninjutsuOffense),
            'the level rebuild must move stats',
        );
        assert.ok(
            Number((bonusThirty.enemy.character.stats as Record<string, number>).strength)
                > Number((plainThirty.enemy.character.stats as Record<string, number>).strength),
            'the server-authored stat bonus must survive the rank cap and difficulty band',
        );
        assert.equal(
            floored.enemy.maxHp,
            Math.max(50, Math.floor(1_400 * pveDifficultyHpMultiplier(2))),
            'the HP floor binds before the difficulty multiplier',
        );
        assert.equal(highFloor.enemy.maxHp, scaled.enemy.maxHp, 'the HP floor is a no-op above the curve');
        assert.equal(build({ sessionId: 'clamp-low', scaling: { level: -5 } }).enemy.character.level, 1);
        assert.equal(build({ sessionId: 'clamp-high', scaling: { level: 999 } }).enemy.character.level, 100);
        assert.equal(JSON.stringify(profile), before, 'the shared catalog profile must remain pristine');
    });

    it('is deterministic for identical sealed inputs', () => {
        const first = build({ sessionId: 'deterministic', scaling: { level: 45, statBonus: 20 } });
        const second = build({ sessionId: 'deterministic', scaling: { level: 45, statBonus: 20 } });
        assert.deepEqual(second, first);
    });

    it('seals the active carried pet and omits a companion when none is active', () => {
        const withPet = build({
            sessionId: 'with-pet',
            save: makeSave({
                activePetId: 'pet-1',
                pets: [{
                    id: 'pet-1', name: 'Kuro', level: 50, unlockedForPve: true,
                    rarity: 'rare', element: 'Fire', trait: 'Balanced', hp: 400,
                    attack: 60, defense: 40, speed: 50, happiness: 100,
                }],
            }),
        });

        assert.equal(withPet.pendingCompanion?.petId, 'pet-1');
        assert.equal(withPet.pendingCompanion?.name, 'Kuro');
        const underLevel = build({
            sessionId: 'under-level-pet',
            save: makeSave({
                activePetId: 'pet-1',
                pets: [{
                    id: 'pet-1', name: 'Kuro', level: 49, unlockedForPve: true,
                    rarity: 'rare', element: 'Fire', trait: 'Balanced', hp: 400,
                    attack: 60, defense: 40, speed: 50, happiness: 100,
                }],
            }),
        });
        assert.equal(underLevel.pendingCompanion, undefined, 'sub-50 pets never enter the sealed encounter');
        assert.equal(build({ sessionId: 'without-pet' }).pendingCompanion, undefined);
    });

    it('seals enemy mastery and the difficulty guard from the rebuilt level', () => {
        const session = build({ sessionId: 'guarded', scaling: { level: 12 } });
        const jutsu = session.enemy.character.jutsu as Array<{ id: string }>;
        const mastery = session.enemy.character.jutsuMastery as Array<{ jutsuId: string; level: number }>;

        assert.equal(mastery.length, jutsu.length);
        assert.deepEqual(mastery.map((entry) => entry.jutsuId), jutsu.map((entry) => entry.id));
        assert.ok(mastery.every((entry) => entry.level === pveAiMasteryForLevel(12)));
        assert.deepEqual(session.difficultyGuard, {
            enemyLevel: 12,
            playerHpTurnStart: 3_000,
            dealtThisTurn: 0,
        });
    });

    it('honors the AI-fight difficulty rollback switch', () => {
        const unguarded = build({
            sessionId: 'unguarded',
            env: { DISABLE_PVE_DIFFICULTY_GUARD_AI_FIGHT: '1' },
        });

        assert.equal(unguarded.difficultyGuard, undefined);
        assert.equal(unguarded.enemy.maxHp, Number(profile.hp));
        assert.deepEqual(unguarded.enemy.character.stats, perRankStatCap(profile.stats as Record<string, number>, Number(profile.level)));
    });

    it('preserves authored pools, armor, boss identity and the full stat sheet', () => {
        const authoredProfile: AiFightProfile = {
            id: 'ai-shadow-weaver',
            name: 'Shadow Weaver',
            level: 55,
            hp: 4_200,
            chakra: 900,
            stamina: 800,
            armorRawDR: 0.14,
            isBossAi: true,
            stats: {
                strength: 300, speed: 420, intelligence: 610, willpower: 380,
                genjutsuOffense: 1_700, genjutsuDefense: 1_200,
                ninjutsuOffense: 900, ninjutsuDefense: 700,
                taijutsuOffense: 200, taijutsuDefense: 150,
                bukijutsuOffense: 180, bukijutsuDefense: 140,
            },
            jutsuIds: [],
            rules: [],
        };
        const session = build({
            sessionId: 'authored-fields',
            profile: authoredProfile,
            env: { DISABLE_PVE_DIFFICULTY_GUARD_AI_FIGHT: '1' },
        });
        const expectedStats = perRankStatCap(authoredProfile.stats as Record<string, number>, 55);

        assert.equal(session.enemy.character.specialty, 'Genjutsu');
        assert.deepEqual(session.enemy.character.stats, expectedStats);
        assert.equal((session.enemy.character.stats as Record<string, number>).speed, expectedStats.speed);
        assert.equal((session.enemy.character.stats as Record<string, number>).taijutsuDefense, expectedStats.taijutsuDefense);
        assert.equal(session.enemy.character.armorRawDR, 0.14);
        assert.equal(session.enemy.maxChakra, 900);
        assert.equal(session.enemy.maxStamina, 800);
        assert.equal(session.enemy.character.boss, true);
    });

    it('clamps hostile profile fields at the live Solo-PvE boundary', () => {
        const hostile = {
            id: 'hostile-profile',
            name: 'z'.repeat(500),
            level: 9_999,
            hp: -50,
            chakra: -10,
            stamina: 99_999,
            armorRawDR: 99,
            stats: { genjutsuOffense: -100, speed: 'NaN' },
            jutsuIds: [],
            rules: [],
        } as AiFightProfile;
        const session = build({
            sessionId: 'hostile-fields',
            profile: hostile,
            env: { DISABLE_PVE_DIFFICULTY_GUARD_AI_FIGHT: '1' },
        });
        const stats = session.enemy.character.stats as Record<string, number>;

        assert.equal(session.enemy.character.level, 100);
        assert.equal(session.enemy.maxHp, 50);
        assert.equal(session.enemy.maxChakra, 100);
        assert.equal(session.enemy.maxStamina, 20_000);
        assert.equal(session.enemy.character.armorRawDR, 1.5);
        assert.ok(stats.genjutsuOffense >= 0 && stats.speed >= 0);
        assert.equal(session.enemy.name.length, 80);
    });

    it('keeps an opponent actionable when no authored jutsu resolves', () => {
        const broken = { ...profile, jutsuIds: ['not-a-real-jutsu'], rules: [] } as AiFightProfile;
        const session = build({ sessionId: 'fallback-kit', profile: broken });
        const jutsu = session.enemy.character.jutsu as Array<{ id: string }>;
        assert.ok(jutsu.length > 0, 'the resolver must supply a fallback signature');
        assert.match(jutsu[0]!.id, /signature$/);
    });

    it('does not let the fallback signature validate a broken authored rule program', () => {
        const broken = {
            ...profile,
            jutsuIds: ['missing-authored-jutsu'],
            rules: [{
                condition: 'always',
                value: 0,
                action: 'use_specific_jutsu',
                jutsuId: 'missing-authored-jutsu',
            }],
        } as AiFightProfile;

        assert.throws(
            () => build({ sessionId: 'broken-rules', profile: broken }),
            /invalid server rule program/i,
        );
    });
});
