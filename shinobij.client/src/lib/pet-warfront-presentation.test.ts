import { test } from "node:test";
import assert from "node:assert/strict";
import {
    adaptWarfrontPresentationBudget,
    reconcileWarfrontMobSlots,
    shouldRenderWarfrontHoundRig,
    warfrontMvpId,
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
