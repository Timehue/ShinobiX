import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// `index.css` is a pure @import manifest of `styles/index/NN-*.css`, and the ORDER
// of those imports is load-bearing: many parts set the same properties on the same
// selectors, with !important on BOTH sides, so source order is the only tiebreaker.
//
// That makes two edits quietly dangerous, which is what these tests catch:
//
//  1. Moving a part OUT of the manifest into a per-screen import. It does not merely
//     land before the screen skins -- it lands after EVERY remaining manifest part,
//     because the manifest is one eager <link> at startup while a route-owned import
//     arrives later as a lazy chunk. Doing this to 16-pvp-fx-combat-jutsu-ui.css
//     inverted 9 mobile combat-HUD declarations (.combat-jutsu-thumb's fixed height
//     beat 18-mobile-safe-adaptive's aspect-ratio -- the "92px blank card" bug) and
//     had to be reverted.
//  2. Reordering the imports.
//
// A part is only safely movable if it shares NO selector+property with any part that
// currently loads after it. As of this writing only 4 of 28 parts qualify, and each
// is either app-level chrome or spans ~29 routes, so none is worth moving. If you
// want to split one anyway, prove the zero-overlap property first.
const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_CSS = join(HERE, "..", "index.css");
const PARTS_DIR = join(HERE, "index");

function manifestOrder(): string[] {
    return readFileSync(INDEX_CSS, "utf8")
        .split("\n")
        .map((line) => /^\s*@import\s+"\.\/styles\/index\/([^"]+)"/.exec(line)?.[1])
        .filter((name): name is string => Boolean(name));
}

test("every styles/index part stays in the eager index.css manifest", () => {
    const onDisk = readdirSync(PARTS_DIR).filter((f) => f.endsWith(".css")).sort();
    const imported = manifestOrder();

    const missing = onDisk.filter((f) => !imported.includes(f));
    assert.deepEqual(
        missing,
        [],
        `styles/index part(s) exist but are not @import-ed by index.css: ${missing.join(", ")}. ` +
            "If a part was moved out to a per-screen import, it now loads AFTER every other " +
            "manifest part and can invert !important ties (see the comment in this file). " +
            "Either restore the @import, or delete the file if it is truly unused.",
    );

    const orphaned = imported.filter((f) => !onDisk.includes(f));
    assert.deepEqual(orphaned, [], `index.css @imports missing file(s): ${orphaned.join(", ")}`);
});

test("index.css imports the parts in ascending numeric order", () => {
    const imported = manifestOrder();
    const numbers = imported.map((name) => {
        const n = Number(/^(\d+)-/.exec(name)?.[1]);
        assert.ok(Number.isFinite(n), `manifest part is missing its NN- order prefix: ${name}`);
        return n;
    });

    const sorted = [...numbers].sort((a, b) => a - b);
    assert.deepEqual(
        numbers,
        sorted,
        "index.css @import order must stay ascending by numeric prefix — later parts " +
            "deliberately override earlier ones, so reordering silently changes which " +
            "!important rule wins.",
    );
});
