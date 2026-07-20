import assert from "node:assert/strict";
import test from "node:test";
import { petHeroBodyPose, petHeroMoveAt, petHeroMoveStyle, petHeroMoveWindows } from "./pet-hero-moves";
import type { DuelEvent } from "./pet-duel-sim";

test("showcase pets receive species-specific move styles", () => {
    assert.equal(petHeroMoveStyle({ petId: "mythic-0", move: "Phantom Phase", kind: "move" }), "kitsune-shadow-step");
    assert.equal(petHeroMoveStyle({ petName: "Eclipse Kitsune", move: "Eclipse Fang", kind: "damage" }), "kitsune-eclipse-pounce");
    assert.equal(petHeroMoveStyle({ petName: "Eclipse Kitsune", move: "Nine Shadow Blessing", kind: "buff" }), "kitsune-tail-cast");
    assert.equal(petHeroMoveStyle({ petName: "Tidal Selkie", move: "Riptide Shift", kind: "move" }), "selkie-surf");
    assert.equal(petHeroMoveStyle({ petName: "Tidal Selkie", move: "Riptide Fang", kind: "damage" }), "selkie-tail-strike");
    assert.equal(petHeroMoveStyle({ petName: "Tidal Selkie", move: "Tidal Crash", kind: "push" }), "selkie-wave-launch");
});

test("every certified model profile receives a non-generic hero package", () => {
    assert.equal(petHeroMoveStyle({ petName: "Direwolf", move: "Fang Rush", kind: "damage", profile: "quadruped" }), "quadruped-rush");
    assert.equal(petHeroMoveStyle({ petName: "Tanuki", move: "Kunai Flurry", kind: "damage", profile: "biped" }), "biped-combo");
    assert.equal(petHeroMoveStyle({ petName: "Tempest Hawk", move: "Skyfall", kind: "damage", profile: "avian" }), "avian-dive");
    assert.equal(petHeroMoveStyle({ petName: "Azure Ryujin", move: "Coil Surge", kind: "move", profile: "serpentine" }), "serpentine-surge");
    assert.equal(petHeroMoveStyle({ petName: "Worldroot Colossus", move: "Worldbreaker", kind: "crush", profile: "heavy" }), "heavy-slam");
});

test("move windows keep named anticipation, contact, and recovery together", () => {
    const events: DuelEvent[] = [
        { t: 30, type: "windup", side: "player", actorId: "player-0", targetId: "enemy-0", move: "Eclipse Fang", kind: "damage" },
        { t: 44, type: "hit", side: "player", actorId: "player-0", targetId: "enemy-0", move: "Eclipse Fang", kind: "damage", dmg: 50 },
    ];
    const windows = petHeroMoveWindows(events, "player-0", { id: "mythic-0", name: "Eclipse Kitsune" });
    assert.deepEqual(windows, [{ start: 27, end: 60, move: "Eclipse Fang", style: "kitsune-eclipse-pounce" }]);
    assert.equal(petHeroMoveAt(windows, 43)?.style, "kitsune-eclipse-pounce");
    assert.equal(petHeroMoveAt(windows, 61), null);
});

test("showcase move poses create different readable silhouettes", () => {
    const pounce = petHeroBodyPose({ style: "kitsune-eclipse-pounce", motion: "strike", motionAge: 0.2, timeline: 2, attackPulse: 1, casting: false });
    const tailSlap = petHeroBodyPose({ style: "selkie-tail-strike", motion: "strike", motionAge: 0.2, timeline: 2, attackPulse: 1, casting: false });
    const surf = petHeroBodyPose({ style: "selkie-surf", motion: "dash", motionAge: 0.29, timeline: 2, attackPulse: 0, casting: false });
    assert.ok(pounce.pitch > 0.2 && pounce.scaleZ > 1.1, "pounce drives the torso through contact");
    assert.ok(tailSlap.yaw > 0.3 && tailSlap.roll > 0.2, "tail strike twists laterally");
    assert.ok(surf.lift > 0.06 && surf.scaleZ > 1.05, "surf has a visible launch arc and long silhouette");
});

test("roster-wide hero packages create distinct attack silhouettes", () => {
    const input = { motion: "strike", motionAge: 0.2, timeline: 2, attackPulse: 1, casting: false } as const;
    const quadruped = petHeroBodyPose({ ...input, style: "quadruped-rush" });
    const biped = petHeroBodyPose({ ...input, style: "biped-combo" });
    const avian = petHeroBodyPose({ ...input, style: "avian-dive" });
    const serpentine = petHeroBodyPose({ ...input, style: "serpentine-surge" });
    const heavy = petHeroBodyPose({ ...input, style: "heavy-slam" });
    assert.ok(quadruped.drive > 0.09 && quadruped.scaleZ > 1.05, "quadruped commits forward");
    assert.ok(biped.yaw > 0.2 && biped.roll > 0.08, "biped twists into a combo");
    assert.ok(avian.pitch > 0.05 && avian.scaleX > 1.05, "avian spreads into contact");
    assert.ok(serpentine.yaw > 0.18 && serpentine.roll > 0.15, "serpentine coils through contact");
    assert.ok(heavy.scaleY > 1.08 && heavy.scaleX > 1.07, "heavy attack expands through a slam");
});
