import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const yard = source("../screens/PetYard.tsx");
const barn = source("../components/PetBreedingBarn.tsx");
const sanctuary = source("../components/PetSanctuary.tsx");
const training = source("../../../api/pet/progress.ts");
const expedition = source("../../../api/missions/expedition-start.ts");
const breeding = source("../../../api/pet/breeding-start.ts");

test("preserved overflow stays visible but cannot begin new reward lifecycles", () => {
    assert.match(yard, /selectedPetCanTrain[^\n]+active five-pet squad can train/);
    assert.match(yard, /selectedPetIsOverflow[^\n]+Sanctuary before starting an expedition/);
    assert.match(yard, /Preserved overflow/);
    assert.match(barn, /activeCarriedPetIds\(character\)/);
    assert.match(barn, /Preserved overflow — move to carried first/);
    assert.match(sanctuary, /Stored companions cannot enter PvE, Tactical Arena, Colosseum, training, expeditions, or breeding/);

    assert.match(training, /activeTrainingPetIds\(character, pets\)/);
    assert.match(training, /active five-pet squad can train/i);
    assert.match(expedition, /activeCarriedPetIds\(character, pets\)/);
    assert.match(expedition, /preserved companion[^\n]+before starting an expedition/i);
    assert.match(breeding, /activeCarriedPetIds\(character, pets\)/);
    assert.match(breeding, /pet-preserved-overflow/);
});

test("overflow checks do not block collection of already-earned training", () => {
    const start = training.slice(training.indexOf("if (action === 'start-training')"), training.indexOf("} else if (action === 'complete-training')"));
    const complete = training.slice(training.indexOf("} else if (action === 'complete-training')"), training.indexOf("} else if", training.indexOf("} else if (action === 'complete-training')") + 1));

    assert.match(start, /activeTrainingPetIds/);
    assert.doesNotMatch(complete, /activeTrainingPetIds/);
    assert.match(complete, /settleFinishedTraining/);
});
