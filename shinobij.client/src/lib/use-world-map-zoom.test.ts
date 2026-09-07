import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isWorldMapControlTarget } from "./use-world-map-zoom";
import { ACADEMY_TRAIL_FOCUS_EVENT, requestAcademyTrailFocus } from "./academy-trail-focus";

test("world-map controls retain their pointer so taps can activate them", () => {
    let selectorSeen = "";
    const nestedButtonChild = {
        closest(selector: string) {
            selectorSeen = selector;
            return { tagName: "BUTTON" };
        },
    };

    assert.equal(isWorldMapControlTarget(nestedButtonChild as unknown as EventTarget), true);
    assert.match(selectorSeen, /button/);
    assert.match(selectorSeen, /\[role='button'\]/);
});

test("world-map background remains a pan gesture target", () => {
    const background = { closest: () => null };
    assert.equal(isWorldMapControlTarget(background as unknown as EventTarget), false);
    assert.equal(isWorldMapControlTarget(null), false);
});

test("Find the trail raises the window event the World Map listens for", () => {
    const received: string[] = [];
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
        dispatchEvent(event: Event) { received.push(event.type); return true; },
    };
    try {
        requestAcademyTrailFocus();
    } finally {
        (globalThis as { window?: unknown }).window = previous;
    }
    assert.deepEqual(received, [ACADEMY_TRAIL_FOCUS_EVENT]);
});

test("Find the trail is a no-op outside a browser", () => {
    assert.doesNotThrow(() => requestAcademyTrailFocus());
});

test("the Academy map focus re-aims on Find the trail on both map paths", () => {
    const source = readFileSync(new URL("./use-world-map-zoom.ts", import.meta.url), "utf8");
    assert.match(source, /addEventListener\(ACADEMY_TRAIL_FOCUS_EVENT, onFindTrail\)/);
    assert.match(source, /removeEventListener\(ACADEMY_TRAIL_FOCUS_EVENT, onFindTrail\)/);
    // Zoom camera: fly to the target at the double-tap zoom, like the mount focus.
    assert.match(source, /if \(zoomActive\) \{ focusPoint\(target\.x, target\.y, DOUBLE_TAP_ZOOM\); return; \}/);
    // The legacy scroll map has no camera: scroll the real pin into view instead.
    assert.match(source, /\.atlas-sector\.academy-click-target"\)\s*\?\.scrollIntoView\(\{ block: "center", inline: "center" \}\)/);
});

test("the mount focus survives activation and the address-bar resize", () => {
    const source = readFileSync(new URL("./use-world-map-zoom.ts", import.meta.url), "utf8");
    // The ref callback measures in the LEGACY layout; the zoom class changes the
    // box, so the viewport must be measured again in the same task as the class.
    assert.match(source, /classList\.add\("wm-zoom"\);[\s\S]*?measureRef\.current\(\);/);
    // A resize snaps back to the home view only when the camera IS home (floor
    // zoom AND cover pan), so a trail focus sitting at the floor is kept.
    assert.match(source, /const atHome = !previousSize\.w \|\| \([\s\S]*?Math\.abs\(current\.tx - previousCover\.tx\) <= 1/);
});
