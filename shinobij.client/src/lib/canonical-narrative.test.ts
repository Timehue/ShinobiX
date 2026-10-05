import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { adminEditableNarrativeEvents, canonicalNarrativeEvent, isReservedNarrativeId, sameNarrativeArtwork } from './canonical-narrative';
import { overlayVnImages, vnActorImageKey } from './vn-shared-artwork';
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

test('the Admin Panel lists built-ins as players receive them, not the stored pre-rebuild copies', () => {
    // Shape of the live admin2 row for this chapter (read 2026-09-18): the
    // three-page pre-rebuild draft with retired "Frost Echo" lore.
    const base = frostfang();
    const stale: CreatorEvent = {
        ...base, name: 'Frostfang Village: The Pack Survives', image: '/api/img?id=event%3Astory-frostfang-village-4-0%3Abg',
        dialogue: ['Elder Sova: The ice remembers footsteps. Walk with purpose, and it carries you.'],
        vnPages: [
            { title: 'The Pack Survives', scene: 'Snow lashes across a frozen training yard.', speaker: 'Elder Sova', dialogue: ['Elder Sova: It is my honor to meet someone chosen by the Frost Echo.'] },
            { title: 'The Warning', scene: 'Snow lashes across a frozen training yard.', speaker: 'Captain Yura', dialogue: ['Captain Yura: The Frost Echo has not chosen someone for generations.'] },
            { title: "The Kage's Shadow", scene: 'Snow lashes across a frozen training yard.', speaker: 'Frost Seal Echo', dialogue: ['Frost Seal Echo: The pact was made to protect us.'], choices: [{ text: 'Protect the people.', nextPage: 2, trait: 'merciful' }] },
        ],
    };
    const custom: CreatorEvent = { id: 'event-festival', name: 'Lantern Festival', biome: 'forest', icon: 'L', eventKind: 'visualNovel', levelReq: 3, xpReward: 0, ryoReward: 0, staminaReward: 0, dialogue: ['Narrator: The lanterns go up at dusk.'] };
    const orphan: CreatorEvent = { ...defaultPetEncounterVn, vnPages: [{ title: 'A Presence in the Shadows', scene: 'Old', speaker: 'Narrator', dialogue: ['Narrator: It chose to find you.'] }] };
    const saved = [stale, custom, orphan];
    const listed = adminEditableNarrativeEvents([base], saved);
    assert.deepEqual(listed.map(event => event.id), [base.id, custom.id]);
    const chapter = listed[0];
    assert.deepEqual(chapter.vnPages, base.vnPages);
    assert.deepEqual(chapter.dialogue, base.dialogue);
    assert.equal(chapter.image, stale.image, 'uploaded event art survives');
    assert.doesNotMatch(JSON.stringify(chapter), /Frost Echo|ice remembers/);
    assert.equal(listed[1], custom, 'custom events are listed untouched');
    assert.equal(saved.length, 3, 'stored copies are not removed');
    const panel = readFileSync(new URL('../screens/AdminPanel.tsx', import.meta.url), 'utf8');
    assert.match(panel, /adminEditableNarrativeEvents\(builtInVisualNovels, creatorEvents\)/);
    assert.match(panel, /canonicalNarrativeEvent\(defaultPetEncounterVn, petEncounterVn, \["pet-encounter"\]\)/);
    assert.match(panel, /canonicalNarrativeEvent\(defaultAncientChestVn, ancientChestVn, \["ancient-chest"\]\)/);
});

test('reserved scenes cannot be redelivered through generic saved-event triggers', () => {
    for (const id of ['pet-encounter', 'ancient-chest', 'legacy-sage-offer', 'chronicle-scribe']) assert.ok(isReservedNarrativeId(id), id);
    for (const id of ['story-frostfang-village-4-0', 'story-interlude-stormveil-village-20', 'rift-first-clear-legacy-echo', 'builtin-awakening-lv2', 'builtin-aura-sphere-lv9', 'builtin-hidden-dungeon', 'craft-dungeon-snow', 'sys-pet-encounter', 'sys-ancient-chest']) assert.ok(isReservedNarrativeId(id), id);
    assert.equal(isReservedNarrativeId('creator-village-festival'), false);
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    assert.match(app, /canonicalNarrativeEvent\(next\.base, edited\)/);
    // The first-departure trigger moved to lib/departure-narrative.ts; count its
    // guard there so all three generic trigger sites stay covered.
    const departure = readFileSync(new URL('./departure-narrative.ts', import.meta.url), 'utf8');
    const reservedGuard = /!isReservedNarrativeId\((?:ev|candidate)\.id\)/g;
    assert.equal((app.match(reservedGuard) ?? []).length + (departure.match(reservedGuard) ?? []).length, 3);
    assert.match(departure, /candidate\.trigger === "firstLeaveVillage"/);
    assert.doesNotMatch(app, /edited \?\? next\.base/);
    const world = readFileSync(new URL('../screens/WorldMap.tsx', import.meta.url), 'utf8');
    assert.match(world, /canonicalNarrativeEvent\(defaultPetEncounterVn, petEncounterVn/);
    assert.match(world, /canonicalNarrativeEvent\(defaultAncientChestVn, ancientChestVn/);
});

test('equal-valued restored cinematic art preserves the entire canonical event reference', () => {
    const base = structuredClone(frostfang());
    base.cinematic = { mode: 'cinematic', backgroundPosition: '50% 40%', titleCard: false };
    const page = base.vnPages![1];
    page.cinematic = { backgroundImage: '/canonical-intake.webp', titleCard: false };
    page.lines = page.dialogue.map(text => ({ speaker: page.speaker, text }));
    page.choices![0].battle = { encounterType: 'ai', bossHp: 400, backgroundImage: '/canonical-arena.webp' };
    const saved = structuredClone(base);
    const baseSnapshot = structuredClone(base);
    const savedSnapshot = structuredClone(saved);
    assert.notEqual(saved.cinematic, base.cinematic);
    assert.notEqual(saved.vnPages![1].cinematic, page.cinematic);
    const result = canonicalNarrativeEvent(base, saved);
    assert.equal(result, base);
    assert.equal(result.cinematic, base.cinematic);
    assert.equal(result.vnPages, base.vnPages);
    assert.equal(result.vnPages![1], page);
    assert.equal(result.vnPages![1].cinematic, page.cinematic);
    assert.equal(result.vnPages![1].dialogue, page.dialogue);
    assert.equal(result.vnPages![1].lines, page.lines);
    assert.equal(result.vnPages![1].choices, page.choices);
    assert.equal(result.vnPages![1].choices![0], page.choices![0]);
    assert.equal(result.vnPages![1].choices![0].battle, page.choices![0].battle);
    assert.deepEqual(base, baseSnapshot);
    assert.deepEqual(saved, savedSnapshot);
});

test('one event or page image changes only the necessary canonical references', () => {
    const base = structuredClone(frostfang());
    const eventArt = structuredClone(base);
    eventArt.image = '/late-event.webp';
    const baseSnapshot = structuredClone(base);
    const eventSnapshot = structuredClone(eventArt);
    const eventResult = canonicalNarrativeEvent(base, eventArt);
    assert.notEqual(eventResult, base);
    assert.equal(eventResult.image, eventArt.image);
    assert.equal(eventResult.vnPages, base.vnPages);
    assert.equal(eventResult.dialogue, base.dialogue);
    assert.equal(canonicalNarrativeEvent(eventResult, structuredClone(eventArt)), eventResult);
    const pageArt = structuredClone(base);
    pageArt.vnPages![1].image = '/late-intake.webp';
    const pageSnapshot = structuredClone(pageArt);
    const result = canonicalNarrativeEvent(base, pageArt);
    assert.notEqual(result, base);
    assert.notEqual(result.vnPages, base.vnPages);
    for (const [index, page] of result.vnPages!.entries()) {
        if (index !== 1) assert.equal(page, base.vnPages![index]);
    }
    const page = result.vnPages![1];
    assert.notEqual(page, base.vnPages![1]);
    assert.equal(page.image, '/late-intake.webp');
    assert.equal(page.id, base.vnPages![1].id);
    assert.equal(page.title, base.vnPages![1].title);
    assert.equal(page.speaker, base.vnPages![1].speaker);
    assert.equal(page.dialogue, base.vnPages![1].dialogue);
    assert.equal(page.lines, base.vnPages![1].lines);
    assert.equal(page.choices, base.vnPages![1].choices);
    assert.equal(canonicalNarrativeEvent(result, structuredClone(pageArt)), result);
    assert.deepEqual(base, baseSnapshot);
    assert.deepEqual(eventArt, eventSnapshot);
    assert.deepEqual(pageArt, pageSnapshot);
});

test('late art matches exact event and stable page identity, with strict legacy title fallback', () => {
    const base = structuredClone(frostfang());
    base.vnPages = base.vnPages!.map((page, index) => ({ ...page, id: `canonical-page-${index}` }));
    const saved = structuredClone(base);
    saved.vnPages!.reverse();
    const intake = saved.vnPages!.find(page => page.id === base.vnPages![1].id)!;
    intake.title = 'An obsolete title on the same stable page';
    intake.image = '/matched-stable-intake.webp';
    intake.dialogue = ['Obsolete narration'];
    const baseSnapshot = structuredClone(base);
    const savedSnapshot = structuredClone(saved);
    const result = canonicalNarrativeEvent(base, saved);
    assert.equal(result.vnPages![1].image, intake.image);
    assert.equal(result.vnPages![1].id, base.vnPages![1].id);
    assert.equal(result.vnPages![1].title, base.vnPages![1].title);
    assert.equal(result.vnPages![1].dialogue, base.vnPages![1].dialogue);
    const wrongEvent = { ...saved, id: 'story-unrelated-village-4-0' };
    assert.equal(canonicalNarrativeEvent(base, wrongEvent), base);
    const wrongPage = structuredClone(base);
    wrongPage.vnPages![1].id = 'unrelated-page';
    wrongPage.vnPages![1].image = '/wrong-stable-page.webp';
    assert.equal(canonicalNarrativeEvent(base, wrongPage), base);
    const legacyBase = structuredClone(frostfang());
    for (const page of legacyBase.vnPages!) delete page.id;
    const wrongTitle = structuredClone(legacyBase);
    wrongTitle.vnPages![1].title = 'A different old Intake';
    wrongTitle.vnPages![1].image = '/wrong-title.webp';
    assert.equal(canonicalNarrativeEvent(legacyBase, wrongTitle), legacyBase);
    const exactTitle = structuredClone(legacyBase);
    exactTitle.vnPages![1].image = '/matched-title.webp';
    assert.equal(canonicalNarrativeEvent(legacyBase, exactTitle).vnPages![1].image, '/matched-title.webp');
    assert.deepEqual(base, baseSnapshot);
    assert.deepEqual(saved, savedSnapshot);
});

test('late choice background preserves the canonical branch, gates, receipt identity and battle rules', () => {
    const base = structuredClone(frostfang());
    const choice = base.vnPages![1].choices![0];
    choice.id = 'canonical-battle-choice';
    choice.requireTrait = 'canonical-required';
    choice.forbidTrait = 'canonical-forbidden';
    choice.battle = {
        encounterType: 'ai', difficulty: 'hard', bossName: 'Canonical Guard', bossHp: 400,
        bossDamage: 7, aiProfileId: 'canonical-guard', backgroundImage: '/canonical-arena.webp',
        ryoReward: 12,
    };
    const saved = structuredClone(base);
    const old = saved.vnPages![1].choices![0];
    old.text = 'Obsolete branch';
    old.nextPage = 999;
    old.trait = 'obsolete-trait';
    old.requireTrait = 'obsolete-gate';
    old.battle = { bossName: 'Wrong Guard', bossHp: 1, ryoReward: 9999, backgroundImage: '/late-arena.webp' };
    const baseSnapshot = structuredClone(base);
    const savedSnapshot = structuredClone(saved);
    const result = canonicalNarrativeEvent(base, saved);
    const changed = result.vnPages![1].choices![0];
    assert.notEqual(changed, choice);
    assert.notEqual(changed.battle, choice.battle);
    assert.deepEqual(changed, { ...choice, battle: { ...choice.battle, backgroundImage: '/late-arena.webp' } });
    assert.equal(result.vnPages![1].dialogue, base.vnPages![1].dialogue);
    for (const [index, other] of result.vnPages![1].choices!.entries()) {
        if (index !== 0) assert.equal(other, base.vnPages![1].choices![index]);
    }
    assert.equal(canonicalNarrativeEvent(result, structuredClone(saved)), result);
    const legacyBase = structuredClone(base);
    delete legacyBase.vnPages![1].choices![0].id;
    const wrongLegacyChoice = structuredClone(legacyBase);
    wrongLegacyChoice.vnPages![1].choices![0].text = 'Different un-IDed choice';
    wrongLegacyChoice.vnPages![1].choices![0].battle!.backgroundImage = '/wrong-branch.webp';
    assert.equal(canonicalNarrativeEvent(legacyBase, wrongLegacyChoice), legacyBase);
    wrongLegacyChoice.vnPages![1].choices![0].text = legacyBase.vnPages![1].choices![0].text;
    wrongLegacyChoice.vnPages![1].choices![0].nextPage = 999;
    assert.equal(canonicalNarrativeEvent(legacyBase, wrongLegacyChoice), legacyBase);
    assert.deepEqual(base, baseSnapshot);
    assert.deepEqual(saved, savedSnapshot);
});

test('settled manifest precedence keeps the reader event reference after art-only composition', () => {
    const base = structuredClone(frostfang());
    base.cinematic = { titleCard: false };
    base.vnPages![1].cinematic = { backgroundPosition: '50% 40%' };
    const saved = structuredClone(base);
    saved.vnPages![1].image = '/saved-intake.webp';
    saved.vnPages![1].dialogue = ['Obsolete saved words'];
    const images = { [`vn:${base.id}:page:1`]: '/manifest-intake.webp' };
    const current = overlayVnImages(base, base.id, images);
    const currentSnapshot = structuredClone(current);
    const savedSnapshot = structuredClone(saved);
    const candidate = overlayVnImages(canonicalNarrativeEvent(current, saved), current.id, images);
    assert.equal(candidate.vnPages![1].image, '/manifest-intake.webp');
    assert.equal(candidate.id, current.id);
    assert.equal(candidate.dialogue, current.dialogue);
    assert.equal(candidate.cinematic, current.cinematic);
    for (const [index, page] of candidate.vnPages!.entries()) {
        const prior = current.vnPages![index];
        assert.equal(page.id, prior.id);
        assert.equal(page.title, prior.title);
        assert.equal(page.speaker, prior.speaker);
        assert.equal(page.dialogue, prior.dialogue);
        assert.equal(page.lines, prior.lines);
        assert.equal(page.choices, prior.choices);
        assert.equal(page.cinematic, prior.cinematic);
    }
    // This predicate follows already verified art-only transforms, never a raw saved graph.
    assert.equal(sameNarrativeArtwork(current, candidate), true);
    const settled = sameNarrativeArtwork(current, candidate) ? current : candidate;
    assert.equal(settled, current);
    assert.equal(settled.vnPages, current.vnPages);
    assert.equal(settled.vnPages![1].choices, current.vnPages![1].choices);
    assert.deepEqual(current, currentSnapshot);
    assert.deepEqual(saved, savedSnapshot);
});

test('art-only hydration preserves cast cleanup and becomes a no-op without resurrecting a portrait', () => {
    const base = structuredClone(frostfang());
    const saved = structuredClone(base);
    const portrait = '/legacy-sova.webp';
    assert.equal(base.vnPages![1].leftName, 'Elder Sova');
    saved.vnPages![1].leftName = base.vnPages![1].leftName;
    saved.vnPages![1].leftImage = portrait;
    const current = canonicalNarrativeEvent(base, saved);
    assert.equal(current.vnPages![1].leftImage, portrait);
    const images = {
        [`vn:${base.id}:page:1:left`]: portrait,
        [vnActorImageKey(base.id, 1, 'Retired Elder')]: '/retired-elder.webp',
    };
    const currentSnapshot = structuredClone(current);
    const savedSnapshot = structuredClone(saved);
    const candidate = overlayVnImages(canonicalNarrativeEvent(current, saved), current.id, images);
    assert.equal(candidate.vnPages![1].leftImage, undefined);
    assert.equal(Object.hasOwn(candidate.vnPages![1], 'leftImage'), false);
    assert.equal(candidate.vnPages![1].dialogue, current.vnPages![1].dialogue);
    assert.equal(candidate.vnPages![1].lines, current.vnPages![1].lines);
    assert.equal(candidate.vnPages![1].speaker, current.vnPages![1].speaker);
    assert.equal(candidate.vnPages![1].choices, current.vnPages![1].choices);
    assert.equal(sameNarrativeArtwork(current, candidate), false, 'defined portrait deletion is a real visual change');
    const repeated = overlayVnImages(canonicalNarrativeEvent(candidate, saved), candidate.id, images);
    assert.equal(repeated.vnPages![1].leftImage, undefined);
    assert.equal(Object.hasOwn(repeated.vnPages![1], 'leftImage'), false);
    assert.equal(repeated.vnPages![1].dialogue, candidate.vnPages![1].dialogue);
    assert.equal(repeated.vnPages![1].choices, candidate.vnPages![1].choices);
    assert.equal(sameNarrativeArtwork(candidate, repeated), true);
    const settled = sameNarrativeArtwork(candidate, repeated) ? candidate : repeated;
    assert.equal(settled, candidate);
    assert.deepEqual(current, currentSnapshot);
    assert.deepEqual(saved, savedSnapshot);
});
