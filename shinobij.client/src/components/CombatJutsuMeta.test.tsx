import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Character } from "../types/character";
import { CombatJutsuMeta } from "./CombatJutsuMeta";
import { adjustedCombatApCost, combatMethodLabel, combatTargetLabel } from "../lib/combat-action-display";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const character = {
    name: "Parity Shinobi",
    level: 1,
    specialty: "Ninjutsu",
    jutsuMastery: [{ jutsuId: "parity-jutsu", level: 50, xp: 0 }],
} as Character;

test("shared jutsu card metadata exposes adjusted AP, geometry, cooldown, target, method, and resource cost", () => {
    const html = renderToStaticMarkup(<CombatJutsuMeta
        character={character}
        jutsu={{
            id: "parity-jutsu",
            ap: 40,
            range: 4,
            cooldown: 7,
            type: "Ninjutsu",
            target: "EMPTY_GROUND",
            method: "AOE_BURST",
            chakraCost: 100,
            staminaCost: 0,
        }}
        statuses={[{ name: "Lag", percent: 50 }, { name: "Overclock", percent: 20 }]}
        activeCooldown={2}
    />);

    assert.match(html, /48 AP · R4 · CD 2 left/);
    assert.match(html, /Burst · Ground/);
    assert.match(html, /25 CP/);
    assert.doesNotMatch(html, /SP/);
});

test("display AP adjustment mirrors resolver ordering and label normalization", () => {
    assert.equal(adjustedCombatApCost([{ name: "Lag", percent: 50 }, { name: "Overclock", percent: 20 }], 40), 48);
    assert.equal(combatMethodLabel("AOE_CIRCLE"), "Circle");
    assert.equal(combatMethodLabel("INSTANT_EFFECT"), "Instant");
    assert.equal(combatTargetLabel("SELF"), "Self");
    assert.equal(combatTargetLabel("OPPONENT"), "Enemy");
});
