import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bloodlineCreatorDraftOffense, normalizeCreatorDraftJutsu } from "./bloodline-creator-draft";
import { blankJutsu, normalizeJutsu } from "./jutsu";
import { jutsuEffectInfo } from "./jutsu-effects";

describe("bloodline creator offense projection", () => {
    it("finds the saved offense after leading Any utilities and keeps an all-utility default concrete", () => {
        assert.equal(bloodlineCreatorDraftOffense([{ type: "Any" }, { type: "Genjutsu" }]), "Genjutsu");
        assert.equal(bloodlineCreatorDraftOffense([{ type: "Any" }]), "Ninjutsu");
        assert.equal(bloodlineCreatorDraftOffense([]), "Ninjutsu");
    });
    for (const offense of ["Ninjutsu", "Genjutsu", "Taijutsu", "Bukijutsu"] as const) {
        it(`${offense} survives a 60-to-40-to-60 AP round-trip and matches save normalization`, () => {
            const original = { ...blankJutsu(0, "S Rank"), type: offense, tags: [{ name: "Increase Discipline", percent: 30 }] };
            const before = structuredClone(original);
            const damage = normalizeCreatorDraftJutsu(original, "S Rank", offense);
            const utility = normalizeCreatorDraftJutsu({ ...damage, ap: 40 }, "S Rank", offense);
            assert.equal(utility.type, "Any");
            assert.match(jutsuEffectInfo(utility, utility.tags[0])!.summary, /Any-style cast has no discipline to boost/);
            const restored = normalizeCreatorDraftJutsu({ ...utility, ap: 60, effectPower: 40 }, "S Rank", offense);
            assert.equal(restored.type, offense);
            assert.match(jutsuEffectInfo(restored, restored.tags[0])!.summary, new RegExp(`Raises your ${offense} offense`));
            assert.deepEqual(restored, normalizeJutsu({ ...restored, type: offense }));
            assert.equal(restored.ap, 60);
            assert.equal(restored.effectPower, damage.effectPower);
            assert.equal(restored.range, damage.range);
            assert.equal(restored.cooldown, damage.cooldown);
            assert.deepEqual(original, before);
        });

        it(`${offense} overrides the Ninjutsu blank when a rank change rebuilds the draft`, () => {
            const reset = normalizeCreatorDraftJutsu(blankJutsu(0, "A Rank"), "A Rank", offense);
            assert.equal(reset.type, offense);
            assert.equal(reset.bloodlineRank, "A Rank");
            assert.equal(reset.ap, 60);
        });
    }
});
