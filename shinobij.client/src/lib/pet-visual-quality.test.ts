import { test } from "node:test";
import assert from "node:assert/strict";
import { PET_VISUAL_QUALITY_PRESETS, PET_VISUAL_QUALITY_STORAGE_KEY, resolvePetVisualQuality } from "./pet-visual-quality.ts";

test("pet visual quality exposes coherent low, medium, and high budgets", () => {
    assert.equal(resolvePetVisualQuality("low"), PET_VISUAL_QUALITY_PRESETS.low);
    assert.equal(resolvePetVisualQuality("HIGH"), PET_VISUAL_QUALITY_PRESETS.high);
    assert.equal(resolvePetVisualQuality("invalid"), PET_VISUAL_QUALITY_PRESETS.medium);
    assert.ok(PET_VISUAL_QUALITY_PRESETS.low.identityParticles < PET_VISUAL_QUALITY_PRESETS.medium.identityParticles);
    assert.ok(PET_VISUAL_QUALITY_PRESETS.low.ambientParticles < PET_VISUAL_QUALITY_PRESETS.medium.ambientParticles);
    assert.ok(PET_VISUAL_QUALITY_PRESETS.medium.ambientParticles < PET_VISUAL_QUALITY_PRESETS.high.ambientParticles);
    assert.ok(PET_VISUAL_QUALITY_PRESETS.medium.setPieceParticles < PET_VISUAL_QUALITY_PRESETS.high.setPieceParticles);
    assert.ok(PET_VISUAL_QUALITY_PRESETS.low.impactDebris < PET_VISUAL_QUALITY_PRESETS.medium.impactDebris);
    assert.ok(PET_VISUAL_QUALITY_PRESETS.medium.impactSparks < PET_VISUAL_QUALITY_PRESETS.high.impactSparks);
    assert.ok(PET_VISUAL_QUALITY_PRESETS.low.aftermathLayers < PET_VISUAL_QUALITY_PRESETS.high.aftermathLayers);
    assert.ok(PET_VISUAL_QUALITY_PRESETS.low.decalLimit < PET_VISUAL_QUALITY_PRESETS.high.decalLimit);
    assert.equal(PET_VISUAL_QUALITY_PRESETS.low.bloomIntensity, 0);
    assert.equal(PET_VISUAL_QUALITY_PRESETS.low.distortion, false);
    assert.equal(PET_VISUAL_QUALITY_PRESETS.medium.distortion, false);
    assert.equal(PET_VISUAL_QUALITY_PRESETS.high.distortion, true);
    assert.equal(PET_VISUAL_QUALITY_STORAGE_KEY, "petVisualQuality");
});
