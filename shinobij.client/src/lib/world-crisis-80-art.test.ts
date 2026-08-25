import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";

const screen = readFileSync(new URL("../screens/WorldCrisis80.tsx", import.meta.url), "utf8");
const screenCss = readFileSync(new URL("../screens/WorldCrisis80.css", import.meta.url), "utf8");
const news = readFileSync(new URL("../components/WorldCrisis80NewsEntry.tsx", import.meta.url), "utf8");
const towerManifest = readFileSync(new URL("./tower-art-manifest.ts", import.meta.url), "utf8");

const assets = [
    "reckoning-outskirts.webp",
    "collection-cell-lineup.webp",
    "pursuit-pack.webp",
] as const;

test("The Hollow Gate Reckoning ships production event art at bounded delivery sizes", async () => {
    for (const asset of assets) {
        const url = new URL(`../assets/world-crisis-80/${asset}`, import.meta.url);
        const bytes = statSync(url).size;
        const metadata = await sharp(readFileSync(url)).metadata();
        assert.equal(metadata.format, "webp", `${asset} must ship as WebP`);
        assert.ok(bytes > 150_000, `${asset} must contain production artwork`);
        assert.ok(bytes < 320 * 1024, `${asset} must remain below the 320 KiB event-art ceiling`);
        assert.ok((metadata.width ?? 0) >= 1500 && (metadata.height ?? 0) >= 900,
            `${asset} must retain a high-resolution cinematic source`);
    }
});

test("event art is wired into the report, outskirts, operation cards, and sealed Tower fight", () => {
    assert.match(screen, /reckoningOutskirtsArt/);
    assert.match(screen, /collectionCellArt/);
    assert.match(screen, /pursuitPackArt/);
    assert.match(screen, /hollowGateMark/);
    assert.match(screenCss, /var\(--reckoning-art\)/);
    assert.match(screenCss, /var\(--collection-art\)/);
    assert.doesNotMatch(screenCss, /var\(--village-art\)/,
        "the cinematic battlefield must not stretch a village emblem as environment art");
    assert.match(news, /crisis-cinematic__reckoning-art/);
    for (const biome of ["forest", "volcano", "snow", "shadow"]) {
        assert.match(towerManifest, new RegExp(`"world-crisis-80-${biome}":\\s*worldCrisis80Art`));
    }
});
