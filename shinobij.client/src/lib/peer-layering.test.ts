import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("other players never swap in front of each other between polls", () => {
    // The server lists nearby players nearest-first, so that order changes as
    // anyone moves. Mounted in that order, two players on one tile traded places
    // on every 2s poll. They now mount by name and layer by foot y.
    const continuous = read("../components/ContinuousWorldPeers.tsx");
    assert.match(continuous, /const figures = \[\.\.\.peers\]\.sort\(\(a, b\) => a\.name < b\.name/u);
    assert.match(continuous, /element\.style\.zIndex = String\(Math\.round\(y\)\)/u);
    assert.match(read("../components/continuous-world.css"), /\.continuous-world-peers\{[^}]*isolation:isolate/u,
        "the foot-y z-index orders peers only among themselves");
    const classic = read("../components/SectorPeers.tsx");
    assert.match(classic, /ordered\.slice\(0, markerBudget\)\.sort\(\(a, b\) => a\.name < b\.name/u);
    assert.match(classic, /zIndex: row \+ 1,/u);
});
