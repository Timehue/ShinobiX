import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOLLOW_GATE_STEP_MS } from "./use-hollow-gate-walk";
import { playerGaitTilesPerSecond } from "../../../../shared/sector-gait-rates";

// Strongholds and the Hollow Gate move at the sector run speed. Two of those
// timings are literals so the shared rate stays out of the startup bundle, so a
// change to the sector rate fails here instead of silently desyncing them.
const runStepMs = Math.round(1000 / playerGaitTilesPerSecond.run);

test("the Hollow Gate step is one tile at the sector run speed", () => {
    assert.equal(HOLLOW_GATE_STEP_MS, runStepMs);
});

test("the stronghold camera glides over one run step", () => {
    const css = readFileSync(new URL("../hushInfiltration/stronghold.css", import.meta.url), "utf8");
    const glide = /\.stronghold-map \{[^}]*transition: transform ([\d.]+)s linear/.exec(css);
    assert.ok(glide, "stronghold.css still sets the map's transform transition");
    assert.equal(Math.round(Number(glide[1]) * 1000), runStepMs);
});

test("the stronghold explorer steps at the sector run speed", () => {
    const source = readFileSync(new URL("../hushInfiltration/StrongholdExplore.tsx", import.meta.url), "utf8");
    assert.match(source, /const STEP_MS = Math\.round\(1000 \/ playerGaitTilesPerSecond\.run\);/);
});
