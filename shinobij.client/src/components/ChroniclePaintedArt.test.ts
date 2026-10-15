import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CHRONICLE_PAINTED_ART, CHRONICLE_PAINTED_FIGURES } from "../../../shared/chronicle-painted-art";
import { CHRONICLE_TOKEN_CARDS } from "../../../shared/chronicle-duel";
import { CHRONICLE_CARD_CATALOG, displayCatalog, chronicleInventoryCatalog } from "../lib/chronicle-duel";
import { buildChronicleArtManifest } from "../data/chronicle-art-manifest";
import { chronicleFigureSources } from "../lib/chronicle-figure-art";
import { ChronicleCardView } from "./ChronicleCardView";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("published refresh wins over a stale admin image on catalog and audit surfaces", () => {
  const [id, image] = Object.entries(CHRONICLE_PAINTED_ART)[0];
  assert.ok(id, "at least one replacement must be packaged");
  const stale = [{ id, name: "Old upload", rarity: "common" as const, element: "Fire", description: "", image: "data:image/webp;base64,old" }];
  assert.equal(displayCatalog(stale).find(card => card.id === id)?.image, image);
  assert.equal(chronicleInventoryCatalog(stale).find(card => card.id === id)?.image, image);
  assert.equal(buildChronicleArtManifest(stale).find(row => row.cardId === id)?.runtimePath, image);
  for (const [cardId, replacement] of Object.entries(CHRONICLE_PAINTED_ART)) {
    assert.equal([...CHRONICLE_CARD_CATALOG,...CHRONICLE_TOKEN_CARDS].find(card => card.id === cardId)?.image, replacement);
  }
});

test("backpack artwork covers the full catalog while preserving retired creator cards", () => {
  const retired={id:"retired-custom-card",name:"Old custom card",rarity:"rare" as const,element:"Earth",description:"Retired",image:"/custom/retired.webp"};
  const inventory=chronicleInventoryCatalog([retired]);
  assert.equal(inventory.length,CHRONICLE_CARD_CATALOG.length+1);
  assert.deepEqual(inventory.find(card=>card.id===retired.id),retired);
  for(const card of CHRONICLE_CARD_CATALOG) assert.equal(inventory.find(row=>row.id===card.id)?.image,card.image);
});

test("unrefreshed cards retain intentional admin artwork", () => {
  const card = CHRONICLE_CARD_CATALOG.find(card => !CHRONICLE_PAINTED_ART[card.id]);
  if (!card) return; // The invariant becomes irrelevant after full migration.
  const image = "data:image/webp;base64,custom";
  assert.equal(displayCatalog([{ id:card.id, name:card.name, rarity:"common", element:"Fire", description:"", image }]).find(row=>row.id===card.id)?.image, image);
});

test("a refreshed creature never loads an unrelated old front or back figure", () => {
  for (const id of Object.keys(CHRONICLE_PAINTED_ART)) {
    const figures=CHRONICLE_PAINTED_FIGURES[id];
    assert.deepEqual(chronicleFigureSources(id), figures ? [figures.front] : []);
    assert.deepEqual(chronicleFigureSources(id,true), figures ? [figures.back,figures.front] : []);
  }
});

test("holographic coating follows rarity across all card classes without leaking face-down identity", () => {
  for (const card of CHRONICLE_CARD_CATALOG) {
    const markup=renderToStaticMarkup(React.createElement(ChronicleCardView,{card}));
    assert.equal(markup.includes("chronicle-card__foil--holographic"),card.rarity === "legendary" || card.rarity === "mythic",card.id);
  }
  const hidden=renderToStaticMarkup(React.createElement(ChronicleCardView,{card:CHRONICLE_CARD_CATALOG.find(card=>card.rarity==='legendary'),hidden:true}));
  assert.equal(hidden.includes("holographic"),false);
});
