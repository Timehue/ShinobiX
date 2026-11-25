import assert from "node:assert/strict";
import test from "node:test";
import { coastFigureMarker, offeredMarker, wandererMarker } from "./npc-quest-marker";

const w = (id: string, verb: string, archetype = "pilgrim") => ({ id, verb, archetype }) as never;

test("story, event and side quest givers get their own tier", () => {
    assert.equal(wandererMarker(w("legacy-sage", "quest", "wanderingSage"))?.tier, "story");
    assert.equal(wandererMarker(w("emissary-1", "legacyQuest"))?.tier, "story");
    assert.equal(wandererMarker(w("story-reckoning-x", "quest"))?.tier, "story");
    assert.equal(wandererMarker(w("rift-giver-ash", "quest"))?.tier, "event");
    assert.equal(wandererMarker(w("chronicle-scribe", "quest", "courier"))?.tier, "event");
    assert.equal(wandererMarker(w("w-1-2-3", "quest"))?.tier, "side");
});

test("NPCs that offer no quest wear nothing", () => {
    for (const verb of ["attack", "merchant", "medic", "gamble", "watch", "angler"]) assert.equal(wandererMarker(w("w-1", verb)), null);
});

test("nothing is drawn when the player cannot take what is offered", () => {
    const free = { busy: false, locked: [] as string[] };
    assert.equal(offeredMarker(w("w-1-2-3", "quest"), free)?.tier, "side");
    assert.equal(offeredMarker(w("w-1-2-3", "quest"), { ...free, busy: true }), null, "a quest is already under way");
    assert.equal(offeredMarker(w("emissary-1", "legacyQuest"), { ...free, emissaryMetrics: ["a"] })?.tier, "story");
    assert.equal(offeredMarker(w("emissary-1", "legacyQuest"), { ...free, busy: true, emissaryMetrics: ["a"] }), null);
    assert.equal(offeredMarker(w("emissary-1", "legacyQuest"), { ...free, locked: ["a"], emissaryMetrics: ["a"] }), null, "every errand locked");
    assert.equal(offeredMarker(w("story-road-x", "quest"), free)?.tier, "story");
    assert.equal(offeredMarker(w("story-road-x", "quest"), { ...free, busy: true })?.tier, "story", "a story beat is not an errand");
    assert.equal(offeredMarker(w("w-1", "merchant"), free), null);
});

test("a finished quest puts a '?' on the NPCs you can hand it in to", () => {
    const done = { busy: true, ready: true, locked: [] as string[], emissaryMetrics: ["a"] };
    assert.deepEqual([offeredMarker(w("w-1-2-3", "quest"), done)?.glyph, offeredMarker(w("w-1-2-3", "quest"), done)?.tier], ["?", "side"]);
    assert.deepEqual([offeredMarker(w("emissary-1", "legacyQuest"), done)?.glyph, offeredMarker(w("emissary-1", "legacyQuest"), done)?.tier], ["?", "story"]);
    assert.equal(offeredMarker(w("w-1", "merchant"), done), null, "only quest givers take it");
    assert.equal(offeredMarker(w("w-1-2-3", "quest"), { ...done, ready: false }), null, "under way but not finished");
});

test("a coast keeper is a story '?' and a quest boss is a red '?'", () => {
    assert.deepEqual([coastFigureMarker({}).glyph, coastFigureMarker({}).tier], ["?", "story"]);
    assert.equal(coastFigureMarker({ boss: true }).tier, "boss");
});
