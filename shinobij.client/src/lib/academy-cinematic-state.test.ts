import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character } from "../types/character";
import { preserveAcademyCinematicState } from "./academy-cinematic-state";

const server = { name: "Rookie", onboardingStep: "companionIntro", ryo: 100, hp: 80, pets: [], activePetId: undefined } as unknown as Character;
const local = { ...server, onboardingStep: "training", academyVow: "unbound", ryo: 999, hp: 999, pets: [{ id: "optimistic" }], activePetId: "optimistic" } as Character;

test("a conflict refresh retains the completed cinematic but takes entitlements and vitals from the server", () => {
    const merged = preserveAcademyCinematicState(server, local);
    assert.equal(merged.onboardingStep, "training");
    assert.equal(merged.academyVow, "unbound");
    assert.equal(merged.ryo, 100);
    assert.equal(merged.hp, 80);
    assert.equal(merged.pets, server.pets);
    assert.equal(merged.activePetId, undefined);
    assert.equal(server.onboardingStep, "companionIntro", "the authoritative snapshot remains available for dirty comparison");
});

test("a pre-grant refresh preserves the handoff while the owned starter is still in flight", () => {
    const merged = preserveAcademyCinematicState({ ...server, onboardingStep: "academyIntro" }, local);
    assert.equal(merged.onboardingStep, "training");
    assert.equal(merged.pets.length, 0, "the pending grant does not mint an optimistic pet");
});

test("an acknowledged handoff keeps the original reference so clean loads do not trigger autosaves", () => {
    const acknowledged = { ...server, onboardingStep: "training", academyVow: "unbound" } as Character;
    assert.equal(preserveAcademyCinematicState(acknowledged, local), acknowledged);
});

test("cinematic reconciliation never crosses accounts or later server-backed milestones", () => {
    assert.equal(preserveAcademyCinematicState(server, null), server);
    assert.equal(preserveAcademyCinematicState(server, { ...local, name: "Other" }), server);
    for (const onboardingStep of [undefined, "jutsu", "academySpar", "done"] as const) {
        const authoritative = { ...server, onboardingStep };
        assert.equal(preserveAcademyCinematicState(authoritative, local), authoritative);
        assert.equal(preserveAcademyCinematicState(server, { ...local, onboardingStep }), server);
    }
    assert.equal(preserveAcademyCinematicState(server, { ...local, onboardingStep: "academyIntro" }), server);
});

test("same-step vow edits survive a mutation while invalid values are ignored", () => {
    const authoritative = { ...server, academyVow: "guardian" } as Character;
    assert.equal(preserveAcademyCinematicState(authoritative, { ...authoritative, academyVow: "seeker" }).academyVow, "seeker");
    assert.equal(preserveAcademyCinematicState(authoritative, { ...authoritative, academyVow: "invalid" as Character["academyVow"] }), authoritative);
});
