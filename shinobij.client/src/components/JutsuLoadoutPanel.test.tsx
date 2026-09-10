import { strict as assert } from "node:assert";
import { it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Character } from "../types/character";
import type { Jutsu } from "../types/combat";
import { JutsuLoadoutPanel } from "./JutsuLoadoutPanel.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function jutsu(id: string, name: string): Jutsu {
    return {
        id,
        name,
        type: "Ninjutsu",
        element: "Fire",
        ap: 60,
        range: 1,
        effectPower: 10,
        cooldown: 0,
        currentCooldown: 0,
        chakraCost: 1,
        staminaCost: 1,
        healthCost: 0,
        target: "OPPONENT",
        method: "SINGLE",
        battleDescription: `${name} strikes.`,
        healthCostReducePerLvl: 0,
        chakraCostReducePerLvl: 0,
        staminaCostReducePerLvl: 0,
        tags: [{ name: "Damage", percent: 10 }],
    };
}

// The collection tab is what carries the filters, and it only renders first
// during the Academy loadout beat — which is why the fixture sits on that step.
const character = {
    name: "Tester",
    level: 20,
    specialty: "Ninjutsu",
    bloodline: "None",
    onboardingStep: "jutsuLoadout",
    equippedJutsuIds: [],
    jutsuMastery: [
        { jutsuId: "plain-jutsu", level: 5, xp: 0 },
        { jutsuId: "bloodline-jutsu", level: 5, xp: 0 },
    ],
    stats: { ninjutsuOffense: 30, taijutsuOffense: 10, genjutsuOffense: 10, bukijutsuOffense: 10 },
} as unknown as Character;

const learned = [jutsu("plain-jutsu", "Ember Palm"), jutsu("bloodline-jutsu", "Ashen Gaze")];

function render(bloodlineJutsuNames?: ReadonlyMap<string, string>, on: Character = character) {
    return renderToStaticMarkup(
        <JutsuLoadoutPanel
            character={on}
            learnedJutsus={learned}
            bloodlineJutsuNames={bloodlineJutsuNames}
            onPlaceJutsu={() => {}}
            onUnequip={() => {}}
            onUnequipAll={() => {}}
        />,
    );
}

it("offers the bloodline source filter and labels bloodline jutsu when the character has one", () => {
    const html = render(new Map([["bloodline-jutsu", "Ashen Eyes"]]));

    assert.match(html, /aria-label="Filter by source"/);
    assert.match(html, /Bloodline Only/);
    assert.match(html, /Sort: Bloodline/);
    // Exactly one card is marked, and the narrow card carries the generic label
    // with the granting bloodline in its tooltip.
    assert.equal((html.match(/jutsu-bloodline-chip/g) ?? []).length, 1);
    assert.match(html, /jutsu-collection-card[^"]*is-bloodline/);
    assert.match(html, /title="Bloodline jutsu — Ashen Eyes"[^>]*>◆ Bloodline</);
});

it("marks a bloodline jutsu the character does not carry, from the rank getAllJutsus stamps", () => {
    // An admin-authored jutsu belonging to someone else's bloodline reaches every
    // player's catalog; it carries bloodlineRank but no entry in the name map.
    const foreign = { ...jutsu("foreign-jutsu", "Borrowed Flame"), bloodlineRank: "A Rank" } as Jutsu;
    const html = renderToStaticMarkup(
        <JutsuLoadoutPanel
            character={{ ...character, jutsuMastery: [{ jutsuId: "foreign-jutsu", level: 5, xp: 0 }] } as Character}
            learnedJutsus={[foreign]}
            bloodlineJutsuNames={new Map()}
            onPlaceJutsu={() => {}}
            onUnequip={() => {}}
            onUnequipAll={() => {}}
        />,
    );

    assert.match(html, /aria-label="Filter by source"/);
    assert.match(html, /title="Bloodline jutsu"[^>]*>◆ Bloodline</);
    assert.match(html, /jutsu-collection-card[^"]*is-bloodline/);
});

it("names the granting bloodline in the details panel, where there is room for it", () => {
    const selectedBloodline = { ...character, equippedJutsuIds: ["bloodline-jutsu"] } as Character;
    const html = render(new Map([["bloodline-jutsu", "Ashen Eyes"]]), selectedBloodline);

    assert.match(html, /jutsu-detail-title[\s\S]*?◆ Bloodline · Ashen Eyes/);
});

it("hides the bloodline controls when no learned jutsu comes from a bloodline", () => {
    const html = render(new Map());

    assert.doesNotMatch(html, /aria-label="Filter by source"/);
    assert.doesNotMatch(html, /Sort: Bloodline/);
    assert.doesNotMatch(html, /jutsu-bloodline-chip/);
    assert.doesNotMatch(html, /is-bloodline/);
    // The rest of the collection controls are untouched.
    assert.match(html, /aria-label="Sort jutsu"/);
    assert.match(html, /Ember Palm/);
});

it("renders without the lookup at all, for callers that do not pass one", () => {
    const html = render();

    assert.doesNotMatch(html, /aria-label="Filter by source"/);
    assert.match(html, /Ember Palm/);
    assert.match(html, /Ashen Gaze/);
});
