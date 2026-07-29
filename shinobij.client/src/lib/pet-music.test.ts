import assert from "node:assert/strict";
import { test } from "node:test";
import { hollowGateMusicMix, standardBattleMusicMix } from "./pet-music";

test("Hollow Gate adaptive mix escalates without overpowering combat SFX", () => {
    const calm = hollowGateMusicMix("calm");
    const pressure = hollowGateMusicMix("pressure");
    const climax = hollowGateMusicMix("climax");
    assert.ok(calm.musicVolume < pressure.musicVolume);
    assert.ok(pressure.musicVolume < climax.musicVolume);
    assert.ok(calm.droneGain < pressure.droneGain);
    assert.ok(pressure.droneGain < climax.droneGain);
    assert.ok(climax.musicVolume < 0.5);
    assert.ok(climax.playbackRate <= 1.05);
});

test("standard Coliseum score builds pressure and climax without racing", () => {
    const calm = standardBattleMusicMix("calm");
    const pressure = standardBattleMusicMix("pressure");
    const climax = standardBattleMusicMix("climax");
    assert.ok(calm.musicVolume < pressure.musicVolume);
    assert.ok(pressure.musicVolume < climax.musicVolume);
    assert.ok(calm.playbackRate < pressure.playbackRate);
    assert.ok(pressure.playbackRate < climax.playbackRate);
    assert.ok(climax.playbackRate < 1.05);
});
