import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coach = readFileSync(new URL("./OnboardingCoach.tsx", import.meta.url), "utf8");
const companionRenderer = readFileSync(
    new URL("../features/intro-cinematic/IntroCompanion3D.tsx", import.meta.url),
    "utf8",
);

test("the Academy coach keeps the companion's full body inside its small canvas", () => {
    const tutorialModel = coach.match(/<IntroCompanion3D[\s\S]*?\/>/)?.[0] ?? "";

    assert.doesNotMatch(tutorialModel, /\bhero\b/);
    assert.doesNotMatch(tutorialModel, /\bcloseUp\b/);
    assert.match(companionRenderer, /key=\{closeUp \? "close-up" : "full-body"\}/);
});
