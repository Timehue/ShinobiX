import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("preserved pet overflow is visible but cannot start new lifecycle rewards", () => {
    const yard = source("shinobij.client/src/screens/PetYard.tsx");
    const barn = source("shinobij.client/src/components/PetBreedingBarn.tsx");
    const sanctuary = source("shinobij.client/src/components/PetSanctuary.tsx");
    const training = source("api/pet/progress.ts");
    const expedition = source("api/missions/expedition-start.ts");
    const breeding = source("api/pet/breeding-start.ts");
    const evolution = source("api/pet/evolve.ts");

    assert.match(yard, /selectedPetIsOverflow[^\n]+Sanctuary before starting new training/);
    assert.match(yard, /selectedPetIsOverflow[^\n]+Sanctuary before starting an expedition/);
    assert.match(yard, /Existing completed sessions remain collectible/);
    assert.match(yard, /Existing completed expeditions remain collectible/);
    assert.match(barn, /activeCarriedPetIds\(character\)/);
    assert.match(barn, /Preserved overflow — swap in Sanctuary/);
    assert.match(sanctuary, /Overflow stays owned but cannot fight, breed, or start new training or expeditions/);

    for (const endpoint of [training, expedition, breeding]) {
        assert.match(endpoint, /activeCarriedPetIds/);
        assert.match(endpoint, /pet-preserved-overflow|preserved companion/);
        assert.match(endpoint, /claimPetLifecycleLease/);
    }
    assert.match(evolution, /claimPetLifecycleLease/);
});
