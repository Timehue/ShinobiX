/*
 * jutsuPointBreakdown is the itemized form of jutsuPoints — the bloodline maker
 * shows it so players see WHAT costs points. These tests lock the invariant that
 * the breakdown always sums to jutsuPoints, plus a few labelled line-items.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    bloodlineCreatorPercentPolicy,
    bloodlinePoints,
    bloodlineTagPercentChoices,
    jutsuPoints,
    jutsuPointBreakdown,
    normalizeBloodlineCreatorTagPercent,
    tagPointValue,
} from "./jutsu-points";
import { normalizeJutsu } from "./jutsu";
import { allTags, cappedDamageTags } from "./tags";
import type { Jutsu } from "../types/combat";
import type { Rank } from "../types/core";

function j(partial: Partial<Jutsu>): Jutsu {
    return normalizeJutsu({ id: "t", name: "T", type: "Ninjutsu", ...partial });
}

const samples: Jutsu[] = [
    j({ ap: 60, effectPower: 40, range: 4, cooldown: 7, tags: [{ name: "Poison", percent: 30 }] }),
    j({ ap: 40, effectPower: 0, range: 5, cooldown: 7, tags: [{ name: "Increase Damage Given", percent: 35 }, { name: "Decrease Damage Taken", percent: 35 }] }),
    j({ ap: 60, effectPower: 50, range: 5, cooldown: 1, tags: [{ name: "Increase Damage Given", percent: 35 }] }),
    j({ ap: 60, effectPower: 40, range: 4, cooldown: 7, target: "EMPTY_GROUND", method: "AOE_SPIRAL", tags: [{ name: "Move", percent: 0 }, { name: "Poison", percent: 30 }] }),
    j({ ap: 60, effectPower: 40, range: 4, cooldown: 7, tags: [] }),
];

describe("jutsuPointBreakdown", () => {
    samples.forEach((s, i) => {
        it(`sample ${i}: breakdown sums to jutsuPoints`, () => {
            const sum = jutsuPointBreakdown(s).reduce((a, b) => a + b.points, 0);
            assert.equal(sum, jutsuPoints(s));
        });
    });

    it("labels the 40 AP utility cost", () => {
        const items = jutsuPointBreakdown(j({ ap: 40, tags: [] }));
        assert.ok(items.some((it) => it.label === "40 AP utility" && it.points === 1));
    });

    it("labels the Nuke and Range 5 costs", () => {
        const items = jutsuPointBreakdown(j({ ap: 60, effectPower: 50, range: 5, tags: [] }));
        assert.ok(items.some((it) => it.label === "Nuke damage"));
        assert.ok(items.some((it) => it.label === "Range 5"));
    });

    it("a plain standard 60 AP jutsu has no point items", () => {
        assert.deepEqual(jutsuPointBreakdown(j({ ap: 60, effectPower: 40, range: 4, cooldown: 7, tags: [] })), []);
    });

    it("a below-cap percent amp tag costs the 0.25 floor (never free)", () => {
        // Increase Damage Given 20% on a no-rank jutsu (cap 30) used to be free (0);
        // now floored to 0.25 so a player can't stack cheap below-cap amps.
        const items = jutsuPointBreakdown(j({ ap: 60, effectPower: 40, range: 4, cooldown: 7, tags: [{ name: "Increase Damage Given", percent: 20 }] }));
        const idg = items.find((it) => it.label.startsWith("Increase Damage Given"));
        assert.ok(idg && idg.points === 0.25, `expected 0.25 floor, got ${idg?.points}`);
    });
});

describe("player bloodline creator percent policy", () => {
    const ranks: Rank[] = ["B Rank", "A Rank", "S Rank"];
    const creatorTags = [...allTags, "Pierce"];

    for (const rank of ranks) {
        it(`${rank}: every creator tag has a closed legal percent policy`, () => {
            const legalChoices = bloodlineTagPercentChoices(rank);
            for (const name of creatorTags) {
                const policy = bloodlineCreatorPercentPolicy(name, rank);
                const normalized = normalizeBloodlineCreatorTagPercent(name, 999, rank);
                if (policy.scalable) {
                    assert.deepEqual(policy.choices, legalChoices, name);
                    assert.equal(policy.defaultPercent, legalChoices[legalChoices.length - 1], name);
                    assert.ok(legalChoices.includes(normalized), `${name}: ${normalized}`);
                } else {
                    assert.deepEqual(policy.choices, [0], name);
                    assert.equal(policy.defaultPercent, 0, name);
                    assert.equal(normalized, 0, name);
                }
            }
        });

        it(`${rank}: every max creator amp pays the at-cap price`, () => {
            const creatorMax = bloodlineTagPercentChoices(rank).at(-1)!;
            for (const name of cappedDamageTags.filter((candidate) => allTags.includes(candidate))) {
                assert.equal(tagPointValue({ name, percent: creatorMax }, rank), 0.75, name);
            }
        });
    }

    it("bloodlinePoints prices the whole kit with its explicit creator rank", () => {
        const maxA = bloodlineTagPercentChoices("A Rank").at(-1)!;
        const kit = [j({
            ap: 60,
            effectPower: 40,
            range: 4,
            cooldown: 7,
            tags: [{ name: "Increase Damage Given", percent: maxA }],
        })];
        assert.equal(bloodlinePoints(kit, "A Rank"), jutsuPoints(kit[0]!, "A Rank"));
        assert.equal(bloodlinePoints(kit, "A Rank"), 0.75);
    });
});
