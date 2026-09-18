import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayVnImages, updateVnPageCast, vnActorImageKey, vnSharedImageActor } from './vn-shared-artwork';
import { resolveVnAuthoredActorImage } from './vn';
import { buildPetEncounterVn } from './pet-encounter-vn';
import { defaultPetEncounterVn } from '../data/default-vn-events';
import type { CreatorEvent } from '../types/vn';

const id = 'story-frostfang-village-4-0';
const event = { id, image: '', vnPages: [{ title: 'Intake', scene: 'Gate', speaker: 'Captain Yura', leftName: 'Player', rightName: 'Captain Yura', dialogue: ['Hold.'] }] } as CreatorEvent;
const ref = (key: string) => `/api/img?id=${encodeURIComponent(key)}`;

test('named portraits follow identities through slot swaps and never spill onto a renamed actor', () => {
    const key = vnActorImageKey(id, 0, 'Captain Yura');
    const images = { [key]: ref(key), [`vn:${id}:page:0:right`]: '/uploads/old-elder.webp' };
    const first = overlayVnImages(event, id, images);
    assert.equal(first.vnPages![0].rightImage, ref(key));
    const swapped = { ...event, vnPages: [{ ...event.vnPages![0], leftName: 'Captain Yura', rightName: 'Player' }] };
    const next = overlayVnImages(swapped, id, images);
    assert.equal(next.vnPages![0].leftImage, ref(key));
    assert.equal(next.vnPages![0].rightImage, undefined);
    const renamed = { ...first, vnPages: [{ ...first.vnPages![0], rightName: 'Elder Sova' }] };
    assert.equal(overlayVnImages(renamed, id, images).vnPages![0].rightImage, undefined);
    assert.equal(resolveVnAuthoredActorImage(id, 'Elder Sova', ref(key)), '');
    assert.equal(resolveVnAuthoredActorImage('creator-custom', 'Elder Sova', ref(key)), '');
    assert.equal(resolveVnAuthoredActorImage(id, 'Captain Yura', ref(key)), ref(key));
    assert.equal(vnSharedImageActor(ref(key)), 'captain yura');
});

test('unreviewed creator art stays authoritative and settled hydration preserves references', () => {
    const custom = { ...event, id: 'creator-custom' };
    const images = { 'vn:creator-custom:page:0:right': '/uploads/custom.webp' };
    const hydrated = overlayVnImages(custom, custom.id, images);
    assert.equal(hydrated.vnPages![0].rightImage, '/uploads/custom.webp');
    assert.equal(overlayVnImages(hydrated, custom.id, images), hydrated);
    assert.equal(overlayVnImages(event, id, {}), event);
});

test('editing cast clears only displaced portraits, including inherited speaker names', () => {
    const page = { leftName: 'Player', leftImage: '/player.webp', speaker: 'Captain Yura', rightImage: '/yura.webp' };
    assert.equal(updateVnPageCast(page, { speaker: 'Elder Sova' }).rightImage, '');
    assert.equal(updateVnPageCast(page, { speaker: ' Captain Yura ' }).rightImage, '/yura.webp');
    const explicit = updateVnPageCast(page, { speaker: 'Elder Sova', rightImage: '/sova.webp' });
    assert.equal(explicit.rightImage, '/sova.webp');
    assert.equal(explicit.leftImage, '/player.webp');
});

test('late template hydration keeps the encountered animal, player avatar and choices intact', () => {
    const pet = buildPetEncounterVn(defaultPetEncounterVn, { name: 'Guard Hound' }, '/pet-poses/guardhound.webp');
    const images = Object.fromEntries(pet.vnPages!.flatMap((_, index) => [
        [`vn:${pet.id}:page:${index}`, '/scenes/custom-forest.webp'],
        [`vn:${pet.id}:page:${index}:right`, '/old-wizard.webp'],
        [`vn:${pet.id}:page:${index}:left`, '/old-person.webp'],
    ]));
    images[`event:${pet.id}:avatar`] = '/old-wizard.webp';
    const result = overlayVnImages(pet, pet.id, images, { preserveCast: true });
    assert.equal(result.avatarImage, pet.avatarImage);
    for (const [index, page] of result.vnPages!.entries()) {
        assert.equal(page.rightName, 'Guard Hound');
        assert.equal(page.rightImage, '/pet-poses/guardhound.webp');
        assert.equal(page.leftImage, undefined);
        assert.equal(page.image, '/scenes/custom-forest.webp');
        assert.equal(page.choices, pet.vnPages![index].choices);
    }
});
