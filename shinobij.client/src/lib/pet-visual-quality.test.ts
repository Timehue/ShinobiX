import { test } from "node:test";
import assert from "node:assert/strict";
import { PET_VISUAL_QUALITY_PRESETS, PET_VISUAL_QUALITY_STORAGE_KEY, petVisualQuality, resolvePetVisualQuality } from "./pet-visual-quality.ts";

test("pet visual quality exposes coherent low, medium, and high budgets", () => {
    assert.equal(resolvePetVisualQuality("low"), PET_VISUAL_QUALITY_PRESETS.low);
    assert.equal(resolvePetVisualQuality("HIGH"), PET_VISUAL_QUALITY_PRESETS.high);
    assert.equal(resolvePetVisualQuality("invalid"), PET_VISUAL_QUALITY_PRESETS.medium);
    assert.ok(PET_VISUAL_QUALITY_PRESETS.low.identityParticles < PET_VISUAL_QUALITY_PRESETS.medium.identityParticles);
    assert.ok(PET_VISUAL_QUALITY_PRESETS.medium.setPieceParticles < PET_VISUAL_QUALITY_PRESETS.high.setPieceParticles);
    assert.equal(PET_VISUAL_QUALITY_PRESETS.low.distortion, false);
    assert.equal(PET_VISUAL_QUALITY_STORAGE_KEY, "petVisualQuality");
});

test("stored 'high' downgrades to medium — High is retired player-facing, QA query still reaches it", () => {
    const g = globalThis as { window?: unknown };
    g.window = {
        location: { search: "" },
        localStorage: { getItem: () => "high" },
    };
    try {
        assert.equal(petVisualQuality(), PET_VISUAL_QUALITY_PRESETS.medium);
        (g.window as { location: { search: string } }).location.search = "?petQuality=high";
        assert.equal(petVisualQuality(), PET_VISUAL_QUALITY_PRESETS.high);
    } finally {
        delete g.window;
    }
});
