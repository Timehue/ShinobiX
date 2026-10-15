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

    const gameplayFiftyFive = SECTOR_POINTS.find((point) => point.id === 55);
    const atlasFiftyFive = ATLAS_SECTOR_POINTS.find((point) => point.id === 55);
    assert.deepEqual(gameplayFiftyFive, { id: 55, x: 59, y: 60 });
    assert.deepEqual(atlasFiftyFive, { id: 55, x: 54, y: 57 });

    assert.deepEqual(SECTOR_POINTS.filter((point) => [17, 23, 24, 25].includes(point.id)), [
        { id: 17, x: 85, y: 77 }, { id: 23, x: 78, y: 70 },
        { id: 24, x: 88.5, y: 66 }, { id: 25, x: 76, y: 82 },
    ], 'opening the village court must preserve the authoritative road geography');

    for (const gameplayPoint of SECTOR_POINTS) {
        const atlasPoint = ATLAS_SECTOR_POINTS.find((point) => point.id === gameplayPoint.id);
        assert.ok(atlasPoint, `atlas is missing sector ${gameplayPoint.id}`);
        if (![8, 17, 23, 24, 25, 55].includes(gameplayPoint.id)) assert.deepEqual(atlasPoint, gameplayPoint);
    }
});
