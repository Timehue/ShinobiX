import assert from "node:assert/strict";
import test from "node:test";
import {
    showdownBodyRadius,
    showdownAttackRhythm,
    showdownCinematicImpulse,
    showdownContactGap,
    showdownMeleeContact,
    showdownMeleeDrive,
    showdownPerformanceVariant,
    showdownReactionRecoil,
} from "./pet-showdown-choreography";

test("Pet Showdown keeps a visible impact core between Red Fox and Blue Frog", () => {
        const fox = showdownBodyRadius({ targetHeight: 2.35, profile: "quadruped" });
        const frog = showdownBodyRadius({ targetHeight: 2.1, profile: "biped" });
        const contact = showdownMeleeContact(0, 4.1, 0, -4.1, fox, frog);
        const remaining = Math.abs(contact.z - -4.1);
        assert.ok(Math.abs(remaining - showdownContactGap(fox, frog)) < 0.00001);
        assert.ok(remaining - fox - frog >= 0.58);
        assert.ok(contact.impactZ < contact.z - fox);
        assert.ok(contact.impactZ > -4.1 + frog);
});

test("Pet Showdown melee never overshoots contact and returns home after recovery", () => {
        assert.equal(showdownMeleeDrive(0.31), 0);
        assert.equal(showdownMeleeDrive(0.55), 1);
        assert.equal(showdownMeleeDrive(1), 0);
});

test("Pet Showdown shares a weight-aware anticipation, contact, and recovery clock", () => {
    const quick = showdownAttackRhythm({ weight: "light", superMove: false, delivery: "melee" });
    const heavy = showdownAttackRhythm({ weight: "heavy", superMove: false, delivery: "melee", moveKind: "crush" });
    const ranged = showdownAttackRhythm({ weight: "normal", superMove: false, delivery: "ranged" });
    assert.ok(heavy.windupStart < heavy.dashStart);
    assert.ok(heavy.dashStart < heavy.contact);
    assert.ok(heavy.contact < heavy.contactEnd);
    assert.ok(heavy.contactEnd < heavy.recoverEnd);
    assert.ok(heavy.contact > quick.contact);
    assert.equal(ranged.dashStart, ranged.contact);
    assert.equal(showdownMeleeDrive(heavy.contact, heavy), 1);
    assert.equal(showdownMeleeDrive(heavy.recoverEnd, heavy), 0);
});

test("strongly committed signature poses reserve extra limb reach", () => {
        const attacker = showdownBodyRadius({ targetHeight: 2.65, profile: "heavy", rarity: "mythic" });
        const defender = showdownBodyRadius({ targetHeight: 2.35, profile: "quadruped" });
        const neutral = showdownMeleeContact(0, 5, 0, -5, attacker, defender, 1);
        const committed = showdownMeleeContact(0, 5, 0, -5, attacker, defender, 1.48);
        assert.ok(committed.travel < neutral.travel);
        assert.ok(committed.gap > neutral.gap);
        assert.ok(committed.impactZ < committed.z - attacker);
        assert.ok(committed.impactZ > -5 + defender);
});

test("Pet Showdown gives heavy pets less root recoil than airborne pets", () => {
        assert.ok(showdownReactionRecoil(1.1, "heavy", 170) < showdownReactionRecoil(1.1, "avian", 170));
});

test("Pet Showdown selects stable per-pet takes", () => {
        assert.equal(showdownPerformanceVariant("red-fox"), showdownPerformanceVariant("red-fox"));
        assert.ok([0, 1, 2].includes(showdownPerformanceVariant("moon-serpent")));
});

test("Pet Showdown reserves the strongest lens and timing response for a finisher", () => {
        const normal = showdownCinematicImpulse({ damageFraction: 0.12, superMove: false, killingBlow: false, lightning: false });
        const finisher = showdownCinematicImpulse({ damageFraction: 0.5, superMove: true, killingBlow: true, lightning: false });
        assert.ok(finisher.lensDegrees > normal.lensDegrees);
        assert.ok(finisher.hitStopMs > normal.hitStopMs);
        assert.ok(finisher.slowScale < normal.slowScale);
});
