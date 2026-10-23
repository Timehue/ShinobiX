import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Measured 2026-10-22 (.tmp/lag-probe, a Hollow Gate walk of 8 steps on a
// 4x-throttled phone, Chromium invalidation tracing): one `:has()` whose
// argument held an attribute selector (`details[open]`, `[data-layout="roomy"]`,
// `input[type=radio]`, `img[data-pet-art]`, `:not([hidden])`) or a `:not()`
// (`.card:not(.back)`) made Chrome re-check every page-level `:has()` anchor
// (html, body, the app shell) on each DOM change anywhere: about 1,500-2,900
// re-checks per walk instead of 0, and ~330 ms of restyling instead of ~190 ms.
// Each rule of those shapes was tested alone and each caused it; `:checked`,
// `:focus-visible` and class-only arguments did not. A rule inside a media
// query counts from the size where it matches (the card game's were >=1024px),
// and a lazily loaded sheet counts once its screen has been visited. Key the
// state on a class instead.
const root = join(process.cwd(), "shinobij.client", "src");

function cssFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) cssFiles(path, out);
        else if (path.endsWith(".css")) out.push(path);
    }
    return out;
}

/** Every `:has(...)` argument in a stylesheet, with balanced parentheses. */
function hasArguments(css: string): string[] {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const found: string[] = [];
    for (let at = text.indexOf(":has("); at >= 0; at = text.indexOf(":has(", at + 5)) {
        let depth = 1, end = at + 5;
        while (end < text.length && depth) { if (text[end] === "(") depth++; else if (text[end] === ")") depth--; end++; }
        found.push(text.slice(at + 5, end - 1));
    }
    return found;
}

const SLOW_ARGUMENT = /\[|:not\(/;

test("no :has() argument uses an attribute selector or :not()", () => {
    const offenders = cssFiles(root).flatMap(file => hasArguments(readFileSync(file, "utf8"))
        .filter(argument => SLOW_ARGUMENT.test(argument))
        .map(argument => `${relative(root, file)}: :has(${argument.replace(/\s+/g, " ").trim()})`));
    assert.deepEqual(offenders, [], "these :has() arguments re-check every page-level :has() on each DOM change; put the state on a class");
});

test("the scan sees :has() arguments, nested parentheses included, and flags both slow shapes", () => {
    assert.deepEqual(hasArguments(".a:has(> .b:not([hidden])) .c, .d:has(.e) {}"), ["> .b:not([hidden])", ".e"]);
    assert.ok(SLOW_ARGUMENT.test("details[open]") && SLOW_ARGUMENT.test("> .card:not(.back)"));
    assert.ok(!SLOW_ARGUMENT.test("input:checked") && !SLOW_ARGUMENT.test("> :focus-visible") && !SLOW_ARGUMENT.test("> .card.face-up"));
    // `:not(:has(...))` puts :has inside :not; only the argument of :has is scanned.
    assert.deepEqual(hasArguments(".z:not(:has(.card)) > span {}"), [".card"]);
    assert.ok(cssFiles(root).some(file => hasArguments(readFileSync(file, "utf8")).length > 0), "the client CSS still uses :has()");
});
