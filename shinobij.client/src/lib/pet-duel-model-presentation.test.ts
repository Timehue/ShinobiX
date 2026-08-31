import assert from "node:assert/strict";
import test from "node:test";
import type { PetCombatModelProfile } from "./pet-3d-models";
import { petDuelModelCalibration } from "./pet-duel-model-presentation";

const profiles: PetCombatModelProfile[] = ["quadruped", "biped", "avian", "serpentine", "heavy"];

test("every combat body profile receives bounded duel framing and grounding", () => {
    for (const profile of profiles) {
        const calibration = petDuelModelCalibration({ visualId: `fixture-${profile}`, profile });
        assert.ok(calibration.modelScale >= 0.9 && calibration.modelScale <= 1.08, `${profile} scale`);
        assert.ok(Math.abs(calibration.groundOffset) <= 0.025, `${profile} remains grounded`);
        assert.ok(calibration.shadowWidth >= 0.8 && calibration.shadowWidth <= 1.25, `${profile} shadow width`);
        assert.ok(calibration.shadowDepth >= 0.35 && calibration.shadowDepth <= 0.65, `${profile} shadow depth`);
        assert.ok(calibration.shadowOpacity >= 0.3 && calibration.shadowOpacity <= 0.5, `${profile} shadow opacity`);
        assert.ok(calibration.labelOffset >= 0.35 && calibration.labelOffset <= 0.7, `${profile} label clearance`);
    }
});

test("long starter bodies use reviewed visual-id exceptions without changing their model config", () => {
    const base = petDuelModelCalibration({ visualId: "fixture", profile: "serpentine" });
    const selkie = petDuelModelCalibration({ visualId: "starter-water-r", profile: "serpentine" });
    assert.ok(selkie.modelScale < base.modelScale);
    assert.ok(selkie.shadowWidth > base.shadowWidth);
});
