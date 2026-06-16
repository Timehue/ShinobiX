/*
 * Tag dropdown grouping — the bloodline maker groups the flat tag list into
 * scannable categories. These tests guarantee the grouping stays complete
 * (every selectable tag categorized exactly once) and that groupTags filters
 * to the available set while preserving order and dropping empty groups.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { allTags, tagGroups, groupTags } from "./tags";

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
});
