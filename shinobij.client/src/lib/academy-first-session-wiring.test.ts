import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const coachSource = readFileSync(new URL("../components/OnboardingCoach.tsx", import.meta.url), "utf8");
const momentsSource = readFileSync(new URL("../components/AcademyStoryMoments.tsx", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("../screens/Profile.tsx", import.meta.url), "utf8");
const centralHubSource = readFileSync(new URL("../screens/CentralHub.tsx", import.meta.url), "utf8");

describe("Academy first-session wiring", () => {
    it("saves the vow selected on the current cinematic run", () => {
        assert.match(appSource, /academyVow:\s*vow,/);
        assert.doesNotMatch(appSource, /academyVow:\s*prev\.academyVow\s*\?\?\s*vow/);
    });

    it("routes all authored interruptions through the tested moment selector", () => {
        assert.match(coachSource, /academyStoryMomentFor\(\{/);
        assert.match(coachSource, /storyMoment === "sparOmen"/);
        assert.match(coachSource, /storyMoment === "fieldTrace"/);
        assert.match(coachSource, /storyMoment === "returnCeremony"/);
    });

    it("persists each beat only after its explicit acknowledgement", () => {
        assert.match(momentsSource, /doneLabel="Keep the vow"[\s\S]*persistMilestone\(props, "incident"\)/);
        assert.match(momentsSource, /doneLabel="Return with the evidence"[\s\S]*persistMilestone\(props, "trace", props\.currentSector\)/);
        assert.match(momentsSource, /saveAction\("seal"\)[\s\S]*Accept the Field Seal/);
        assert.match(momentsSource, /const finish = async \(screen: Screen, intent\?: "openAwakening"\)[\s\S]*saveAction\("complete"\)/);
        assert.match(momentsSource, /buildAcademyHandoff\(\{ \.\.\.props\.character, onboardingStep: "done" \}\)/);
        assert.match(appSource, /onVersionedCharacter=\{commitVersionedCharacter\}/);
        assert.match(coachSource, /commitAcademyNarrativeAction\(character\.name, action, sector\)/);
    });

    it("carries the awakening choice through Central Hub instead of dropping its intent", () => {
        assert.match(momentsSource, /intent === "openAwakening"[\s\S]*props\.onOpenAwakening\(\)/);
        assert.match(appSource, /setAcademyAwakeningRequested\(true\)[\s\S]*setScreen\("centralHub"\)/);
        assert.match(centralHubSource, /useState\(openAwakeningOnMount\)[\s\S]*onAwakeningRequestHandled/);
    });

    it("keeps the earned seal visible after the tutorial overlay is gone", () => {
        assert.match(profileSource, /character\.academyFieldSeal/);
        assert.match(profileSource, /Shiranui&apos;s Field Seal/);
        assert.match(profileSource, /academyTraceSector/);
    });
});
