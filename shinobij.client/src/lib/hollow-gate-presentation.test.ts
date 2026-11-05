import assert from "node:assert/strict";
import { test } from "node:test";
import {
    HOLLOW_GATE_ALPHA_CINEMATIC,
    HOLLOW_GATE_HOUND_COMBAT,
    hollowGateAlphaCinematicImage,
    hollowGateEncounterPresentation,
    hollowGateFloorProfile,
    hollowGateHoundCombatImage,
    hollowGateLegacyRoomPrefabs,
    hollowGateRoomArt,
} from "./hollow-gate-presentation";

test("a floor from before the crypt board still gets a painting for every room", () => {
    // 20x6 board: room 0 is a 7x3 hall, room 1 a 3x3 cave, room 2 a 6x6 room.
    const width = 20, tiles = Array.from({ length: width * 6 }, (_, i) => {
        const x = i % width, y = Math.floor(i / width);
        const roomId = y < 3 && x < 7 ? 0 : y < 3 && x >= 8 && x < 11 ? 1 : x >= 12 && x < 18 ? 2 : null;
        return { kind: roomId == null ? "wall" : "empty", roomId };
    });
    const prefabs = hollowGateLegacyRoomPrefabs(tiles, width);
    assert.deepEqual(prefabs, { 0: "hall", 1: "small", 2: "room" });
    const art = hollowGateRoomArt(1, false, prefabs);
    assert.deepEqual(Object.keys(art ?? {}).sort(), ["0", "1", "2"]);
    assert.match(art![0], /crypt-threshold-hall-v1\.webp$/);
});

test("every canonical Hollow Gate floor has a distinct authored identity", () => {
    const floors = Array.from({ length: 5 }, (_, index) => hollowGateFloorProfile(index + 1));
    assert.equal(new Set(floors.map((floor) => floor.name)).size, 5);
    assert.equal(new Set(floors.map((floor) => floor.houndName)).size, 5);
    assert.equal(new Set(floors.map((floor) => floor.signature)).size, 5);
    assert.equal(new Set(floors.map((floor) => floor.storyTitle)).size, 5);
    assert.equal(new Set(floors.map((floor) => floor.shrineTitle)).size, 5);
    assert.equal(new Set(floors.map((floor) => floor.petTrace)).size, 5);
    assert.equal(floors[4].name, "Alpha Sanctum");
    assert.equal(floors[4].houndName, "Hollow Hound Alpha");
});

test("encounter presentation preserves elite and ambush roles", () => {
    assert.equal(hollowGateEncounterPresentation(2, "elite").name, "Elite Veilrunner Hollow Hound");
    assert.equal(hollowGateEncounterPresentation(4, "ambush").name, "Ambushing Riftmaw Hollow Hound");
    assert.match(HOLLOW_GATE_ALPHA_CINEMATIC, /\.webp$/);
});

test("Hollow Hound art resolves canonical, published legacy, and bundled keys consistently", () => {
    assert.equal(hollowGateHoundCombatImage({ "shrine:hollow-hound": "/custom/canonical.webp" }), "/custom/canonical.webp");
    assert.equal(hollowGateHoundCombatImage({ "shrine:tile-hollow-beast": "/custom/published.webp" }), "/custom/published.webp");
    assert.equal(hollowGateHoundCombatImage({}), HOLLOW_GATE_HOUND_COMBAT);
    assert.equal(
        hollowGateAlphaCinematicImage({ "shrine:hollow-hound-alpha-cinematic": "/custom/alpha.webp" }),
        "/custom/alpha.webp",
    );
    assert.equal(hollowGateAlphaCinematicImage({}), HOLLOW_GATE_ALPHA_CINEMATIC);
});
