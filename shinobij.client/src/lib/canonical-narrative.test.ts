import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { canonicalNarrativeEvent, isReservedNarrativeId } from './canonical-narrative';
import { storylines } from '../data/storylines';
import { defaultPetEncounterVn } from '../data/default-vn-events';
import type { CreatorEvent } from '../types/vn';

function frostfang(): CreatorEvent {
    const chapter = storylines['Frostfang Village'][0];
    return { id: 'story-frostfang-village-4-0', name: chapter.title, biome: 'snow', icon: 'F',
        eventKind: 'visualNovel', levelReq: chapter.levelReq, xpReward: 0, ryoReward: 0, staminaReward: 0,
        dialogue: chapter.dialogue, vnPages: chapter.pages };
}

test('saved dialogue, typed lines, speakers and branches cannot override a built-in chapter', () => {
    const base = frostfang();
    const saved = structuredClone(base);
    saved.dialogue = ['Obsolete summary'];
    saved.levelReq = 1;
    const page = saved.vnPages![1];
    page.dialogue = ['Obsolete intake'];
    page.lines = [{ speaker: 'Wrong person', text: 'Typed text wins in the reader unless removed.' }];
    page.speaker = 'Wrong person';
    page.choices = [{ text: 'Skip the chapter', nextPage: 999, trait: 'obsolete' }];
    page.image = '/uploaded-intake.webp';
    const snapshot = structuredClone(saved);
    const result = canonicalNarrativeEvent(base, saved);
    assert.deepEqual(result.dialogue, base.dialogue);
    assert.equal(result.levelReq, base.levelReq);
    assert.deepEqual(result.vnPages![1].dialogue, base.vnPages![1].dialogue);
    assert.equal(result.vnPages![1].lines, undefined);
    assert.equal(result.vnPages![1].speaker, 'Elder Sova');
    assert.deepEqual(result.vnPages![1].choices, base.vnPages![1].choices);
    assert.equal(result.vnPages![1].image, page.image);
    assert.deepEqual(saved, snapshot, 'hydration does not mutate the stored source');
});

test('art follows page and actor identity, not a stale page position or cast slot', () => {
    const base = frostfang(), saved = structuredClone(base);
    const page = saved.vnPages![1];
    page.leftName = 'Player';
    page.leftImage = '/player.webp';
    page.rightName = 'Elder Sova';
    page.rightImage = '/sova.webp';
    const result = canonicalNarrativeEvent(base, saved);
    assert.equal(result.vnPages![1].leftImage, '/sova.webp');
    assert.equal(result.vnPages![1].rightImage, '/player.webp');
    page.title = 'An unrelated old page';
    page.image = '/wrong-scene.webp';
    assert.deepEqual(canonicalNarrativeEvent(base, saved).vnPages![1], base.vnPages![1]);
});

test('old system aliases retain art but cannot revive legacy narration', () => {
    const saved = { ...defaultPetEncounterVn, id: 'pet-encounter', image: '/trail.webp', vnPages: [] };
    const result = canonicalNarrativeEvent(defaultPetEncounterVn, saved, ['pet-encounter']);
    assert.equal(result.id, defaultPetEncounterVn.id);
    assert.equal(result.image, saved.image);
    assert.deepEqual(result.vnPages, defaultPetEncounterVn.vnPages);
    assert.equal(canonicalNarrativeEvent(defaultPetEncounterVn, saved), defaultPetEncounterVn);
});

test('reserved scenes cannot be redelivered through generic saved-event triggers', () => {
    for (const id of ['pet-encounter', 'ancient-chest', 'legacy-sage-offer', 'chronicle-scribe']) assert.ok(isReservedNarrativeId(id), id);
    for (const id of ['story-frostfang-village-4-0', 'story-interlude-stormveil-village-20', 'rift-first-clear-legacy-echo', 'builtin-awakening-lv2', 'builtin-aura-sphere-lv9', 'builtin-hidden-dungeon', 'craft-dungeon-snow', 'sys-pet-encounter', 'sys-ancient-chest']) assert.ok(isReservedNarrativeId(id), id);
    assert.equal(isReservedNarrativeId('creator-village-festival'), false);
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    assert.match(app, /canonicalNarrativeEvent\(next\.base, edited\)/);
    assert.equal((app.match(/!isReservedNarrativeId\((?:ev|candidate)\.id\)/g) ?? []).length, 3);
    assert.doesNotMatch(app, /edited \?\? next\.base/);
    const world = readFileSync(new URL('../screens/WorldMap.tsx', import.meta.url), 'utf8');
    assert.match(world, /canonicalNarrativeEvent\(defaultPetEncounterVn, petEncounterVn/);
    assert.match(world, /canonicalNarrativeEvent\(defaultAncientChestVn, ancientChestVn/);
});
