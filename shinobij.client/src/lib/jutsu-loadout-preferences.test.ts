import assert from "node:assert/strict";
import test from "node:test";
import {
    placeNewJutsuPreservingDormant,
} from "./jutsu-loadout-preferences";

test("replacing an active Base slot keeps all three dormant preferences byte-for-byte", () => {
    const ids = Array.from({ length: 15 }, (_, index) => `jutsu-${index + 1}`);
    const next = placeNewJutsuPreservingDormant(ids, "replacement", 12, 4);
    assert.ok(next);
    assert.equal(next.length, 15);
    assert.equal(next[4], "replacement");
    assert.deepEqual(next.slice(12), ids.slice(12));
});

test("a full active loadout refuses an implicit replacement", () => {
    const ids = Array.from({ length: 15 }, (_, index) => `jutsu-${index + 1}`);
    assert.equal(placeNewJutsuPreservingDormant(ids, "replacement", 12), null);
});

test("an open active loadout inserts before any dormant tail", () => {
    const ids = Array.from({ length: 8 }, (_, index) => `jutsu-${index + 1}`);
    assert.deepEqual(
        placeNewJutsuPreservingDormant(ids, "new-jutsu", 12),
        [...ids, "new-jutsu"],
    );
});
