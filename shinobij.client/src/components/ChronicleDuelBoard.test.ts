import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_FIXED_FALLBACK_DECK,
  createMatch,
  projectMatchForViewer,
  type ChronicleDisplayCard,
} from "../lib/chronicle-duel";
import { ChronicleDuelBoard } from "./ChronicleDuelBoard";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("duel board exposes mirrored zones, Health Points, and the active Field Card", () => {
  const state = createMatch(
    "Akari",
    CHRONICLE_FIXED_FALLBACK_DECK,
    "Ren",
    CHRONICLE_FIXED_FALLBACK_DECK,
    () => 0,
    1_000,
  );
  state.phase = "main1";
  state.activeField = {
    cardId: "chronicle-field-volcano",
    fieldId: "volcano",
    owner: "p1",
  };
  const projection = projectMatchForViewer(state, "p1");
  const cardsById = Object.fromEntries(
    CHRONICLE_CARD_CATALOG.map((card) => [card.id, card]),
  ) as Record<string, ChronicleDisplayCard>;

  const html = renderToStaticMarkup(
    React.createElement(ChronicleDuelBoard, {
      state: projection,
      cardsById,
      playerAvatar: "/avatars/akari.webp",
      opponentAvatar: "/avatars/ren.webp",
      onAction: () => undefined,
    }),
  );

  assert.match(html, /Shinobi Journey Chronicle Showdown board/);
  assert.match(html, /OPPONENT FIELD/);
  assert.match(html, /YOUR FIELD/);
  assert.match(html, /OPPONENT DECK/);
  assert.match(html, /YOUR GRAVEYARD/);
  assert.match(html, /FIELD ZONE/);
  assert.match(html, /Volcano/);
  assert.match(html, /Fire \+300 ATK \| Wind -200 ATK/);
  assert.match(html, /chronicle\/fields\/volcano\.webp/);
  assert.match(html, /8,000 <small>HP<\/small>/);
  assert.match(html, /Akari portrait/);
  assert.match(html, /Ren portrait/);
  assert.match(html, /Enlarge Volcano/);
  assert.match(html, /Open readable card/);
  assert.doesNotMatch(html, /Life Points|>LP</);
  assert.equal((html.match(/Face-down Shinobi Journey card/g) ?? []).length, 5);
});

test("face-up opponent cards are inspectable and the acting indicator renders", () => {
  const state = createMatch(
    "Akari",
    CHRONICLE_FIXED_FALLBACK_DECK,
    "Ren",
    CHRONICLE_FIXED_FALLBACK_DECK,
    () => 0,
    1_000,
  );
  state.phase = "main1";
  const monsterId = CHRONICLE_CARD_CATALOG.find(
    (card) => card.cardClass === "monster",
  )!.id;
  state.p2.monsterZones[1] = {
    instanceId: "foe-m1",
    cardId: monsterId,
    owner: "p2",
    zoneIndex: 1,
    position: "attack",
    faceUp: true,
    summonedOnTurn: 1,
    lastPositionChangeTurn: 0,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
  const projection = projectMatchForViewer(state, "p1");
  const cardsById = Object.fromEntries(
    CHRONICLE_CARD_CATALOG.map((card) => [card.id, card]),
  ) as Record<string, ChronicleDisplayCard>;
  const html = renderToStaticMarkup(
    React.createElement(ChronicleDuelBoard, {
      state: projection,
      cardsById,
      aiActing: true,
      onAction: () => undefined,
    }),
  );
  // The Keeper's face-up monster renders as a clickable, inspectable zone.
  assert.match(html, /inspectable/);
  // Pacing indicator: opponent-is-acting chip pulses during the AI replay.
  assert.match(html, /chronicle-ai-acting/);
  assert.match(html, /Ren is acting/);
});

test("turn countdown renders only for timed PvP duels; forfeit requires arming", () => {
  const state = createMatch(
    "Akari",
    CHRONICLE_FIXED_FALLBACK_DECK,
    "Ren",
    CHRONICLE_FIXED_FALLBACK_DECK,
    () => 0,
    1_000,
  );
  state.phase = "main1";
  state.activePlayer = "p1";
  const projection = projectMatchForViewer(state, "p1");
  const cardsById = Object.fromEntries(
    CHRONICLE_CARD_CATALOG.map((card) => [card.id, card]),
  ) as Record<string, ChronicleDisplayCard>;
  const render = (timedTurns?: boolean) =>
    renderToStaticMarkup(
      React.createElement(ChronicleDuelBoard, {
        state: projection,
        cardsById,
        timedTurns,
        onAction: () => undefined,
      }),
    );
  const untimed = render();
  // AI duels have no enforced deadline, so no countdown pressure clock.
  assert.doesNotMatch(untimed, /\|\s*\d+s/);
  // First forfeit click only arms; the initial render never shows the confirm.
  assert.match(untimed, />Forfeit</);
  assert.doesNotMatch(untimed, /Confirm forfeit/);
  // Legal next phases render as clickable rail jumps.
  assert.match(untimed, /chronicle-phase-jump/);
  const timed = render(true);
  assert.match(timed, /\|\s*\d+s/);
});

test("a fresh duel opens with the Showdown splash; a resumed board does not", () => {
  const state = createMatch(
    "Akari",
    CHRONICLE_FIXED_FALLBACK_DECK,
    "Ren",
    CHRONICLE_FIXED_FALLBACK_DECK,
    () => 0,
    1_000,
  );
  const cardsById = Object.fromEntries(
    CHRONICLE_CARD_CATALOG.map((card) => [card.id, card]),
  ) as Record<string, ChronicleDisplayCard>;
  const render = () =>
    renderToStaticMarkup(
      React.createElement(ChronicleDuelBoard, {
        state: projectMatchForViewer(state, "p1"),
        cardsById,
        onAction: () => undefined,
      }),
    );
  const fresh = render();
  assert.match(fresh, /chronicle-splash intro/);
  assert.match(fresh, /takes the first turn/);
  // Animated HP readout still renders the full formatted value.
  assert.match(fresh, /8,000 <small>HP<\/small>/);
  state.turnNumber = 5;
  const resumed = render();
  assert.doesNotMatch(resumed, /chronicle-splash/);
});
