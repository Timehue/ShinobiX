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

test("grid tiles keep the badge anchored to the bottom-right of the tile", () => {
    assert.match(
        css,
        /\.profile-page-card \.jutsu-equipped-badge\s*\{[^}]*position:\s*absolute;[^}]*right:\s*7px;[^}]*bottom:\s*46px;/s,
    );
});

test("list rows re-anchor the badge into the art column, clear of the jutsu name", () => {
    // The list row is half a grid tile tall and centres its copy column, so the
    // tile's `bottom: 46px` lands on the name; the override must drop both of the
    // inherited anchors, not just add new ones.
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
