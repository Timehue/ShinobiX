import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAcademyHandoff } from "./academy-handoff";

const completedAcademy = {
    academyChecklistClaimed: false,
    academySectorVisited: true,
    academyTrialClaimed: true,
    element: "",
    elements: [],
    level: 2,
    onboardingStep: "done" as const,
};

describe("Academy handoff", () => {
    it("recommends the free awakening before presenting the open-world choice", () => {
        const handoff = buildAcademyHandoff(completedAcademy);
        assert.equal(handoff?.id, "academy-handoff-awakening");
        assert.equal(handoff?.primary.screen, "centralHub");
        assert.equal(handoff?.primary.label, "Visit the Awakening Stone");
        assert.equal(handoff?.primary.intent, "openAwakening");
        assert.equal(handoff?.secondary.screen, "missions");
    });

    it("offers mission or story after an element is owned", () => {
        const handoff = buildAcademyHandoff({ ...completedAcademy, element: "Fire", elements: ["Fire"] });
        assert.equal(handoff?.id, "academy-handoff-choice");
        assert.equal(handoff?.primary.screen, "missions");
        assert.equal(handoff?.secondary.screen, "storyHall");
    });

    it("does not appear for skipped, unfinished, rewarded, or veteran Academy paths", () => {
        assert.equal(buildAcademyHandoff({ ...completedAcademy, academyTrialClaimed: false }), null);
        assert.equal(buildAcademyHandoff({ ...completedAcademy, academySectorVisited: false }), null);
        assert.equal(buildAcademyHandoff({ ...completedAcademy, academyChecklistClaimed: true }), null);
        assert.equal(buildAcademyHandoff({ ...completedAcademy, level: 15 }), null);
        assert.equal(buildAcademyHandoff({ ...completedAcademy, onboardingStep: "sectorReturn" }), null);
    });
});
