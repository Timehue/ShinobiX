// Guards for the intro-cinematic script data: every real village must have
// dedicated lore lines (a new village silently falling to the generic fallback
// is a content bug, not a crash), placeholders must resolve, and the cinematic
// must always end on the farewell beat the white-out keys off.
import test from "node:test";
import assert from "node:assert/strict";
import { villages } from "../../data/sectors";
import {
    COMPANION_VILLAGE_FLAVOR,
    FOX_NAME,
    PRE_GIFT_LINES,
    VILLAGE_LORE_LINES,
    buildCompanionIntroLines,
    buildPostGiftLines,
    buildVowResponseLines,
    resolveCinematicLine,
} from "./introCinematicScript";
import { ACADEMY_VOWS } from "../../lib/academy-narrative";

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

test("intro limits Shiranui to the machine and rescue he directly witnessed", () => {
    const copy = [...PRE_GIFT_LINES, ...buildPostGiftLines(villages[0])].map((line) => line.text).join(" ");
    assert.match(copy, /Sunken Court mason marks cover its housing/i);
    assert.match(copy, /shrine lintel calls it the Hollow Gate/i);
    assert.match(copy, /I do not know why the Court built it/i);
    assert.match(copy, /I know it measures people because I have watched the marks change/i);
    assert.match(copy, /machine beneath the road tried to identify you and pull you in/i);
    assert.match(copy, /brought you here before it could succeed/i);
    assert.match(copy, /slate kept clearing instead of naming a place for you/i);
    assert.match(copy, /failed record, not a destiny/i);
    assert.doesNotMatch(copy, /Four intakes beneath the villages|takes a human choice and turns it into something useful/i);
    assert.doesNotMatch(copy, /before your kind first drew breath|it hungers|held the seal/i);
    assert.doesNotMatch(copy, /\bchosen\b/i);
});

test("post-gift script ends on a personal fading farewell", () => {
    for (const village of [...villages, "Unknown Test Village"]) {
        const lines = buildPostGiftLines(village);
        assert.ok(lines.length >= 5, `post-gift script too short for "${village}"`);
        const last = lines[lines.length - 1];
        assert.ok(last.fading, "final line must dim the fox");
        assert.match(last.text, /wish I could walk the rest of this road with you/i);
        assert.match(last.text, /do not let the Gate choose for us/i);
    }
});

test("every identity vow receives an immediate and later callback", () => {
    for (const vow of ACADEMY_VOWS) {
        const response = buildVowResponseLines(vow.id).map((line) => line.text).join(" ");
        const farewell = buildPostGiftLines(villages[0], vow.id).map((line) => line.text).join(" ");
        const companion = buildCompanionIntroLines(villages[0], "Cinder Cub", vow.id).map((line) => line.text).join(" ");
        assert.match(response, new RegExp(vow.shiranuiResponse.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.ok(farewell.includes(vow.quote), `farewell does not recall ${vow.id}`);
        assert.ok(companion.includes(vow.companionCallback), `companion does not recall ${vow.id}`);
    }
});

test("every village has companion-intro flavor and the beat asks to guide", () => {
    for (const village of villages) {
        assert.ok(COMPANION_VILLAGE_FLAVOR[village], `missing COMPANION_VILLAGE_FLAVOR for "${village}"`);
        const lines = buildCompanionIntroLines(village, "Cinder Cub");
        assert.ok(lines.length >= 3);
        for (const line of lines) {
            assert.ok(line.text.trim().length > 0);
            assert.equal(line.label, "Cinder Cub");
        }
        assert.match(lines[lines.length - 1].text, /guide/i);
    }
    // Unknown villages fall back gracefully instead of crashing the beat.
    assert.ok(buildCompanionIntroLines("Nowhere Village", "Pup").length >= 3);
});

test("placeholders resolve with no braces left behind", () => {
    const all = [...PRE_GIFT_LINES, ...buildVowResponseLines("seeker"), ...buildPostGiftLines(villages[0], "seeker"), ...buildCompanionIntroLines(villages[0], "Cinder Cub", "seeker")];
    for (const line of all) {
        const resolved = resolveCinematicLine(line.text, "Testkage", "Cinder Cub");
        assert.ok(!resolved.includes("{"), `unresolved placeholder in: ${resolved}`);
        assert.ok(!resolved.includes("}"), `unresolved placeholder in: ${resolved}`);
    }
    assert.equal(resolveCinematicLine("{name} and {pet} and {name}", "A", "B"), "A and B and A");
});

test("player-facing intro dialogue uses clean punctuation and reveals the chosen world", () => {
    const allLines = [
        ...PRE_GIFT_LINES,
        ...buildPostGiftLines(villages[0]),
        ...buildCompanionIntroLines(villages[0], "Cinder Cub"),
    ];
    for (const line of allLines) {
        assert.ok(!line.text.includes("—"), `em dash remains in player-facing line: ${line.text}`);
    }
    const postGift = buildPostGiftLines(villages[0]);
    assert.ok(postGift.some((line) => line.worldReveal), "post-gift sequence must reveal the player's village");
    assert.ok(postGift.at(-1)?.worldReveal, "the world reveal must remain visible through the farewell");
    const spokenCopy = allLines.map((line) => line.text).join(" ");
    assert.doesNotMatch(spokenCopy, /save this land|stronger than any blade|grow stronger together/i);
});
