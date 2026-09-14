import { strict as assert } from "node:assert";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Jutsu } from "../types/combat";
import { JutsuDropdownList } from "./JutsuDropdownList.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const jutsu = (id: string, name: string, extra: Partial<Jutsu> = {}): Jutsu => ({
    id,
    name,
    type: "Ninjutsu",
    element: "Fire",
    ap: 20,
    range: 1,
    effectPower: 12,
    cooldown: 2,
    currentCooldown: 0,
    chakraCost: 0,
    staminaCost: 0,
    healthCost: 0,
    target: "OPPONENT",
    method: "SINGLE",
    battleDescription: `${name} strikes.`,
    healthCostReducePerLvl: 0,
    chakraCostReducePerLvl: 0,
    staminaCostReducePerLvl: 0,
    tags: [{ name: "Damage", percent: 100 }],
    ...extra,
});

const library = [
    jutsu("ashen-eyes-blood-gaze", "Blood Gaze"),
    jutsu("borrowed-flame", "Borrowed Flame", { bloodlineRank: "A Rank" }),
    jutsu("ember-palm", "Ember Palm"),
];

function render(bloodlineJutsuNames?: ReadonlyMap<string, string>) {
    return renderToStaticMarkup(
        <JutsuDropdownList
            jutsus={library}
            label="Jutsu library"
            renderDetails={() => null}
            bloodlineJutsuNames={bloodlineJutsuNames}
        />,
    );
}

/** The markup of one card, found by the jutsu's name. */
function card(html: string, name: string) {
    const cards = html.split('<button class="technique-card').slice(1);
    const match = cards.find((markup) => markup.includes(`<span class="technique-name">${name}</span>`));
    assert.ok(match, `expected a technique card named ${name}`);
    return match;
}

test("the Training Hall marks the character's own bloodline jutsu and names the bloodline", () => {
    const html = render(new Map([["ashen-eyes-blood-gaze", "Ashen Eyes"]]));

    const own = card(html, "Blood Gaze");
    assert.match(own, /^[^"]*is-bloodline/);
    assert.match(own, /<span class="technique-bloodline" title="Bloodline jutsu — Ashen Eyes">◆ Bloodline<\/span>/);

    const plain = card(html, "Ember Palm");
    assert.doesNotMatch(plain, /is-bloodline|technique-bloodline/);
});

test("a rank-stamped kit the character does not carry is marked without a name", () => {
    const html = render(new Map());

    assert.match(card(html, "Borrowed Flame"), /<span class="technique-bloodline" title="Bloodline jutsu">◆ Bloodline<\/span>/);
});

test("the badge sits beside the name, so the name span still holds exactly the jutsu name", () => {
    // e2e/non-combat-ui-audit reads .technique-name's text and looks for it as
    // the mobile modal's heading; a badge nested inside would break that match.
    const html = render(new Map([["ashen-eyes-blood-gaze", "Ashen Eyes"]]));

    assert.match(html, /<span class="technique-name">Blood Gaze<\/span><span class="technique-bloodline"/);
});

test("lists that do not opt in, like the admin creator tools, render no marker at all", () => {
    const html = render();

    // Even the rank-stamped jutsu stays unmarked without the lookup.
    assert.doesNotMatch(html, /is-bloodline|technique-bloodline/);
    assert.match(html, /<span class="technique-name">Borrowed Flame<\/span>/);
});
