import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Jutsu } from "../types/combat";
import { createCharacter } from "../lib/create-character.js";
import { JutsuLoadoutPanel } from "./JutsuLoadoutPanel.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const css = readFileSync(new URL("../styles/profile-skin.css", import.meta.url), "utf8");

const jutsu = (id: string, name: string): Jutsu => ({
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
    isUtility: false,
    tags: [{ name: "Damage", percent: 100 }],
});

function panelMarkup() {
    const learned = [jutsu("collection-a", "Ember Palm"), jutsu("collection-b", "Great Fireball Technique")];
    const base = createCharacter("Badge Tester", "Leaf", "Ninjutsu", "None");
    const character = {
        ...base,
        // Opens on the collection tab, which is the only tab that renders cards.
        onboardingStep: "jutsuLoadout" as const,
        equippedJutsuIds: ["collection-a"],
        jutsuMastery: learned.map((entry) => ({ jutsuId: entry.id, level: 4, xp: 0 })),
    };
    return renderToStaticMarkup(
        <div className="profile-page-card">
            <JutsuLoadoutPanel
                character={character}
                learnedJutsus={learned}
                catalogJutsus={learned}
                onPlaceJutsu={() => {}}
                onUnequip={() => {}}
                onUnequipAll={() => {}}
            />
        </div>,
    );
}

test("only equipped collection cards carry the badge, and both views share one card element", () => {
    const html = panelMarkup();

    assert.equal((html.match(/jutsu-equipped-badge/g) ?? []).length, 1);
    assert.match(html, /<span class="jutsu-equipped-badge">Equipped<\/span>/);
    // The badge sits inside the select button, ahead of the copy it used to cover.
    assert.match(html, /jutsu-equipped-badge[\s\S]*?jutsu-collection-copy/);

    // List view is a class swap on the same markup, so CSS is the only lever that
    // can move the badge for one view without moving it for the other.
    const source = readFileSync(new URL("./JutsuLoadoutPanel.tsx", import.meta.url), "utf8");
    assert.match(source, /view === "list" \? "is-list" : ""/);
    assert.match(source, /jutsu-collection-grid \$\{view === "list" \? "is-list-view" : ""\}/);
});

test("grid tiles anchor the badge to the art panel, not to the growing tile bottom", () => {
    // A tile's height follows the jutsu name, so anchoring from the bottom walks
    // the badge up onto a name that wraps in a narrow (88px) column.
    const shared = css.match(/\.profile-page-card \.jutsu-equipped-badge\s*\{([^}]*)\}/);
    assert.ok(shared, "expected the shared .jutsu-equipped-badge rule");
    assert.match(shared[1], /position:\s*absolute;/);
    assert.match(shared[1], /right:\s*7px;/);
    assert.match(shared[1], /top:\s*57px;/);
    assert.doesNotMatch(shared[1], /bottom:/);

    // 57px only clears the name because it lands inside the 78px art panel.
    assert.match(
        css,
        /\.profile-page-card \.jutsu-collection-card \.jutsu-workbench-art\s*\{[^}]*height:\s*78px;/s,
    );
});

test("list rows re-anchor the badge into the art column, clear of the jutsu name", () => {
    // A list row is half a grid tile tall and centres its copy column, so the
    // shared anchor lands the badge on the name (and, once it is art-relative,
    // on the quick-equip button); the override must drop both inherited anchors,
    // not just add new ones.
    const override = css.match(
        /\.profile-page-card \.jutsu-collection-card\.is-list \.jutsu-equipped-badge\s*\{([^}]*)\}/,
    );
    assert.ok(override, "expected a .is-list override for .jutsu-equipped-badge");
    const body = override[1];
    assert.match(body, /top:\s*auto;/);
    assert.match(body, /right:\s*auto;/);
    assert.match(body, /left:\s*\d+px;/);
    assert.match(body, /bottom:\s*\d+px;/);

    // It has to win the cascade over the shared rule it is correcting.
    assert.ok(
        css.indexOf(".jutsu-collection-card.is-list .jutsu-equipped-badge")
            > css.indexOf(".profile-page-card .jutsu-equipped-badge"),
        "the list override must follow the shared badge rule in source order",
    );

    // The override is only safe because the art column is a fixed 72px track that
    // the copy (and therefore the name) never enters.
    assert.match(
        css,
        /\.profile-page-card \.jutsu-collection-card\.is-list \.jutsu-collection-select\s*\{[^}]*grid-template-columns:\s*72px minmax\(0, 1fr\);/s,
    );
    assert.match(css, /\.profile-page-card \.jutsu-collection-card\.is-list\s*\{[^}]*min-height:\s*88px;/s);
});

// Bloodline source filter: which learned jutsu come from a bloodline, and
// whether the collection lets the player pick them out.

function bloodlineMarkup(
    learned: Jutsu[],
    bloodlineJutsuNames?: ReadonlyMap<string, string>,
    equippedJutsuIds: string[] = [],
) {
    const base = createCharacter("Bloodline Tester", "Leaf", "Ninjutsu", "None");
    const character = {
        ...base,
        // Opens on the collection tab, which is the only tab that carries the filters.
        onboardingStep: "jutsuLoadout" as const,
        equippedJutsuIds,
        jutsuMastery: learned.map((entry) => ({ jutsuId: entry.id, level: 5, xp: 0 })),
    };
    return renderToStaticMarkup(
        <JutsuLoadoutPanel
            character={character}
            learnedJutsus={learned}
            catalogJutsus={learned}
            bloodlineJutsuNames={bloodlineJutsuNames}
            onPlaceJutsu={() => {}}
            onUnequip={() => {}}
            onUnequipAll={() => {}}
        />,
    );
}

const plainAndBloodline = [jutsu("plain-jutsu", "Ember Palm"), jutsu("bloodline-jutsu", "Ashen Gaze")];

test("offers the bloodline source filter and labels bloodline jutsu when the character has one", () => {
    const html = bloodlineMarkup(plainAndBloodline, new Map([["bloodline-jutsu", "Ashen Eyes"]]));

    assert.match(html, /aria-label="Filter by source"/);
    assert.match(html, /Bloodline Only/);
    assert.match(html, /Sort: Bloodline/);
    // Exactly one card is marked, and the narrow card carries the generic label
    // with the granting bloodline in its tooltip.
    assert.equal((html.match(/jutsu-bloodline-chip/g) ?? []).length, 1);
    assert.match(html, /jutsu-collection-card[^"]*is-bloodline/);
    assert.match(html, /title="Bloodline jutsu — Ashen Eyes"[^>]*>◆ Bloodline</);
});

test("marks a bloodline jutsu the character does not carry, from the rank getAllJutsus stamps", () => {
    // An admin-authored jutsu belonging to someone else's bloodline reaches every
    // player's catalog; it carries bloodlineRank but no entry in the name map.
    const foreign: Jutsu = { ...jutsu("foreign-jutsu", "Borrowed Flame"), bloodlineRank: "A Rank" };
    const html = bloodlineMarkup([foreign], new Map());

    assert.match(html, /aria-label="Filter by source"/);
    assert.match(html, /title="Bloodline jutsu"[^>]*>◆ Bloodline</);
    assert.match(html, /jutsu-collection-card[^"]*is-bloodline/);
});

test("names the granting bloodline in the details panel, where there is room for it", () => {
    const html = bloodlineMarkup(plainAndBloodline, new Map([["bloodline-jutsu", "Ashen Eyes"]]), ["bloodline-jutsu"]);

    assert.match(html, /jutsu-detail-title[\s\S]*?◆ Bloodline · Ashen Eyes/);
});

test("hides the bloodline controls when no learned jutsu comes from a bloodline", () => {
    const html = bloodlineMarkup(plainAndBloodline, new Map());

    assert.doesNotMatch(html, /aria-label="Filter by source"/);
    assert.doesNotMatch(html, /Sort: Bloodline/);
    assert.doesNotMatch(html, /jutsu-bloodline-chip/);
    assert.doesNotMatch(html, /is-bloodline/);
    // The rest of the collection controls are untouched.
    assert.match(html, /aria-label="Sort jutsu"/);
    assert.match(html, /Ember Palm/);
});

test("renders without the lookup at all, for callers that do not pass one", () => {
    const html = bloodlineMarkup(plainAndBloodline);

    assert.doesNotMatch(html, /aria-label="Filter by source"/);
    assert.match(html, /Ember Palm/);
    assert.match(html, /Ashen Gaze/);
});
