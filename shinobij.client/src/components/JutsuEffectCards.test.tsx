import { strict as assert } from "node:assert";
import { it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Jutsu } from "../types/combat";
import { describeJutsuEffects } from "../lib/jutsu-effects.js";
import { JutsuEffectCards } from "./JutsuEffectCards.js";
import { jutsuEffectTargetLabel } from "../lib/jutsu-effect-card-model.js";

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
    ],
};

it("repairs stale one-tag Overload content into one colored two-stack card with current and max values", () => {
    const html = renderToStaticMarkup(<JutsuEffectCards jutsu={overload} masteryLevel={8} />);

    assert.match(html, /role="list" aria-label="Jutsu effects"/);
    assert.equal((html.match(/role="listitem"/g) ?? []).length, 1);
    assert.match(html, /jutsu-effect-card--power/);
    assert.match(html, /2 stacks · Starts next round · 2 rounds/);
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

it("labels each mixed-tag effect by its actual recipient rather than the cast target", () => {
    const mixed: Jutsu = {
        ...overload,
        id: "mixed-target-jutsu",
        name: "Mixed Target",
        target: "OPPONENT",
        tags: [
            { name: "Heal", percent: 0 },
            { name: "Increase Damage Taken", percent: 30 },
            { name: "Copy", percent: 0 },
            { name: "Mirror", percent: 0 },
        ],
    };

    const html = renderToStaticMarkup(<JutsuEffectCards jutsu={mixed} masteryLevel={50} />);

    assert.equal((html.match(/<strong>Target:<\/strong> Self<\/span>/g) ?? []).length, 1);
    assert.equal((html.match(/<strong>Target:<\/strong> Enemy<\/span>/g) ?? []).length, 1);
    assert.match(html, /<strong>Target:<\/strong> Self \(copies eligible enemy buffs\)<\/span>/);
    assert.match(html, /<strong>Target:<\/strong> Enemy \(copies all your debuffs\)<\/span>/);
});

it("normalizes legacy tag aliases before choosing an effect recipient", () => {
    assert.equal(jutsuEffectTargetLabel(overload, "Vamp"), "Self");
    assert.equal(jutsuEffectTargetLabel(overload, "Seal"), "Enemy");
    assert.equal(jutsuEffectTargetLabel(overload, "Barrier"), "Battlefield");
});
