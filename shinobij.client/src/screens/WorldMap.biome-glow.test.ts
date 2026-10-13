import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The world map builds each region glow's class by concatenation
// ("world-biome-glow wbg-" + biome). That hid the colours from a dead-rule
// sweep on 2026-07-28 (e464d1955), which deleted them, and the five glows
// painted nothing until they were restored. Every biome the map renders must
// keep a painted rule.
const root = join(process.cwd(), "shinobij.client", "src");
const worldMap = readFileSync(join(root, "screens", "WorldMap.tsx"), "utf8");
const css = readFileSync(join(root, "styles", "index", "28-desktop-scaling.css"), "utf8");

test("every world-map biome glow the map renders has a painted colour rule", () => {
    const block = worldMap.match(/\{\[\s*([\s\S]*?)\]\.map\(\(g\) => \(\s*<div key=\{g\.c\} className=\{"world-biome-glow wbg-" \+ g\.c\}/);
    assert.ok(block, "WorldMap no longer renders the biome glows the way this test expects");
    const biomes = [...block[1].matchAll(/c:\s*"([a-z]+)"/g)].map((match) => match[1]);
    assert.deepEqual(biomes.sort(), ["central", "forest", "shadow", "snow", "volcano"]);
    for (const biome of biomes) {
        assert.match(css, new RegExp(`\\.wbg-${biome}\\s*\\{\\s*background:\\s*radial-gradient\\(`), `.wbg-${biome} lost its colour`);
    }
    assert.match(css, /\.world-biome-glow\s*\{[^}]*mix-blend-mode:\s*screen/);
});
