import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TagPicker } from "./TagPicker";
import type { JutsuType, Rank } from "../types/core";

function render(tag: string, rank: Rank, percent: number): string {
    return renderToStaticMarkup(createElement(TagPicker, {
        tag,
        rank,
        percent,
        setTag: () => undefined,
        setPercent: () => undefined,
    }));
}

describe("TagPicker player-creator percent choices", () => {
    it("renders only 25/30 for A/B and 30/35 for S scalable tags", () => {
        for (const rank of ["B Rank", "A Rank"] as const) {
            const html = render("Recoil", rank, 25);
            assert.match(html, /aria-label="Recoil strength"/);
            assert.match(html, /<option value="25" selected="">25%<\/option>/);
            assert.match(html, /<option value="30">30%<\/option>/);
            assert.doesNotMatch(html, /<option value="35">35%<\/option>/);
        }

        const sRank = render("Wound", "S Rank", 35);
        assert.match(sRank, /<option value="30">30%<\/option>/);
        assert.match(sRank, /<option value="35" selected="">35%<\/option>/);
        assert.doesNotMatch(sRank, /<option value="40">40%<\/option>/);
    });

    it("does not render a percent control for fixed or binary magnitudes", () => {
        assert.doesNotMatch(render("Heal", "S Rank", 100), /aria-label="Heal strength"/);
        assert.doesNotMatch(render("Push", "A Rank", 100), /aria-label="Push strength"/);
        assert.doesNotMatch(render("Stun", "B Rank", 100), /aria-label="Stun strength"/);
    });

    // Combat holds creator Poison to the rank's Poison ceiling (12 for A/B, 14 for
    // S), so 25% and 30% play identically. The picker shows the real value instead
    // of a choice that changes nothing.
    it("shows Poison at its combat ceiling instead of a strength choice", () => {
        for (const [rank, percent, ceiling, spend] of [["B Rank", 25, 12, 144], ["A Rank", 30, 12, 144], ["S Rank", 35, 14, 168]] as const) {
            const html = render("Poison", rank, percent);
            assert.doesNotMatch(html, /aria-label="Poison strength"/, `${rank} should not offer a Poison strength choice`);
            assert.match(html, /Poisons the target for 2 rounds/, `${rank} help states the duration`);
            assert.match(html, new RegExp(`${spend}% of the amount spent`), `${rank} help converts its ${ceiling}% ceiling into the real HP share`);
            assert.match(html, /free casts cause none/);
        }
    });
});

describe("TagPicker effect timing preview", () => {
    it("describes damage-reading effects without inventing a discipline requirement", () => {
        const siphon = render("Siphon", "A Rank", 30);
        const wound = render("Wound", "A Rank", 30);
        const lifesteal = render("Lifesteal", "A Rank", 30);
        assert.match(siphon, /damage this hit deals/);
        assert.match(wound, /post-shield damage the applying hit dealt/);
        assert.match(lifesteal, /every damaging attack.*regardless of offense type/);
        for (const html of [siphon, wound, lifesteal]) {
            assert.doesNotMatch(html, /(?:Ninjutsu|Genjutsu|Taijutsu|Bukijutsu|Any) damage/);
        }
    });

    function renderRecoil(jutsuTarget: "OPPONENT" | "EMPTY_GROUND", jutsuMethod: "SINGLE" | "INSTANT_EFFECT"): string {
        return renderToStaticMarkup(createElement(TagPicker, {
            tag: "Recoil",
            rank: "A Rank",
            percent: 25,
            jutsuTarget,
            jutsuMethod,
            setTag: () => undefined,
            setPercent: () => undefined,
        }));
    }

    it("shows recurring-zone timing for a ground method and queued timing for a direct method", () => {
        const ground = renderRecoil("EMPTY_GROUND", "INSTANT_EFFECT");
        const direct = renderRecoil("OPPONENT", "SINGLE");

        assert.match(ground, /A caught target suffers recoil on attacks made during that turn/);
        assert.doesNotMatch(ground, /Queues a negative status for the next combat round/);
        assert.match(direct, /Queues a negative status for the next combat round/);
    });
});

describe("TagPicker previews the authored discipline", () => {
    function preview(jutsuType?: JutsuType, rank?: Rank) {
        return renderToStaticMarkup(createElement(TagPicker, {
            tag: "Increase Discipline",
            percent: 30,
            jutsuType,
            rank,
            setTag: () => undefined,
            setPercent: () => undefined,
        }));
    }

    it("uses each selected style in both admin and ranked bloodline previews", () => {
        for (const type of ["Ninjutsu", "Genjutsu", "Taijutsu", "Bukijutsu"] as const) {
            for (const rank of [undefined, "A Rank", "S Rank"] as const) {
                assert.match(preview(type, rank), new RegExp(`Raises your ${type} offense`), `${type}, ${rank ?? "admin"}`);
            }
        }
    });

    it("does not invent a Ninjutsu boost for Any-style utilities or missing type context", () => {
        for (const type of ["Any", undefined] as const) {
            const html = preview(type);
            assert.match(html, /Any-style cast has no discipline to boost/);
            assert.doesNotMatch(html, /Raises your Ninjutsu offense/);
        }
    });
});
