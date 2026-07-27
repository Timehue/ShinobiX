import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompanionJourney, companionStepMeta } from "./journey-guide";

describe("Academy journey presentation", () => {
    it("groups all nine real coach beats into three phases", () => {
        const journey = buildCompanionJourney({ onboardingStep: "training" });
        assert.equal(journey?.steps.length, 9);
        assert.deepEqual(journey?.phases.map((phase) => phase.title), [
            "Prepare",
            "Prove Yourself",
            "Find Direction",
        ]);
        assert.equal(journey?.current.title, "Start your first stat training");
        assert.equal(journey?.current.phase.title, "Prepare");
    });

    it("marks only one immediate future action as up next", () => {
        const journey = buildCompanionJourney({ onboardingStep: "jutsuLoadout" });
        assert.equal(journey?.steps.filter((step) => step.state === "now").length, 1);
        assert.equal(journey?.steps.filter((step) => step.state === "upNext").length, 1);
        assert.equal(journey?.steps.find((step) => step.state === "upNext")?.id, "inventory");
        assert.equal(journey?.steps.find((step) => step.id === "academySpar")?.state, "later");
    });

    it("shares phase, progress, and next-step metadata with the speech bubble", () => {
        const meta = companionStepMeta("firstMission");
        assert.equal(meta?.current.phase.title, "Prove Yourself");
        assert.equal(meta?.current.index, 7);
        assert.equal(meta?.completedCount, 6);
        assert.equal(meta?.upNext?.id, "logbook");
    });

    it("does not create a roadmap for cinematic, completed, or legacy steps", () => {
        assert.equal(buildCompanionJourney({ onboardingStep: "academyIntro" }), null);
        assert.equal(buildCompanionJourney({ onboardingStep: "companionIntro" }), null);
        assert.equal(buildCompanionJourney({ onboardingStep: "done" }), null);
        assert.equal(buildCompanionJourney({ onboardingStep: undefined }), null);
    });
});
