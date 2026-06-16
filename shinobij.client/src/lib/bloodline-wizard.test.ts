/*
 * Bloodline Maker wizard step model — verifies the per-rank step counts
 * (B = details + 4 jutsu + review, A/S = details + 5 jutsu + review), the
 * step-kind classification, jutsu-index mapping, labels, details gating, and
 * the rank-change clamp.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    bloodlineWizardStepCount,
    bloodlineWizardStepKind,
    bloodlineWizardJutsuIndex,
    bloodlineWizardStepLabel,
    canLeaveBloodlineDetails,
    clampBloodlineWizardStep,
} from "./bloodline-wizard";

describe("bloodline wizard step model", () => {
    it("B Rank = details + 4 jutsu + review = 6 steps", () => {
        assert.equal(bloodlineWizardStepCount("B Rank"), 6);
    });

    it("A/S Rank = details + 5 jutsu + review = 7 steps", () => {
        assert.equal(bloodlineWizardStepCount("A Rank"), 7);
        assert.equal(bloodlineWizardStepCount("S Rank"), 7);
    });

    it("classifies step kinds", () => {
        assert.equal(bloodlineWizardStepKind(0, "A Rank"), "details");
        assert.equal(bloodlineWizardStepKind(1, "A Rank"), "jutsu");
        assert.equal(bloodlineWizardStepKind(5, "A Rank"), "jutsu");
        assert.equal(bloodlineWizardStepKind(6, "A Rank"), "review");
        // B Rank has one fewer jutsu step.
        assert.equal(bloodlineWizardStepKind(4, "B Rank"), "jutsu");
        assert.equal(bloodlineWizardStepKind(5, "B Rank"), "review");
    });

    it("maps jutsu steps to indices, -1 for details/review", () => {
        assert.equal(bloodlineWizardJutsuIndex(0, "A Rank"), -1);
        assert.equal(bloodlineWizardJutsuIndex(1, "A Rank"), 0);
        assert.equal(bloodlineWizardJutsuIndex(5, "A Rank"), 4);
        assert.equal(bloodlineWizardJutsuIndex(6, "A Rank"), -1);
    });

    it("labels steps", () => {
        assert.equal(bloodlineWizardStepLabel(0, "B Rank"), "Details");
        assert.equal(bloodlineWizardStepLabel(2, "B Rank"), "Jutsu 2");
        assert.equal(bloodlineWizardStepLabel(5, "B Rank"), "Review");
    });

    it("gates the details step on a non-empty name", () => {
        assert.equal(canLeaveBloodlineDetails("   "), false);
        assert.equal(canLeaveBloodlineDetails(""), false);
        assert.equal(canLeaveBloodlineDetails("Crimson Eye"), true);
    });

    it("clamps step into range (e.g. after a rank downgrade)", () => {
        assert.equal(clampBloodlineWizardStep(-3, "B Rank"), 0);
        assert.equal(clampBloodlineWizardStep(99, "B Rank"), 5);
        // A-Rank review (step 6) clamps to B-Rank review (step 5).
        assert.equal(clampBloodlineWizardStep(6, "B Rank"), 5);
    });
});
