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
    // The training gate's copy branches on WHY the pet cannot train. A
    // Supporter's sixth carried companion is not overflow (it is already in the
    // carried roster), so telling it to "move into your carried roster" is wrong.
    assert.match(yard, /if \(!selectedPetCanTrain\) return alert\(selectedPetIsOverflow\s*\? `\$\{petDisplayName\(selectedPet\)\} is preserved overflow\. Move it into your carried roster through the Sanctuary before starting training\.`\s*: `\$\{petDisplayName\(selectedPet\)\} is carried but outside your active five\. Set it as Active or as your 2v2 Partner, or rest another companion in the Sanctuary, before starting training\.`\);/);
    assert.match(yard, /\{!selectedPetCanTrain && <p [^>]*>\{selectedPetIsOverflow \? "This companion is preserved overflow\. Move it into your carried roster through the Sanctuary to start training\." : "This companion is carried but outside your active five\. Set it as Active or as your 2v2 Partner, or rest another companion in the Sanctuary, to start training\."\}<\/p>\}/);
    assert.match(yard, /!selectedPetCanTrain \? \(selectedPetIsOverflow \? "Move into carried roster" : "Move into active five"\) : "Start Training"/);
    assert.match(yard, /onClick=\{startTraining\} disabled=\{[^}]*!selectedPetCanTrain/);
    assert.match(yard, /selectedPetIsOverflow[^\n]+Sanctuary before starting an expedition/);
    assert.match(yard, /Preserved overflow/);
    assert.match(barn, /activeCarriedPetIds\(character\)/);
    assert.match(barn, /Preserved overflow — move to carried first/);
    assert.match(sanctuary, /Stored companions cannot enter PvE, Beastbound Warfront, Colosseum, training, expeditions, or breeding/);

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
