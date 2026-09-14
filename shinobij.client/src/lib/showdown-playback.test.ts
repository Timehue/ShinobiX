import assert from "node:assert/strict";
import test from "node:test";
import { showdownBeatProgress, showdownImpactClock } from "./showdown-playback";
import { showdownAttackRhythm, showdownCinematicImpulse, showdownMeleeDrive } from "./pet-showdown-choreography";

test("a beat starts at home, reaches scheduled contact, and ends at home at either playback speed", () => {
    for (const speed of [1, 2]) for (const weight of ["light", "normal", "heavy"] as const) for (const superMove of [false, true]) {
        const rhythm = showdownAttackRhythm({ weight, superMove, delivery: "melee" });
        const durationMs = (superMove ? 6400 : weight === "heavy" ? 4100 : 2700) / speed;
        const startedAt = 10000;
        const at = startedAt + durationMs * rhythm.contact;
        const cinematic = showdownCinematicImpulse({ damageFraction: 0.5, superMove, killingBlow: true, lightning: true });
        const beat = { startedAt, durationMs, impact: showdownImpactClock({ startedAt, durationMs }, at, rhythm.contact, cinematic) };
        assert.equal(showdownBeatProgress(beat, startedAt - 1), 0);
        assert.ok(Math.abs(showdownBeatProgress(beat, at) - rhythm.contact) < 1e-10);
        assert.equal(showdownMeleeDrive(showdownBeatProgress(beat, at), rhythm), 1);
        assert.equal(showdownMeleeDrive(showdownBeatProgress(beat, beat.impact.hitStopUntil), rhythm), 1);
        let previous = 0;
        for (let ms = 0; ms <= durationMs; ms += 5) {
            const progress = showdownBeatProgress(beat, startedAt + ms);
            assert.ok(progress >= previous && progress <= 1, `clock must advance monotonically: ${weight}/${speed}`);
            previous = progress;
        }
        assert.equal(showdownBeatProgress(beat, startedAt + durationMs), 1);
        assert.equal(showdownMeleeDrive(showdownBeatProgress(beat, startedAt + durationMs - 1), rhythm), 0);
    }
});

test("misses and subsequent actions have no inherited hit-stop or frame-rate drift", () => {
    const beat = { startedAt: 1000, durationMs: 2700 };
    assert.equal(showdownBeatProgress(beat, 2350), 0.5);
    assert.equal(showdownBeatProgress(beat, 3700), 1);
    // Sampling out of order models independently mounted body and VFX consumers.
    assert.equal(showdownBeatProgress(beat, 2350), 0.5);
});
