import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coach = readFileSync(new URL("./OnboardingCoach.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./onboarding-coach.css", import.meta.url), "utf8");

function screenSource(name: string) {
    return readFileSync(new URL(`../screens/${name}.tsx`, import.meta.url), "utf8");
}

test("Academy coach explains and safely reveals the highlighted target", () => {
    assert.match(coach, /Follow the gold pulse/);
    assert.match(coach, /academy-click-target\[data-academy-autoscroll='true'\]/);
    assert.match(coach, /MutationObserver/);
    assert.match(coach, /step === "academySpar" && sparKnockedOut/);
    assert.match(coach, /step === "academySpar" && sparKnockedOut && screen === "hospital"/);
    assert.match(coach, /candidate\.offsetParent !== null/);
    assert.match(coach, /rect\.left >= 16/);
    assert.match(coach, /rect\.right <= window\.innerWidth - 16/);
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
    assert.match(worldMap, /wmZoom\.focusPoint\(target\.x, target\.y, 2\.6\)/);
    assert.match(worldMap, /data-academy-autoscroll=\{academySectorTargetId === sector\.id/);
    assert.match(worldMap, /academy-map-target-label/);
    assert.match(css, /atlas-sector\.academy-click-target::after[\s\S]*?display: none !important/);
});
