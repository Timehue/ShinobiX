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
    assert.equal(petHeroMoveStyle({ petId: "starter-water", petName: "Abyssal Leviathan", move: "Tidal Crash", kind: "push", profile: "serpentine" }), "dragon-overrun");
    assert.equal(petHeroMoveStyle({ petId: "starter-water", petName: "Ripple Seal", move: "Seal Glide", kind: "move", profile: "serpentine" }), "amphibious-slide");
});

test("every certified model profile receives a non-generic hero package", () => {
    assert.equal(petHeroMoveStyle({ petName: "Direwolf", move: "Fang Rush", kind: "damage", profile: "quadruped" }), "pack-hunter-pressure");
    assert.equal(petHeroMoveStyle({ petName: "Tanuki", move: "Kunai Flurry", kind: "damage", profile: "biped" }), "biped-combo");
    assert.equal(petHeroMoveStyle({ petName: "Tempest Hawk", move: "Skyfall", kind: "damage", profile: "avian" }), "avian-dive");
    assert.equal(petHeroMoveStyle({ petName: "Azure Ryujin", move: "Coil Surge", kind: "move", profile: "serpentine" }), "dragon-overrun");
    assert.equal(petHeroMoveStyle({ petName: "Worldroot Colossus", move: "Worldbreaker", kind: "crush", profile: "heavy" }), "armored-counter");
});

test("animal families receive different body-language packages on the same skeleton", () => {
    assert.equal(petHeroMoveStyle({ petName: "Ember Ocelot", profile: "quadruped" }), "pouncer-stalk");
    assert.equal(petHeroMoveStyle({ petName: "Solar Stag", profile: "quadruped" }), "charger-drive");
    assert.equal(petHeroMoveStyle({ petName: "Terra Porcupine", profile: "heavy" }), "burrow-grapple");
    assert.equal(petHeroMoveStyle({ petName: "Ironback Turtle", profile: "heavy" }), "armored-counter");
    assert.equal(petHeroMoveStyle({ petName: "Brook Newt", profile: "biped" }), "amphibious-slide");
    assert.equal(petHeroMoveStyle({ petName: "Snow Rabbit", profile: "biped" }), "hopper-spring");
    assert.equal(petHeroMoveStyle({ petName: "Desert Lizard", profile: "biped" }), "reptile-snap");
    assert.equal(petHeroMoveStyle({ petName: "Cinder Rat", profile: "biped" }), "rodent-scramble");
    assert.equal(petHeroMoveStyle({ petName: "Bamboo Ape", profile: "biped" }), "primate-combo");
    assert.equal(petHeroMoveStyle({ petName: "Abyss Kraken", profile: "biped" }), "aquatic-undertow");
    assert.equal(petHeroMoveStyle({ petName: "Worldstorm Dragon", profile: "quadruped" }), "dragon-overrun");
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

test("animal-family poses communicate distinct anticipation and contact", () => {
    const windup = { motion: "windup", motionAge: 0.2, timeline: 2, attackPulse: 0, casting: false } as const;
    const strike = { motion: "strike", motionAge: 0.2, timeline: 2, attackPulse: 1, casting: false } as const;
    const pouncer = petHeroBodyPose({ ...strike, style: "pouncer-stalk" });
    const charger = petHeroBodyPose({ ...strike, style: "charger-drive" });
    const burrower = petHeroBodyPose({ ...windup, style: "burrow-grapple" });
    const armored = petHeroBodyPose({ ...windup, style: "armored-counter" });
    assert.ok(pouncer.scaleZ > 1.15 && pouncer.drive > 0.15, "pouncer lengthens into a leap");
    assert.ok(charger.drive > pouncer.drive && charger.scaleZ > 1.15, "charger commits through the target");
    assert.ok(burrower.scaleY < 0.85, "grappler disappears into a low coil");
    assert.ok(armored.scaleX > 1.1 && armored.scaleY < 0.9, "bulwark visibly withdraws and braces");
});

test("move windows use the current evolution form instead of its persistent starter id", () => {
    const events: DuelEvent[] = [
        { t: 30, type: "windup", side: "player", actorId: "player-0", targetId: "enemy-0", move: "Tsunami Surge", kind: "damage" },
        { t: 44, type: "hit", side: "player", actorId: "player-0", targetId: "enemy-0", move: "Tsunami Surge", kind: "damage", dmg: 50 },
    ];
    const windows = petHeroMoveWindows(events, "player-0", {
        id: "starter-water",
        name: "Abyssal Leviathan",
        profile: "serpentine",
    });
    assert.equal(windows[0]?.style, "dragon-overrun");
});

test("expanded roster families have readable, non-interchangeable attack grammar", () => {
    const windup = { motion: "windup", motionAge: 0.2, timeline: 2, attackPulse: 0, casting: false } as const;
    const strike = { motion: "strike", motionAge: 0.2, timeline: 2, attackPulse: 1, casting: false } as const;
    const dash = { motion: "dash", motionAge: 0.29, timeline: 2, attackPulse: 0, casting: false } as const;
    const hopper = petHeroBodyPose({ ...dash, style: "hopper-spring" });
    const reptile = petHeroBodyPose({ ...strike, style: "reptile-snap" });
    const rodent = petHeroBodyPose({ ...dash, motionAge: 0.073, style: "rodent-scramble" });
    const primate = petHeroBodyPose({ ...strike, style: "primate-combo" });
    const aquatic = petHeroBodyPose({ ...strike, style: "aquatic-undertow" });
    const dragon = petHeroBodyPose({ ...windup, style: "dragon-overrun" });
    assert.ok(hopper.lift > 0.18 && hopper.scaleY > 1.1, "hopper loads into a tall spring arc");
    assert.ok(reptile.yaw > 0.3 && reptile.drive > 0.15, "reptile snaps laterally through contact");
    assert.ok(Math.abs(rodent.roll) > 0.08 && Math.abs(rodent.yaw) > 0.1, "rodent changes direction during its scramble");
    assert.ok(primate.yaw > 0.35 && primate.scaleX > 1.05, "primate rotates through a broad combination");
    assert.ok(aquatic.roll > 0.2 && aquatic.scaleX > 1.1, "aquatic hunter sweeps across the target");
    assert.ok(dragon.scaleX > 1.09 && dragon.drive < 0, "dragon looms before overrunning the target");
});
