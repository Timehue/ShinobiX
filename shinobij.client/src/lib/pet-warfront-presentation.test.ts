import { test } from "node:test";
import assert from "node:assert/strict";
import {
    adaptWarfrontPresentationBudget,
    shouldRenderWarfrontHoundRig,
    warfrontPresentationBudget,
} from "./pet-warfront-presentation.ts";

test("Warfront budgets reserve expensive cameras and the largest rig pool for High", () => {
    const low = warfrontPresentationBudget("low");
    const medium = warfrontPresentationBudget("medium");
    const high = warfrontPresentationBudget("high");

    assert.equal(low.squadCameras, false);
    assert.equal(medium.squadCameras, false);
    assert.equal(high.squadCameras, true);
    assert.ok(low.laneHoundRigs < medium.laneHoundRigs);
    assert.ok(medium.laneHoundRigs < high.laneHoundRigs);
    assert.ok(high.squadCameraRenderEvery >= 2);
});

test("hound LOD requires both an available rig slot and camera proximity", () => {
    assert.equal(shouldRenderWarfrontHoundRig(1, 12, 3, 25), true);
    assert.equal(shouldRenderWarfrontHoundRig(3, 12, 3, 25), false);
    assert.equal(shouldRenderWarfrontHoundRig(1, 30, 3, 25), false);
});

test("adaptive pressure sheds secondary cameras and rigs before combat presentation", () => {
    const high = warfrontPresentationBudget("high");
    const warm = adaptWarfrontPresentationBudget(high, 1);
    const emergency = adaptWarfrontPresentationBudget(high, 2);

    assert.equal(warm.squadCameras, false);
    assert.ok(warm.hollowHoundRigs < high.hollowHoundRigs);
    assert.ok(warm.laneHoundRigs < high.laneHoundRigs);
    assert.deepEqual(emergency, warfrontPresentationBudget("low"));
});
