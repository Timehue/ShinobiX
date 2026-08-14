import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BattlefieldActor } from "./BattlefieldActor";

test("player portraits render as grounded markers inside the fixed actor anchor", () => {
    const html = renderToStaticMarkup(
        <BattlefieldActor side="player" label="Player One" portrait="/api/img?id=avatar" />,
    );
    assert.match(html, /class="avatar-orb battlefield-actor battlefield-actor--player battlefield-actor--marker"/);
    assert.match(html, /data-battlefield-presentation="marker"/);
    assert.match(html, /battlefield-actor-pin/);
    assert.match(html, /battlefield-actor-portrait-image/);
    assert.match(html, /aria-hidden="true"/);
});

test("AI body art renders as a non-interactive full-body sprite", () => {
    const html = renderToStaticMarkup(
        <BattlefieldActor side="enemy" label="Arena Rival" sprite="/assets/rival.webp" portrait="/assets/portrait.webp" />,
    );
    assert.match(html, /enemy-orb battlefield-actor--enemy battlefield-actor--sprite/);
    assert.match(html, /data-battlefield-presentation="sprite"/);
    assert.match(html, /data-battlefield-sprite-kind="humanoid"/);
    assert.match(html, /class="battlefield-actor-sprite"/);
    assert.doesNotMatch(html, /battlefield-actor-portrait-image/);
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

test("missing art keeps a readable marker fallback", () => {
    const html = renderToStaticMarkup(
        <BattlefieldActor side="enemy" label="Unknown Rival" fallback="UR" />,
    );
    assert.match(html, /battlefield-actor--marker/);
    assert.match(html, />UR<\/span>/);
});
