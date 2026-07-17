import { test } from "node:test";
import assert from "node:assert/strict";
import { PET_VISUAL_QUALITY_PRESETS, resolvePetVisualQuality } from "./pet-visual-quality.ts";

test("pet visual quality exposes coherent low, medium, and high budgets", () => {
    assert.equal(resolvePetVisualQuality("low"), PET_VISUAL_QUALITY_PRESETS.low);
    assert.equal(resolvePetVisualQuality("HIGH"), PET_VISUAL_QUALITY_PRESETS.high);
    assert.equal(resolvePetVisualQuality("invalid"), PET_VISUAL_QUALITY_PRESETS.medium);
    assert.ok(PET_VISUAL_QUALITY_PRESETS.low.identityParticles < PET_VISUAL_QUALITY_PRESETS.medium.identityParticles);
    assert.ok(PET_VISUAL_QUALITY_PRESETS.medium.setPieceParticles < PET_VISUAL_QUALITY_PRESETS.high.setPieceParticles);
    assert.equal(PET_VISUAL_QUALITY_PRESETS.low.distortion, false);
});
