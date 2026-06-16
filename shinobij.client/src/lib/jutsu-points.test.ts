/*
 * jutsuPointBreakdown is the itemized form of jutsuPoints — the bloodline maker
 * shows it so players see WHAT costs points. These tests lock the invariant that
 * the breakdown always sums to jutsuPoints, plus a few labelled line-items.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { jutsuPoints, jutsuPointBreakdown } from "./jutsu-points";
import { normalizeJutsu } from "./jutsu";
import type { Jutsu } from "../types/combat";

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
});
