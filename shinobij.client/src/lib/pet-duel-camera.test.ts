import assert from "node:assert/strict";
import test from "node:test";
import { duelCameraComposition } from "./pet-duel-camera";

test("duelCameraComposition preserves the authored desktop lens", () => {
    const shot = duelCameraComposition(16 / 9);
    assert.equal(shot.fov, 38);
    assert.equal(shot.pullBack, 0);
    assert.equal(shot.elevation, 0);
    assert.equal(shot.cinematicScale, 1);
});

test("duelCameraComposition keeps portrait fighters large without cropping", () => {
    const shot = duelCameraComposition(390 / 844);
    assert.ok(shot.fov >= 58 && shot.fov <= 59.1, `portrait FOV is controlled (${shot.fov})`);
    assert.ok(shot.pullBack >= 5 && shot.pullBack <= 5.21, `portrait pullback is capped (${shot.pullBack})`);
    assert.ok(shot.elevation <= 0.81, `portrait does not become a roof shot (${shot.elevation})`);
    assert.ok(shot.cinematicScale >= 0.5 && shot.cinematicScale <= 0.51);
});

test("duelCameraComposition is continuous and finite across device shapes", () => {
    const aspects = [0, 0.46, 0.6, 0.79, 0.8, 1, 1.2, 1.78, Number.NaN];
    for (const aspect of aspects) {
        const shot = duelCameraComposition(aspect);
        for (const value of Object.values(shot)) assert.ok(Number.isFinite(value));
    }
    assert.ok(duelCameraComposition(0.6).pullBack < duelCameraComposition(0.46).pullBack);
    assert.ok(duelCameraComposition(0.79).pullBack < duelCameraComposition(0.6).pullBack);
});
