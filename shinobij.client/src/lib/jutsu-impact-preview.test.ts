import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { jutsuImpactPreviewTiles } from "./jutsu-impact-preview";

const allTiles = [0, 1, 2, 3, 4, 5];
const distance = (a: number, b: number) => Math.abs(a - b);
const neighbors = (center: number) => [center - 1, center + 1].filter((tile) => allTiles.includes(tile));

describe("jutsuImpactPreviewTiles", () => {
    it("shows only the impact ring for movement AOE_CIRCLE", () => {
        assert.deepEqual(
            [...jutsuImpactPreviewTiles({ method: "AOE_CIRCLE", center: 2, allTiles, distance, neighbors })],
            [1, 3],
        );
    });

    it("includes the selected enemy for a direct-target area burst", () => {
        assert.deepEqual(
            [...jutsuImpactPreviewTiles({ method: "AOE_BURST", center: 2, allTiles, distance, neighbors })],
            [2, 1, 3],
        );
    });

    it("shows the full radius-two AOE_SPIRAL footprint", () => {
        assert.deepEqual(
            [...jutsuImpactPreviewTiles({ method: "AOE_SPIRAL", center: 2, allTiles, distance, neighbors })],
            [0, 1, 2, 3, 4],
        );
    });

    it("does not invent an impact area for single-target methods", () => {
        assert.equal(jutsuImpactPreviewTiles({ method: "SINGLE", center: 2, allTiles, distance, neighbors }).size, 0);
    });
});
