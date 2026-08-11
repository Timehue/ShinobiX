import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet } from "../types/pet";
import { publicEligiblePets } from "./public-pet-roster";

const pet = (id: string): Pet => ({ id } as Pet);

test("public pet DTO preserves Base three and Supporter five without Patreon state", () => {
    const base = { eligiblePets: [pet("b1"), pet("b2"), pet("b3")] };
    const supporter = { eligiblePets: [pet("s1"), pet("s2"), pet("s3"), pet("s4"), pet("s5")] };
    assert.equal(publicEligiblePets(base).length, 3);
    assert.equal(publicEligiblePets(supporter).length, 5);
    assert.equal("patreon" in supporter, false);
    assert.equal(publicEligiblePets(supporter).length >= 4, true, "a supporter can be offered a 4v4 challenge");
});

test("missing explicit eligibility fails closed instead of assuming the Base cap", () => {
    assert.deepEqual(publicEligiblePets({}), []);
});
