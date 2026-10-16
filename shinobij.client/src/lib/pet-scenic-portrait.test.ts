import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { petScenicPortraitImage } from './pet-scenic-portrait';
import { PET_SCENIC_PORTRAITS } from './pet-portrait-assets.generated';
import { petBattleSprite, petPoseImage, petCardImage } from './pet-battle-anim';
import { STARTER_PETS } from '../data/starter-pets';
import { STARTER_EVOLUTIONS } from '../data/pet-evolutions';
import { rawPetPool } from '../data/pet-pool';
import type { Pet } from '../types/pet';

const catalog = [...STARTER_PETS.map(({ pet }) => pet), ...STARTER_EVOLUTIONS, ...rawPetPool];

test('every reviewed portrait belongs to its exact production identity and is an opaque delivery WebP', async () => {
    const production = JSON.parse(readFileSync(new URL('../../art-source/pet-portrait-refresh/production.json', import.meta.url), 'utf8'));
    const reviewed = production.entries.filter((entry: { status: string }) => entry.status === 'reviewed');
    assert.equal(production.entries.length, catalog.length);
    assert.equal(production.symbolPolicy?.required, true, 'Visual symbol review is required for the collection');
    assert.equal(reviewed.length, catalog.length, 'Every built-in companion must have reviewed scenic art');
    assert.equal(Object.keys(PET_SCENIC_PORTRAITS).length, reviewed.length);
    for (const entry of reviewed) {
        assert.equal(entry.qualityReview?.passed, true, `Full-resolution visual review: ${entry.id}`);
        assert.equal(entry.qualityReview.sourceSha256, entry.sourceSha256, `Review matches master: ${entry.id}`);
        assert.equal(entry.qualityReview.outputSha256, entry.outputSha256, `Review matches delivery: ${entry.id}`);
        assert.equal(entry.symbolReview?.passed, true, `Visual symbol review: ${entry.id}`);
        assert.equal(entry.symbolReview.sourceSha256, entry.sourceSha256, `Symbol review matches master: ${entry.id}`);
        assert.equal(entry.symbolReview.outputSha256, entry.outputSha256, `Symbol review matches delivery: ${entry.id}`);
        const pet = catalog.find((item) => item.id === entry.id)!;
        assert.ok(pet, entry.id);
        const url = PET_SCENIC_PORTRAITS[entry.id];
        assert.equal(petScenicPortraitImage(pet), url, entry.id);
        const file = new URL(`../../public${url.split('?')[0]}`, import.meta.url);
        const bytes = readFileSync(file);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.outputSha256, entry.id);
        const metadata = await sharp(bytes).metadata();
        assert.equal(metadata.format, 'webp');
        assert.equal(metadata.width, 640);
        assert.equal(metadata.height, 640);
        assert.equal(metadata.hasAlpha, false);
    }
});

test('all five base starters use scenic portraits without changing their battle cutouts', () => {
    for (const { pet } of STARTER_PETS) {
        assert.ok(PET_SCENIC_PORTRAITS[pet.id], pet.id);
        assert.equal(petScenicPortraitImage(pet), PET_SCENIC_PORTRAITS[pet.id]);
        assert.ok(!petPoseImage(pet).includes('shinobi-v1'), pet.id);
        assert.ok(!petBattleSprite(pet).src.includes('shinobi-v1'), pet.id);
    }
});

test('owned and timestamped identities resolve the same portrait, including starter stages', () => {
    for (const pet of catalog.filter((item) => PET_SCENIC_PORTRAITS[item.id])) {
        assert.equal(petScenicPortraitImage({ ...pet, id: `${pet.id}:owned-instance`, templateId: pet.id }), PET_SCENIC_PORTRAITS[pet.id]);
        assert.equal(petScenicPortraitImage({ ...pet, id: `${pet.id}-1700000000000` }), PET_SCENIC_PORTRAITS[pet.id]);
    }
    for (const { pet: base } of STARTER_PETS) {
        for (const [stage, suffix] of [[1, 'r'], [2, 'l']] as const) {
            const expected = PET_SCENIC_PORTRAITS[`${base.id}-${suffix}`];
            const evolved = { ...base, id: `${base.id}:owned-instance`, evolutionStage: stage } as Pet;
            assert.equal(petScenicPortraitImage(evolved), expected);
            assert.equal(petScenicPortraitImage({ ...evolved, id: 'owned-instance', templateId: base.id }), expected);
            assert.equal(petScenicPortraitImage({ ...evolved, id: `${base.id}-1700000000000` }), expected);
        }
    }
});

test('dedicated custom cards and explicit palette variants retain priority over the built-in replacement', () => {
    const pet = STARTER_PETS[0].pet;
    assert.equal(petScenicPortraitImage(pet, { [`petcard:${pet.id}`]: 'custom-card.webp' }), 'custom-card.webp');
    const chromatic = { ...pet, paletteVariantId: 'chromatic-v1' };
    assert.equal(petScenicPortraitImage(chromatic, {
        [`pet:${pet.id}:variant:chromatic-v1`]: 'chromatic.webp',
        [`petcard:${pet.id}`]: 'ordinary.webp',
    }), 'chromatic.webp');
    assert.equal(petScenicPortraitImage(pet, { [`pet:${pet.id}`]: 'stale-portrait.webp', [`petbody:${pet.id}`]: 'battle-body.webp' }), PET_SCENIC_PORTRAITS[pet.id]);
});

test('unknown creator companions retain legacy artwork and never borrow another species portrait', () => {
    const pet = { ...STARTER_PETS[0].pet, id: 'creator-companion', image: 'creator.webp' };
    assert.equal(petScenicPortraitImage(pet), petCardImage(pet));
    assert.equal(petScenicPortraitImage({ ...pet, image: '' }), '');
});

test('the production references remain byte-identical, including model-baked 2.5D atlases', () => {
    const production = JSON.parse(readFileSync(new URL('../../art-source/pet-portrait-refresh/production.json', import.meta.url), 'utf8'));
    for (const entry of production.entries) {
        entry.references.forEach((reference: string, index: number) => {
            const bytes = readFileSync(new URL(`../../public/${reference}`, import.meta.url));
            assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.referenceSha256[index], reference);
        });
    }
});
