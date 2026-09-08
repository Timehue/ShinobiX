import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character } from "../types/character";
import { completeStarterPetCommit } from "./starter-pet-commit";

const current = { name: "Rookie", onboardingStep: "training", academyVow: "unbound", pets: [{ id: "starter-fire", name: "Optimistic" }], activePetId: "starter-fire" } as Character;
const server = { ...current, onboardingStep: "companionIntro", pets: [{ ...current.pets[0], name: "Canonical" }] } as Character;

test("a superseded grant still permits the handoff without accepting an older character", () => {
    let offered: Character | undefined;
    const completed = completeStarterPetCommit(current, { character: server, _saveVersion: 5 }, "starter-fire", {
        activeAccountKey: "rookie", latestVersion: 6,
        commitCharacter: (character, version) => { offered = character; assert.equal(version, 5); return false; },
    });
    assert.equal(completed, true);
    assert.equal(offered?.onboardingStep, "training");
    assert.equal(offered?.academyVow, "unbound");
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

test("account switches, foreign receipts and missing grants never continue the handoff", () => {
    const authority = { activeAccountKey: "rookie", latestVersion: 6, commitCharacter: () => assert.fail("must not offer a foreign or absent grant") };
    assert.equal(completeStarterPetCommit(current, { character: server, _saveVersion: 5 }, "starter-fire", { ...authority, activeAccountKey: "other" }), false);
    assert.equal(completeStarterPetCommit(current, { character: { ...server, name: "Other" }, _saveVersion: 5 }, "starter-fire", authority), false);
    assert.equal(completeStarterPetCommit(current, {}, "starter-fire", authority), false);
    assert.equal(completeStarterPetCommit(current, { character: { ...server, pets: [] }, _saveVersion: 5 }, "starter-fire", authority), false);
});

test("a rejected receipt needs a valid, strictly superseded version", () => {
    for (const version of [undefined, 0, -1, 5.5, NaN, 6, 7]) {
        assert.equal(completeStarterPetCommit(current, { character: server, _saveVersion: version }, "starter-fire", {
            activeAccountKey: "rookie", latestVersion: 6, commitCharacter: () => false,
        }), false, `rejected version ${version} is not evidence of a superseded grant`);
    }
});
