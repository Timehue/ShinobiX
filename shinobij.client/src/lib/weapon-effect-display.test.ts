import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { WEAPON_FLAT_TAG_AMOUNTS, namedRollTagValue, weaponDistinctTagCount, weaponEffectDisplayValue } from "./weapon-effect-display.js";
import { effectiveTagPercent, WEAPON_POISON_TAG_CAP } from "./tags.js";

describe("weapon effect cards show what the swing really does", () => {
    it("shows flat Heal/Shield/Drain amounts instead of the stored number", () => {
        // Built-in weapons swing at mastery 0: 30% of a jutsu's 750, and Drain's 50 floor.
        assert.deepEqual(WEAPON_FLAT_TAG_AMOUNTS, { Heal: 225, Shield: 225, Drain: 50 });
        assert.equal(weaponEffectDisplayValue("Heal", 35), "225 HP");
        assert.equal(weaponEffectDisplayValue("Shield", 30, { id: "custom-blade", weaponEffect: "Shield" }), "225 shield");
        // Built-ins grant their authored rarity-ladder amount (owner ruling 2026-10-06).
        assert.equal(weaponEffectDisplayValue("Shield", 300, { id: "frostfang-oathblade", weaponEffect: "Shield" }), "300 shield", "Frostfang Oathblade read 'Shield 300%'");
        assert.equal(weaponEffectDisplayValue("Shield", 400, { id: "glacier-king-cleaver", weaponEffect: "Shield" }), "400 shield");
        // Named Weapons follow their tag count (owner ruling 2026-10-06): 450 alone, 225 beside another.
        const id = "named-weapon-0f07ac79-66d2-4f4f-a4b4-3c9b6eb74527";
        assert.equal(weaponEffectDisplayValue("Shield", 37, { id, weaponTags: [{ name: "Shield" }] }), "450 shield");
        assert.equal(weaponEffectDisplayValue("Heal", 37, { id, weaponTags: [{ name: "Heal" }] }), "450 HP");
        assert.equal(weaponEffectDisplayValue("Heal", 18, { id, weaponTags: [{ name: "Heal" }, { name: "Wound" }] }), "225 HP");
        assert.equal(weaponEffectDisplayValue("Drain", 37, { id, weaponTags: [{ name: "Drain" }] }), "150 HP + chakra per turn");
        assert.equal(weaponEffectDisplayValue("Drain", 18, { id, weaponTags: [{ name: "Drain" }, { name: "Wound" }] }), "75 HP + chakra per turn");
        assert.equal(weaponDistinctTagCount({ weaponEffect: "Shield", weaponTags: [{ name: "Shield" }] }), 1);
        // A prefix alone is not a forged id: the server needs the minted UUID too.
        assert.equal(weaponEffectDisplayValue("Shield", 37, { id: "named-weapon-test", weaponTags: [{ name: "Shield" }] }), "225 shield");
        // The roll result / reveal show the flat amount, not the rolled percent.
        assert.equal(namedRollTagValue("Shield", 37, 1), "450 shield");
        assert.equal(namedRollTagValue("Heal", 18, 2), "225 HP");
        assert.equal(namedRollTagValue("Drain", 18, 2), "75 HP + chakra per turn");
        assert.equal(namedRollTagValue("Siphon", 19, 2), "19%");
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
