import { test } from "node:test";
import assert from "node:assert/strict";
import { DUEL_TPS, KIND_ACCURACY, elementMult, terrainPetMult } from "./pet-duel-sim";
import { petMoveAccuracy } from "./pet-moves";

/*
 * Coverage for the shared duel contract (pet-duel-sim.ts). The legacy engine
 * that used to live in that module, and the 26 tests that exercised it, were
 * retired on 2026-10-02. What stays is read by the live cinematic engine and
 * its generated server mirror, so these pins guard balance numbers that decide
 * real coliseum and Warfront fights.
 */

test("accuracy: KIND_ACCURACY mirrors pet-moves KIND_SPECS (no drift between the inlined copy and the source)", () => {
    for (const kind of Object.keys(KIND_ACCURACY) as Array<keyof typeof KIND_ACCURACY>) {
        assert.equal(KIND_ACCURACY[kind], petMoveAccuracy(kind), `accuracy drift for kind "${kind}"`);
    }
});

test("the duel clock runs at 30 ticks per second", () => {
    assert.equal(DUEL_TPS, 30);
});

test("element chart: Fire > Wind > Lightning > Earth > Water > Fire, ±15%", () => {
    const cycle = ["Fire", "Wind", "Lightning", "Earth", "Water"];
    cycle.forEach((attacker, index) => {
        const beaten = cycle[(index + 1) % cycle.length];
        assert.equal(elementMult(attacker, beaten), 1.15, `${attacker} should beat ${beaten}`);
        assert.equal(elementMult(beaten, attacker), 0.85, `${beaten} should be resisted by ${attacker}`);
    });
    // Off-cycle pairs, mirrors, "None" and missing elements are all neutral.
    assert.equal(elementMult("Fire", "Earth"), 1);
    assert.equal(elementMult("Water", "Water"), 1);
    assert.equal(elementMult("None", "Wind"), 1);
    assert.equal(elementMult("Fire", null), 1);
    assert.equal(elementMult(undefined, "Fire"), 1);
});

test("terrain home-ground bonus: +10% only for the sector's own element", () => {
    assert.equal(terrainPetMult("volcano", "Fire"), 1.1);
    assert.equal(terrainPetMult("snow", "Water"), 1.1);
    assert.equal(terrainPetMult("forest", "Earth"), 1.1);
    assert.equal(terrainPetMult("shadow", "Lightning"), 1.1);
    assert.equal(terrainPetMult("volcano", "Water"), 1);
    assert.equal(terrainPetMult("central", "Fire"), 1);
    assert.equal(terrainPetMult(null, "Fire"), 1);
    assert.equal(terrainPetMult("volcano", null), 1);
});
