import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worldMapSource = readFileSync(new URL("./WorldMap.tsx", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("../components/WorldSectorCanvas.tsx", import.meta.url), "utf8");

function lineCount(source: string): number {
    return source.trimEnd().split(/\r?\n/u).length;
}

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.ok(start >= 0, `Missing source-contract start: ${startNeedle}`);
    assert.ok(end > start, `Missing source-contract end after ${startNeedle}: ${endNeedle}`);
    return source.slice(start, end);
}

function assertOrdered(source: string, needles: readonly string[], contract: string): void {
    let cursor = 0;
    for (const needle of needles) {
        const found = source.indexOf(needle, cursor);
        assert.ok(found >= cursor, `${contract}: expected ${needle} after offset ${cursor}`);
        cursor = found + needle.length;
    }
}

test("WorldMap and its canvas leaf keep the first projection line-budget ratchet", () => {
    assert.ok(
        lineCount(worldMapSource) <= 5_700,
        `WorldMap.tsx grew past 5,700 lines; selected-sector presentation belongs in its focused leaves.`,
    );
    assert.ok(
        lineCount(canvasSource) <= 220,
        `WorldSectorCanvas.tsx grew past 220 lines; overlays and controllers must remain separate.`,
    );
});

test("WorldSectorCanvas stays hook-free, network-free, and persistence-free", () => {
    assert.doesNotMatch(canvasSource, /\buse(?:State|Effect|LayoutEffect|Reducer|Ref|Memo|Callback|ImperativeHandle)\s*\(/u);
    assert.doesNotMatch(canvasSource, /\bfetch\s*\(/u);
    assert.doesNotMatch(canvasSource, /\b(?:localStorage|sessionStorage)\b/u);
    assert.doesNotMatch(canvasSource, /\bDate\.now\s*\(/u);
    assert.doesNotMatch(canvasSource, /\bcreatePortal\s*\(/u);
});

test("selected-sector canvas preserves stage and stacking order", () => {
    assert.match(canvasSource, /const GRID_SIZE = 12;/u);
    assert.match(canvasSource, /const TILE_COUNT = GRID_SIZE \* GRID_SIZE;/u);
    assertOrdered(canvasSource, [
        '<main className="tile-scene sector-stage-panel">',
        "<RegionSplash",
        "<SectorMap",
        "<SceneAmbience",
        "<SceneCritters",
        "Array.from({ length: TILE_COUNT })",
        "<SectorPeersLive",
        "<SectorAvatar",
        "{overlayLayer}",
        "<SectorForeground",
        "{encounterLayer}",
    ], "selected-sector stage order");
    assertOrdered(canvasSource, [
        "if (roadExit && isPlayer && isCurrent) onCrossExit(roadExit);",
        "else onSelectTile(index);",
    ], "road crossing before ordinary movement");
});

test("WorldMap retains controller and portal ownership around the canvas slots", () => {
    const projection = sliceBetween(worldMapSource, "<WorldSectorCanvas", '<aside className="instance-actions sector-command-panel"');
    assertOrdered(projection, [
        "onSelectTile={setSectorPlayerPos}",
        "onCrossExit={crossSectorExit}",
        "overlayLayer={",
        "createPortal(",
        "encounterLayer={",
    ], "WorldMap canvas projection");
    assert.doesNotMatch(projection, /<(?:RegionSplash|SectorGateMarker|SectorPeersLive)\b/u);
});
