import { strict as assert } from "node:assert";
import test from "node:test";
import { COMBAT_COVER_SELECTOR, combatCoverPresent, isCoveredByCombat, subscribeCombatCover } from "./combat-cover";

test("the cover selector names the fight boundary exactly as CombatInstance renders it", () => {
    assert.equal(COMBAT_COVER_SELECTOR, "body > .combat-instance");
});

test("combatCoverPresent reads the DOM and never throws on a missing or odd root", () => {
    const seen: string[] = [];
    const root = { querySelector: (q: string) => { seen.push(q); return q === COMBAT_COVER_SELECTOR ? {} : null; } } as unknown as ParentNode;
    assert.equal(combatCoverPresent(root), true);
    assert.deepEqual(seen, [COMBAT_COVER_SELECTOR]);
    assert.equal(combatCoverPresent({ querySelector: () => null } as unknown as ParentNode), false);
    assert.equal(combatCoverPresent({ querySelector: () => { throw new Error("detached"); } } as unknown as ParentNode), false);
    assert.equal(combatCoverPresent(null), false);
    assert.equal(combatCoverPresent(undefined), false);
});

test("without a document (node, SSR) nothing is covered and subscribing is harmless", () => {
    assert.equal(typeof document, "undefined");
    assert.equal(isCoveredByCombat(), false);
    let calls = 0;
    const off = subscribeCombatCover(() => { calls++; });
    assert.equal(typeof off, "function");
    off();
    assert.equal(calls, 0);
});
