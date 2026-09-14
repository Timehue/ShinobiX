/*
 * A universal selector must never give elements a transition.
 *
 * The classic reduced-motion reset, `* { transition-duration: 0.01ms }`, looks
 * harmless, but the initial `transition-property` is `all`. Every element that
 * had no transition of its own gets a transition of every property, so a resize
 * turns each fluid width, font size and grid track into a transition, and each
 * one fires a bubbling `transitionend`. On WebKit, a board's grid `auto` rows
 * then stayed sized for the previous width after a resize, which pushed the PvP
 * board's last row out of its panel at 800x360 for players with Reduce Motion
 * on (measured 2026-09-10). A zero duration kills a transition without creating
 * one, so a universal rule may say `0s` or `none`, and nothing longer.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function allCss(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) allCss(p, out);
        else if (entry.endsWith(".css")) out.push(p);
    }
    return out;
}

/** A block of declarations and every selector it is scoped by, outermost first. */
type StyleRule = { file: string; line: number; selectors: string[]; body: string };

function styleRules(file: string): StyleRule[] {
    // Blank comments out but keep their newlines, so line numbers stay true.
    const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
    const rules: StyleRule[] = [];
    const open: Array<{ prelude: string; body: string; line: number }> = [];
    let start = 0;
    let line = 1;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === "\n") {
            line++;
        } else if (ch === "{") {
            // Text up to the last `;` belongs to the enclosing block (a nested
            // rule's parent declarations, or an @import); the rest is the prelude.
            const segment = text.slice(start, i);
            const cut = segment.lastIndexOf(";") + 1;
            if (open.length > 0) open[open.length - 1].body += segment.slice(0, cut);
            open.push({ prelude: segment.slice(cut).trim(), body: "", line });
            start = i + 1;
        } else if (ch === "}") {
            const block = open.pop();
            assert.ok(block, `${file}:${line} closes a block that was never opened`);
            block.body += text.slice(start, i);
            // Declarations in a nested @media apply to the style rules around it.
            const selectors = [...open, block].map((b) => b.prelude).filter((p) => !p.startsWith("@"));
            if (selectors.length > 0) rules.push({ file, line: block.line, selectors, body: block.body });
            start = i + 1;
        }
    }
    assert.equal(open.length, 0, `${file} has unclosed blocks`);
    return rules;
}

let corpus: StyleRule[] | undefined;
const allRules = () => (corpus ??= allCss(srcDir).flatMap(styleRules));

// Attribute selectors like [class*="rarity-"] contain a `*` that is not one.
const isUniversal = (rule: StyleRule) => rule.selectors.some((s) => s.replace(/\[[^\]]*\]/g, "").includes("*"));

/** The declarations in `body` that give a transition a positive time. */
function positiveTransitionTimes(body: string): string[] {
    return body.split(";")
        .map((declaration) => declaration.trim())
        .filter((declaration) => /^(-webkit-)?transition(-duration|-delay)?\s*:/i.test(declaration))
        .filter((declaration) => [...declaration.matchAll(/(-?\d*\.?\d+)(ms|s)\b/gi)].some((m) => Number(m[1]) > 0));
}

test("the rule scanner sees the universal rules it is meant to police", () => {
    const universal = allRules().filter((rule) => isUniversal(rule) && /transition/i.test(rule.body));
    // The scoped reduced-motion resets (guides, jutsu training, the cinematic
    // VN, card packs, civic facilities, Warfront) and the `transition: none`
    // kills. If this finds none, the scanner is broken, not the stylesheets.
    assert.ok(universal.length >= 7, `expected the universal transition rules, found ${universal.length}`);
});

test("no universal selector gives elements a transition", () => {
    const offenders = allRules()
        .filter(isUniversal)
        .flatMap((rule) => positiveTransitionTimes(rule.body).map((declaration) =>
            `${path.relative(srcDir, rule.file)}:${rule.line} ${rule.selectors.join(" { ").replace(/\s+/g, " ")} { ${declaration} }`));
    assert.deepEqual(
        offenders,
        [],
        "a universal selector with a positive transition time transitions EVERY property of every element "
        + "it matches, including ones that had no transition. Use `transition-duration: 0s` (with "
        + "!important to override components) or `transition: none` instead.",
    );
});
