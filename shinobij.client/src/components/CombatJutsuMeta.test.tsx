import { strict as assert } from "node:assert";
import { it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Character } from "../types/character";
import { CombatJutsuMeta } from "./CombatJutsuMeta.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

it("PvP sealed resource costs override drifting local mastery and character data", () => {
    const character = {
        level: 100,
        specialty: "Ninjutsu",
        jutsuMastery: [{ jutsuId: "sealed", level: 50, xp: 0 }],
    } as Character;
    const html = renderToStaticMarkup(
        <CombatJutsuMeta
            character={character}
            jutsu={{ id: "sealed", ap: 40, chakraCost: 1, staminaCost: 2 }}
            sealedResourceCosts={{ chakraCost: 321, staminaCost: 654 }}
        />,
    );
    assert.match(html, /321 CP/);
    assert.match(html, /654 SP/);
    assert.doesNotMatch(html, />1 CP|>2 SP/);
});
