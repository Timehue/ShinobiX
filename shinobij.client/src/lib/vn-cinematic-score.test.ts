import test from "node:test";
import assert from "node:assert/strict";
import { resolveVnScoreKey, VN_SCORE_TRACKS } from "./vn-cinematic-score";

test("village story events resolve to their authored score", () => {
    assert.equal(resolveVnScoreKey("story-stormveil-village-20-2"), "stormveil");
    assert.equal(resolveVnScoreKey("story-ashen-leaf-village-40-3"), "ashen");
    assert.equal(resolveVnScoreKey("story-frostfang-village-60-4"), "frostfang");
    assert.equal(resolveVnScoreKey("story-moonshadow-village-80-6"), "moonshadow");
});

test("each village reckoning resolves to the shared Hollow Gate motif", () => {
    assert.equal(resolveVnScoreKey("story-stormveil-village-100-8"), "hollow");
    assert.equal(resolveVnScoreKey("story-ashen-leaf-village-100-8"), "hollow");
    assert.equal(resolveVnScoreKey("story-frostfang-village-100-8"), "hollow");
    assert.equal(resolveVnScoreKey("story-moonshadow-village-100-8"), "hollow");
    assert.equal(resolveVnScoreKey("preview", "Hollow Gate Storyline"), "hollow");
});

test("a coast quest's scene plays the theme its id names, and Stormveil's when it names none it may play", () => {
    assert.equal(resolveVnScoreKey("coast-quest:first-footing@stormveil", "First Footing"), "stormveil");
    assert.equal(resolveVnScoreKey("coast-quest:crossing-war-3@ashen"), "ashen");
    assert.equal(resolveVnScoreKey("coast-quest:crossing-war-4@frostfang"), "frostfang");
    assert.equal(resolveVnScoreKey("coast-quest:the-unmoored@moonshadow", "The Unmoored"), "moonshadow");
    // The coast is not where the Hollow Gate came from, so its theme is never played there, whatever is asked.
    assert.equal(resolveVnScoreKey("coast-quest:the-unmoored@hollow"), "stormveil");
    for (const id of ["coast-quest:first-footing", "coast-quest:first-footing@", "coast-quest:first-footing@undefined", "coast-quest:x@toString", "coast-quest:x@nothing"]) {
        assert.equal(resolveVnScoreKey(id), "stormveil", id);
    }
    assert.equal(resolveVnScoreKey("a-coast-quest:lookalike@ashen"), null);
});

test("unrelated visual novels do not receive a chapter score", () => {
    assert.equal(resolveVnScoreKey("arena-bandit-ambush", "Forest encounter"), null);
    assert.equal(resolveVnScoreKey("sage-offer", "Legacy Choice"), null);
    assert.equal(resolveVnScoreKey("arena-stormveil-finals", "Stormveil Village"), null);
});

test("every score key has a production OGG route", () => {
    assert.deepEqual(Object.keys(VN_SCORE_TRACKS).sort(), [
        "ashen",
        "frostfang",
        "hollow",
        "moonshadow",
        "stormveil",
    ]);
    for (const track of Object.values(VN_SCORE_TRACKS)) {
        assert.match(track, /^\/music\/vn\/.+\.ogg$/);
    }
});
