import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CHRONICLE_CARD_CATALOG,
  getChronicleCard,
} from "../lib/chronicle-duel";
import { ChronicleCardView } from "./ChronicleCardView";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function renderCard(id: string, hidden = false): string {
  const card = getChronicleCard(id);
  assert.ok(card, `${id} must exist in the Chronicle catalog`);
  return renderToStaticMarkup(ChronicleCardView({ card, hidden }));
}

test("Monster cards render the complete physical TCG information hierarchy", () => {
  const html = renderCard("tc-142");

  const expectedInOrder = [
    "EFFECT MONSTER",
    "Solar God Beast",
    "LEVEL 8",
    "/chronicle/cards/tc-142.webp",
    "BEAST / EFFECT MONSTER",
    "When this card overpowers a Defense Position Monster",
    "ATK",
    "3200",
    "DEF",
    "2600",
    "SJ-CDX",
    "tc-142",
  ];
  let cursor = -1;
  for (const text of expectedInOrder) {
    const next = html.indexOf(text, cursor + 1);
    assert.ok(next > cursor, `${text} must appear in card-face order`);
    cursor = next;
  }

  assert.doesNotMatch(html, />STRIKE</);
  assert.doesNotMatch(html, />GUARD</);
  assert.doesNotMatch(html, />JUTSU</);
  assert.doesNotMatch(html, />COUNTER</);
});

test("generated Monster lore uses Shinobi Journey flavor text instead of roster copy", () => {
  const solarGodBeast = getChronicleCard("tc-142");
  assert.ok(solarGodBeast);
  assert.equal(solarGodBeast.cardClass, "monster");
  assert.equal(
    solarGodBeast.lore,
    "A fragment of the sun. In the world of Shinobi Journey, its fire chakra blazes through every strike.",
  );

  for (const card of CHRONICLE_CARD_CATALOG) {
    assert.doesNotMatch(card.lore, /ShinobiX/i);
    assert.doesNotMatch(card.lore, /enters the Chronicle|established roster/i);
  }
});

test("Field Jutsu and Snare cards have explicit, distinct physical card identities", () => {
  const field = renderCard("chronicle-field-volcano");
  const trap = renderCard("chronicle-smoke-bomb");
  const counterTrap = renderCard("chronicle-kage-judgment-seal");

  assert.match(field, /FIELD JUTSU/);
  assert.match(field, /JUTSU CARD/);
  assert.match(field, /Fire Monsters gain 300 ATK/);
  assert.match(field, /chronicle\/fields\/volcano\.webp/);

  assert.match(trap, /NORMAL SNARE/);
  assert.match(trap, /SNARE CARD/);
  assert.match(trap, /negate that attack/);
  assert.doesNotMatch(trap, />COUNTER</);
  assert.match(counterTrap, /COUNTER SNARE/);
  assert.match(counterTrap, /COUNTER \/ SNARE CARD/);
});

test("face-down rendering uses the card back and leaks no card identity", () => {
  const html = renderCard("tc-142", true);

  assert.match(html, /Face-down Shinobi Journey card/);
  assert.match(html, /SHINOBI/);
  assert.doesNotMatch(html, /Solar God Beast/);
  assert.doesNotMatch(html, /tc-142/);
  assert.doesNotMatch(html, /3200|2700/);
});

test("every Chronicle catalog entry renders through the same complete card face", () => {
  for (const card of CHRONICLE_CARD_CATALOG) {
    const html = renderToStaticMarkup(ChronicleCardView({ card }));
    assert.ok(html.includes(card.id), `${card.id} must render its stable ID`);
    assert.match(html, /chronicle-card__art-frame/);
    assert.match(html, /chronicle-card__dossier/);
    assert.match(html, /SJ-CDX/);

    if (card.cardClass === "monster") {
      assert.match(
        html,
        card.monsterType === "effect" ? /EFFECT MONSTER/ : /NORMAL MONSTER/,
      );
      if (card.monsterType === "effect") assert.ok(card.effectText?.trim());
      assert.match(html, />ATK</);
      assert.match(html, />DEF</);
    } else if (card.cardClass === "magic") {
      assert.match(html, /JUTSU CARD/);
    } else {
      assert.match(
        html,
        card.trapType === "counter" ? /COUNTER SNARE/ : /NORMAL SNARE/,
      );
      assert.match(html, /SNARE CARD/);
    }
  }
});
