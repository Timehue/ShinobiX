import { test } from "node:test";
import assert from "node:assert/strict";
import {
    EVOLUTION_BEATS,
    EVOLUTION_TOTAL_MS,
    evolutionPhaseAt,
    isOldFormVisible,
    isNewFormVisible,
    showOldName,
    showNewName,
    turntableRotation,
    burstIntensity,
} from "./pet-evolution-cutscene";

test("beats are contiguous and sum to the total duration", () => {
    let cursor = 0;
    for (const spec of EVOLUTION_BEATS) {
        assert.equal(spec.startMs, cursor, `${spec.beat} should start where the previous ended`);
        assert.ok(spec.durationMs > 0, `${spec.beat} has positive duration`);
        cursor += spec.durationMs;
    }
    assert.equal(cursor, EVOLUTION_TOTAL_MS);
});

test("evolutionPhaseAt resolves the right beat at boundaries", () => {
    assert.equal(evolutionPhaseAt(0).beat, "charge");
    assert.equal(evolutionPhaseAt(1199).beat, "charge");
    assert.equal(evolutionPhaseAt(1200).beat, "ascend");
    assert.equal(evolutionPhaseAt(2200).beat, "tube");
    assert.equal(evolutionPhaseAt(3400).beat, "burst");
    assert.equal(evolutionPhaseAt(3800).beat, "reveal");
    assert.equal(evolutionPhaseAt(4200).beat, "turntable");
    assert.equal(evolutionPhaseAt(6500).beat, "settle");
});

test("progress is 0..1 within a beat and clamps outside the timeline", () => {
    const mid = evolutionPhaseAt(600); // halfway through charge (0..1200)
    assert.equal(mid.beat, "charge");
    assert.ok(Math.abs(mid.progress - 0.5) < 1e-9);
    assert.equal(mid.done, false);

    const before = evolutionPhaseAt(-500);
    assert.equal(before.beat, "charge");
    assert.equal(before.elapsedMs, 0);

    const after = evolutionPhaseAt(EVOLUTION_TOTAL_MS + 5000);
    assert.equal(after.beat, "settle");
    assert.equal(after.done, true);
    assert.equal(after.progress, 1);
});

test("old form shows through the tube; new form from the reveal onward (no overlap)", () => {
    for (const beat of ["charge", "ascend", "tube"] as const) {
        assert.equal(isOldFormVisible(beat), true);
        assert.equal(isNewFormVisible(beat), false);
        assert.equal(showOldName(beat), true);
        assert.equal(showNewName(beat), false);
    }
    for (const beat of ["reveal", "turntable", "settle"] as const) {
        assert.equal(isNewFormVisible(beat), true);
        assert.equal(isOldFormVisible(beat), false);
        assert.equal(showNewName(beat), true);
        assert.equal(showOldName(beat), false);
    }
    // The burst is the hand-off: neither form is "shown" during the flash.
    assert.equal(isOldFormVisible("burst"), false);
    assert.equal(isNewFormVisible("burst"), false);
});

test("turntable completes a full circle across its beat", () => {
    assert.equal(turntableRotation(evolutionPhaseAt(2000)), 0); // before turntable
    const start = turntableRotation(evolutionPhaseAt(4200));
    const end = turntableRotation(evolutionPhaseAt(6499));
    assert.ok(start < 0.01, "starts near 0");
    assert.ok(Math.abs(end - Math.PI * 2) < 0.05, "reaches ~360°");
    // Settle keeps it past a full turn (resting hero angle), never snapping back.
    assert.ok(turntableRotation(evolutionPhaseAt(7000)) >= Math.PI * 2);
});

test("burst flash peaks during the burst and is gone before the turntable", () => {
    assert.equal(burstIntensity(evolutionPhaseAt(3000)), 0); // tube, no flash yet
    assert.ok(burstIntensity(evolutionPhaseAt(3550)) > 0.5);  // mid-burst
    assert.equal(burstIntensity(evolutionPhaseAt(4200)), 0);  // turntable, faded
});
