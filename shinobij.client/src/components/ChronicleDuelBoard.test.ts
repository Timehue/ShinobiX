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

  assert.match(html, /Shinobi Journey Chronicle Duel board/);
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
