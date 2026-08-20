import test from "node:test";
import assert from "node:assert/strict";
import { attackClipWindow, motionOwnsLocomotion, petDeathChoreography, resolveCombatBodyFacing } from "./pet-combat-performance";

test("attack clip windows preserve anticipation, contact, and recovery order", () => {
    const windup = attackClipWindow("windup")!;
    const strike = attackClipWindow("strike")!;
    const recover = attackClipWindow("recover")!;
    assert.equal(windup.start, 0);
    assert.equal(windup.end, strike.start);
    assert.equal(strike.end, recover.start);
    assert.ok(recover.end < 1);
});

test("residual movement cannot layer locomotion over committed actions", () => {
    assert.equal(motionOwnsLocomotion("idle", true), true);
    assert.equal(motionOwnsLocomotion("run", false), true);
    assert.equal(motionOwnsLocomotion("windup", true), false);
    assert.equal(motionOwnsLocomotion("strike", true), false);
    assert.equal(motionOwnsLocomotion("recover", true), false);
});

test("dash travel reacquires the opponent before contact", () => {
    const launch = resolveCombatBodyFacing({ faceX: 1, faceZ: 0, moveX: 0, moveZ: 1, motion: "dash", motionAge: 0, allowTravelFacing: true });
    const contact = resolveCombatBodyFacing({ faceX: 1, faceZ: 0, moveX: 0, moveZ: 1, motion: "dash", motionAge: 0.58, allowTravelFacing: true });
    assert.ok(launch[1] > 0.99);
    assert.ok(contact[0] > 0.99);
});

test("ordinary quadruped travel can turn without ever facing away from combat", () => {
    const facing = resolveCombatBodyFacing({ faceX: 1, faceZ: 0, moveX: -1, moveZ: 0, motion: "run", motionAge: 1, allowTravelFacing: true });
    const alignment = facing[0];
    assert.ok(alignment > 0.7, `body alignment ${alignment} should keep the opponent in its forward cone`);
});

test("death choreography recoils, falls once, impacts, and settles", () => {
    const start = petDeathChoreography(0, 2, "quadruped");
    const recoil = petDeathChoreography(0.08, 2, "quadruped");
    const falling = petDeathChoreography(0.45, 2, "quadruped");
    const impact = petDeathChoreography(0.9, 2, "quadruped");
    const settled = petDeathChoreography(1.4, 2, "quadruped");
    assert.equal(start.fall, 0);
    assert.ok(recoil.lift > 0);
    assert.ok(falling.fall > 0 && falling.fall < 1);
    assert.ok(impact.impact > 0);
    assert.equal(settled.fall, 1);
    assert.ok(settled.sink > 0);
    assert.ok(settled.impact < 1e-9);
});
