import assert from "node:assert/strict";
import { test } from "node:test";
import { STARTER_EVOLUTIONS } from "../data/pet-evolutions";
import { adminPetPortraitImage, evoTemplateArt, publishAdminPetPortrait } from "./admin-pet-template-art";
import { RAIJIN_ART_REVISION } from "./pet-art-revision";
import { STARTER_PETS } from "../data/starter-pets";
import { rawPetPool } from "../data/pet-pool";
import { PET_SCENIC_PORTRAITS } from "./pet-portrait-assets.generated";

test("admin avatar fallback covers only starter evolution templates and refreshes Raijin art", () => {
    assert.equal(STARTER_EVOLUTIONS.length, 10);
    for (const pet of STARTER_EVOLUTIONS) {
        const expected = `/pet-evos/${pet.id}.webp`;
        assert.equal(evoTemplateArt(pet.id), pet.id === "starter-lightning-l"
            ? `${expected}?v=${RAIJIN_ART_REVISION}` : expected);
    }
    assert.equal(evoTemplateArt("starter-lightning"), "");
    assert.equal(evoTemplateArt("wild-wolf"), "");
});

test("the admin overview shows all161 current portraits instead of stale inline and shared photos", () => {
    for (const pet of [...STARTER_PETS.map(({ pet }) => pet), ...STARTER_EVOLUTIONS, ...rawPetPool]) {
        assert.equal(adminPetPortraitImage({ ...pet, image: 'old.webp' }, {}, { [`pet:${pet.id}`]: 'old-shared.webp' }), PET_SCENIC_PORTRAITS[pet.id], pet.id);
    }
});

test("fresh local edits and published card overrides appear in the admin preview", () => {
    const pet = STARTER_PETS[0].pet;
    assert.equal(adminPetPortraitImage(pet, { [`pet:${pet.id}`]: 'local.webp' }, {}), 'local.webp');
    assert.equal(adminPetPortraitImage(pet, {}, { [`petcard:${pet.id}`]: 'published.webp' }), 'published.webp');
});

test("an admin upload publishes the evolved card identity and keeps the existing photo slot", async () => {
    const pet = { ...STARTER_PETS[0].pet, id: 'owned-pet', templateId: 'starter-fire', evolutionStage: 1 as const };
    const published: Record<string, string> = {};
    let local: Record<string, string> = {};
    const ok = await publishAdminPetPortrait(pet, 'new.webp', async (id, image) => {
        assert.equal(adminPetPortraitImage(pet, {}, local), 'new.webp', 'Local portrait updates before the network completes');
        published[id] = image; return true;
    }, (slots) => { local = slots; });
    assert.equal(ok, true);
    assert.deepEqual(published, { 'pet:owned-pet': 'new.webp', 'petcard:starter-fire-r': 'new.webp' });
    assert.equal(adminPetPortraitImage(pet, {}, published), 'new.webp');
    assert.equal(await publishAdminPetPortrait(pet, 'new.webp', async (id) => id.startsWith('pet:')), false, 'A failed card publish must not report full success');
});
