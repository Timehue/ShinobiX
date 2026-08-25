import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, "mobile-noncombat-aaa.css"), "utf8");
const main = readFileSync(join(HERE, "..", "main.tsx"), "utf8");
const shell = readFileSync(join(HERE, "..", "components", "layout", "AdaptiveGameShell.tsx"), "utf8");
const app = readFileSync(join(HERE, "..", "App.tsx"), "utf8");
const nav = readFileSync(join(HERE, "..", "components", "MobileNav.tsx"), "utf8");
const training = readFileSync(join(HERE, "..", "screens", "Training.tsx"), "utf8");
const jutsuCss = readFileSync(join(HERE, "jutsu-training-skin.css"), "utf8");
const missionCss = readFileSync(join(HERE, "hub-screens-skin.css"), "utf8");

test("AAA mobile layer is last and battle-gated at the shell boundary", () => {
    assert.ok(shell.includes('data-ui-mode={uiMode}'), "the adaptive shell must publish its UI mode");
    assert.ok(
        app.includes('uiMode={hideBattleChrome || isBattleViewScreen(screen) ? "combat" : "noncombat"}'),
        "App must derive mobile UI mode from the canonical battle-chrome boundary",
    );
    assert.ok(
        css.match(/data-ui-mode="noncombat"/g)?.length && (css.match(/data-ui-mode="noncombat"/g)?.length ?? 0) >= 20,
        "authenticated mobile rules must remain explicitly non-combat scoped",
    );
    assert.ok(css.includes("body:not(.in-battle)"), "portaled mobile surfaces must stand down during battle");
    assert.ok(!css.includes('data-ui-mode="combat"'), "the mobile product layer must not target combat mode");

    const adaptiveIndex = main.indexOf("./styles/layout/adaptive-tools.css");
    const mobileIndex = main.indexOf("./styles/mobile-noncombat-aaa.css");
    assert.ok(adaptiveIndex >= 0 && mobileIndex > adaptiveIndex, "the final mobile layer must load after adaptive authorities");
    assert.ok(main.includes("window.matchMedia('(max-width: 979px)')"), "the mobile-only layer must stay out of the desktop initial graph");
    assert.ok(main.includes("import('./styles/mobile-noncombat-aaa.css')"), "the product layer must remain an async mobile chunk");
    assert.ok(main.includes("mobileProductViewport.addEventListener('change', ensureMobileProductLayer)"), "desktop-to-mobile resize must request the layer");
});

test("portaled combat suppresses ambient mobile hint expansion before body mode settles", () => {
    const screenHintSelectors = [...css.matchAll(/([^{}]+\.screen-hint-(?:banner|copy|dismiss|inline)[^{}]*)\{/g)]
        .map((match) => match[1].trim());
    assert.ok(screenHintSelectors.length >= 6, "the mobile layer must retain its screen-hint treatments");
    for (const selector of screenHintSelectors) {
        assert.ok(
            selector.includes(":not(:has(> .combat-instance))"),
            `combat portal exclusion missing from ${selector}`,
        );
    }
});

test("mobile navigation keeps five anchors and a searchable destination sheet", () => {
    const anchorCount = nav.match(/className="mobile-nav-btn(?: menu-btn)?"/g)?.length ?? 0;
    assert.equal(anchorCount, 5, "the persistent bar must keep the five-anchor mobile pattern");
    assert.ok(nav.includes('aria-label="Primary game navigation"'));
    assert.ok(nav.includes("PLAYER_MENU_GROUPS"), "destinations must remain catalog-derived");
    assert.ok(nav.includes("visibleMenuGroups.map"), "the destination catalog must render through its filtered view");
    assert.ok(nav.includes('type="search"'));
    assert.ok(nav.includes("Find a destination"));
    assert.ok(nav.includes("menuSearchRef.current?.focus"), "opening the sheet must focus destination search");
    assert.ok(css.includes(".mobile-menu-search"), "the search control must retain its mobile treatment");
    assert.match(css, /mobile-menu-overlay > :where\([^)]+mobile-menu-groups\)[^{]*\{[^}]*flex:\s*0 0 auto;/s);
});

test("mobile jutsu cards open readable details with the training action inside", () => {
    assert.ok(training.includes('window.matchMedia("(max-width: 800px)").matches'));
    assert.ok(training.includes('className="jutsu-mobile-info-modal"'));
    assert.ok(training.includes("void startPaidJutsuTraining()"));
    assert.match(jutsuCss, /\.jutsu-training-screen \.technique-selected-panel \{ display: none; \}/);
    assert.match(jutsuCss, /\.jutsu-training-screen \.technique-grid \{ grid-template-columns: minmax\(0, 1fr\); max-height: none;/);
});

test("accepted field missions keep their abandon action in mobile flow", () => {
    assert.match(missionCss, /\.mh-field-card\.mh-field-accepted \.mh-fetch-actions \{[\s\S]*display: contents;/);
    assert.match(missionCss, /\.mh-field-secondary-action \{[\s\S]*min-height: 30px;/);
});
