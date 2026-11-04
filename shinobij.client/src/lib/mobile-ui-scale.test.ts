import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import {
    BASE_VIEWPORT_CONTENT,
    MOBILE_UI_SCALE,
    PHONE_MAX_SHORT_SIDE,
    isWebKitOnlyBrowser,
    viewportContentFor,
    viewportScaleFor,
} from "./mobile-ui-scale";
import { VIEWPORT_BREAKPOINTS } from "./viewport-contract";

test("portrait phones draw menus 15% smaller, with the zoom-out floor pinned", () => {
    assert.equal(MOBILE_UI_SCALE, 0.85);
    assert.equal(viewportScaleFor({ portraitPhone: true, fullScaleHeld: false }), 0.85);
    assert.equal(
        viewportContentFor({ portraitPhone: true, fullScaleHeld: false }),
        "width=device-width, initial-scale=0.85, minimum-scale=0.85, viewport-fit=cover",
    );
});

test("the widest scaled phone still lays out in the phone shell", () => {
    assert.ok(PHONE_MAX_SHORT_SIDE / MOBILE_UI_SCALE < VIEWPORT_BREAKPOINTS.sm);
});

test("combat, card and map holds, desktops, tablets and landscape keep the shipped viewport", () => {
    assert.equal(viewportScaleFor({ portraitPhone: true, fullScaleHeld: true }), 1);
    assert.equal(viewportScaleFor({ portraitPhone: false, fullScaleHeld: false }), 1);
    assert.equal(viewportContentFor({ portraitPhone: true, fullScaleHeld: true }), BASE_VIEWPORT_CONTENT);
    // index.html ships the PHONE viewport; the boot script resets everything
    // else to the base one before the first layout (tested below).
    const indexHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const phoneContent = viewportContentFor({ portraitPhone: true, fullScaleHeld: false });
    assert.ok(indexHtml.includes(`content="${phoneContent}"`), "index.html ships the phone viewport");
});

test("only WebKit-only browsers are held back", () => {
    const androidChrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    const samsung = "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36";
    const androidFirefox = "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0";
    const iphoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
    const iphoneChrome = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1";
    const ipadDesktopMode = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
    assert.equal(isWebKitOnlyBrowser(androidChrome), false);
    assert.equal(isWebKitOnlyBrowser(samsung), false);
    assert.equal(isWebKitOnlyBrowser(androidFirefox), false);
    assert.equal(isWebKitOnlyBrowser(iphoneSafari), true);
    assert.equal(isWebKitOnlyBrowser(iphoneChrome), true);
    assert.equal(isWebKitOnlyBrowser(ipadDesktopMode, "MacIntel", 5), true);
});

test("every combat, card-game and world-map root holds the full-scale viewport", () => {
    const holders: Record<string, RegExp> = {
        "../components/CombatInstance.tsx": /useFullScaleViewport\(\);/,
        "../components/layout/AdaptiveGameShell.tsx": /useFullScaleViewport\(uiMode === "combat"\);/,
        "../components/PetShowdownBattle.tsx": /useFullScaleViewport\(\);/,
        "../components/PetBoardArena.tsx": /useFullScaleViewport\(\);/,
        "../screens/PetArena.tsx": /useFullScaleViewport\(fullscreenBattleActive\);/,
        "../components/ChronicleDuelBoard.tsx": /useFullScaleViewport\(\);/,
        "../screens/CardHall.tsx": /useFullScaleViewport\(\);/,
        "../components/CardPackOpening.tsx": /useFullScaleViewport\(\);/,
        "../screens/WorldMap.tsx": /useFullScaleViewport\(\);/,
        "../components/PetWarfrontRite.tsx": /useFullScaleViewport\(\);/,
        "../screens/EchoesOfWar.tsx": /useFullScaleViewport\(\);/,
        "../components/ChronicleCardInspector.tsx": /useFullScaleViewport\(Boolean\(card\)\);/,
    };
    for (const [path, pattern] of Object.entries(holders)) {
        assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), pattern, path);
    }
});

test("the scale is re-checked when the window resizes without rotating", () => {
    // A portrait window widened past phone size (split screen, a foldable
    // opening) must drop back to 1.0, or the layout crosses into desktop.
    const source = readFileSync(new URL("./mobile-ui-scale.ts", import.meta.url), "utf8");
    assert.match(source, /window\.addEventListener\("resize", apply/);
    assert.match(source, /Math\.min\(window\.screen\.width, window\.screen\.height\)/);
});

test("nothing rewrites the viewport on a pointer change or caps the zoom", () => {
    // A pointer-change listener fired just before reload (e2e touch emulation),
    // set 1.0, and Chrome restored that zoom on the next load. A maximum-scale
    // cap lifted two frames later zoomed the page to 1.0 by itself.
    const source = readFileSync(new URL("./mobile-ui-scale.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /\(pointer: coarse\)"\)\.addEventListener/);
    assert.doesNotMatch(source, /maximum-scale=\$\{/);
});

test("the pre-module boot script picks the same viewport before the first layout", () => {
    // A phone must never load through a 1.0 viewport: with one, Chrome could
    // restore 1.0 after a reload and leave the 85% layout cut off.
    const watchdog = readFileSync(new URL("../../public/boot-watchdog.js", import.meta.url), "utf8");
    const androidChrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    const iphoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
    const shipped = viewportContentFor({ portraitPhone: true, fullScaleHeld: false });
    const run = (userAgent: string, width: number, height: number, coarse = true): string => {
        // Starts from what index.html ships.
        let content = shipped;
        const meta = { setAttribute: (_name: string, value: string) => { content = value; } };
        const window = {
            navigator: { userAgent, platform: "Linux armv8l", maxTouchPoints: 5 },
            matchMedia: (query: string) => ({ matches: query === "(pointer: coarse)" ? coarse : false }),
            screen: { width, height, orientation: { type: height >= width ? "portrait-primary" : "landscape-primary" } },
        };
        const document = { querySelector: (selector: string) => (selector === 'meta[name="viewport"]' ? meta : null) };
        // Only the first IIFE is the early scale; the watchdog after it needs a
        // real DOM, so run the scale block on its own.
        const end = watchdog.indexOf("(function installBootWatchdog");
        assert.ok(end > 0, "the early scale block sits before the watchdog");
        vm.runInNewContext(watchdog.slice(0, end), { window, document, Math });
        return content;
    };
    assert.equal(run(androidChrome, 390, 844), viewportContentFor({ portraitPhone: true, fullScaleHeld: false }));
    assert.equal(run(androidChrome, 470, 900), viewportContentFor({ portraitPhone: true, fullScaleHeld: false }));
    assert.equal(run(iphoneSafari, 390, 844), BASE_VIEWPORT_CONTENT, "WebKit keeps the shipped viewport");
    assert.equal(run(androidChrome, 844, 390), BASE_VIEWPORT_CONTENT, "landscape keeps the shipped viewport");
    assert.equal(run(androidChrome, 800, 1280), BASE_VIEWPORT_CONTENT, "tablets keep the shipped viewport");
    assert.equal(run(androidChrome, 390, 844, false), BASE_VIEWPORT_CONTENT, "a mouse keeps the shipped viewport");
});

test("keyboard detection compares the visual scale with the base scale, not 1", () => {
    const contract = readFileSync(new URL("./use-viewport-contract.ts", import.meta.url), "utf8");
    assert.match(contract, /viewport\.scale - currentViewportBaseScale\(\)/);
});
