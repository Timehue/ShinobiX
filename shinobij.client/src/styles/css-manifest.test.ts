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
    "15-world-map-territory.css": ["screens/WorldMap.tsx"],
    "25-mobile-profile-tabs.css": ["screens/Profile.tsx", "screens/UserView.tsx"],
    "29-clan-exchange-storefront.css": [
        "screens/ClanHall.tsx",
        "screens/WorldMap.tsx",
        "screens/TownHall.tsx",
        "features/hollowGate/HollowGateShrineView.tsx",
    ],
    "33-hollow-gate-cinematic.css": ["features/hollowGate/HollowGateShrineView.tsx"],
    "36-clan-boss-operation.css": ["screens/ClanBoss.tsx"],
    "39-civic-facilities.css": ["components/FacilityHero.tsx"],
    "40-village-social-panels.css": [
        "screens/ShinobiCouncilHall.tsx",
        "screens/HallOfLegends.tsx",
        "screens/VillageTavern.tsx",
    ],
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

// styles/jutsu-frames.css is route-owned as well, but it needs no tie audit:
// everything except its :root tokens sits in `@layer jutsu-frames`, so its
// winners do not depend on where its <link> lands. That stays true only while
// it is the app's one layer and the only file defining those tokens.
const JUTSU_FRAMES_OWNERS = ["Profile", "Training", "AdminPanel", "CentralHub", "BloodlineMaker"];
const JUTSU_FRAMES_RENDERERS = ["JutsuLoadoutPanel", "JutsuDropdownList", "LegacyPanel"];

test("jutsu-frames.css stays off startup and order-independent", () => {
    const srcDir = join(HERE, "..");
    for (const eager of ["index.css", "main.tsx"]) {
        assert.doesNotMatch(readFileSync(join(srcDir, eager), "utf8"), /jutsu-frames\.css/, `${eager} must not load jutsu-frames.css at startup`);
    }
    const sources = (readdirSync(srcDir, { recursive: true }) as string[])
        .map((file) => file.replaceAll("\\", "/"))
        .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
    const renderer = new RegExp(`["'][^"']*/(?:${JUTSU_FRAMES_RENDERERS.join("|")})["']`);
    const hosts = sources.filter((file) => renderer.test(readFileSync(join(srcDir, file), "utf8")));
    assert.deepEqual(hosts.map((file) => /([^/]+)\.tsx?$/.exec(file)![1]).filter((name) => !JUTSU_FRAMES_OWNERS.includes(name)), [],
        "a module that renders a jutsu-frames component must be listed here and import the stylesheet");
    for (const owner of JUTSU_FRAMES_OWNERS) {
        assert.match(readFileSync(join(srcDir, "screens", `${owner}.tsx`), "utf8"), /^import "\.\.\/styles\/jutsu-frames\.css";$/m, `${owner}.tsx must import jutsu-frames.css`);
    }

    const tokens = new Set<string>();
    postcss.parse(readFileSync(join(HERE, "jutsu-frames.css"), "utf8")).each((node) => {
        if (node.type === "comment" || (node.type === "atrule" && node.name === "layer" && node.params === "jutsu-frames")) return;
        assert.ok(node.type === "rule" && node.selector === ":root", `jutsu-frames.css has an unlayered ${node.type} outside its :root tokens`);
        node.each((decl) => {
            assert.ok(decl.type === "decl" && decl.prop.startsWith("--"), "jutsu-frames.css :root may only define custom properties");
            tokens.add(decl.prop);
        });
    });
    const conflicts: string[] = [];
    for (const file of (readdirSync(srcDir, { recursive: true }) as string[]).filter((name) => name.endsWith(".css"))) {
        const name = file.replaceAll("\\", "/");
        if (name === "styles/jutsu-frames.css") continue;
        const css = postcss.parse(readFileSync(join(srcDir, file), "utf8"), { from: name });
        css.walkAtRules((rule) => {
            if (rule.name === "layer" || (rule.name === "import" && /\blayer\b/.test(rule.params))) conflicts.push(`${name}: @${rule.name} ${rule.params}`);
        });
        css.walkDecls((decl) => { if (tokens.has(decl.prop)) conflicts.push(`${name}: defines ${decl.prop}`); });
    }
    assert.deepEqual(conflicts, [], "another layer or token definition would make jutsu-frames.css load-order dependent");
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
