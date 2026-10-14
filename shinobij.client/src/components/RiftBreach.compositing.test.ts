import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The rift energy overlay animates for as long as its chamber is on screen. A
// Chrome trace (2026-10-14) showed what keeps that cheap: its keyframes touch
// only opacity and transform, so every animation runs on the compositor, and the
// card around it has no live backdrop-filter. With the shared `.card` blur, the
// compositor re-read and re-blurred the whole card backdrop on every frame
// (12 of 16.7 ms per frame in software compositing, 1 ms without it).
const root = join(process.cwd(), "shinobij.client", "src");
const css = readFileSync(join(root, "components", "underground-sector.css"), "utf8");
const sharedCard = readFileSync(join(root, "styles", "index", "14-menu-panels-bloodline-vn.css"), "utf8");

function keyframes(source: string, prefix: string) {
    const blocks = new Map<string, string>();
    for (const match of source.matchAll(new RegExp(`@keyframes (${prefix}[\\w-]*)\\s*\\{`, "g"))) {
        const start = match.index! + match[0].length;
        let depth = 1, end = start;
        for (; end < source.length && depth > 0; end++) depth += source[end] === "{" ? 1 : source[end] === "}" ? -1 : 0;
        blocks.set(match[1], source.slice(start, end - 1));
    }
    return blocks;
}

test("rift energy keyframes animate only compositor properties", () => {
    const blocks = keyframes(css, "rift-");
    assert.ok(blocks.size >= 3, `expected the rift energy keyframes, found: ${[...blocks.keys()].join(", ")}`);
    for (const [name, body] of blocks) {
        const properties = new Set([...body.matchAll(/([\w-]+)\s*:/g)].map(m => m[1]));
        assert.deepEqual([...properties].filter(p => p !== "opacity" && p !== "transform"), [], `${name} animates a property the compositor cannot run`);
    }
});

test("the rift card keeps no live backdrop blur behind its animating overlay", () => {
    assert.match(sharedCard, /\.center-game > \.card,[\s\S]*?backdrop-filter: blur\(3px\) !important;/, "the shared card blur changed; re-check the rift override");
    const override = css.match(/^([^{}\n]*\.underground-world--rift[^{}\n]*)\{\s*backdrop-filter:\s*none !important;\s*\}/m);
    assert.ok(override, "underground-sector.css lost the rift card's backdrop-filter override");
    const classes = override[1].match(/\.[\w-]+/g)?.length ?? 0;
    assert.ok(classes > 2, `${override[1].trim()} must out-rank .center-game > .card without relying on load order`);
    // Dropping the blur is invisible only while the card hides what is behind it.
    const backing = css.match(/\.hollow-gate-shrine\.underground-world--rift \{[^}]*background: linear-gradient\(([^)]*)\) !important/)?.[1] ?? "";
    const alphas = [...backing.matchAll(/#[0-9a-f]{6}([0-9a-f]{2})\b/gi)].map(m => parseInt(m[1], 16) / 255);
    assert.ok(alphas.length >= 2 && alphas.every(alpha => alpha >= 0.9),
        `the rift card backing must stay at least 90% opaque, found: ${alphas.map(alpha => alpha.toFixed(2)).join(", ") || "none"}`);
});
