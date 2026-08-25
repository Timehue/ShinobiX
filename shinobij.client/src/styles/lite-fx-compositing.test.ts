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
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "..");
const liteFx = readFileSync(path.join(here, "lite-fx-compositing.css"), "utf8");
const mainTsx = readFileSync(path.join(srcDir, "main.tsx"), "utf8");

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
    assert.match(
        liteFx,
        /-webkit-backdrop-filter: none !important/,
        "Safari/iOS needs the prefixed property too, and iOS is exactly where this matters",
    );
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
