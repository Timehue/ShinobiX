import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Character } from "../types/character.ts";
import {
    getHospitalDiscountPercent,
    getMissionRewardBonus,
    getPetXpBonus,
    getShopDiscountPercent,
    getTrainingXpBonus,
} from "./village-upgrades.ts";

function character(overrides: Partial<Character>): Character {
    return overrides as Character;
}

describe("clan benefit membership safety", () => {
    test("stale clan snapshots grant no benefits after membership is cleared", () => {
        const base = {
            clanUpgradeLevels: { trainingGrounds: 5, petDen: 5, medicalWing: 5, blacksmith: 5 },
        } satisfies Partial<Character>;

        assert.equal(getTrainingXpBonus(character({ ...base, clanDoctrine: "scholars" })), 0);
        assert.equal(getMissionRewardBonus(character({ ...base, clanDoctrine: "scholars" })), 0);
        assert.equal(getShopDiscountPercent(character({ ...base, clanDoctrine: "merchant" })), 0);
        assert.equal(getHospitalDiscountPercent(character({ ...base, clanDoctrine: "medics" })), 0);
        assert.equal(getPetXpBonus(character(base)), 0);
    });

    test("the same snapshots still apply to an active clan member", () => {
        const member = character({
            clan: "Akatsuki",
            clanDoctrine: "scholars",
            clanUpgradeLevels: { trainingGrounds: 5, petDen: 5 },
        });

        assert.ok(getTrainingXpBonus(member) > 0);
        assert.ok(getMissionRewardBonus(member) > 0);
        assert.ok(getPetXpBonus(member) > 0);
    });
});
