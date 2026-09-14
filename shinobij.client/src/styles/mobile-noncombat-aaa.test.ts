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
const sectorFigures = {
    "SectorAvatar.tsx": readFileSync(join(HERE, "..", "components", "SectorAvatar.tsx"), "utf8"),
    "SectorPeers.tsx": readFileSync(join(HERE, "..", "components", "SectorPeers.tsx"), "utf8"),
    "SectorWanderer.tsx": readFileSync(join(HERE, "..", "components", "SectorWanderer.tsx"), "utf8"),
    "SectorWeeklyBossActor.tsx": readFileSync(join(HERE, "..", "components", "SectorWeeklyBossActor.tsx"), "utf8"),
};
const worldSectorCanvas = readFileSync(join(HERE, "..", "components", "WorldSectorCanvas.tsx"), "utf8");

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

test("mobile navigation keeps five anchors and a compact destination sheet", () => {
    const anchorCount = nav.match(/className="mobile-nav-btn(?: menu-btn)?"/g)?.length ?? 0;
    assert.equal(anchorCount, 5, "the persistent bar must keep the five-anchor mobile pattern");
    assert.ok(nav.includes('aria-label="Primary game navigation"'));
    assert.ok(nav.includes("PLAYER_MENU_GROUPS"), "destinations must remain catalog-derived");
    assert.ok(nav.includes("PLAYER_MENU_GROUPS.map"), "the complete destination catalog must render directly");
    assert.ok(!nav.includes('type="search"'), "the compact destination sheet must not include a search field");
    assert.ok(!nav.includes("Find a destination"));
    assert.ok(nav.includes("menuCloseRef.current?.focus"), "opening the sheet must focus its close control");
    assert.ok(!css.includes(".mobile-menu-search"), "removed search controls must not leave dead mobile styling");
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

test("profile dossier accordions fill the mobile content width", () => {
    assert.match(css, /\.screen-profile \.profile-dossier-grid \{[\s\S]*width:\s*100% !important;[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) !important;[\s\S]*justify-items:\s*stretch !important;/);
    assert.match(css, /\.screen-profile \.profile-dossier-section,[\s\S]*\.screen-profile \.profile-dossier-rows,[\s\S]*\.screen-profile \.profile-dossier-row \{[\s\S]*width:\s*100% !important;[\s\S]*max-width:\s*none !important;/);
});

/*
 * The mobile touch floor must not resize the sector board.
 *
 * lib/sector-marker exists so every figure on a 12x12 sector board is drawn at
 * one size (c63f3b4e3). That held on desktop and broke below 980px: the blanket
 * 44px `min-inline-size`/`min-block-size` in this layer clamps anything matching
 * [role="button"], and of the four figure components only the two AI ones are
 * clickable. On a 352px phone (~27.8px tiles, ~20px markers) that painted
 * wanderers at 44px against the player's 20px, and flattened the weekly boss's
 * deliberate 1.5x lead into the same 44px. The same floor cannot widen a
 * `minmax(0, 1fr)` track either, so the 144 .scene-tile buttons overflowed their
 * ~27.8px cells and overlapped, handing taps to a neighbouring tile.
 */
test("the mobile touch floor exempts sector-board geometry", () => {
    const floor = css.match(
        /\n\s*(\.app-shell\[data-ui-mode="noncombat"\] \.center-game :where\(button[^{]*?)\{\s*min-inline-size: 44px !important;\s*min-block-size: 44px !important;\s*\}/,
    );
    assert.ok(floor, "the 44px mobile touch floor must remain in this layer");

    const selector = floor[1];
    // Split on the comma ending each selector half, tolerating either line ending.
    // This repo is `* text=auto` with core.autocrlf=true, so a Windows checkout
    // hands the stylesheet back CRLF-terminated while CI reads it LF-terminated.
    // Splitting on a literal comma+LF passed locally until a rebase re-checked-out
    // the stylesheet as CRLF, and the split then found one half instead of two.
    const halves = selector.split(/,\r?\n/).map((part) => part.trim()).filter(Boolean);
    assert.equal(halves.length, 2, "the floor must keep its in-shell and portaled halves");
    for (const half of halves) {
        assert.match(
            half,
            /:not\(\.sector-avatar-figure, \.scene-tile\)$/,
            `board geometry must be exempt from the touch floor in: ${half}`,
        );
    }
});

test("every clickable sector figure is reached by that exemption, and keeps a full-size hit area", () => {
    // The exemption is keyed to .sector-avatar-figure — the same class the shared
    // geometry sizes. A figure that carries role="button" without it would be
    // silently re-inflated, so assert the pairing at the source.
    for (const [file, source] of Object.entries(sectorFigures)) {
        if (!source.includes('role="button"')) continue;
        assert.match(
            source,
            /className="sector-avatar-figure sector-wanderer-figure"/,
            `${file} is clickable, so it must carry the exempt shared figure class`,
        );
        assert.ok(
            source.includes("sectorMarkerBox("),
            `${file} must size itself from lib/sector-marker`,
        );
    }
    // The board's own tiles are the other exempt selector.
    assert.match(worldSectorCanvas, /className=\{`scene-tile walkable-tile/, "sector tiles must keep the exempt .scene-tile class");

    // A11y is preserved by padding the target, not the portrait.
    assert.match(
        css,
        /\.app-shell\[data-ui-mode="noncombat"\] \.center-game \.sector-wanderer-figure::after \{[\s\S]*?inline-size: max\(44px, 100%\);[\s\S]*?block-size: max\(44px, 100%\);[\s\S]*?pointer-events: auto;/,
        "clickable sector figures must keep a transparent 44px hit area",
    );
});
