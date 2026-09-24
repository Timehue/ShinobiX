import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postcss from "postcss";

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
// currently loads after it. The route-owned exceptions below are checked against
// every later part, so adding a conflicting override fails this test.
const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_CSS = join(HERE, "..", "index.css");
const PARTS_DIR = join(HERE, "index");
const ROUTE_OWNERS: Record<string, string[]> = {
    "17-shop-inventory-loadout.css": ["components/Shop.tsx", "screens/Inventory.tsx"],
    "19-town-hall.css": ["screens/TownHall.tsx", "screens/Cafeteria.tsx", "screens/AdminPanel.tsx"],
    "25-mobile-profile-tabs.css": ["screens/Profile.tsx", "screens/UserView.tsx"],
    "33-hollow-gate-cinematic.css": ["features/hollowGate/HollowGateShrineView.tsx"],
    "39-civic-facilities.css": ["components/FacilityHero.tsx"],
};

function selectorProperties(file: string): Set<string> {
    const pairs = new Set<string>();
    postcss.parse(readFileSync(join(PARTS_DIR, file), "utf8"), { from: file }).walkRules((rule) => {
        // Keyframe stops such as `from` and `to` belong to separate animations;
        // they are not stylesheet selectors and cannot change the cascade.
        for (let parent = rule.parent; parent; parent = parent.parent) {
            if (parent.type === "atrule" && /keyframes$/i.test(parent.name)) return;
        }
        for (const selector of rule.selectors) {
            for (const node of rule.nodes ?? []) {
                if (node.type === "decl") pairs.add(`${selector.trim()}\u0000${node.prop.toLowerCase()}`);
            }
        }
    });
    return pairs;
}

function manifestOrder(): string[] {
    return readFileSync(INDEX_CSS, "utf8")
        .split("\n")
        .map((line) => /^\s*@import\s+"\.\/styles\/index\/([^"]+)"/.exec(line)?.[1])
        .filter((name): name is string => Boolean(name));
}

test("every styles/index part is eager or has an audited route owner", () => {
    const onDisk = readdirSync(PARTS_DIR).filter((f) => f.endsWith(".css")).sort();
    const imported = manifestOrder();

    const missing = onDisk.filter((f) => !imported.includes(f) && !ROUTE_OWNERS[f]);
    assert.deepEqual(
        missing,
        [],
        `styles/index part(s) have no eager or audited route import: ${missing.join(", ")}`,
    );

    const orphaned = imported.filter((f) => !onDisk.includes(f));
    assert.deepEqual(orphaned, [], `index.css @imports missing file(s): ${orphaned.join(", ")}`);
    for (const [file, owners] of Object.entries(ROUTE_OWNERS)) {
        assert.ok(onDisk.includes(file), `route-owned stylesheet is missing: ${file}`);
        assert.ok(!imported.includes(file), `route-owned stylesheet is still eager: ${file}`);
        for (const owner of owners) {
            const source = readFileSync(join(HERE, "..", owner), "utf8");
            assert.match(source, new RegExp(`import ["'][^"']*/${file.replaceAll(".", "\\.")}["']`), `${owner} must import ${file}`);
        }
    }
});

test("route-owned styles have no selector/property ties with later parts", () => {
    const onDisk = readdirSync(PARTS_DIR).filter((f) => f.endsWith(".css"))
        .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
    const pairs = new Map(onDisk.map((file) => [file, selectorProperties(file)]));
    for (const file of Object.keys(ROUTE_OWNERS)) {
        const index = onDisk.indexOf(file);
        const overlaps = onDisk.slice(index + 1).flatMap((later) =>
            [...pairs.get(file)!].filter((pair) => pairs.get(later)!.has(pair)).map((pair) => `${later}: ${pair.replace("\u0000", " / ")}`));
        assert.deepEqual(overlaps, [], `${file} loads after later manifest parts and would invert these ties`);
    }
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
