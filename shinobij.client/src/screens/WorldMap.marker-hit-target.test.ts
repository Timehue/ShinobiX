import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mapCss = readFileSync(new URL("../styles/index/02-world-map.css", import.meta.url), "utf8");

test("overlapping world-map landmarks never intercept sector destination clicks", () => {
    const sectorRule = mapCss.match(/(?:^|\n)\.atlas-sector\s*\{([^}]+)\}/u)?.[1] ?? "";
    const landmarkRule = mapCss.match(/(?:^|\n)\.atlas-landmark\s*\{([^}]+)\}/u)?.[1] ?? "";
    const sectorZ = Number(sectorRule.match(/z-index:\s*(\d+)/u)?.[1]);
    const landmarkZ = Number(landmarkRule.match(/z-index:\s*(\d+)/u)?.[1]);

    assert.ok(Number.isFinite(sectorZ), "sector markers need an explicit stacking order");
    assert.ok(Number.isFinite(landmarkZ), "landmark buttons need an explicit stacking order");
    assert.ok(sectorZ > landmarkZ, "a sector's center must activate travel even beneath a landmark crest");
});
