import { test } from "node:test";
import assert from "node:assert/strict";
import { CHROMATIC_PET_SURFACE, HOLLOW_HOUND_SURFACE, WARFRONT_MINION_SURFACES } from "./pet-model-surface.ts";

test("Chromatic pets have a strong shared 3D palette treatment", () => {
    assert.match(CHROMATIC_PET_SURFACE.lowTint, /^#[0-9a-f]{6}$/i);
    assert.match(CHROMATIC_PET_SURFACE.highTint, /^#[0-9a-f]{6}$/i);
    assert.match(CHROMATIC_PET_SURFACE.emissive, /^#[0-9a-f]{6}$/i);
    assert.ok(CHROMATIC_PET_SURFACE.tintStrength >= 0.75);
    assert.ok(CHROMATIC_PET_SURFACE.tintBlend >= 0.65);
    assert.ok(CHROMATIC_PET_SURFACE.emissiveIntensity >= 0.4);
});

test("Hollow Hounds have an explicit, visibly emissive purple treatment", () => {
    assert.match(HOLLOW_HOUND_SURFACE.lowTint, /^#[0-9a-f]{6}$/i);
    assert.match(HOLLOW_HOUND_SURFACE.highTint, /^#[0-9a-f]{6}$/i);
    assert.match(HOLLOW_HOUND_SURFACE.emissive, /^#[0-9a-f]{6}$/i);
    assert.ok(HOLLOW_HOUND_SURFACE.tintStrength >= 0.7);
    assert.ok(HOLLOW_HOUND_SURFACE.tintBlend >= 0.5);
    assert.ok(HOLLOW_HOUND_SURFACE.emissiveIntensity >= 0.35);
});

test("lane hounds use team colors while Hollow purple remains unique", () => {
    assert.notEqual(WARFRONT_MINION_SURFACES.blue.emissive, HOLLOW_HOUND_SURFACE.emissive);
    assert.notEqual(WARFRONT_MINION_SURFACES.red.emissive, HOLLOW_HOUND_SURFACE.emissive);
    assert.notEqual(WARFRONT_MINION_SURFACES.blue.emissive, WARFRONT_MINION_SURFACES.red.emissive);
    assert.ok(WARFRONT_MINION_SURFACES.blue.emissiveIntensity < HOLLOW_HOUND_SURFACE.emissiveIntensity);
    assert.ok(WARFRONT_MINION_SURFACES.red.emissiveIntensity < HOLLOW_HOUND_SURFACE.emissiveIntensity);
});
