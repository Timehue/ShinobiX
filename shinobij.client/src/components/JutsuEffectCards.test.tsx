import { strict as assert } from "node:assert";
import { it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Jutsu } from "../types/combat";
import type { JutsuType } from "../types/core";
import { starterJutsus } from "../data/jutsu";
import { describeJutsuEffects } from "../lib/jutsu-effects.js";
import { JutsuEffectCards } from "./JutsuEffectCards.js";
import { jutsuEffectTargetLabel } from "../lib/jutsu-effect-card-model.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

it("keeps Undertow Fang accurate when Training or combat inspection supplies scaled effect power", () => {
    const fang = starterJutsus.find((entry) => entry.name === "Undertow Fang");
    assert.ok(fang);
    for (const lensDiscipline of [undefined, "Ninjutsu", "Genjutsu", "Taijutsu", "Bukijutsu", "Any"] as const) {
        for (const scaledEffectPower of [undefined, 40]) {
            const html = renderToStaticMarkup(<JutsuEffectCards jutsu={fang} masteryLevel={8} scaledEffectPower={scaledEffectPower} lensDiscipline={lensDiscipline} />);
            assert.match(html, /damage this hit deals/);
            assert.doesNotMatch(html, /(?:Ninjutsu|Genjutsu|Taijutsu|Bukijutsu|Any) damage/);
        }
    }
});

// Shaped like the live authored "Overload": a 40 AP SELF utility whose two
// independent Increase Damage Given pulses are BOTH written into the record.
const overload: Jutsu = {
    id: "admin-99c8efb8-8fa2-4b28-98d1-b95ad81af554",
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

it("groups a repeated tag into one colored two-stack card with current and max values", () => {
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
    assert.equal((summary.match(/Strengthens your attacks/g) ?? []).length, 1);
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

it("renders hit and attack scope consistently for every discipline lens across custom, bloodline and weapon effects", () => {
    const disciplines: JutsuType[] = ["Ninjutsu", "Genjutsu", "Taijutsu", "Bukijutsu", "Any"];
    for (const type of disciplines) {
        const technique: Jutsu & { weaponSwing: boolean } = {
            ...overload,
            id: `custom-${type}`,
            type,
            ap: 60,
            target: "OPPONENT",
            bloodlineRank: "A Rank",
            weaponSwing: type === "Bukijutsu",
            isUtility: false,
            tags: [
                { name: "Siphon", percent: 30 },
                { name: "Lifesteal", percent: 30 },
                { name: "Wound", percent: 30 },
                { name: "Increase Discipline", percent: 30 },
            ],
        };
        for (const masteryLevel of [0, 50]) {
            const baseline = renderToStaticMarkup(<JutsuEffectCards jutsu={technique} masteryLevel={masteryLevel} />);
            assert.match(baseline, /damage this hit deals/);
            assert.match(baseline, /post-shield damage the applying hit dealt/);
            assert.match(baseline, /regardless of offense type/);
            for (const lensDiscipline of disciplines) {
                assert.equal(renderToStaticMarkup(<JutsuEffectCards jutsu={technique} masteryLevel={masteryLevel} lensDiscipline={lensDiscipline} />), baseline, `${type}, mastery ${masteryLevel}, ${lensDiscipline} lens`);
            }
        }
    }
});
