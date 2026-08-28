import assert from "node:assert/strict";
import test from "node:test";
import { SECTOR_POINTS } from "../../../shared/sector-links";
import { ATLAS_SECTOR_POINTS } from "./sector-points";

test("atlas clearance nudges do not mutate gameplay geography", () => {
    assert.equal(ATLAS_SECTOR_POINTS.length, SECTOR_POINTS.length);

    const gameplayEight = SECTOR_POINTS.find((point) => point.id === 8);
    const atlasEight = ATLAS_SECTOR_POINTS.find((point) => point.id === 8);
    assert.deepEqual(gameplayEight, { id: 8, x: 14, y: 72 });
    assert.deepEqual(atlasEight, { id: 8, x: 12, y: 72 });

    for (const gameplayPoint of SECTOR_POINTS) {
        const atlasPoint = ATLAS_SECTOR_POINTS.find((point) => point.id === gameplayPoint.id);
        assert.ok(atlasPoint, `atlas is missing sector ${gameplayPoint.id}`);
        if (gameplayPoint.id !== 8) assert.deepEqual(atlasPoint, gameplayPoint);
    }
});
