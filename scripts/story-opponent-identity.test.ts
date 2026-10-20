import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSoloPveAiEncounter, type SoloPveAiProfile } from '../api/solo-pve/_ai-encounter';
import { storyBossEnemyTemplate } from '../api/story/_authoritative-story-combat';
import { applyWorldAiFightSettlement, buildWorldAiFightSpec } from '../api/missions/_world-ai-fight';
import { createHollowGateCombatBinding } from '../api/hollow-gate/_combat-session';
import { buildHollowGateSoloPveEncounter } from '../api/hollow-gate/_encounter';
import { RIFT_QUESTS } from '../api/sector/_rift-quest';
import { buildWorldBossTeamEncounter } from '../api/world-boss-event/_encounter';
import { buildWorldCrisis80EnemyTemplates, buildWorldCrisis80Floor } from '../api/world-crisis-80/_encounter';
import { buildTowerEncounter } from '../api/towers/_encounter';
import { WORLD_BOSS_DEFINITIONS, worldBossBattleVisual } from '../shared/world-boss-event';
import { WORLD_CRISIS_80_ENCOUNTERS } from '../shared/world-crisis-80';
import { WORLD_CRISIS_ENCOUNTERS } from '../shared/world-crisis';
import { newWorldCrisisState, WORLD_CRISIS_STATE_KEY } from '../api/world-crisis/_state';
import { kv } from '../api/_storage';
import { weeklyBossChallengeProfile } from '../api/_weekly-boss-profile';
import { builtinAiProfile } from '../api/_ai-profile-catalog';
import { storylines } from '../shinobij.client/src/data/storylines';
import { storyReckonings } from '../shinobij.client/src/data/story-reckonings';
import { hollowRifts } from '../shinobij.client/src/data/hollow-rifts';
import { QUEST_BOOK, QUEST_BOSSES } from '../shinobij.client/src/lib/questbook';
import { narrativeGroupFor } from '../shared/narrative-groups';

const now = 1_800_000_000_000;
const characterAt = (level: number) => ({ name: 'Audit', level, hp: 1000, maxHp: 1000,
    chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500, stats: {}, inventory: [] });
function sealedEnemy(profile: SoloPveAiProfile, level: number, difficultyMode = 'AI_FIGHT' as 'AI_FIGHT' | 'STORY') {
    return buildSoloPveAiEncounter({ sessionId: `identity-${profile.id}`, playerName: 'audit', now, admin: null,
        profile, difficultyMode, save: { character: characterAt(level) } }).enemy;
}
const squad = [{ id: 'sq-0', name: 'Audit', ownerSlug: 'audit', ai: false, character: characterAt(100) }];
function assertNamedEncounter(profile: SoloPveAiProfile, level: number, name: string, difficultyMode: 'AI_FIGHT' | 'STORY' = 'AI_FIGHT') {
    const session = buildSoloPveAiEncounter({ sessionId: `identity-${profile.id}`, playerName: 'audit', now, admin: null,
        profile, difficultyMode, save: { character: characterAt(level) } });
    const group = narrativeGroupFor(profile.id, profile.narrativeGroupId, String(profile.name));
    if (group) {
        assert.equal(session.huntCombat!.battle.encounterFloor!.name, name);
        assert.deepEqual(session.huntCombat!.battle.actors.filter(a => a.side === 'enemy').map(a => a.name), group.members.map(m => m.name));
        assert.equal(session.enemy.name, name, 'the outer seal retains the encounter title');
        assert.equal(session.enemy.character.name, group.members[0].name, 'the projected fighter is the lead actor');
    } else {
        assert.equal(session.enemy.name, name); assert.equal(session.enemy.character.name, name);
    }
}

test('all 36 village chapters create the opponent named in their dialogue, including finales', () => {
    let count = 0;
    for (const [village, chapters] of Object.entries(storylines)) for (const [progressIndex, chapter] of chapters.entries()) {
        const profile = storyBossEnemyTemplate({ village, progressIndex });
        assert.equal(profile.id, chapter.aiProfileId, `${village}/${progressIndex}`);
        assertNamedEncounter(profile, chapter.levelReq, chapter.bossName, 'STORY');
        count++;
    }
    assert.equal(count, 36);
});

test('every epic quest AI boss and every wave seals the advertised opponent, including rivalry escalation', async () => {
    let stages = 0;
    for (const quest of Object.values(QUEST_BOOK)) for (const [stageIndex, stage] of quest.stages.entries()) {
        if (stage.metric !== 'totalAiKills' || !stage.bossId) continue;
        const boss = QUEST_BOSSES[stage.bossId];
        for (const tier of boss.scalesWithRivalry ? [0, 4] : [0]) {
            let character: Record<string, unknown> = { ...characterAt(quest.bandMin), wandererNemesis: { tier } };
            const seal = { id: quest.id, stage: stageIndex, baseline: 0, at: now, choices: {} };
            for (let wave = 1; wave <= stage.count; wave++) {
                const spec = await buildWorldAiFightSpec({ playerName: 'audit', now,
                    request: { kind: 'questbook-boss', sourceId: quest.id, sector: 25 },
                    save: { currentSector: 25, character, activeQuestbookSeal: seal } });
                const name = narrativeGroupFor(spec.profile.id, spec.profile.narrativeGroupId)?.name
                    ?? boss.name + (stage.count > 1 ? ` — Wave ${wave}` : '') + (tier >= 4 ? ', Risen' : '');
                assert.equal(spec.context.displayName, name, `${quest.id}/${stage.key}`);
                assertNamedEncounter(spec.profile, quest.bandMin, name);
                character = applyWorldAiFightSettlement(character, spec.context, 'win', `${quest.id}-${tier}-${wave}`);
            }
        }
        stages++;
    }
    assert.equal(stages, 9);
});

test('all five personal story hunts create their named quest opponent', async () => {
    let count = 0;
    for (const quest of storyReckonings) {
        if (quest.task.kind !== 'hunt') continue;
        assert.ok(quest.task.boss, quest.id);
        const spec = await buildWorldAiFightSpec({ playerName: 'audit', now,
            request: { kind: 'story-reckoning', sourceId: quest.id, sector: 25 },
            save: { currentSector: 25, character: characterAt(quest.levelReq),
                activeStoryReckoningSeal: { id: quest.id, stage: 'task', baseline: 0, at: now } } });
        assert.equal(spec.context.displayName, quest.task.boss.name, quest.id);
        assert.equal(sealedEnemy(spec.profile, quest.levelReq).name, quest.task.boss.name, quest.id);
        assert.equal(quest.task.targetName.toLowerCase(), spec.context.displayName.toLowerCase(), quest.id);
        count++;
    }
    assert.equal(count, 5);
});

test('all seven rift finales carry the advertised identity through run and combat sealing', () => {
    for (const rift of hollowRifts) {
        const definition = RIFT_QUESTS[rift.id];
        const binding = createHollowGateCombatBinding({ playerName: 'audit', token: 'identity-token', now,
            floor: definition.floors, nodeId: `floor:${definition.floors}:tile:8`, kind: 'boss', runId: rift.id });
        const session = buildHollowGateSoloPveEncounter({ binding, now, admin: null,
            save: { character: characterAt(rift.levelReq) },
            run: { playerName: 'audit', mintedAt: now, seed: 'identity-seed', floorDepth: definition.floors,
                currentFloor: definition.floors, entryCurrencies: {}, offeredAugmentIds: [], chosenAugmentId: null,
                dailyRunOrdinal: 1, variantId: definition.id, bossProfileId: definition.bossAiId, bossName: definition.bossName } });
        assert.equal(session.enemy.name, rift.bossName, rift.id);
        assert.equal(session.enemy.character.name, rift.bossName);
    }
    assert.equal(hollowRifts.length, 7);
});

test('all three public world bosses keep their announced identity and battle visual in combat', () => {
    for (const definition of WORLD_BOSS_DEFINITIONS) {
        const session = buildWorldBossTeamEncounter({ squad, now, runId: 'identity-world-boss', matchId: 'identity-match', seed: 42,
            event: { eventId: 'identity-event', bossId: definition.id, bossName: definition.name, hp: 600_000, hpMax: 600_000 } });
        const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
        assert.equal(boss.name, definition.name, definition.id);
        assert.equal(boss.character.name, definition.name);
        assert.equal(boss.character.visual, worldBossBattleVisual(definition.id));
    }
});

test('weekly bosses keep the announced spawn name even if their source profile changes', () => {
    for (const id of ['ashen-dragon', 'moonshadow-oni', 'frostfang-warlord', 'stormveil-beast', 'deathsgate-revenant']) {
        const base = builtinAiProfile(id)!;
        const spawn = { id, name: base.name as string };
        for (const profile of [base, { ...base, name: 'Renamed after the announcement' }, null]) {
            const enemy = sealedEnemy(weeklyBossChallengeProfile(profile, spawn), 100);
            assert.equal(enemy.name, spawn.name, id);
        }
        assert.equal(sealedEnemy(weeklyBossChallengeProfile(base, { id }), 100).name, base.name, 'unnamed legacy spawns keep the catalog name');
    }
});

test('each village Reckoning creates exactly the three enemies announced for that village', () => {
    for (const encounter of Object.values(WORLD_CRISIS_80_ENCOUNTERS)) {
        const session = buildTowerEncounter({ floor: buildWorldCrisis80Floor(encounter), squad, now, runId: encounter.sourceId,
            seed: 42, partySize: 1, embedFloor: true, enemyTemplates: buildWorldCrisis80EnemyTemplates(encounter, 100, null) });
        const enemies = session.actors.filter(actor => actor.side === 'enemy');
        assert.deepEqual(enemies.map(enemy => enemy.name).sort(), encounter.triad.map(member => member.name).sort(), encounter.village);
    }
});

test('each Fourfold Breach defense creates the opponent announced for the defending village', async (t) => {
    const state = newWorldCrisisState(now, 'active');
    t.mock.method(kv, 'get', async (key: string) => {
        assert.equal(key, WORLD_CRISIS_STATE_KEY, 'this identity test must not read any live state');
        return state;
    });
    for (const encounter of Object.values(WORLD_CRISIS_ENCOUNTERS)) {
        const spec = await buildWorldAiFightSpec({ playerName: 'audit', now,
            request: { kind: 'world-crisis', sourceId: encounter.sourceId, sector: 0 },
            save: { character: { ...characterAt(37), village: encounter.village } } });
        assert.equal(spec.context.displayName, encounter.name, encounter.village);
        assertNamedEncounter(spec.profile, 37, encounter.name);
    }
});
