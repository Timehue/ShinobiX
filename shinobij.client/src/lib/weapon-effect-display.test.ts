import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { WEAPON_FLAT_TAG_AMOUNTS, weaponEffectDisplayValue } from "./weapon-effect-display.js";
import { effectiveTagPercent, WEAPON_POISON_TAG_CAP } from "./tags.js";

describe("weapon effect cards show what the swing really does", () => {
    it("shows flat Heal/Shield/Drain amounts instead of the stored number", () => {
        // The server resolves a swing at mastery 0: 30% of a jutsu's 750, and Drain's 50 floor.
        assert.deepEqual(WEAPON_FLAT_TAG_AMOUNTS, { Heal: 225, Shield: 225, Drain: 50 });
        assert.equal(weaponEffectDisplayValue("Shield", 300), "225 shield", "Frostfang Oathblade read 'Shield 300%'");
        assert.equal(weaponEffectDisplayValue("Heal", 35), "225 HP");
        assert.equal(weaponEffectDisplayValue("Drain", 35), "50 HP + chakra per turn");
    });

    it("caps percentages the way a weapon swing is capped", () => {
        assert.equal(weaponEffectDisplayValue("Wound", 300), "25% of damage dealt", "the Ranked Kunai read 'Wound 300%'");
        assert.equal(weaponEffectDisplayValue("Wound", 20), "20% of damage dealt");
        assert.equal(weaponEffectDisplayValue("Reflect", 40), "35%");
        assert.equal(weaponEffectDisplayValue("Lifesteal", 30), "30%");
        assert.equal(weaponEffectDisplayValue("Poison", 40), `${WEAPON_POISON_TAG_CAP}%`);
    });
});

describe("jutsu cards show the Wound percent the server applies", () => {
    it("caps Wound at the jutsu's rank (25 / 30 / 35)", () => {
        assert.equal(effectiveTagPercent({ name: "Wound", percent: 30 }, null, 50), 25, "a basic 'Wound 30%' applies 25%");
        assert.equal(effectiveTagPercent({ name: "Wound", percent: 40 }, "A Rank", 50), 30);
        assert.equal(effectiveTagPercent({ name: "Wound", percent: 40 }, "S Rank", 50), 35);
        assert.equal(effectiveTagPercent({ name: "Wound", percent: 14 }, null, 50), 14, "under the cap it is unchanged");
    });
});
