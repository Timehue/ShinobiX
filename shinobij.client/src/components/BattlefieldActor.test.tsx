import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BattlefieldActor } from "./BattlefieldActor";

test("a player with a custom profile portrait still has a bundled body", () => {
    const html = renderToStaticMarkup(<BattlefieldActor side="player" label="Player One" />);
    assert.match(html, /src="\/combat-actors\/starters\/starter-one-idle\.webp"/);
    assert.match(html, /data-battlefield-presentation="sprite"/);
    assert.match(html, /aria-hidden="true"/);
});

test("AI body art renders as a non-interactive full-body sprite", () => {
    const html = renderToStaticMarkup(
        <BattlefieldActor side="enemy" label="Arena Rival" sprite="/assets/rival.webp" />,
    );
    assert.match(html, /enemy-orb battlefield-actor--enemy battlefield-actor--sprite/);
    assert.match(html, /data-battlefield-presentation="sprite"/);
    assert.match(html, /data-battlefield-sprite-kind="humanoid"/);
    assert.match(html, /data-battlefield-facing="left"/);
    assert.match(html, /data-battlefield-native-facing="left"/);
    assert.match(html, /data-battlefield-mirrored="false"/);
    assert.match(html, /class="battlefield-actor-sprite"/);
    assert.doesNotMatch(html, /battlefield-actor-portrait-image/);
});

test("sprite facing mirrors only when display and native directions differ", () => {
    const mirrored = renderToStaticMarkup(
        <BattlefieldActor side="enemy" label="Arena Rival" sprite="/assets/rival.webp" facing="right" />,
    );
    const rightAuthored = renderToStaticMarkup(
        <BattlefieldActor side="enemy" label="Custom Rival" sprite="/assets/custom.webp" facing="right" nativeFacing="right" />,
    );
    assert.match(mirrored, /data-battlefield-facing="right"/);
    assert.match(mirrored, /data-battlefield-native-facing="left"/);
    assert.match(mirrored, /data-battlefield-mirrored="true"/);
    assert.match(rightAuthored, /data-battlefield-native-facing="right"/);
    assert.match(rightAuthored, /data-battlefield-mirrored="false"/);
});

test("creature and boss sprite geometry is selected without changing the actor anchor", () => {
    const creature = renderToStaticMarkup(
        <BattlefieldActor side="enemy" label="Frost Wolf" sprite="/assets/hunt-ai-frost-wolf-idle.webp" />,
    );
    const boss = renderToStaticMarkup(
        <BattlefieldActor side="enemy" label="Ancient Golem" sprite="/assets/clan-boss-golem-idle.webp" />,
    );
    assert.match(creature, /data-battlefield-sprite-kind="quadruped"/);
    assert.match(boss, /data-battlefield-sprite-kind="construct"/);
    assert.match(creature, /class="avatar-orb battlefield-actor/);
    assert.match(boss, /class="avatar-orb battlefield-actor/);
});

test("an actor with unavailable primary art can use its own local battle sprite", () => {
    const html = renderToStaticMarkup(<BattlefieldActor side="enemy" label="Rival" fallbackSprite="/combat-actors/starters/starter-two-idle.webp" />);
    assert.ok(html.includes('src="/combat-actors/starters/starter-two-idle.webp"'));
    assert.match(html, /data-battlefield-facing="left"/);
});
