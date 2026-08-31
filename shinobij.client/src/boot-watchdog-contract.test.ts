import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

describe("boot watchdog / app constant parity", () => {
    it("uses the same localStorage key the app writes accounts to", () => {
        // If PLAYER_ACCOUNTS_STORAGE is ever renamed, the watchdog would silently
        // read a key that never exists — every returning player would look like a
        // first-time visitor and pay the 193 KB hero preload again.
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
    });

    it("points at an image that ships", () => {
        const href = /LANDING_HERO\s*=\s*'([^']+)'/u.exec(watchdog)?.[1];
        assert.ok(href, "boot-watchdog.js must declare LANDING_HERO");
        // landing-skin.css is what actually paints it; if the two ever disagree
        // the preload warms a file nothing uses, which is worse than no preload.
        const landingSkin = readFileSync(new URL("./styles/landing-skin.css", import.meta.url), "utf8");
        assert.ok(landingSkin.includes(href!), `landing-skin.css must reference ${href}`);
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
