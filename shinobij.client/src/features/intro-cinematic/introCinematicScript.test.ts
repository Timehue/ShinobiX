// Guards for the intro-cinematic script data: every real village must have
// dedicated lore lines (a new village silently falling to the generic fallback
// is a content bug, not a crash), placeholders must resolve, and the cinematic
// must always end on the farewell beat the white-out keys off.
import test from "node:test";
import assert from "node:assert/strict";
import { villages } from "../../data/sectors";
import {
    FOX_NAME,
    PRE_GIFT_LINES,
    VILLAGE_LORE_LINES,
    buildPostGiftLines,
    resolveCinematicLine,
} from "./introCinematicScript";

test("every village has dedicated fox lore lines", () => {
    for (const village of villages) {
        const lines = VILLAGE_LORE_LINES[village];
        assert.ok(lines, `missing VILLAGE_LORE_LINES entry for "${village}"`);
        assert.equal(lines.length, 2);
        for (const line of lines) assert.ok(line.trim().length > 0);
    }
});

test("no lore entry points at a village that no longer exists", () => {
    for (const key of Object.keys(VILLAGE_LORE_LINES)) {
        assert.ok(villages.includes(key), `VILLAGE_LORE_LINES has stale village "${key}"`);
    }
});

test("pre-gift script is non-empty and hands off to the companion choice", () => {
    assert.ok(PRE_GIFT_LINES.length >= 8);
    for (const line of PRE_GIFT_LINES) assert.ok(line.text.trim().length > 0);
    // The fox introduces itself by name somewhere before the gift.
    assert.ok(PRE_GIFT_LINES.some((l) => l.text.includes(FOX_NAME)));
    // The warning beat shows the Hollow Gate vision at least once.
    assert.ok(PRE_GIFT_LINES.some((l) => l.vision));
});

test("post-gift script ends on the fading 'save this land' farewell", () => {
    for (const village of [...villages, "Unknown Test Village"]) {
        const lines = buildPostGiftLines(village);
        assert.ok(lines.length >= 5, `post-gift script too short for "${village}"`);
        const last = lines[lines.length - 1];
        assert.ok(last.fading, "final line must dim the fox");
        assert.match(last.text, /save this land/i);
    }
});

test("placeholders resolve with no braces left behind", () => {
    const all = [...PRE_GIFT_LINES, ...buildPostGiftLines(villages[0])];
    for (const line of all) {
        const resolved = resolveCinematicLine(line.text, "Testkage", "Cinder Cub");
        assert.ok(!resolved.includes("{"), `unresolved placeholder in: ${resolved}`);
        assert.ok(!resolved.includes("}"), `unresolved placeholder in: ${resolved}`);
    }
    assert.equal(resolveCinematicLine("{name} and {pet} and {name}", "A", "B"), "A and B and A");
});
