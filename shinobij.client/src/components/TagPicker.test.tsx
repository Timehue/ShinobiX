import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TagPicker } from "./TagPicker";
import type { Rank } from "../types/core";

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
            const html = render("Poison", rank, 25);
            assert.match(html, /aria-label="Poison strength"/);
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
});

describe("TagPicker effect timing preview", () => {
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
