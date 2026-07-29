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
