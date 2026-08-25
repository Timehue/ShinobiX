import { test } from "node:test";
import assert from "node:assert/strict";
import {
    advanceWarfrontMotionFilter,
    adaptWarfrontPresentationBudget,
    createWarfrontMotionFilter,
    evaluateWarfrontPerformance,
    reconcileWarfrontMobSlots,
    shouldRenderWarfrontHoundRig,
    warfrontMotionFilterSpeed,
    warfrontMvpId,
    warfrontPresentationBudget,
    warfrontPercentile,
} from "./pet-warfront-presentation.ts";

test("motion filter rejects tick-level reversals but follows sustained travel", () => {
    const jitter = createWarfrontMotionFilter();
    let jitterMin = Infinity;
    let jitterMax = -Infinity;
    for (let frame = 0; frame < 180; frame++) {
        const target = Math.floor(frame / 2) % 2 === 0 ? -0.1 : 0.1;
        advanceWarfrontMotionFilter(jitter, target, 0, 1 / 60);
        if (frame > 60) {
            jitterMin = Math.min(jitterMin, jitter.x);
            jitterMax = Math.max(jitterMax, jitter.x);
        }
    }
    assert.ok(jitterMax - jitterMin < 0.05, `tick reversal leaked ${jitterMax - jitterMin}u`);
    assert.ok(warfrontMotionFilterSpeed(jitter) < 0.35);

    const travel = createWarfrontMotionFilter();
    for (let frame = 0; frame < 120; frame++) {
        advanceWarfrontMotionFilter(travel, frame * 0.05, 0, 1 / 60);
    }
    assert.ok(travel.x > 5.5, "sustained travel must not be mistaken for jitter");
    assert.ok(warfrontMotionFilterSpeed(travel) > 2);
});

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

test("mob render slots stay bound when an earlier mob dies", () => {
    const initial = reconcileWarfrontMobSlots([null, null, null, null], [10, 11, 12]);
    assert.deepEqual(initial, [10, 11, 12, null]);

    const afterDeath = reconcileWarfrontMobSlots(initial, [11, 12, 13]);
    assert.deepEqual(afterDeath, [13, 11, 12, null]);
});

test("mob slot reconciliation ignores duplicate ids and respects capacity", () => {
    assert.deepEqual(
        reconcileWarfrontMobSlots([4, null], [4, 4, 5, 6], 2),
        [4, 5],
    );
});

test("MVP scoring recognizes decisive kills, assists, and economy", () => {
    assert.equal(warfrontMvpId([
        { id: "damage-only", dmg: 2200, kills: 0, assists: 0, coins: 100 },
        { id: "closer", dmg: 1500, kills: 2, assists: 2, coins: 500 },
    ]), "closer");
    assert.equal(warfrontMvpId([]), null);
});

test("performance gates use p95 frame time, worst stall, and draw-call ceilings", () => {
    const smooth = Array.from({ length: 120 }, (_, index) => index === 0 ? 42 : 16.4);
    assert.equal(warfrontPercentile(smooth, 0.95), 16.4);
    assert.equal(evaluateWarfrontPerformance(smooth, 280, "desktop60").pass, true);
    assert.equal(evaluateWarfrontPerformance([...smooth, 130], 280, "desktop60").pass, false);
    assert.equal(evaluateWarfrontPerformance(smooth, 400, "desktop60").pass, false);
});
