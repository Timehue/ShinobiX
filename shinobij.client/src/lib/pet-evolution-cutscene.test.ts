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
    evolutionSpin,
    morphProgress,
    whiteness,
    tubeIntensity,
    tubeRise,
    tunnelIntensity,
    burstIntensity,
    morphScale,
    evolutionStageMotion,
} from "./pet-evolution-cutscene";

const TAU = Math.PI * 2;

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
    assert.equal(evolutionPhaseAt(1200).beat, "spinup");
    assert.equal(evolutionPhaseAt(2600).beat, "morph");
    assert.equal(evolutionPhaseAt(4600).beat, "slowdown");
    assert.equal(evolutionPhaseAt(6000).beat, "burst");
    assert.equal(evolutionPhaseAt(6500).beat, "reveal");
    assert.equal(evolutionPhaseAt(7400).beat, "settle");
});

test("progress clamps outside the timeline; settle is the terminal state", () => {
    const before = evolutionPhaseAt(-500);
    assert.equal(before.beat, "charge");
    assert.equal(before.elapsedMs, 0);

    const after = evolutionPhaseAt(EVOLUTION_TOTAL_MS + 5000);
    assert.equal(after.beat, "settle");
    assert.equal(after.done, true);
    assert.equal(after.progress, 1);
});

test("old pet whites out, evolved pet spins white in the tube, then reveals", () => {
    for (const beat of ["charge", "spinup"] as const) {
        assert.equal(isOldFormVisible(beat), true);
        assert.equal(isNewFormVisible(beat), false);
    }
    assert.equal(isOldFormVisible("morph"), true);
    assert.equal(isNewFormVisible("morph"), true);
    for (const beat of ["slowdown", "burst"] as const) {
        assert.equal(isOldFormVisible(beat), false);
        assert.equal(isNewFormVisible(beat), true);
    }
    for (const beat of ["reveal", "settle"] as const) {
        assert.equal(isNewFormVisible(beat), true);
        assert.equal(isOldFormVisible(beat), false);
    }
    assert.equal(showOldName("morph"), true);
    assert.equal(showOldName("slowdown"), false);
    // new name held back until the boom reveal
    assert.equal(showNewName("slowdown"), false);
    assert.equal(showNewName("burst"), false);
    assert.equal(showNewName("reveal"), true);
    assert.equal(showNewName("settle"), true);
});

test("evolutionSpin: starts at 0, accelerates, lands on whole turns at SPIN_END, then holds front", () => {
    assert.equal(evolutionSpin(evolutionPhaseAt(0)), 0);
    const a = evolutionSpin(evolutionPhaseAt(1000));
    const b = evolutionSpin(evolutionPhaseAt(3000));
    const c = evolutionSpin(evolutionPhaseAt(5000));
    assert.ok(a < b && b < c, "monotonically increasing through the spin window");
    // lands on a whole number of turns (front-facing) at the end of the slowdown
    const landed = evolutionSpin(evolutionPhaseAt(6000));
    assert.ok(Math.abs(landed - 6 * TAU) < 1e-9, "exactly 6 full turns at SPIN_END");
    // held there afterward (reveal/settle face front)
    assert.equal(evolutionSpin(evolutionPhaseAt(7000)), 6 * TAU);
    assert.equal(evolutionSpin(evolutionPhaseAt(8700)), 6 * TAU);
    // a whole number of turns is front-facing
    assert.ok(Math.abs(((6 * TAU) % TAU)) < 1e-9, "6 turns ≡ 0° (front)");
});

test("morph progress hands off old-white to evolved-white inside the tube", () => {
    assert.equal(morphProgress(evolutionPhaseAt(2000)), 0); // spinup
    const midMorph = morphProgress(evolutionPhaseAt(3600)); // ~mid morph
    assert.ok(midMorph > 0.2 && midMorph < 0.8);
    assert.equal(morphProgress(evolutionPhaseAt(5000)), 1); // slowdown: evolved silhouette owns tube
    assert.equal(morphProgress(evolutionPhaseAt(6950)), 1); // reveal
    assert.equal(morphProgress(evolutionPhaseAt(8000)), 1); // settle
});

test("whiteness: colour→white over the first half of charge, white through burst, colour by settle", () => {
    assert.ok(whiteness(evolutionPhaseAt(150)) < 0.5, "still mostly colour at the very start");
    assert.equal(whiteness(evolutionPhaseAt(600)), 1, "fully white by half-charge (before it turns edge-on)");
    assert.equal(whiteness(evolutionPhaseAt(2000)), 1); // spinup
    assert.equal(whiteness(evolutionPhaseAt(5000)), 1); // slowdown
    assert.equal(whiteness(evolutionPhaseAt(6200)), 1); // burst
    const rev = whiteness(evolutionPhaseAt(6950)); // ~mid reveal
    assert.ok(rev > 0.1 && rev < 0.9, "colour floods in across the reveal");
    assert.equal(whiteness(evolutionPhaseAt(8000)), 0); // settle: full colour
});

test("tube of light waits until after the opening glow, then holds and goes down on reveal", () => {
    for (const t of [0, 600, 1800, 3600, 5000, 6200, 6950, 8000]) {
        const v = tubeIntensity(evolutionPhaseAt(t));
        assert.ok(v >= 0 && v <= 1, `tube in range at ${t}`);
    }
    assert.equal(tubeIntensity(evolutionPhaseAt(0)), 0, "no tube at the start");
    assert.equal(tubeIntensity(evolutionPhaseAt(600)), 0, "no tube during the opening glow");
    assert.ok(tubeIntensity(evolutionPhaseAt(1800)) > 0.6, "rises during spin-up");
    assert.equal(tubeIntensity(evolutionPhaseAt(3600)), 1); // morph: fully up
    assert.equal(tubeIntensity(evolutionPhaseAt(5000)), 1); // slowdown: still up
    assert.ok(tubeIntensity(evolutionPhaseAt(6510)) > 0, "tube is dropping during reveal");
    assert.equal(tubeIntensity(evolutionPhaseAt(7400)), 0); // settle: gone
    assert.equal(tubeRise(evolutionPhaseAt(600)), 0, "tube has not risen during charge");
    assert.ok(tubeRise(evolutionPhaseAt(2599)) > 0.9);
    assert.equal(tubeRise(evolutionPhaseAt(3600)), 1);
    assert.ok(tubeRise(evolutionPhaseAt(6950)) < 1, "tube goes down during reveal");
});

test("tunnel intensity stays in [0,1], peaks in the slowdown, clean by the settle", () => {
    for (const t of [0, 600, 2000, 3600, 5000, 6200, 6950, 8000]) {
        const v = tunnelIntensity(evolutionPhaseAt(t));
        assert.ok(v >= 0 && v <= 1, `tunnel in range at ${t}`);
    }
    assert.equal(tunnelIntensity(evolutionPhaseAt(5000)), 1); // slowdown peak
    assert.equal(tunnelIntensity(evolutionPhaseAt(8000)), 0); // settle: clean
});

test("burst flash is the BOOM: 0 before, peaks in burst, gone by settle", () => {
    assert.equal(burstIntensity(evolutionPhaseAt(5000)), 0); // slowdown, no flash yet
    assert.ok(burstIntensity(evolutionPhaseAt(6300)) > 0.5); // mid-burst
    assert.equal(burstIntensity(evolutionPhaseAt(8000)), 0); // settle, faded
});

test("scale grows through the spin then pops on the reveal back to 1", () => {
    assert.equal(morphScale(evolutionPhaseAt(600)), 1);          // charge: rest
    assert.ok(morphScale(evolutionPhaseAt(4599)) > 1.1);         // end of morph: grown
    assert.ok(Math.abs(morphScale(evolutionPhaseAt(5000)) - 1.12) < 1e-9); // slowdown holds
    assert.ok(morphScale(evolutionPhaseAt(6510)) > 1.12);        // reveal: boom pop bigger
    assert.equal(morphScale(evolutionPhaseAt(8000)), 1);         // settle: 1
});

test("2.5D stage motion swaps from old-white to evolved-white before color reveal", () => {
    const chargeOld = evolutionStageMotion(evolutionPhaseAt(600), false);
    const chargeNew = evolutionStageMotion(evolutionPhaseAt(600), true);
    assert.equal(chargeOld.opacity, 1);
    assert.equal(chargeOld.pose, "cast");
    assert.equal(chargeNew.opacity, 0);

    const morphOld = evolutionStageMotion(evolutionPhaseAt(3600), false);
    const morphNew = evolutionStageMotion(evolutionPhaseAt(3600), true);
    assert.ok(morphOld.opacity > 0 && morphOld.opacity < 1);
    assert.ok(morphNew.opacity > 0 && morphNew.opacity < 1);
    assert.ok(Math.abs(morphOld.opacity + morphNew.opacity - 1) < 1e-9);

    const slowdownOld = evolutionStageMotion(evolutionPhaseAt(5000), false);
    const slowdownNew = evolutionStageMotion(evolutionPhaseAt(5000), true);
    assert.equal(slowdownOld.opacity, 0);
    assert.equal(slowdownNew.opacity, 1);
    assert.equal(slowdownNew.flash, 1);
    assert.ok(slowdownNew.spinDeg > 0);

    assert.equal(evolutionStageMotion(evolutionPhaseAt(6200), true).opacity, 1);
    assert.ok(evolutionStageMotion(evolutionPhaseAt(6950), true).opacity > 0);
});

test("2.5D stage uses a full energy spin, then lands front-facing for reveal", () => {
    const spinup = evolutionStageMotion(evolutionPhaseAt(1800), false);
    const morph = evolutionStageMotion(evolutionPhaseAt(3600), false);
    const slowdown = evolutionStageMotion(evolutionPhaseAt(5900), true);
    assert.ok(spinup.spinDeg > 180, "old form is already in a full-circle energy spin during spinup");
    assert.ok(morph.spinDeg > spinup.spinDeg, "spin continues through the morph");
    assert.ok(slowdown.spinDeg > 2700, "new form carries a faster multi-turn spin through slowdown");
    assert.equal(evolutionStageMotion(evolutionPhaseAt(6200), true).spinDeg, 0);
    assert.equal(evolutionStageMotion(evolutionPhaseAt(8000), true).spinDeg, 0);
});
