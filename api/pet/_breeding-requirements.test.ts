import { test } from "node:test";
import assert from "node:assert/strict";
import { petBreedingRequirementsComplete, recordPetBreedingProgress, settlePetBreedingSession } from "./_breeding-requirements.js";
import { PET_EGG_GAMEPLAY_MS } from "../../shared/pet-incubation.js";
const base = { sessionId: "breed-1", state: "breeding" as const, parentIds: ["p1", "p2"] as [string, string], parentNames: ["One", "Two"] as [string, string], parentElement: "Fire", startedAt: 0, readyAt: 100, rulesVersion: 1 };
test("legacy pairings keep their promised wait and enter Sanctuary incubation without rerolling", () => {
    assert.equal(settlePetBreedingSession({ petBreeding: base }, 99).changed, false);
    const settled = settlePetBreedingSession({ petBreeding: base }, 100);
    const egg = settled.character.petBreeding as { state: string; sessionId: string; location: string; incubationRemainingMs: number; requirements?: unknown };
    assert.equal(egg.state, "egg"); assert.equal(egg.sessionId, base.sessionId);
    assert.equal(egg.location, "sanctuary"); assert.equal(egg.incubationRemainingMs, PET_EGG_GAMEPLAY_MS);
    assert.equal(egg.requirements, undefined);
    assert.equal(settlePetBreedingSession(settled.character, 1000000).changed, false);
});
test("mission, petting and feeding receipts cannot replace gameplay incubation", () => {
    const character = settlePetBreedingSession({ petBreeding: base }, 100).character;
    for (const kind of ["mission-complete", "feed", "pet-interaction"] as const) {
        const progress = recordPetBreedingProgress(character, { kind, amount: 100, petElement: "Fire", receipt: kind }, 101);
        assert.equal(progress.changed, false);
        assert.equal(petBreedingRequirementsComplete(progress.character.petBreeding as never), false);
    }
    assert.equal(petBreedingRequirementsComplete({ ...base, state: "egg", incubationRemainingMs: 0 }), true);
});
