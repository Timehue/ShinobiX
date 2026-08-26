import { strict as assert } from "node:assert";
import { it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Jutsu } from "../types/combat";
import { describeJutsuEffects } from "../lib/jutsu-effects.js";
import { JutsuEffectCards } from "./JutsuEffectCards.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const overload: Jutsu = {
    id: "starter-universal-blitz",
    name: "Overload",
    type: "Ninjutsu",
    element: "None",
    ap: 40,
    range: 1,
    effectPower: 0,
    cooldown: 7,
    currentCooldown: 0,
    chakraCost: 0,
    staminaCost: 0,
    healthCost: 0,
    target: "SELF",
    method: "SINGLE",
    battleDescription: "Overload surges through the user.",
    healthCostReducePerLvl: 0,
    chakraCostReducePerLvl: 0,
    staminaCostReducePerLvl: 0,
    isUtility: true,
    tags: [
        { name: "Increase Damage Given", percent: 30 },
        { name: "Increase Damage Given", percent: 30 },
    ],
};

it("groups Overload into one colored two-stack card with current and max values", () => {
    const html = renderToStaticMarkup(<JutsuEffectCards jutsu={overload} masteryLevel={8} />);

    assert.match(html, /role="list" aria-label="Jutsu effects"/);
    assert.equal((html.match(/role="listitem"/g) ?? []).length, 1);
    assert.match(html, /jutsu-effect-card--power/);
    assert.match(html, /2 stacks · 2 rounds/);
    assert.match(html, /Triggers 2× per cast/);
    assert.match(html, /Stack 1/);
    assert.match(html, /Stack 2/);
    assert.equal((html.match(/>21%<\/strong>/g) ?? []).length, 2);
    assert.match(html, /At max mastery: 2 × \+30%/);
});

it("collapses the repeated plain-language effect summary", () => {
    const summary = describeJutsuEffects(overload, 8);
    assert.equal((summary.match(/Increases your damage given/g) ?? []).length, 1);
    assert.match(summary, /Triggers 2 times per cast\./);
});
