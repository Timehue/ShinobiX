import assert from "node:assert/strict";
import test from "node:test";
import { resolvePetDuelVisualLayers } from "./pet-duel-visual-layers";

test("visual layers default to the unchanged full production composition", () => {
    assert.ok(Object.values(resolvePetDuelVisualLayers()).every(Boolean));
});

test("visual layer query isolates only requested effect owners", () => {
    assert.deepEqual(resolvePetDuelVisualLayers("identity, elements"), {
        identity: true,
        trails: false,
        impacts: false,
        elements: true,
        aftermath: false,
        post: false,
    });
});
