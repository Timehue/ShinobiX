import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character } from "../types/character";
import { abandonStarterPet, completeStarterPetCommit, finishStarterPetHandoff, resumedStarterStep } from "./starter-pet-commit";

const current = { name: "Rookie", onboardingStep: "training", academyVow: "unbound", pets: [{ id: "starter-fire", name: "Optimistic" }], activePetId: "starter-fire" } as Character;
const server = { ...current, onboardingStep: "companionIntro", pets: [{ ...current.pets[0], name: "Canonical" }] } as Character;

test("a superseded grant still permits the handoff without accepting an older character", () => {
    let offered: Character | undefined;
    const offeredVersions: unknown[] = [];
    const completed = completeStarterPetCommit(current, { character: server, _saveVersion: 5 }, "starter-fire", {
        activeAccountKey: "rookie", latestVersion: 6,
        commitCharacter: (character, version) => {
            offered = character;
            offeredVersions.push(version);
            return version === 6;
        },
    });
    assert.equal(completed, true);
    assert.deepEqual(offeredVersions, [5, 6]);
    assert.equal(offered?.onboardingStep, "training");
    assert.equal(offered?.academyVow, "unbound");
    assert.equal(offered?.pets[0].name, "Canonical", "the newer save keeps the server-rolled starter");
    assert.equal(current.pets[0].name, "Optimistic", "no rejected character was installed or mutated");
});

test("an accepted receipt reconciles the owned pet while preserving the newer handoff", () => {
    let installed: Character | undefined;
    assert.equal(completeStarterPetCommit(current, { character: server, _saveVersion: 7 }, "starter-fire", {
        activeAccountKey: "rookie", latestVersion: 6, commitCharacter: character => { installed = character; return true; },
    }), true);
    assert.equal(installed?.pets[0].name, "Canonical");
    assert.equal(installed?.onboardingStep, "training");
    assert.equal(installed?.academyVow, "unbound");
});

test("a pre-grant conflict refresh cannot leave the committed starter inactive", () => {
    let installed: Character | undefined;
    const refreshed = { ...current, pets: [], activePetId: undefined };
    assert.equal(completeStarterPetCommit(refreshed, { character: server, _saveVersion: 7 }, "starter-fire", {
        activeAccountKey: "rookie", latestVersion: 6, commitCharacter: character => { installed = character; return true; },
    }), true);
    assert.equal(installed?.pets[0].name, "Canonical");
    assert.equal(installed?.activePetId, "starter-fire");
    assert.equal(installed?.onboardingStep, "training");
});

test("account switches, foreign receipts and missing grants never continue the handoff", () => {
    const authority = { activeAccountKey: "rookie", latestVersion: 6, commitCharacter: () => assert.fail("must not offer a foreign or absent grant") };
    assert.equal(completeStarterPetCommit(current, { character: server, _saveVersion: 5 }, "starter-fire", { ...authority, activeAccountKey: "other" }), false);
    assert.equal(completeStarterPetCommit(current, { character: { ...server, name: "Other" }, _saveVersion: 5 }, "starter-fire", authority), false);
    assert.equal(completeStarterPetCommit(current, {}, "starter-fire", authority), false);
    assert.equal(completeStarterPetCommit(current, { character: { ...server, pets: [] }, _saveVersion: 5 }, "starter-fire", authority), false);
});

test("a reload after an early commit resumes at the companion beat, not the picker", () => {
    const pets = current.pets;
    assert.equal(resumedStarterStep({ onboardingStep: "academyIntro", pets }), "companionIntro");
    assert.equal(resumedStarterStep({ onboardingStep: "starter", pets }), "companionIntro");
    assert.equal(resumedStarterStep({ onboardingStep: "academyIntro", pets: [] }), null, "no starter owned: the picker is still needed");
    for (const onboardingStep of ["companionIntro", "training", "done", undefined] as const) {
        assert.equal(resumedStarterStep({ onboardingStep, pets }), null);
    }
});

test("an abandoned commit reopens the picker only on the same account", () => {
    const abandoned = abandonStarterPet({ ...current, pets: [], activePetId: undefined, onboardingStep: "companionIntro" }, "Rookie");
    assert.deepEqual(abandoned?.pets, []);
    assert.equal(abandoned?.activePetId, undefined);
    assert.equal(abandoned?.onboardingStep, "academyIntro");
    assert.equal(abandonStarterPet(current, "Other"), current);
    assert.equal(abandonStarterPet(current, "Rookie"), current, "a late failure cannot remove an owned pet");
    assert.equal(abandonStarterPet(null, "Rookie"), null);
});

test("a committed A with a lost reply followed by choice B completes with only canonical A", () => {
    const chosenB = "starter-water";
    let installed = { ...current, onboardingStep: "academyIntro", pets: [], activePetId: undefined } as Character;
    // A was committed on the server, but its acknowledgement never arrived.
    installed = abandonStarterPet(installed, "Rookie")!;
    assert.equal(finishStarterPetHandoff(installed, "Rookie", chosenB, "unbound"), installed);
    const authority = { activeAccountKey: "rookie", latestVersion: 7,
        commitCharacter: (next: Character) => { installed = next; return true; } };
    assert.equal(completeStarterPetCommit(installed, { character: server, _saveVersion: 7 }, chosenB, authority), true);
    assert.deepEqual(installed.pets.map(pet => pet.id), ["starter-fire"]);
    assert.equal(finishStarterPetHandoff(installed, "Rookie", chosenB, "unbound"), installed, "a stale B callback cannot add B");
    installed = finishStarterPetHandoff(installed, "Rookie", "starter-fire", "unbound")!;
    assert.equal(installed.onboardingStep, "companionIntro");
    assert.equal(installed.activePetId, "starter-fire");
    // An idempotent receipt can arrive after an authoritative refresh already installed A.
    assert.equal(completeStarterPetCommit(installed, { character: server, _saveVersion: 7 }, chosenB, authority), true);
    assert.deepEqual(installed.pets, server.pets, "canonical ownership is not duplicated");
});

test("late completion cannot advance pending ownership, another account, or finished onboarding", () => {
    for (const candidate of [
        { ...current, onboardingStep: "academyIntro", pets: [] },
        { ...current, name: "Other", onboardingStep: "academyIntro" },
        { ...current, onboardingStep: "training" },
        { ...current, onboardingStep: "done" },
    ] as Character[]) assert.equal(finishStarterPetHandoff(candidate, "Rookie", "starter-fire", "unbound"), candidate);
});

test("a rejected receipt needs a valid, strictly superseded version", () => {
    for (const version of [undefined, 0, -1, 5.5, NaN, 6, 7]) {
        assert.equal(completeStarterPetCommit(current, { character: server, _saveVersion: version }, "starter-fire", {
            activeAccountKey: "rookie", latestVersion: 6, commitCharacter: () => false,
        }), false, `rejected version ${version} is not evidence of a superseded grant`);
    }
});
