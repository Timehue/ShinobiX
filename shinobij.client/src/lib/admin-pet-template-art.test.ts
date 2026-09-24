import assert from "node:assert/strict";
import { test } from "node:test";
import { STARTER_EVOLUTIONS } from "../data/pet-evolutions";
import { evoTemplateArt } from "./admin-pet-template-art";
import { RAIJIN_ART_REVISION } from "./pet-art-revision";

test("admin avatar fallback covers only starter evolution templates and refreshes Raijin art", () => {
    assert.equal(STARTER_EVOLUTIONS.length, 10);
    for (const pet of STARTER_EVOLUTIONS) {
        const expected = `/pet-evos/${pet.id}.webp`;
        assert.equal(evoTemplateArt(pet.id), pet.id === "starter-lightning-l"
            ? `${expected}?v=${RAIJIN_ART_REVISION}` : expected);
    }
    assert.equal(evoTemplateArt("starter-lightning"), "");
    assert.equal(evoTemplateArt("wild-wolf"), "");
});
