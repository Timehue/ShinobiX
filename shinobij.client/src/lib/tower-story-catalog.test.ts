import assert from "node:assert/strict";
import test from "node:test";
import type { TowerFloorMeta } from "./towers-api";
import {
    groupTowerStoryChapters,
    isTowerStoryFloorActionable,
    orderedTowerStoryFloors,
    recommendedTowerStoryFloor,
} from "./tower-story-catalog";

function floor(id: number, chapter?: number): TowerFloorMeta {
    return {
        id,
        name: `Floor ${id}`,
        biome: "central",
        objective: "defeat-all",
        roundBudget: 8,
        isBoss: false,
        bossMechanic: null,
        bossTargetMode: null,
        bossStrike: null,
        closingRing: null,
        dynamicHazards: [],
        fieldRule: null,
        enemyCount: 1,
        reinforcementWaves: [],
        firstClearReward: { ryo: 0, statPoints: 0, fateShards: 0, boneCharms: 0, milestone: null },
        milestone: null,
        map: { width: 20, height: 14 },
        ...(chapter == null ? {} : {
            chapter,
            chapterTitle: chapter === 1 ? "The First Ascent" : "The Shattered Crown",
            chapterSubtitle: chapter === 2 ? "A broken summit opens above." : null,
            chapterSummary: chapter === 2 ? "Climb into the occupied crown." : null,
            artKey: chapter === 2 ? "shattered-crown" : null,
        }),
    };
}

test("Story recommendation follows API floors beyond the former ten-floor ceiling", () => {
    const floors = [floor(15, 2), floor(11, 2), floor(10, 1), floor(12, 2), floor(11, 2)];
    assert.deepEqual(orderedTowerStoryFloors(floors).map(value => value.id), [10, 11, 12, 15]);
    assert.equal(recommendedTowerStoryFloor(floors, 10), 11);
    assert.equal(recommendedTowerStoryFloor(floors, 12), 12, "a catalog gap never recommends an unauthorized numeric floor");
    assert.equal(recommendedTowerStoryFloor(floors, 15), 15, "a completed catalog stays on its finale");
});

test("Story actionability mirrors level, replay, and numeric-frontier authority", () => {
    const common = { bestFloor: 10, clearedFloors: new Set([2, 10]), levelEligible: true, admin: false };
    assert.equal(isTowerStoryFloorActionable({ ...common, floor: 2 }), true);
    assert.equal(isTowerStoryFloorActionable({ ...common, floor: 11 }), true);
    assert.equal(isTowerStoryFloorActionable({ ...common, floor: 12 }), false);
    assert.equal(isTowerStoryFloorActionable({ ...common, floor: 11, levelEligible: false }), false);
    assert.equal(isTowerStoryFloorActionable({ ...common, floor: 15, levelEligible: false, admin: true }), true);
});

test("Story chapters come from metadata and old cached floors receive a safe fallback", () => {
    const chapters = groupTowerStoryChapters([floor(11, 2), floor(1), floor(12, 2)]);
    assert.deepEqual(chapters.map(chapter => ({ number: chapter.number, title: chapter.title, floors: chapter.floors.map(value => value.id) })), [
        { number: 1, title: "The Celestial Ascent", floors: [1] },
        { number: 2, title: "The Shattered Crown", floors: [11, 12] },
    ]);
    assert.equal(chapters[1]?.artKey, "shattered-crown");
});
