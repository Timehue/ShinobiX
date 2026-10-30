import assert from "node:assert/strict";
import test from "node:test";
import type { DuelActorSnap, DuelResult } from "./pet-duel-sim";
import { sampleActor } from "./pet-warfront-rite-presentation";
import { warfrontRigPhase, warfrontRigTrack, warfrontTravelFacing, createWarfrontWeight, stepWarfrontWeight, warfrontReleaseTick, warfrontDeliveryAt } from "./pet-warfront-rig-motion";
import { warfrontAttackCues } from "./pet-warfront-attack-causality";

const replay = (states: DuelActorSnap["state"][]): DuelResult => ({
    ticks: states.length - 1, result: "win", winner: "player", events: [],
    snapshots: states.map((state, t) => ({ t, projectiles: [], actors: [{
        id: "player-0", team: "player", slot: 0, state, x: t, y: 0,
        faceX: 1, faceY: 0, hp: 100, maxHp: 100, stamina: 100, statuses: [],
    }] })),
});

test("ranged anticipation releases with the projectile and completes on authoritative contact", () => {
    const cues = warfrontAttackCues([
        { t: 10, type: "windup", side: "player", actorId: "player-0", targetId: "enemy-0" },
        { t: 25, type: "hit", side: "player", actorId: "player-0", targetId: "enemy-0", ranged: true },
    ]);
    const release = warfrontReleaseTick(10, 25);
    assert.ok(release > 10 && release < 25);
    assert.equal(warfrontDeliveryAt(cues, release - .01)?.motion, "windup");
    assert.deepEqual(warfrontDeliveryAt(cues, release), { motion: "strike", progress: 0 });
    assert.deepEqual(warfrontDeliveryAt(cues, 25), { motion: "strike", progress: 1 });
    assert.equal(warfrontDeliveryAt(cues, 26), null);
    assert.equal(warfrontDeliveryAt(cues, 0), null);
});

test("locomotion weight responds to starts, turns and braking while remaining bounded and pausable", () => {
    const weight = createWarfrontWeight();
    stepWarfrontWeight(weight, 6, 0, 1 / 60, true);
    assert.ok(weight.roll < 0);
    stepWarfrontWeight(weight, 0, 6, 1 / 60, true);
    assert.ok(weight.pitch > 0);
    const held = { ...weight };
    stepWarfrontWeight(weight, 9, -9, 0, true);
    assert.deepEqual(weight, held);
    for (let i = 0; i < 60; i++) {
        stepWarfrontWeight(weight, i % 2 ? 90 : -90, 50, 1 / 60, true);
        assert.ok(Math.hypot(weight.pitch, weight.roll) <= .085001);
    }
    for (let i = 0; i < 60; i++) stepWarfrontWeight(weight, 0, 0, 1 / 60, false);
    assert.ok(Math.hypot(weight.pitch, weight.roll) < .00001);
    stepWarfrontWeight(weight, 6, 0, 1 / 60, true, true);
    assert.equal(weight.pitch, 0);
    assert.equal(weight.roll, 0);
});

test("authored attack phases follow the sampled battle state at every fractional boundary", () => {
    const result = replay(["idle", "windup", "windup", "windup", "strike", "recover", "recover", "idle"]);
    const track = warfrontRigTrack(result, "player-0");
    for (let tick = 0; tick <= result.ticks; tick += .125) {
        const motion = sampleActor(result, "player", 0, tick).state;
        const phase = warfrontRigPhase(track, tick, motion);
        if (["windup", "strike", "recover"].includes(motion)) {
            assert.ok(phase !== undefined && phase >= 0 && phase <= 1, `${tick}: ${motion} lost its authored phase`);
        } else assert.equal(phase, undefined);
    }
    assert.equal(warfrontRigPhase(track, 2, "windup"), .5);
    assert.equal(warfrontRigPhase(track, 4, "strike"), .5);
    assert.equal(warfrontRigPhase(track, 5.5, "recover"), .5);
});

test("short trained windups and long tells each use the full anticipation without clock drift", () => {
    for (const duration of [2, 6, 15]) {
        const result = replay(["idle", ...Array<DuelActorSnap["state"]>(duration).fill("windup"), "strike", "recover"]);
        const track = warfrontRigTrack(result, "player-0");
        for (const progress of [.1, .5, .9]) {
            const tick = .5 + duration * progress;
            assert.ok(Math.abs(warfrontRigPhase(track, tick, "windup")! - progress) < 1e-9);
        }
        assert.equal(warfrontRigPhase(track, 0, "idle"), undefined, "rewinding clears the last attack phase");
        assert.equal(warfrontRigPhase(track, 1, "stagger"), undefined, "a hit reaction must not inherit the attack phase");
    }
});

test("path-facing locomotion cannot turn a planted attack or KO", () => {
    assert.equal(warfrontTravelFacing(true, 6, "dash"), true);
    assert.equal(warfrontTravelFacing(true, 3, "idle"), true);
    assert.equal(warfrontTravelFacing(true, .01, "idle"), false);
    assert.equal(warfrontTravelFacing(false, 6, "dash"), false);
    for (const state of ["windup", "strike", "recover", "dodge", "stagger", "dead"]) {
        assert.equal(warfrontTravelFacing(true, 6, state), false);
    }
});
