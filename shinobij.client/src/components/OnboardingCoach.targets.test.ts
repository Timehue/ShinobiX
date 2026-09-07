import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coach = readFileSync(new URL("./OnboardingCoach.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./onboarding-coach.css", import.meta.url), "utf8");

function screenSource(name: string) {
    return readFileSync(new URL(`../screens/${name}.tsx`, import.meta.url), "utf8");
}

test("a dialog that owns the screen stands the coaching banner down", () => {
    // The banner is fixed at z-index 9000, well above --z-modal (1100) and the
    // mobile Shinobi Menu (2000), so every dialog opened mid-tutorial had the
    // speech bubble painted across it — the Inventory popup's "Equip to <slot>"
    // button included, during the beat that asks the player to equip. The
    // signal is the ref-counted lock every screen-owning overlay already sets,
    // so the banner stands down for all of them and returns when the last one
    // closes. e2e/academy-coach-occlusion.spec.ts measures the real layering.
    const ui = readFileSync(new URL("../styles/ui.css", import.meta.url), "utf8");
    assert.match(ui, /body\.ui-scroll-locked \.onboarding-coach-banner \{[^}]*visibility: hidden;/);

    const lock = readFileSync(new URL("../lib/useBodyScrollLock.ts", import.meta.url), "utf8");
    assert.match(lock, /classList\.add\("ui-scroll-locked"\)/);
    assert.match(lock, /classList\.remove\("ui-scroll-locked"\)/);

    // The three layers that sit between --z-modal and the banner. Each must keep
    // raising that signal or its own dialog goes back under the bubble.
    for (const [file, source] of [
        ["ui/Modal.tsx", readFileSync(new URL("./ui/Modal.tsx", import.meta.url), "utf8")],
        ["MobileNav.tsx", readFileSync(new URL("./MobileNav.tsx", import.meta.url), "utf8")],
        ["MobileProfileSheet.tsx", readFileSync(new URL("./MobileProfileSheet.tsx", import.meta.url), "utf8")],
    ] as const) {
        assert.match(source, /useBodyScrollLock\(open\)/, `${file} must raise the screen-owned signal`);
    }
});

test("Academy coach explains and safely reveals the highlighted target", () => {
    assert.match(coach, /Follow the gold pulse/);
    assert.match(coach, /academy-click-target\[data-academy-autoscroll='true'\]/);
    assert.match(coach, /MutationObserver/);
    assert.match(coach, /step === "academySpar" && sparKnockedOut/);
    assert.match(coach, /step === "academySpar" && sparKnockedOut && screen === "hospital"/);
    assert.match(coach, /candidate\.offsetParent !== null/);
    assert.match(coach, /rect\.left >= 16/);
    assert.match(coach, /rect\.right <= window\.innerWidth - 16/);
    // The bottom reserve is MEASURED off the banner, never a flat constant: the
    // bubble is 148-218px tall depending on the line, so a fixed number let the
    // coach call a target visible while its own speech bubble covered it.
    assert.match(coach, /querySelector<HTMLElement>\("\.onboarding-coach-banner"\)/);
    assert.match(coach, /rect\.bottom <= clearOfBanner/);
    assert.match(css, /\.academy-click-target/);
    assert.match(css, /overflow: visible !important/);
    assert.match(css, /Next · click here/);
    assert.match(css, /outline-offset: 9px/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.academy-click-target[\s\S]*?animation: none/);
});

test("every clickable Academy path screen marks its real next action", () => {
    for (const screen of ["Training", "Profile", "Inventory", "Cafeteria", "Hospital", "Missions", "WorldMap"]) {
        assert.match(
            screenSource(screen),
            /academy-click-target/,
            `${screen} should expose an Academy click target`,
        );
    }

    const loadout = readFileSync(new URL("./JutsuLoadoutPanel.tsx", import.meta.url), "utf8");
    assert.match(loadout, /academyRecommendedJutsuId/);
    assert.match(loadout, /Next · equip this/);

    const worldMap = screenSource("WorldMap");
    const worldMapZoom = readFileSync(new URL("../lib/use-world-map-zoom.ts", import.meta.url), "utf8");
    assert.match(worldMap, /useAcademyWorldMapFocus\(/);
    assert.match(worldMapZoom, /focusPoint\(target\.x, target\.y, DOUBLE_TAP_ZOOM\)/);
    assert.match(worldMap, /data-academy-autoscroll=\{academySectorTargetId === sector\.id/);
    assert.match(worldMap, /academy-map-target-label/);
    assert.match(css, /atlas-sector\.academy-click-target::after[\s\S]*?display: none !important/);
});

test("the World Map beat collapses the banner to a chip that can re-aim the camera", () => {
    // On a phone the 148-218px bubble sat over the bottom ~40% of the map
    // viewport it was pointing at (and hid the region chips under it), while
    // saying nothing the pulsing target pin does not. So on the map, with the
    // trail not yet found, the coach renders a one-line chip instead — same
    // banner class, so the nav clearance, the dialog stand-down and the reveal
    // measurement all still apply — and "Find the trail" re-aims the camera
    // through the window event the map's focus hook listens for.
    assert.match(coach, /if \(!visitedSector && screen === "worldMap"\) return renderTrailChip\(\);/);
    assert.match(coach, /className="onboarding-coach-banner coach-trail-chip"/);
    assert.match(coach, /className="coach-trail-chip-find" onClick=\{requestAcademyTrailFocus\}/);
    assert.match(coach, /import \{ requestAcademyTrailFocus \} from "\.\.\/lib\/academy-trail-focus";/);
    // The chip keeps the full coaching line for screen readers.
    assert.match(coach, /coach-trail-chip[\s\S]*?className="coach-guide-sr" aria-live="polite">\{bannerText\}/);
    assert.match(css, /\.coach-trail-chip \{\s*pointer-events: none;/);
    assert.match(css, /\.coach-trail-chip-pill \{[^}]*pointer-events: auto;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.coach-trail-chip-pill[\s\S]*?animation: none/);
    const worldMapZoom = readFileSync(new URL("../lib/use-world-map-zoom.ts", import.meta.url), "utf8");
    assert.match(worldMapZoom, /addEventListener\(ACADEMY_TRAIL_FOCUS_EVENT, onFindTrail\)/);
});
