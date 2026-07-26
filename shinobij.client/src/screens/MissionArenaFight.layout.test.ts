import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const missionSource = readFileSync(new URL("./MissionArenaFight.tsx", import.meta.url), "utf8");
const missionCss = readFileSync(new URL("../styles/mission-arena-fight.css", import.meta.url), "utf8");
const battleSkinCss = readFileSync(new URL("../styles/battle-skin.css", import.meta.url), "utf8");

// The combat shell places its bands in a FIXED-track grid — `.combat-main-area`
// on desktop, `.combat-layout` on mobile (where `.combat-main-area` flattens to
// `display: contents`) — and orders them with `order` / explicit `grid-row`.
// A conditional extra child with the default `order: 0` sorts ahead of every
// band and takes row 1, pushing them all down one track: the terrain strip
// inherits the board's minmax(300px, 1fr) row and the hex board collapses into
// the command bar's `auto` row. Measured on this screen: 362px -> 30px, i.e. the
// board vanished the moment a jutsu was armed. `has-rookie-tip` is the class
// that reserves the extra track on every tier.
test("mission fight reserves a row for its action notice instead of displacing the board", () => {
    assert.match(
        missionSource,
        /combat-layout\$\{hasActionNotice \? " has-rookie-tip" : ""\}/,
        "the combat grid must be marked whenever the action notice is rendered",
    );

    assert.match(
        missionSource,
        /const hasActionNotice = !!reject \|\| showTargetingHint;/,
        "the marker must track BOTH conditional notices, not just one of them",
    );

    // Both notices must live inside the single wrapper. Two bare children would
    // need two extra tracks, and `has-rookie-tip` only reserves one.
    const wrapper = missionSource.match(
        /<div className="combat-action-notice">([\s\S]*?)<\/div>\s*\)\}/,
    );
    assert.ok(wrapper, "the notices must be wrapped in a single .combat-action-notice grid child");
    assert.match(wrapper![1], /className="rookie-combat-tip"/, "the rejection alert belongs in the wrapper");
    assert.match(wrapper![1], /className="combat-targeting-hint"/, "the targeting hint belongs in the wrapper");

    // Nothing may render either notice as a direct child of .combat-main-area.
    assert.equal(
        (missionSource.match(/className="combat-targeting-hint"/g) ?? []).length,
        1,
        "exactly one targeting-hint element, and it must be the wrapped one",
    );

    // Mobile flattens .combat-main-area with display:contents and pins every band
    // to an explicit outer-grid row, so the wrapper needs its own pin there.
    assert.match(
        missionCss,
        /\.combat-layout\.has-rookie-tip \.combat-action-notice\s*\{[^}]*grid-row:\s*2\s*!important;/,
        "mobile must pin the notice to the reserved row below the fighter HUDs",
    );

    // ...and that pin must be gated on the SAME breakpoint as the sibling pins it
    // sits alongside. battle-skin's block was widened 800 -> 1023 to close the
    // responsive dead band; a stale bound here would silently leave the notice
    // unpinned in exactly that range, which is how this drifted the first time.
    const siblingPinBound = (() => {
        const anchor = battleSkinCss.indexOf(".combat-layout.has-rookie-tip .rookie-combat-tip");
        assert.ok(anchor > 0, "battle-skin must still pin Arena's rookie tip on the flattened grid");
        const bounds = [...battleSkinCss.slice(0, anchor).matchAll(/@media \(max-width:\s*(\d+)px\)\s*\{/g)];
        return bounds.length ? bounds[bounds.length - 1][1] : null;
    })();
    assert.ok(siblingPinBound, "could not read the sibling pins' breakpoint out of battle-skin.css");
    const noticeBound = (() => {
        const anchor = missionCss.indexOf(".combat-layout.has-rookie-tip .combat-action-notice");
        const bounds = [...missionCss.slice(0, anchor).matchAll(/@media \(max-width:\s*(\d+)px\)\s*\{/g)];
        return bounds.length ? bounds[bounds.length - 1][1] : null;
    })();
    assert.equal(
        noticeBound,
        siblingPinBound,
        `the notice pin is gated at max-width ${noticeBound}px but the sibling band pins it lines up with are gated at ${siblingPinBound}px — they must match`,
    );

    // The fix is load-bearing on that class still reserving a track.
    assert.ok(
        (battleSkinCss.match(/\.combat-layout\.has-rookie-tip(?: \.combat-main-area)?\s*\{[^}]*grid-template-rows:[^}]*\}/g) ?? []).length >= 3,
        "battle-skin must still reserve the extra tip row on desktop, mobile, and short-mobile",
    );
});
