import test from "node:test";
import assert from "node:assert/strict";
import { attackClipWindow, motionOwnsLocomotion, petDeathChoreography, resolveCombatBodyFacing, resolveOpponentFacing } from "./pet-combat-performance";

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

test("opposing pets receive reciprocal headings that point directly at each other", () => {
    const player = resolveOpponentFacing(-3.4, 2.6, 1.2, -1.5);
    const enemy = resolveOpponentFacing(1.2, -1.5, -3.4, 2.6);
    const playerToEnemy = [4.6, -4.1] as const;
    const enemyToPlayer = [-4.6, 4.1] as const;
    assert.ok(player[0] * playerToEnemy[0] + player[1] * playerToEnemy[1] > Math.hypot(...playerToEnemy) * 0.999);
    assert.ok(enemy[0] * enemyToPlayer[0] + enemy[1] * enemyToPlayer[1] > Math.hypot(...enemyToPlayer) * 0.999);
    assert.ok(Math.abs(player[0] + enemy[0]) < 1e-9);
    assert.ok(Math.abs(player[1] + enemy[1]) < 1e-9);
});

test("locked duel locomotion preserves the opponent heading instead of the travel tangent", () => {
    const opponent = resolveOpponentFacing(-3.4, 2.6, 1.2, -1.5);
    const body = resolveCombatBodyFacing({
        faceX: opponent[0],
        faceZ: opponent[1],
        moveX: -1,
        moveZ: 0,
        motion: "run",
        motionAge: 1,
        allowTravelFacing: false,
    });
    assert.ok(body[0] * opponent[0] + body[1] * opponent[1] > 0.999999);
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
