import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isWorldMapControlTarget, isWorldMapZoomEnabled } from "./use-world-map-zoom";
import { ACADEMY_TRAIL_FOCUS_EVENT, requestAcademyTrailFocus } from "./academy-trail-focus";

test("the mobile map stays off outside the mobile shell, including a stored enable flag", () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    try {
        for (const mobile of [false, true]) {
            Object.defineProperty(globalThis, "window", { configurable: true, value: {
                matchMedia(query: string) {
                    assert.equal(query, "(max-width: 979px)");
                    return { matches: mobile };
                },
            } });
            for (const flag of [null, "0", "1"]) {
                Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => flag } });
                assert.equal(isWorldMapZoomEnabled(), mobile && flag !== "0", `mobile=${mobile}, saved flag=${flag}`);
            }
        }
    } finally {
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
        else Reflect.deleteProperty(globalThis, "window");
        if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
        else Reflect.deleteProperty(globalThis, "localStorage");
    }
});

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

test("a claimed pan cancels its touchmoves so no hidden fling swallows the next tap", () => {
    const source = readFileSync(new URL("./use-world-map-zoom.ts", import.meta.url), "utf8");
    // Native and explicitly non-passive: React attaches touchmove passively, so a
    // preventDefault from a React handler would be ignored.
    assert.match(source, /addEventListener\("touchmove", onTouchMove, \{ passive: false \}\)/);
    // Only a gesture the hook has claimed, and only an event that can be cancelled.
    assert.match(source, /if \(suppressClick\.current && event\.cancelable\) event\.preventDefault\(\);/);
    // Attached only in zoom mode, and re-synced when the mode changes. Removing
    // the listener must also clear the flag, or a later sync would believe the
    // removed guard is still attached and never restore it.
    assert.match(source, /if \(activeRef\.current === touchGuardAttached\) return;/);
    assert.match(source, /activeRef\.current = active;[\s\S]*?syncTouchGuardRef\.current\(\);/);
    assert.match(source, /removeEventListener\("touchmove", onTouchMove\);\s*touchGuardAttached = false;/);
    // Never a touchstart or touchend: cancelling either would cost controls their click.
    assert.doesNotMatch(source, /addEventListener\("touch(start|end)"/);
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

test("a touch tap's focus never pans the camera out from under the finger", () => {
    const source = readFileSync(new URL("./use-world-map-zoom.ts", import.meta.url), "utf8");
    // A touch tap's compatibility mousedown focuses after its pointer-up, so the
    // reveal also skips a focus that arrives between a mousedown and its mouseup.
    assert.match(source, /const pressed = pointers\.current\.size > 0 \|\| mousePressed\.current;\s*mousePressed\.current = false;/);
    assert.match(source, /const onMouseDownCapture = useCallback\(\(\) => \{ mousePressed\.current = true; \}, \[\]\);/);
    assert.match(source, /const onMouseUpCapture = useCallback\(\(\) => \{ mousePressed\.current = false; \}, \[\]\);/);
    assert.match(source, /onFocusCapture,\s*onMouseDownCapture,\s*onMouseUpCapture,/);
});
