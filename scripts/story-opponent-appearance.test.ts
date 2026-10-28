import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { STORY_COMBAT_IDENTITIES } from '../shared/story-combat-identity';
import { NARRATIVE_ENEMY_IDENTITIES, narrativeEnemyIdentity, narrativeEnemyJutsuIds } from '../shared/narrative-enemy-identity';
import { STORY_KAGE_ENCOUNTERS } from '../shared/story-kage';
import { storyBossEnemyTemplate } from '../api/story/_authoritative-story-combat';
import { buildSoloPveAiEncounter } from '../api/solo-pve/_ai-encounter';
import { buildHollowGateSoloPveEncounter } from '../api/hollow-gate/_encounter';
import { createHollowGateCombatBinding } from '../api/hollow-gate/_combat-session';
import { RIFT_QUESTS } from '../api/sector/_rift-quest';
import { resolveAiProfileJutsu } from '../api/_ai-opponent-loadout';
import { battlefieldAiSprite } from '../shinobij.client/src/lib/battlefield-actor-art';
import { builtinAiProfile } from '../api/_ai-profile-catalog';
import { worldRuntimeAiProfile } from '../api/missions/_world-ai-fight';
import { CARAVAN_ENEMIES } from '../api/festival/_caravan-combat';
import sharp from 'sharp';
import { narrativeGroupFor, type NarrativeGroup } from '../shared/narrative-groups';
import type { SoloPveSession } from '../api/solo-pve/_session';

const save = { character: { name: 'Audit', level: 75, hp: 1000, maxHp: 1000, stats: {} } };
const seal = (profile: Record<string, unknown> & { id: string }) => buildSoloPveAiEncounter({ profile, save, sessionId: profile.id, playerName: 'audit', admin: null, now: 1000 });
function realPublicImage(path: string) {
    assert.ok(existsSync(resolve('shinobij.client/public', path.slice(1))), `missing artwork: ${path}`);
}
function assertGroupPresentation(session: SoloPveSession, group: NarrativeGroup) {
    const actors = session.huntCombat!.battle.actors.filter(actor => actor.side === 'enemy');
    assert.deepEqual(actors.map(actor => actor.name), group.members.map(member => member.name));
    for (const [i, actor] of actors.entries()) {
        const member = group.members[i];
        assert.equal(actor.character.avatarImage, member.portrait);
        assert.equal(actor.character.visual, member.visual);
        assert.equal(actor.character.specialty, member.specialty);
        realPublicImage(member.portrait);
        const kit = actor.character.jutsu as Array<Record<string, unknown>>;
        const canonical = resolveAiProfileJutsu(member.jutsuIds);
        assert.deepEqual(kit.map(j => j.id), member.jutsuIds);
        for (const [j, move] of kit.entries()) {
            for (const field of ['ap', 'cooldown', 'element', 'tags', 'effectPower', 'chakraCost', 'staminaCost']) assert.deepEqual(move[field], canonical[j][field], `${member.name}/${field}`);
        }
    }
}

test('all chapter enemies seal their own portrait, role, element and actual technique names', () => {
    assert.equal(Object.keys(STORY_COMBAT_IDENTITIES).length, 32);
    for (const [id, identity] of Object.entries(STORY_COMBAT_IDENTITIES)) {
        const match = /^story-ai-(.+)-village-(\d+)$/.exec(id)!;
        const village = match[1].split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' ') + ' Village';
        const index = [4,15,25,35,50,65,75,85].indexOf(Number(match[2]));
        const session = seal(storyBossEnemyTemplate({ village, progressIndex: index }));
        const group = narrativeGroupFor(id);
        if (group) { assertGroupPresentation(session, group); continue; }
        assert.equal(session.enemy.character.avatarImage, identity.portrait, id);
        realPublicImage(identity.portrait);
        if (identity.body) realPublicImage(identity.body);
        assert.equal(session.enemy.character.specialty, identity.specialty);
        const techniques = session.enemy.character.jutsu as Array<Record<string, unknown>>;
        assert.ok(techniques.filter(jutsu => jutsu.id !== 'starter-universal-flicker')
            .every(jutsu => jutsu.element === identity.element), id);
        assert.ok(techniques.some(jutsu => jutsu.name === identity.signature), id);
        assert.ok(!techniques.some(jutsu => String(jutsu.name).endsWith(' Signature')), id);
        assert.ok(battlefieldAiSprite(id));
    }
});

test('Mira, the wooden guardian and the snow beast cannot fall back to a generic ninja', () => {
    assert.equal(battlefieldAiSprite('academy-spar-dummy'), '/combat-actors/narrative/academy-training-dummy.webp');
    assert.match(battlefieldAiSprite('builtin-ai-academy-sparring')!, /builtin-ai-academy-sparring-idle/, 'the human mission trainer keeps his own body');
    assert.equal(battlefieldAiSprite('story-ai-stormveil-village-75'), '/portraits/cinematic/storywide/mira-volt-neutral.webp');
    assert.equal(battlefieldAiSprite('story-ai-ashen-leaf-village-4'), '/combat-actors/narrative/wooden-root-guardian.webp');
    assert.match(battlefieldAiSprite('story-ai-frostfang-village-4')!, /hunt-ai-frost-wolf-idle/);
    assert.match(battlefieldAiSprite('story-ai-ashen-leaf-village-75')!, /hunt-ai-ember-drake-idle/);
    assert.equal(battlefieldAiSprite('world-questbook-qb-ashes-ashbound-slag'), '/portraits/quest-bosses/ashbound-slag.webp', 'Slag is the rock-armored man in his portrait, not the clan stone golem');
    assert.equal(battlefieldAiSprite('story-ai-ashen-leaf-village-35'), '/combat-actors/narrative/first-flame-sentinel.webp', 'the armored Sentinel is separate from the First Flame Avatar');
    assert.equal(battlefieldAiSprite('story-ai-frostfang-village-25'), '/combat-actors/narrative/frost-seal-guardian.webp', 'the ice Guardian is separate from the Echo controlling it');
    assert.equal(battlefieldAiSprite('story-ai-moonshadow-village-35'), '/combat-actors/narrative/contract-bound-shadow.webp', 'the contract guard is separate from Hollow Moon');
});

test('named road, quest and personal enemies seal real thematic kits and keep their canonical faces', () => {
    const custom = seal({ id: 'custom-fighter-with-rift-art', name: 'Custom Fighter', visual: 'rift-boss-engine-echo',
        avatarImage: '/portraits/pve/defender.webp', jutsuIds: ['starter-tai-water-2'] });
    assert.deepEqual((custom.enemy.character.jutsu as Array<{id:string}>).map(jutsu => jutsu.id), ['starter-tai-water-2', 'starter-universal-flicker'], 'reusing artwork alone must not replace an authored combat kit; shared Flicker is additive');
    assert.equal(custom.enemy.character.avatarImage, '/portraits/pve/defender.webp');
    for (const [id, identity] of Object.entries(NARRATIVE_ENEMY_IDENTITIES)) {
        realPublicImage(identity.portrait);
        if (identity.body) realPublicImage(identity.body);
        const runtimeId = id.startsWith('story-reckoning-') ? `world-story-${id}` :
            !id.startsWith('road-ai-') && !id.startsWith('rift-boss-') && !id.startsWith('world-crisis-') && !id.startsWith('sunscar-') ? `world-questbook-test-${id}` : id;
        const base = builtinAiProfile(id);
        const session = seal({ ...base, id: runtimeId, name: 'Authored foe', level: 50 });
        const group = narrativeGroupFor(runtimeId);
        if (group) { assertGroupPresentation(session, group); continue; }
        assert.equal(session.enemy.character.avatarImage, identity.portrait, runtimeId);
        const techniques = session.enemy.character.jutsu as Array<Record<string, unknown>>;
        const expectedIds = [...new Set([...narrativeEnemyJutsuIds(identity), 'starter-universal-flicker'])];
        assert.deepEqual(techniques.map(jutsu => jutsu.id), expectedIds, runtimeId);
        const canonical = resolveAiProfileJutsu(expectedIds);
        assert.equal(canonical.length, expectedIds.length, `${id}: no technique silently drops out`);
        for (const [index, technique] of techniques.entries()) {
            assert.deepEqual(technique.tags, canonical[index].tags, `${id}: labels must retain real effects`);
            assert.equal(technique.ap, canonical[index].ap);
            assert.equal(technique.cooldown, canonical[index].cooldown);
            if (identity.moveDescriptions?.[index]) assert.equal(technique.battleDescription, identity.moveDescriptions[index]);
        }
        assert.ok(narrativeEnemyIdentity(runtimeId));
    }
});

test('every real rift boss reaches combat with its dedicated body and portrait instead of a Hollow Hound', () => {
    for (const rift of Object.values(RIFT_QUESTS)) {
        const binding = createHollowGateCombatBinding({ playerName: 'audit', token: 'identity', floor: rift.floors,
            nodeId: `floor:${rift.floors}:tile:8`, kind: 'boss', runId: rift.id, now: 1000 });
        const session = buildHollowGateSoloPveEncounter({ binding, save, now: 1000, admin: null,
            run: { playerName: 'audit', mintedAt: 1000, seed: 'identity', floorDepth: rift.floors, currentFloor: rift.floors,
                entryCurrencies: {}, offeredAugmentIds: [], chosenAugmentId: null, dailyRunOrdinal: 1,
                variantId: rift.id, bossProfileId: rift.bossAiId, bossName: rift.bossName } });
        assert.equal(session.enemy.character.visual, rift.bossAiId);
        assert.equal(session.enemy.character.avatarImage, `/portraits/${rift.bossAiId}.webp`);
        assert.match(battlefieldAiSprite(String(session.enemy.character.visual))!, new RegExp(`${rift.bossAiId}-idle`));
        assert.deepEqual((session.enemy.character.jutsu as Array<{id:string}>).map(jutsu => jutsu.id), NARRATIVE_ENEMY_IDENTITIES[rift.bossAiId].jutsuIds);
        if (rift.bossAiId === 'rift-boss-gate-heir') {
            const elements = new Set((session.enemy.character.jutsu as Array<{element:string}>).map(jutsu => jutsu.element));
            for (const element of ['Lightning', 'Fire', 'Water', 'Wind']) assert.ok(elements.has(element), `the Heir draws on all four village powers: ${element}`);
        }
    }
});

test('final Kage encounters keep their already-authored portraits and full signature kits', () => {
    for (const [village, identity] of Object.entries(STORY_KAGE_ENCOUNTERS)) {
        const session = seal(storyBossEnemyTemplate({ village, progressIndex: 8 }));
        assert.equal(session.enemy.character.avatarImage, identity.portrait);
        assert.deepEqual((session.enemy.character.jutsu as Array<{id:string}>).map(jutsu => jutsu.id), [...identity.jutsuIds]);
    }
});

test('all six caravan encounters override the borrowed kit donor’s appearance, including the scorpion', () => {
    for (const [key, definition] of Object.entries(CARAVAN_ENEMIES)) {
        const session = seal({ ...builtinAiProfile(definition.profile), id: `sunscar-${key}`, name: definition.name, visual: definition.profile });
        assert.equal(session.enemy.character.visual, `sunscar-${key}`);
        assert.equal(session.enemy.character.avatarImage, NARRATIVE_ENEMY_IDENTITIES[`sunscar-${key}`].portrait);
        assert.ok(battlefieldAiSprite(String(session.enemy.character.visual)));
        if (key === 'scorpion') {
            assert.match(battlefieldAiSprite(String(session.enemy.character.visual))!, /scorpion-queen/);
            const techniques = session.enemy.character.jutsu as Array<{ name: string; tags?: Array<{name:string}> }>;
            assert.ok(techniques.some(jutsu => jutsu.name === 'Venom Sting' && jutsu.tags?.some(tag => tag.name === 'Poison')));
        }
    }
});

test('veteran named enemies retain their rotation capacity with themed follow-ups', () => {
    const profile = worldRuntimeAiProfile('world-questbook-qb-ashes-kazan-ashbound', 'Kazan the Ashbound', 85, 8, 'boss', true);
    const session = seal(profile);
    const techniques = session.enemy.character.jutsu as Array<{element:string}>;
    assert.equal(techniques.length, (profile.jutsuIds as string[]).length);
    assert.ok(techniques.every(jutsu => jutsu.element === 'Fire' || jutsu.element === 'None'));
});

test('new creature and paired-fighter cutouts retain transparency and the tile asset budget', async () => {
    for (const name of ['academy-training-dummy', 'wooden-root-guardian', 'tempest-twins', 'glacier-twins', 'scorpion-queen', 'first-flame-sentinel', 'frost-seal-guardian', 'contract-bound-shadow', 'black-bridge-shooter']) {
        const path = resolve(`shinobij.client/public/combat-actors/narrative/${name}.webp`);
        const metadata = await sharp(path).metadata();
        assert.equal(metadata.width, 384);
        assert.equal(metadata.height, 384);
        assert.equal(metadata.hasAlpha, true);
        assert.ok(statSync(path).size <= 128 * 1024);
    }
});
