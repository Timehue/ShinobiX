/*
 * Google OAuth brand-verification guards for the public home page.
 *
 * Google rejected this app TWICE — once for "home page does not explain the
 * purpose", once for "app name does not match" — and both times the page looked
 * fine to a human with JavaScript on. The failure modes are specific and quiet,
 * so they are pinned here rather than left to reviewer roulette:
 *
 *   1. The rendered hero must state, in plain words, that this is a free
 *      role-playing game played in a browser. Flavour text alone is not an
 *      answer to "what does this app do".
 *   2. The app name must appear VERBATIM and match the consent screen. It was
 *      once an uppercase string joined by a non-breaking space, which no text
 *      comparison would match.
 *   3. A reviewer (or crawler) that does not execute JavaScript receives only
 *      index.html, so the name and purpose must ALSO exist in static markup —
 *      a bare 5 KB shell is what got rejected the first time.
 *   4. The consent flow requires a discoverable privacy policy on the home page.
 *
 * None of this constrains the hook: the hero may lead with atmosphere, as long
 * as the plain-language sentence is still there.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, "..", "..");
const startScreen = readFileSync(path.join(here, "StartScreen.tsx"), "utf8");
const indexHtml = readFileSync(path.join(clientRoot, "index.html"), "utf8");

/*
 * Read APP_NAME from source rather than importing it: StartScreen.tsx reaches a
 * stylesheet, and the node test runner (tsx) cannot load .css — the same reason
 * ChronicleCardInspector documents for not importing its own stylesheet.
 */
const APP_NAME = (() => {
    const m = startScreen.match(/export const APP_NAME = "([^"]+)";/);
    assert.ok(m, "StartScreen.tsx must export a literal APP_NAME");
    return m[1];
})();

/** The hero paragraph, source text with JSX expressions left in place. */
const tagline = (() => {
    const m = startScreen.match(/<p className="landing-tagline">([\s\S]*?)<\/p>/);
    assert.ok(m, "the landing hero paragraph (.landing-tagline) is missing");
    return m[1].replace(/\s+/g, " ").trim();
})();

test("the app name is exactly what the consent screen shows", () => {
    assert.equal(APP_NAME, "Shinobi Journey");
    // Plain spaces only: a non-breaking space or an uppercase variant reads as a
    // different string to Google's comparison even though it looks identical.
    assert.ok(!/[^\x20-\x7E]/.test(APP_NAME), "APP_NAME must be plain ASCII: a non-breaking space or a look-alike glyph renders identically but never matches the consent screen");
    assert.equal(APP_NAME, APP_NAME.trim());
});

test("the hero states the app's purpose in plain words", () => {
    assert.match(
        tagline,
        /\{APP_NAME\}/,
        "the hero must render APP_NAME verbatim rather than a hardcoded or styled variant",
    );
    for (const phrase of ["free", "role-playing game", "in your browser"]) {
        assert.ok(
            tagline.toLowerCase().includes(phrase),
            `the hero must say "${phrase}" in plain words — a reviewer should not have to `
            + `interpret flavour text to learn what this app is. Current text: ${tagline}`,
        );
    }
});

test("the hero describes the world from live data, not a hardcoded count", () => {
    // This line once claimed five villages. Brand review asks that the page
    // represent the app accurately, so the number is read from the real data.
    assert.match(
        tagline,
        /\{villages\.length\} rival villages/,
        "keep the village count bound to live data so the claim cannot drift",
    );
});

test("a visitor without JavaScript still gets the name and the purpose", () => {
    // index.html is everything a non-executing fetch receives. React replaces it
    // on first render, so this markup exists solely for that audience.
    assert.ok(
        indexHtml.includes(`>${APP_NAME}<`),
        "index.html must contain the app name as static text, not only inside the React tree",
    );
    const description = indexHtml.match(/<meta name="description" content="([^"]+)"/);
    assert.ok(description, "index.html needs a meta description");
    for (const phrase of ["free", "browser"]) {
        assert.ok(
            description[1].toLowerCase().includes(phrase),
            `the meta description must say "${phrase}"`,
        );
    }
    // The boot splash carries the prose a JS-less reviewer actually reads.
    const splash = indexHtml.match(/id="boot-splash"[\s\S]*?<\/noscript>/);
    assert.ok(splash, "the static boot splash is missing");
    assert.ok(
        /free role-playing game|free .{0,20}game/i.test(splash[0]),
        "the boot splash must explain in plain words what this app is",
    );
});

test("the home page exposes a privacy policy the consent flow can point at", () => {
    assert.match(
        startScreen,
        /LEGAL_PAGE_LINKS\.map/,
        "the landing footer must render the legal policy links",
    );
    const legal = readFileSync(path.join(here, "..", "data", "legal.ts"), "utf8");
    assert.match(legal, /slug: "privacy"/, "a privacy policy page must exist and be linked");
    assert.match(legal, /slug: "terms"/, "a terms page must exist and be linked");
});
