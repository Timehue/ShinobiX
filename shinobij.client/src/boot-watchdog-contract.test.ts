import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";
import { PLAYER_ACCOUNTS_STORAGE } from "./constants/game";

// public/boot-watchdog.js is a PRE-MODULE classic script: it is fetched and run
// before Vite's module graph so it can recover a failed entry bundle, and it is
// external rather than inline because production's script-src is 'self'. That
// means it cannot import anything from the bundle, so the few values it shares
// with the app are duplicated as literals. These tests are the only thing
// stopping those copies from drifting.
const watchdog = readFileSync(new URL("../public/boot-watchdog.js", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const bootSplashCss = /<style id="boot-splash-style">([\s\S]*?)<\/style>/u.exec(indexHtml)?.[1] ?? "";

describe("boot watchdog / app constant parity", () => {
    it("uses the same localStorage key the app writes accounts to", () => {
        // If PLAYER_ACCOUNTS_STORAGE is ever renamed, the watchdog would silently
        // read a key that never exists — every returning player would look like a
        // first-time visitor and pay the 171 KB hero preload again.
        assert.match(
            watchdog,
            new RegExp(`PLAYER_ACCOUNTS_STORAGE\\s*=\\s*'${PLAYER_ACCOUNTS_STORAGE}'`, "u"),
            `boot-watchdog.js must read '${PLAYER_ACCOUNTS_STORAGE}' — keep it in step with src/constants/game.ts`,
        );
    });
});
describe("landing hero preload", () => {
    it("is not a static preload in index.html", () => {
        // A static <link rel=preload> fires for EVERY visitor, including the
        // returning players who restore straight into the game and never paint
        // the landing screen. The whole point of moving it is that it must not
        // be in the markup.
        assert.doesNotMatch(
            indexHtml,
            /<link[^>]+rel="preload"[^>]+landing-hero/u,
            "the landing hero must not be statically preloaded — boot-watchdog.js injects it conditionally",
        );
    });

    it("is injected by the watchdog, gated on there being no saved account", () => {
        assert.match(watchdog, /function preloadLandingHero\(\)/u);
        assert.match(watchdog, /if \(hasSavedAccount\(\)\) return;/u,
            "the injection must be gated — that gate is the entire saving");
        assert.match(watchdog, /rel = 'preload'/u);
        assert.match(watchdog, /setAttribute\('fetchpriority', 'high'\)/u,
            "a first-time visitor's LCP still wants the high-priority hint");
        assert.match(watchdog, /^\s*preloadLandingHero\(\);/mu,
            "the injector must actually be called at install time");
        assert.match(watchdog, /document\.documentElement\.classList\.add\('landing-guest'\)/u,
            "the static splash must receive the same first-visit gate as the hero preload");
    });

    it("points at an image that ships", () => {
        const desktopHref = /LANDING_HERO_DESKTOP\s*=\s*'([^']+)'/u.exec(watchdog)?.[1];
        const mobileHref = /LANDING_HERO_MOBILE\s*=\s*'([^']+)'/u.exec(watchdog)?.[1];
        assert.ok(desktopHref, "boot-watchdog.js must declare LANDING_HERO_DESKTOP");
        assert.ok(mobileHref, "boot-watchdog.js must declare LANDING_HERO_MOBILE");
        // The watchdog, inline splash and landing CSS must select the same
        // responsive file or the high-priority preload is wasted.
        const landingSkin = readFileSync(new URL("./styles/landing-home.css", import.meta.url), "utf8");
        assert.ok(landingSkin.includes(desktopHref!), `landing-home.css must reference ${desktopHref}`);
        assert.ok(landingSkin.includes(mobileHref!), `landing-home.css must reference ${mobileHref}`);
        assert.ok(bootSplashCss.includes(desktopHref!), `boot-splash.css must paint ${desktopHref}`);
        assert.ok(bootSplashCss.includes(mobileHref!), `boot-splash.css must paint ${mobileHref}`);
        assert.match(watchdog, /matchMedia\('\(max-width: 560px\)'\)\.matches[\s\S]*?landingHero = LANDING_HERO_MOBILE/u,
            "phone-sized first visits must preload the smaller composition");
        assert.match(bootSplashCss, /html\.landing-guest #boot-splash/u,
            "the landing art must be omitted from saved-session restore screens");
        assert.ok(bootSplashCss, "the critical boot splash styles must be inline before the app module starts");
        for (const href of [desktopHref!, mobileHref!]) {
            const assetPath = new URL(href, "https://shinobijourney.com").pathname;
            const asset = new URL(`../public${assetPath}`, import.meta.url);
            const size = statSync(asset).size;
            assert.ok(size <= 256 * 1024, `the first-visit hero preload must stay within its 256 KiB transfer budget (actual ${size} B for ${assetPath})`);
        }
    });

    it("fails open: an unreadable localStorage preloads rather than skipping", () => {
        // Private mode and a corrupt value must land on `return false` (preload),
        // never on a thrown error or an accidental "has account". Guessing wrong
        // in this direction costs what already shipped; guessing the other way
        // costs a first-time visitor their LCP image.
        const body = /function hasSavedAccount\(\)\s*\{[\s\S]*?\n {4}\}/u.exec(watchdog)?.[0] ?? "";
        assert.ok(body.includes("catch"), "hasSavedAccount must swallow storage errors");
        assert.match(body, /catch \(_error\) \{\s*return false;/u,
            "the catch must return false (preload), not true");
    });
});
