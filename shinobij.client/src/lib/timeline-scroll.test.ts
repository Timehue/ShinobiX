import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { isFollowingEnd, scrollLeftAfterPrepend } from "./timeline-scroll";

// ─── Auto-follow gating ───────────────────────────────────────────────────────
// A new action may only pull the strip if the reader was already at the end.

test("a reader parked at the end is following", () => {
    assert.equal(isFollowingEnd({ scrollLeft: 600, clientWidth: 400, scrollWidth: 1000 }), true);
});

test("a reader scrolled back into the fight is NOT following", () => {
    // Looking at round 2 of a long fight — a new action must not yank them away.
    assert.equal(isFollowingEnd({ scrollLeft: 100, clientWidth: 400, scrollWidth: 1000 }), false);
});

test("sub-pixel and momentum overshoot still count as following", () => {
    // 599.6 + 400 = 999.6, a hair short of 1000. Without slack this reads as
    // "scrolled away" and silently disables auto-follow forever.
    assert.equal(isFollowingEnd({ scrollLeft: 599.6, clientWidth: 400, scrollWidth: 1000 }), true);
    assert.equal(isFollowingEnd({ scrollLeft: 580, clientWidth: 400, scrollWidth: 1000 }), true);
});

test("just outside the slack window is not following", () => {
    assert.equal(isFollowingEnd({ scrollLeft: 570, clientWidth: 400, scrollWidth: 1000 }), false);
});

test("a strip too short to scroll is trivially following", () => {
    assert.equal(isFollowingEnd({ scrollLeft: 0, clientWidth: 800, scrollWidth: 400 }), true);
});

test("the slack window is configurable", () => {
    assert.equal(isFollowingEnd({ scrollLeft: 500, clientWidth: 400, scrollWidth: 1000 }, 0), false);
    assert.equal(isFollowingEnd({ scrollLeft: 500, clientWidth: 400, scrollWidth: 1000 }, 200), true);
});

// ─── Prepend re-anchoring ─────────────────────────────────────────────────────
// Loading older actions must leave the SAME content under the viewport.

test("loading older entries shifts scrollLeft by exactly the growth", () => {
    // 300px of older actions were prepended; the reader stays on what they read.
    const next = scrollLeftAfterPrepend({ scrollWidth: 1000, scrollLeft: 250 }, 1300);
    assert.equal(next, 550);
});

test("re-anchoring holds the viewport steady in content terms", () => {
    const before = { scrollWidth: 1000, scrollLeft: 250 };
    const afterWidth = 1600;
    const next = scrollLeftAfterPrepend(before, afterWidth);
    // Distance from the RIGHT edge is what must be preserved: the newest action
    // is still exactly as far away as it was.
    const rightBefore = before.scrollWidth - before.scrollLeft;
    const rightAfter = afterWidth - next;
    assert.equal(rightAfter, rightBefore);
});

test("a reader at the very start is pushed to keep their place", () => {
    assert.equal(scrollLeftAfterPrepend({ scrollWidth: 1000, scrollLeft: 0 }, 1400), 400);
});

test("no growth means no movement — a spurious call cannot nudge the strip", () => {
    assert.equal(scrollLeftAfterPrepend({ scrollWidth: 1000, scrollLeft: 250 }, 1000), 250);
});

test("a shrinking strip is left alone rather than scrolled backwards", () => {
    assert.equal(scrollLeftAfterPrepend({ scrollWidth: 1000, scrollLeft: 250 }, 800), 250);
});

// ─── Structural accessibility ─────────────────────────────────────────────────
// Same idiom the repo already uses for structural guarantees (see
// mobile-touch-targets.test.ts): assert on the source so a refactor that drops
// an aria contract fails the build rather than silently shipping.

const timelineSrc = readFileSync(new URL("../components/BattleActionTimeline.tsx", import.meta.url), "utf8");
const roundLogSrc = readFileSync(new URL("../components/DurableBattleRoundLog.tsx", import.meta.url), "utf8");
const detailsSrc = readFileSync(new URL("../components/BattleActionDetails.tsx", import.meta.url), "utf8");

test("timeline actions are real buttons, not clickable divs", () => {
    assert.match(timelineSrc, /<button\s+type="button"\s+className={`bt-node/s);
});

test("each timeline action carries a spoken label with actor, action, round and result", () => {
    // The aria string is assembled from these parts.
    assert.match(timelineSrc, /aria-label={aria}/);
    for (const part of ["round \\${entry.round}", "action \\${entry.seq}", "damage", "battle end"]) {
        assert.match(timelineSrc, new RegExp(part), `aria label should mention ${part}`);
    }
});

test("selection state is exposed to assistive tech, not just styled", () => {
    assert.match(timelineSrc, /aria-pressed={selected}/);
});

test("filters are keyboard-operable buttons with pressed state", () => {
    assert.match(timelineSrc, /className={`bt-filter\$\{[^}]*\}`}\s*\n\s*aria-pressed={actorFilter === f}/s);
    assert.match(timelineSrc, /role="group"\s+aria-label="Filter actions by fighter"/);
});

test("hide-basic is a real checkbox input, so it is keyboard reachable", () => {
    assert.match(timelineSrc, /<input\s+type="checkbox"/s);
});

test("round accordions report their expanded state", () => {
    assert.match(roundLogSrc, /aria-expanded={open}/);
});

test("category is conveyed as a WORD, not by colour alone", () => {
    assert.match(timelineSrc, /CATEGORY_WORD/);
    assert.match(timelineSrc, /\{CATEGORY_WORD\[category\]\}/);
});

test("vital deltas carry an explicit sign rather than relying on colour", () => {
    assert.match(detailsSrc, /\{positive \? "\+" : ""\}\{value\}/);
});

test("a missing image falls back to a category glyph", () => {
    assert.match(timelineSrc, /entry\.display\?\.imageRef\s*\n?\s*\?\s*<img/s);
    assert.match(timelineSrc, /CATEGORY_GLYPH\[category\]/);
});

test("receipt narrative is rendered as text, never as raw HTML", () => {
    for (const [name, src] of [["details", detailsSrc], ["round log", roundLogSrc], ["timeline", timelineSrc]] as const) {
        assert.ok(!src.includes("dangerouslySetInnerHTML"), `${name} must not inject receipt content as HTML`);
    }
});
