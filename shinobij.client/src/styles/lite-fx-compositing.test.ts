/*
 * Guards for the lite-fx compositing layer (styles/lite-fx-compositing.css).
 *
 * That file drops every `backdrop-filter` on weak devices and hands a heavier
 * tint to the handful of rules whose backing was too thin to stay legible
 * without the blur. Both halves rot silently: the blanket rule stops winning if
 * the import moves, and a compensation turns into dead CSS the moment someone
 * renames the selector it targets. Neither failure is visible on a dev machine,
 * because `.lite-fx` is only applied on low-end phones and under reduced-motion.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "..");
const liteFx = readFileSync(path.join(here, "lite-fx-compositing.css"), "utf8");
const mainTsx = readFileSync(path.join(srcDir, "main.tsx"), "utf8");
// The lightningcss that Vite itself loads for `build.cssMinify`, rather than
// whichever copy happens to be hoisted.
const { transform } = createRequire(fileURLToPath(import.meta.resolve("vite")))(
    "lightningcss",
) as typeof import("lightningcss");

function allCss(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) allCss(p, out);
        else if (entry.endsWith(".css") && entry !== "lite-fx-compositing.css") out.push(p);
    }
    return out;
}

test("lite-fx-compositing.css is the LAST css import in main.tsx", () => {
    const imports = [...mainTsx.matchAll(/^import ['"](\.[^'"]+\.css)['"]/gm)].map((m) => m[1]);
    assert.ok(imports.length > 1, "expected several eager stylesheet imports in main.tsx");
    assert.equal(
        imports.at(-1),
        "./styles/lite-fx-compositing.css",
        "the compositing layer must be imported last so its overrides win the cascade over "
        + "veiled-steel and the adaptive-* layers. Move it back to the end of the import block.",
    );
});

test("the blanket backdrop-filter kill covers elements and both pseudo-elements", () => {
    for (const needle of ["html.lite-fx *", "*::before", "*::after"]) {
        assert.ok(liteFx.includes(needle), `blanket selector must cover ${needle}`);
    }
    assert.match(liteFx, /backdrop-filter: none !important/);
});

/** build.cssTarget from vite.config.ts, encoded the way Vite's convertTargets hands it to lightningcss. */
function viteCssTargets(): Record<string, number> {
    const config = readFileSync(path.resolve(srcDir, "..", "vite.config.ts"), "utf8");
    const list = /cssTarget:\s*\[([^\]]*)\]/.exec(config);
    assert.ok(list, "vite.config.ts no longer sets build.cssTarget as an array literal; update this probe");
    const browsers: Record<string, string> = {
        chrome: "chrome", edge: "edge", firefox: "firefox", ios: "ios_saf", opera: "opera", safari: "safari",
    };
    const targets: Record<string, number> = {};
    for (const [, name, major, minor = "0"] of list[1].matchAll(/['"]([a-z]+)(\d+)(?:\.(\d+))?['"]/g)) {
        assert.ok(browsers[name], `cssTarget entry "${name}${major}" is not mapped here; add it`);
        targets[browsers[name]] = (Number(major) << 16) | (Number(minor) << 8);
    }
    assert.ok(Object.keys(targets).length > 0, "parsed no browsers out of build.cssTarget");
    return targets;
}

test("the production CSS build ships the kill to Chromium and Firefox AND to Safari", () => {
    // Assert on what the minifier emits, not on the source text. The source used
    // to spell out both properties and the build kept only the prefixed one, so
    // Chrome never received this rule (2026-08-25 to 2026-09-10).
    const targets = viteCssTargets();
    const built = transform({
        filename: "lite-fx-compositing.css", code: Buffer.from(liteFx), minify: true, targets,
    }).code.toString();
    const blanket = /html\.lite-fx,html\.lite-fx \*[^{]*\{([^}]*)\}/.exec(built);
    assert.ok(blanket, `the blanket rule is missing from the minified output:\n${built.slice(0, 400)}`);
    assert.match(
        blanket[1],
        /(^|;)backdrop-filter:none!important/,
        "Chromium and Firefox read only the standard property",
    );
    // Safari reads the unprefixed property from 18 on. While the build still
    // targets an older Safari, the build has to supply the prefix, because the
    // source must not (see scripts/lib/css-prefix-collapse.mjs).
    const oldestSafari = Math.min(targets.safari ?? Infinity, targets.ios_saf ?? Infinity);
    if (oldestSafari < 18 << 16) {
        assert.match(
            blanket[1],
            /-webkit-backdrop-filter:none!important/,
            "Safari 17 reads only -webkit-backdrop-filter, and iOS is exactly where lite-fx matters",
        );
    }
});

test("every selector lite-fx compensates still exists in the stylesheets", () => {
    // Class selectors that appear in a `html.lite-fx ...` rule are compensations
    // for a real rule elsewhere. If the real one is gone or renamed, the
    // compensation is dead weight AND the original problem is unhandled.
    // Each selector line ends in either "," (more to come) or " {" (last of the group).
    const compensated = new Set(
        [...liteFx.matchAll(/^html\.lite-fx ([^,{\n*]+?)\s*[,{]\s*$/gm)].map((m) => m[1].trim()),
    );
    assert.ok(compensated.size >= 12, `expected the compensation list, found ${compensated.size}`);

    const corpus = allCss(srcDir).map((f) => readFileSync(f, "utf8")).join("\n");
    const orphaned = [...compensated].filter((sel) => {
        const leaf = sel.split(" ").pop()!; // ".landing-login-highlights span" -> "span"
        const anchor = leaf.startsWith(".") ? leaf : sel.split(" ")[0];
        return !corpus.includes(anchor);
    });
    assert.deepEqual(orphaned, [], "lite-fx compensates selectors that no longer exist");
});

test("compensated backgrounds are opaque enough to replace a blur", () => {
    // The whole point is that the tint carries legibility once the live blur is
    // gone. A compensation below ~0.4 alpha would not.
    const alphas = [...liteFx.matchAll(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)\s*!important/g)]
        .map((m) => parseFloat(m[1]));
    assert.ok(alphas.length >= 6, `expected compensation backgrounds, found ${alphas.length}`);
    const tooThin = alphas.filter((a) => a < 0.4);
    assert.deepEqual(tooThin, [], "a compensation tint below 0.4 alpha cannot stand in for the blur");
});
