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
