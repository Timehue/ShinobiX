import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    ACADEMY_STARTER_GEAR_IDS,
    ACADEMY_STARTER_GEAR_TARGET,
    academyEquippedItemCount,
    hasAcademyJutsuLoadoutComplete,
    hasAcademyStarterGearEquipped,
    hasAcademyTrainedExtraJutsu,
    isAcademyOnboardingActive,
} from "./onboarding-step";
import { starterSavedBloodlines } from "../data/jutsu";

describe("Academy starter gear step", () => {
    it("waits for both starter equipment slots", () => {
        assert.equal(ACADEMY_STARTER_GEAR_TARGET, 2);
        assert.deepEqual(ACADEMY_STARTER_GEAR_IDS, ["rustfang-kunai", "shinobi-vest"]);
        assert.equal(hasAcademyStarterGearEquipped({}), false);
        assert.equal(hasAcademyStarterGearEquipped({ hand: "rustfang-kunai" }), false);
        assert.equal(hasAcademyStarterGearEquipped({ hand: "rustfang-kunai", body: "shinobi-vest" }), true);
        assert.equal(hasAcademyStarterGearEquipped({ head: "unrelated-mask", feet: "unrelated-boots" }), false);
    });

    it("counts only the named Academy starter pieces", () => {
        assert.equal(academyEquippedItemCount({ hand: "rustfang-kunai", body: "", head: undefined }), 1);
        assert.equal(academyEquippedItemCount({ hand: "other-kunai", body: "shinobi-vest", head: "unrelated-mask" }), 1);
    });
});

describe("Academy jutsu steps", () => {
    const ashenEyesIds = starterSavedBloodlines
        .find((bloodline) => bloodline.name === "Ashen Eyes")!
        .jutsus
        .map((jutsu) => jutsu.id);

    it("does not count the four automatically learned bloodline jutsu as new training", () => {
        assert.equal(ashenEyesIds.length, 4);
        assert.equal(hasAcademyTrainedExtraJutsu({
            bloodline: "Ashen Eyes",
            jutsuMastery: ashenEyesIds.map((jutsuId) => ({ jutsuId, level: 1, xp: 0 })),
        }), false);
    });

    it("advances after the player learns a non-bloodline jutsu", () => {
        assert.equal(hasAcademyTrainedExtraJutsu({
            bloodline: "Ashen Eyes",
            jutsuMastery: [
                ...ashenEyesIds.map((jutsuId) => ({ jutsuId, level: 1, xp: 0 })),
                { jutsuId: "starter-universal-flicker", level: 1, xp: 0 },
            ],
        }), true);
    });

    it("requires four equipped jutsu before the loadout step completes", () => {
        assert.equal(hasAcademyJutsuLoadoutComplete({ equippedJutsuIds: ["a", "b", "c"] }), false);
        assert.equal(hasAcademyJutsuLoadoutComplete({ equippedJutsuIds: ["a", "b", "c", "d"] }), true);
    });
});

describe("Academy wayfinding ownership", () => {
    it("keeps the generic next-goal pin hidden until the companion tutorial ends", () => {
        assert.equal(isAcademyOnboardingActive("academyIntro"), true);
        assert.equal(isAcademyOnboardingActive("training"), true);
        assert.equal(isAcademyOnboardingActive("sectorReturn"), true);
        assert.equal(isAcademyOnboardingActive("done"), false);
        assert.equal(isAcademyOnboardingActive(undefined), false);
    });
});
