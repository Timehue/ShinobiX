import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Button label case ratchet ───────────────────────────────────────────────
// Player-facing control labels use sentence case: "Claim reward", "Leave queue".
// Proper nouns keep their capitals ("Open World Map", "Fate Shards"). Before the
// 2026-10-14 sweep the game was split almost evenly between "Claim Reward" and
// "Claim reward", which reads as unreviewed.
//
// This counts plain-text <button>/<Button> labels in which EVERY word is
// capitalised. That catches "Claim Reward" but also legitimate names such as
// "Town Hall", so it is a ratchet, not a ban: the budget is today's count.
//
// Adding a button? Use sentence case. If the label is a proper noun and pushes
// the count over, raise MAX_TITLE_CASE and say which name it is in the commit.
// If you fix one, lower MAX_TITLE_CASE to lock the gain in.
//
// The sweep took this count from 56 to 9. The 9 left are names: "Skip Academy",
// "Open Card Hall", "← Sunscar Festival", "Open Awakening Stone →", "Leave
// Showdown", and the Fourfold Breach / Hollow Gate Reckoning level chips.
const MAX_TITLE_CASE = 9;

const srcDir = fileURLToPath(new URL(".", import.meta.url));
// Admin and editor tools are staff-only, and dev harnesses never ship.
const SKIP = /(^|[\\/])(qa|admin)[\\/]|Admin|Editor|Moderation|preview|petvfx|towerfx|iconsheet|-qa\.|\.test\./i;

function tsxFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) tsxFiles(path, out);
        else if (name.endsWith(".tsx") && !SKIP.test(relative(srcDir, path))) out.push(path);
    }
    return out;
}

/** "Claim Reward" yes; "Claim reward", "OK", "Open PvP", "Sell all x3" no.
 *  Acronyms and camel-case words (PvP, ANBU, XP) are neutral: they neither make
 *  a label Title Case nor stop it from being one. */
export function isTitleCaseLabel(label: string): boolean {
    const words = label.trim().split(/\s+/)
        .map((word) => word.replace(/[^A-Za-z']/g, ""))
        .filter((word) => word.length > 0 && !/[A-Z]/.test(word.slice(1)));
    return words.length >= 2 && words.every((word) => /^[A-Z]/.test(word));
}

/** Plain-text labels of single-line <button> / <Button> elements. */
export function buttonLabels(source: string): string[] {
    const labels: string[] = [];
    for (const match of source.matchAll(/<(button|Button)\b[^<>]*>([^<>{}]+)<\/\1>/g)) labels.push(match[2].trim());
    return labels;
}

test("the scanner reads plain button labels and classifies case", () => {
    const source = `<button onClick={go}>Claim Reward</button><Button variant="primary">Leave queue</Button><button>{label}</button><button>OK</button>`;
    assert.deepEqual(buttonLabels(source), ["Claim Reward", "Leave queue", "OK"]);
    assert.equal(isTitleCaseLabel("Claim Reward"), true);
    assert.equal(isTitleCaseLabel("Claim reward"), false);
    assert.equal(isTitleCaseLabel("OK"), false);
    assert.equal(isTitleCaseLabel("Open PvP"), false);
    assert.equal(isTitleCaseLabel("Sell all x3"), false);
});

test("Title Case control labels do not grow", () => {
    const hits = tsxFiles(srcDir).flatMap((file) => buttonLabels(readFileSync(file, "utf8"))
        .filter(isTitleCaseLabel)
        .map((label) => `${relative(srcDir, file).replace(/\\/g, "/")}: ${label}`));
    assert.ok(hits.length <= MAX_TITLE_CASE,
        `${hits.length} plain button labels are in Title Case, over the budget of ${MAX_TITLE_CASE}. `
        + `Control labels use sentence case ("Claim reward"); proper nouns keep their capitals. `
        + `Every Title Case label, to find the new one:\n${hits.join("\n")}`);
});
