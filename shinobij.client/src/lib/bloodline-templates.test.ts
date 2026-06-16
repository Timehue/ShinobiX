/*
 * Bloodline quick-start templates — guarantees every archetype, at every rank,
 * is safe to load: correct jutsu count, within the rank point budget, and
 * obeying the builder's structural rules (≤1 Nuke, ≤1 Pierce, bloodline-unique
 * tags used at most once). If a spec drifts out of budget the test fails.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { bloodlineArchetypes, bloodlineTemplateJutsus } from "./bloodline-templates";
import { bloodlinePoints, jutsuCountForRank, pointBudgetForRank } from "./jutsu-points";
import { bloodlineUniqueTags, hasFixedEffectPower } from "./tags";
import type { Rank } from "../types/core";

const ranks: Rank[] = ["B Rank", "A Rank", "S Rank"];

describe("bloodline templates", () => {
    for (const arch of bloodlineArchetypes) {
        for (const rank of ranks) {
            const jutsus = bloodlineTemplateJutsus(arch.key, rank, "Fire", "Ninjutsu");

            it(`${arch.name} / ${rank}: has ${jutsuCountForRank(rank)} jutsu`, () => {
                assert.equal(jutsus.length, jutsuCountForRank(rank));
            });

            it(`${arch.name} / ${rank}: within point budget`, () => {
                const total = bloodlinePoints(jutsus);
                assert.ok(total <= pointBudgetForRank(rank), `${total} > ${pointBudgetForRank(rank)}`);
            });

            it(`${arch.name} / ${rank}: at most one Nuke and one Pierce`, () => {
                const nukes = jutsus.filter((jt) => jt.effectPower === 50 && !hasFixedEffectPower(jt)).length;
                const pierces = jutsus.filter((jt) => jt.tags.some((t) => t.name === "Pierce")).length;
                assert.ok(nukes <= 1, `${nukes} nukes`);
                assert.ok(pierces <= 1, `${pierces} pierces`);
            });

            it(`${arch.name} / ${rank}: bloodline-unique tags used at most once`, () => {
                for (const unique of bloodlineUniqueTags) {
                    const count = jutsus.filter((jt) => jt.tags.some((t) => t.name === unique)).length;
                    assert.ok(count <= 1, `${unique} used ${count}×`);
                }
            });

            it(`${arch.name} / ${rank}: every jutsu is named`, () => {
                assert.ok(jutsus.every((jt) => jt.name.trim().length > 0));
            });
        }
    }

    it("themes jutsu names to the chosen element", () => {
        const jutsus = bloodlineTemplateJutsus("glass-cannon", "A Rank", "Crystal", "Ninjutsu");
        assert.ok(jutsus.every((jt) => jt.name.startsWith("Crystal ")));
    });
});
