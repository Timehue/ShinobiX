import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    ACADEMY_STARTER_GEAR_IDS,
    ACADEMY_STARTER_GEAR_TARGET,
    academyEquippedItemCount,
    hasAcademyStarterGearEquipped,
} from "./onboarding-step";

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
