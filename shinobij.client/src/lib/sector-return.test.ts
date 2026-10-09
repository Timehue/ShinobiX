import { test } from "node:test";
import assert from "node:assert/strict";
import { consumeReloadIntoSector, peekReloadIntoSector, worldMapReopenTarget } from "./sector-return";

test("the reload signal can be peeked without consuming it, and is gone once consumed", () => {
    // Under node there is no navigation timing entry, so both reads false —
    // the contract under test is that peek never flips the one-shot.
    const peeked = peekReloadIntoSector();
    assert.equal(typeof peeked, "boolean");
    assert.equal(peekReloadIntoSector(), peeked, "peeking is idempotent");
    consumeReloadIntoSector();
    assert.equal(peekReloadIntoSector(), false, "after consumption nothing reads as a reload");
    assert.equal(consumeReloadIntoSector(), false);
});

test("explicit World Map overview clears the one-shot local-sector reopen marker", () => {
    assert.equal(worldMapReopenTarget("missions", 1), 1, "ordinary Travel can reopen the current field sector");
    assert.equal(worldMapReopenTarget("missions", 1, true), null, "explicit World Map opens the global overview");
    assert.equal(worldMapReopenTarget("worldMap", 1), null, "reopening the map does not loop into sector detail");
    assert.equal(worldMapReopenTarget("tavern", 0), null, "village Travel starts at the overview");
});

test("closing a fight fought over the field goes back into that sector", () => {
    // The sealed fight is an overlay, so the screen under it is still the map.
    // This is the bug: closing it read as "map to map" and landed on the overview.
    assert.equal(worldMapReopenTarget("worldMap", 12, false, true), 12, "a World Map fight returns to its sector");
    assert.equal(worldMapReopenTarget("logbook", 12, false, true), 12);
    assert.equal(worldMapReopenTarget("worldMap", 0, false, true), null, "a fight launched from a village has no sector to reopen");
    assert.equal(worldMapReopenTarget("worldMap", 12, true, true), null, "an explicit overview request still wins");
});

test("every AI fight close asks for the field it was fought on", async () => {
    const { readFileSync } = await import("node:fs");
    const hook = readFileSync(new URL("./use-ai-fight-close-navigation.ts", import.meta.url), "utf8");
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    assert.match(hook, /navigateRef\.current\(pending\.returnScreen as Screen, undefined, \{ returningFromFight: true \}\)/u);
    assert.match(app, /worldMapReopenTarget\(screen, currentSectorRef\.current, options\?\.worldMapOverview, options\?\.returningFromFight\)/u);
});
