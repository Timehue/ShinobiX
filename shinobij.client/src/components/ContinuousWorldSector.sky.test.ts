import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The sector view must show the world's day/night. The sky is rendered with the
// shared `on-floor` class, whose generic rule (`.day-night-sky.on-floor`, two
// classes) parks it at z-index -1, under an opaque canvas. The sector's own
// rule lifts it above the terrain canvas and must out-rank that rule on
// specificity, not on stylesheet load order.
const root = join(process.cwd(), "shinobij.client", "src");
const sector = readFileSync(join(root, "components", "ContinuousWorldSector.tsx"), "utf8");
const sectorCss = readFileSync(join(root, "components", "continuous-world.css"), "utf8");
const sharedCss = readFileSync(join(root, "styles", "index", "28-desktop-scaling.css"), "utf8");

test("the sector view renders the day/night sky above its terrain canvas", () => {
    assert.match(sector, /<canvas ref=\{canvas\}[\s\S]*?\/>\s*<DayNightSky className="on-floor" \/>/);
    assert.match(sharedCss, /\.day-night-sky\.on-floor\s*\{\s*z-index:\s*-1;\s*\}/);
    const lift = sectorCss.match(/([^{}\n]+)\{z-index:(\d+);pointer-events:none\}/);
    assert.ok(lift && lift[1].includes(".day-night-sky"), "continuous-world.css lost the sky's z-index rule");
    const classCount = (lift[1].match(/\./g) ?? []).length;
    assert.ok(classCount > 2, `the sector sky rule (${lift[1].trim()}) must out-rank .day-night-sky.on-floor without relying on load order`);
    const canvasZ = Number(sectorCss.match(/\.continuous-world-map>canvas\{[^}]*z-index:(\d+)/)?.[1]);
    const chunkZ = Number(sectorCss.match(/\.pixel-map\.continuous-world-chunk\{[^}]*z-index:(\d+)/)?.[1]);
    assert.ok(Number(lift[2]) > canvasZ && Number(lift[2]) < chunkZ, "the sky must sit above the terrain canvas and below the tiles and players");
});
