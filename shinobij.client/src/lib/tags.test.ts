/*
 * Tag dropdown grouping — the bloodline maker groups the flat tag list into
 * scannable categories. These tests guarantee the grouping stays complete
 * (every selectable tag categorized exactly once) and that groupTags filters
 * to the available set while preserving order and dropping empty groups.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    allTags,
    effectivePoisonPercent,
    effectiveTagPercent,
    groupTags,
    tagGroups,
    weaponTagCombatPercent,
    WEAPON_POISON_TAG_CAP,
} from "./tags";

// Poison's percent is a potency with its own rank ceiling (server:
// api/combat-core/formulas.ts poisonPercentForTag). The cards must show what
// combat applies, not the authored creator value.
describe("poison display potency", () => {
    it("caps authored poison at the rank ceiling, as combat does", () => {
        assert.equal(effectivePoisonPercent(30, null, 50), 10);
        assert.equal(effectivePoisonPercent(30, "A Rank", 50), 12);
        assert.equal(effectivePoisonPercent(35, "S Rank", 50), 14);
        assert.equal(effectivePoisonPercent(5, null, 50), 5);
    });

    it("ramps two-thirds to full with mastery and falls back to 6 when unset", () => {
        assert.equal(effectivePoisonPercent(10, null, 0), 6);
        assert.equal(effectivePoisonPercent(10, null, 25), 8);
        assert.equal(effectivePoisonPercent(0, null, 50), 6);
    });

    it("effectiveTagPercent routes Poison through the poison ceiling, not the amp cap", () => {
        assert.equal(effectiveTagPercent({ name: "Poison", percent: 30 }, null, 50), 10);
        assert.equal(effectiveTagPercent({ name: "Increase Damage Given", percent: 30 }, null, 50), 30);
    });

    it("item cards show a weapon's Poison at the weapon ceiling (old forged blades rolled 15-40)", () => {
        assert.equal(weaponTagCombatPercent("Poison", 38), WEAPON_POISON_TAG_CAP);
        assert.equal(weaponTagCombatPercent("Poison", 10), 10);
        assert.equal(weaponTagCombatPercent("Lifesteal", 38), 38, "only Poison changes");
    });
});

describe("tag groups", () => {
    it("every selectable tag is categorized exactly once", () => {
        const grouped = tagGroups.flatMap((g) => g.tags);
        for (const tag of allTags) {
            const count = grouped.filter((t) => t === tag).length;
            assert.equal(count, 1, `${tag} appears in ${count} groups`);
        }
    });

    it("has no tag in a group that is not a real tag", () => {
        const known = new Set(allTags);
        for (const group of tagGroups) {
            for (const tag of group.tags) {
                assert.ok(known.has(tag), `${tag} is not in allTags`);
            }
        }
    });

    it("groupTags filters to the available set and drops empty groups", () => {
        const grouped = groupTags(["Stun", "Move", "Poison"]);
        const flat = grouped.flatMap((g) => g.tags);
        assert.deepEqual([...flat].sort(), ["Move", "Poison", "Stun"]);
        assert.ok(grouped.every((g) => g.tags.length > 0));
    });

    it("routes an unknown tag into an 'Other' group", () => {
        const grouped = groupTags(["Move", "Quantum Flux"]);
        assert.ok(grouped.some((g) => g.label === "Other" && g.tags.includes("Quantum Flux")));
    });

    it("groups Clear Prevent with self defense rather than enemy debuffs", () => {
        const defense = tagGroups.find((group) => group.label === "Defense (you)");
        const debuffs = tagGroups.find((group) => group.label === "Debuffs (enemy)");

        assert.ok(defense?.tags.includes("Clear Prevent"));
        assert.equal(debuffs?.tags.includes("Clear Prevent"), false);
    });
});
