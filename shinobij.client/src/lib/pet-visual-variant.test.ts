import assert from "node:assert/strict";
import test from "node:test";
import { CHROMATIC_PET_SURFACE, HOLLOW_HOUND_SURFACE } from "./pet-model-surface";
import {
    firstSharedImage,
    petModelVariantSurface,
    petPaletteVariant,
    petVisualVariantClass,
    variantImageKeys,
} from "./pet-visual-variant";

const normal = { paletteVariantId: undefined };
const chromatic = { paletteVariantId: " Chromatic " };

test("Chromatic identity resolves consistently for DOM and 3D presentation", () => {
    assert.equal(petPaletteVariant(normal), null);
    assert.equal(petPaletteVariant(chromatic), "chromatic");
    assert.equal(petVisualVariantClass(normal), "");
    assert.equal(petVisualVariantClass(chromatic), "pet-visual--chromatic");
    assert.equal(petModelVariantSurface(chromatic), CHROMATIC_PET_SURFACE);
    assert.equal(petModelVariantSurface(normal, HOLLOW_HOUND_SURFACE), HOLLOW_HOUND_SURFACE);
});

test("published variant artwork wins before the shared palette fallback", () => {
    const keys = variantImageKeys("pet:", chromatic, ["owned", "template"]);
    assert.deepEqual(keys, [
        "pet:owned:variant:chromatic",
        "pet:template:variant:chromatic",
        "pet:owned",
        "pet:template",
    ]);
    assert.equal(firstSharedImage({ "pet:owned": "base.webp", "pet:template:variant:chromatic": "shiny.webp" }, keys), "shiny.webp");
});
