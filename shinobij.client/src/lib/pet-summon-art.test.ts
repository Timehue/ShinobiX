import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sharp from "sharp";
import { PET_CATALOG } from "../../../api/pet/_catalog";
import { sealCompanionFromSave } from "../../../api/combat-core/companion";
import { rawPetPool } from "../data/pet-pool";
import { STARTER_PETS } from "../data/starter-pets";
import { STARTER_EVOLUTIONS, petVisualId } from "../data/pet-evolutions";
import { PET_SUMMON_KINDS } from "./pet-summon-index";
import { inferSpriteKind, inferSpriteNativeFacing } from "./battlefield-sprite";
import { petSummonBattleArt } from "./pet-summon-art";

test("every summonable form has a transparent, static board sprite", async () => {
    const pets = [...rawPetPool, ...STARTER_PETS.map(option => option.pet), ...STARTER_EVOLUTIONS];
    assert.deepEqual(new Set(PET_SUMMON_KINDS.keys()), new Set(pets.map(petVisualId)));
    assert.deepEqual(new Set(Object.keys(PET_CATALOG)), new Set(PET_SUMMON_KINDS.keys()));
    for (const pet of pets) {
        const id = petVisualId(pet);
        const owned = { ...PET_CATALOG[id], templateId: id, id: "opaque-instance", level: 75 };
        const seal = sealCompanionFromSave({ pets: [owned], activePetId: owned.id });
        assert.equal(seal?.speciesId, id, id);
        const { sprite } = petSummonBattleArt(undefined, owned.id, seal?.speciesId);
        const path = sprite.split("?")[0];
        assert.equal(path, `/combat-actors/pets/${PET_SUMMON_KINDS.get(id)}/${id}-guard.webp`);
        const file = fileURLToPath(new URL("../../public" + path, import.meta.url));
        const metadata = await sharp(file).metadata();
        assert.equal(metadata.format, "webp", id);
        assert.equal(metadata.hasAlpha, true, id);
        assert.equal(metadata.pages ?? 1, 1, id);
        assert.equal(inferSpriteKind(path), PET_SUMMON_KINDS.get(id), id);
    }
});

test("summons use the sealed appearance or recover the form from an older owned pet", () => {
    const starter = { ...STARTER_PETS.find(option => option.pet.id === "starter-fire")!.pet, id: "starter-fire:owned", evolutionStage: 2 as const };
    assert.match(petSummonBattleArt(starter, starter.id, "starter-fire-r").sprite, /starter-fire-r-guard\.webp/);
    assert.match(petSummonBattleArt(starter, starter.id, undefined).sprite, /starter-fire-l-guard\.webp/);
    const old = petSummonBattleArt(undefined, "rare-27-1700000000000", undefined);
    assert.match(old.sprite, /rare-27-guard\.webp/);
    assert.match(old.fallback, /rare-27-idle\.webp/);
    assert.match(petSummonBattleArt(undefined, "rare-27-legacy-copy", undefined).sprite, /rare-27-guard\.webp/);
    assert.match(petSummonBattleArt(undefined, "starter-fire-r-legacy-copy", undefined).sprite, /starter-fire-r-guard\.webp/);
    assert.match(petSummonBattleArt(undefined, "rare-270-copy", undefined).sprite, /guardhound-idle/);
    assert.match(petSummonBattleArt(undefined, "unknown", undefined).sprite, /guardhound-idle/);
    assert.equal(inferSpriteNativeFacing(petSummonBattleArt(undefined, "standard-7", undefined).sprite), "right");
    assert.equal(inferSpriteNativeFacing(petSummonBattleArt(undefined, "standard-6", undefined).sprite), "left");
});
