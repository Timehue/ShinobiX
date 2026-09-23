import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { jutsuImpactPreviewTiles } from "./jutsu-impact-preview";

const allTiles = [0, 1, 2, 3, 4, 5];
const distance = (a: number, b: number) => Math.abs(a - b);
const neighbors = (center: number) => [center - 1, center + 1].filter((tile) => allTiles.includes(tile));

describe("jutsuImpactPreviewTiles", () => {
    it("shows only the impact ring for movement AOE_CIRCLE", () => {
        assert.deepEqual(
            [...jutsuImpactPreviewTiles("AOE_CIRCLE", 2, allTiles, distance, neighbors)],
            [1, 3],
        );
    });

    it("includes the selected enemy for a direct-target area burst", () => {
        assert.deepEqual(
            [...jutsuImpactPreviewTiles("AOE_BURST", 2, allTiles, distance, neighbors)],
            [2, 1, 3],
        );
    });

    it("shows the full radius-two AOE_SPIRAL footprint", () => {
        assert.deepEqual(
            [...jutsuImpactPreviewTiles("AOE_SPIRAL", 2, allTiles, distance, neighbors)],
            [0, 1, 2, 3, 4],
        );
    });

    it("shows the caster's full range for an instant ground effect, regardless of clicked tile", () => {
        const field = { casterPos: 2, range: 2 };
        assert.deepEqual(
            [...jutsuImpactPreviewTiles("INSTANT_EFFECT", 5, allTiles, distance, neighbors, false, field)],
            [0, 1, 2, 3, 4],
        );
    });

    it("treats legacy AOE_LINE as the same full instant field", () => {
        assert.deepEqual(
            [...jutsuImpactPreviewTiles("AOE_LINE", 5, allTiles, distance, neighbors, false, { casterPos: 2, range: 2 })],
            [0, 1, 2, 3, 4],
        );
    });

    it("does not invent an impact area for single-target methods", () => {
        assert.equal(jutsuImpactPreviewTiles("SINGLE", 2, allTiles, distance, neighbors).size, 0);
    });
});
