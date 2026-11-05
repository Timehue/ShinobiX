import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { artBackdropStyle, cardArtBackdrop } from "./card-art-backdrop";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

test("combat cards keep their --combat-card-art property", () => {
    assert.deepEqual(cardArtBackdrop("/api/img?id=jutsu:fire&v=3"), { "--combat-card-art": 'url("/api/img?id=jutsu:fire&v=3")' });
});

test("art frames default to --art-backdrop", () => {
    assert.deepEqual(artBackdropStyle("/sector-map/s18.webp"), { "--art-backdrop": 'url("/sector-map/s18.webp")' });
    assert.deepEqual(artBackdropStyle("data:image/webp;base64,AAAA"), { "--art-backdrop": 'url("data:image/webp;base64,AAAA")' });
});

test("missing art or anything that could break out of url(\"…\") sets nothing", () => {
    for (const art of [undefined, null, "", 42, 'a"b', "a'b", "a)b", "a(b", "a\\b", "a b", "a\nb"]) {
        assert.equal(artBackdropStyle(art), undefined, String(art));
        assert.equal(cardArtBackdrop(art), undefined, String(art));
    }
});

test("the shared frame paints the var behind the art and positions an unpositioned frame", () => {
    const css = readFileSync(join(SRC, "styles", "art-backdrop.css"), "utf8");
    // Without a positioned frame the absolute backdrop escapes to an outer
    // ancestor, unclipped. Zero specificity so an absolutely placed frame wins.
    assert.match(css, /:where\(\.art-backdrop\)\s*\{\s*position:\s*relative;/);
    assert.match(css, /\.art-backdrop::before\s*\{[^}]*z-index:\s*-1;[^}]*var\(--art-backdrop, none\)/);
    assert.match(css, /\.art-backdrop\s*\{[^}]*isolation:\s*isolate;/);
});

// Components that unit tests import cannot import CSS themselves (Node cannot
// load it, and scripts/test-asset-hooks.mjs deliberately does not stub it), so
// every screen that renders them imports the stylesheet on their behalf.
const STYLESHEET_VIA_PARENTS: Record<string, string[]> = {
    "components/CombatSideHud.tsx": ["screens/MissionArenaFight.tsx", "screens/PvpBattleScreen.tsx"],
    "components/ChroniclePackGallery.tsx": ["screens/CardHall.tsx"],
};
const IMPORTS_STYLESHEET = /import ["'](?:\.\.\/)+styles\/art-backdrop\.css["'];/;

test("every artBackdropStyle caller loads the shared stylesheet and marks its frame", () => {
    // The helper only sets a custom property; without the class and its
    // stylesheet nothing paints it, and the frame silently shows flat bands.
    const callers = sourceFiles(SRC).filter((file) => /\bartBackdropStyle\(/.test(readFileSync(file, "utf8")) && !file.endsWith("card-art-backdrop.ts"));
    assert.ok(callers.length >= 10, `expected the Mission Hall, portrait and banner frames, found ${callers.length}`);
    for (const file of callers) {
        const source = readFileSync(file, "utf8");
        const name = relative(SRC, file).replace(/\\/g, "/");
        assert.match(source, /\bart-backdrop\b(?!-)/, `${name} uses artBackdropStyle without an .art-backdrop frame`);
        const parents = STYLESHEET_VIA_PARENTS[name];
        if (!parents) {
            assert.match(source, IMPORTS_STYLESHEET, `${name} uses artBackdropStyle without importing styles/art-backdrop.css`);
            continue;
        }
        assert.doesNotMatch(source, IMPORTS_STYLESHEET, `${name} is imported by unit tests, so its parents import the stylesheet instead`);
        // Every file that imports the component itself (not just sibling
        // exports such as CombatEffectsPanel) must be a listed parent that
        // carries the stylesheet.
        const component = name.split("/").pop()!.replace(/\.tsx$/, "");
        const importLine = new RegExp(`^import\\s*\\{([^}]*)\\}\\s*from\\s*["'][^"']*/${component}["']`, "m");
        const renderers = sourceFiles(SRC)
            .filter((other) => other !== file && !/\.test\.tsx?$/.test(other))
            .filter((other) => new RegExp(`\\b${component}\\b`).test(importLine.exec(readFileSync(other, "utf8"))?.[1] ?? ""))
            .map((other) => relative(SRC, other).replace(/\\/g, "/"));
        assert.deepEqual(renderers.sort(), [...parents].sort(), `${component} renderers changed; update STYLESHEET_VIA_PARENTS`);
        for (const parent of parents) {
            assert.match(readFileSync(join(SRC, parent), "utf8"), IMPORTS_STYLESHEET, `${parent} renders ${component} but does not import styles/art-backdrop.css`);
        }
    }
});
