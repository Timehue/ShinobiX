import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    WF_MASK, WF_COLS, WF_ROWS, WF_X, WF_Y, WF_CELL_X, WF_CELL_Y,
    wfWalkable, wfCellWalkable, wfMobRoute,
    WF_SPAWNS, WF_CORE, WF_STATUES, WF_PADS, WF_LAIR, WF_LANES, WF_THEMES,
} from "./pet-warfront-map";
import { WF_BAKED_COLS, WF_BAKED_MASK, WF_BAKED_ROWS } from "./pet-warfront-mask-baked";
import { wfThemeForVillage } from "./pet-warfront-theme";

const cellOf = (x: number, y: number): [number, number] => [Math.floor((x + WF_X) / WF_CELL_X), Math.floor((y + WF_Y) / WF_CELL_Y)];

test("baked reference mask expands to the exact symmetric source bytes", () => {
    assert.equal(WF_BAKED_MASK.length, WF_BAKED_COLS * WF_BAKED_ROWS);
    assert.match(WF_BAKED_MASK, /^[01]+$/);
    for (let row = 0; row < WF_BAKED_ROWS; row++) {
        const start = row * WF_BAKED_COLS;
        for (let col = 0; col < WF_BAKED_COLS / 2; col++) {
            assert.equal(
                WF_BAKED_MASK[start + col],
                WF_BAKED_MASK[start + WF_BAKED_COLS - 1 - col],
                `baked x-mirror mismatch at ${col},${row}`,
            );
        }
    }
    assert.equal(
        createHash("sha256").update(WF_BAKED_MASK).digest("hex"),
        "171282de272b85e8ad5a7d28e23a7ad969a70b4929d3cd1af62f7601eea1eb09",
    );
});

test("mask has the right size and a sane walkable share", () => {
    assert.equal(WF_MASK.length, WF_COLS * WF_ROWS);
    let walkable = 0;
    for (let i = 0; i < WF_MASK.length; i++) if (WF_MASK.charCodeAt(i) === 49) walkable++;
    const share = walkable / WF_MASK.length;
    assert.ok(share > 0.18 && share < 0.6, // solid-field design: mostly ground, walls+void carved
        `walkable share ${share.toFixed(3)} out of range`);
});

test("mask is x-symmetric (team fairness — both teams see the identical field)", () => {
    // Note: the field is deliberately NOT y-symmetric — the mid corridor weaves,
    // like LoL's top/bot asymmetry. Both teams share that asymmetry equally via
    // the x-mirror, so team fairness is exact.
    for (let r = 0; r < WF_ROWS; r++) {
        for (let c = 0; c < WF_COLS; c++) {
            const v = WF_MASK[r * WF_COLS + c];
            assert.equal(v, WF_MASK[r * WF_COLS + (WF_COLS - 1 - c)], `x-mirror mismatch at ${c},${r}`);
        }
    }
});

test("every point of interest stands on walkable ground", () => {
    const pois: Array<readonly [number, number]> = [
        WF_CORE.blue, WF_CORE.red,
        ...WF_STATUES.blue, ...WF_STATUES.red,
        ...WF_PADS,
        [WF_LAIR.x + WF_LAIR.r - 1, WF_LAIR.y],   // the arena RING (the centre pit is carved void on purpose)
        ...WF_SPAWNS.blue, ...WF_SPAWNS.red,
        ...WF_LANES.n, ...WF_LANES.s,
    ];
    for (const [x, y] of pois) assert.ok(wfWalkable(x, y), `POI ${x},${y} is not walkable`);
});

test("the whole battlefield is one connected region (BFS reaches every POI)", () => {
    const seen = new Uint8Array(WF_COLS * WF_ROWS);
    const [sc, sr] = cellOf(WF_SPAWNS.blue[0][0], WF_SPAWNS.blue[0][1]);
    const queue: number[] = [sr * WF_COLS + sc];
    seen[queue[0]] = 1;
    while (queue.length) {
        const cur = queue.pop()!;
        const c = cur % WF_COLS, r = (cur - c) / WF_COLS;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nc = c + dc, nr = r + dr;
            if (!wfCellWalkable(nc, nr)) continue;
            const idx = nr * WF_COLS + nc;
            if (!seen[idx]) { seen[idx] = 1; queue.push(idx); }
        }
    }
    // Every walkable cell must be reachable — no orphaned islands anywhere.
    for (let i = 0; i < WF_MASK.length; i++) {
        if (WF_MASK.charCodeAt(i) === 49) assert.equal(seen[i], 1, `walkable cell ${i % WF_COLS},${Math.floor(i / WF_COLS)} unreachable from blue spawn`);
    }
});

test("mob routes are walkable end to end and reach the right base", () => {
    for (const lane of ["n", "s"] as const) {
        for (const toward of ["blue", "red"] as const) {
            const route = wfMobRoute(lane, toward);
            assert.ok(route.length >= 4);
            for (const [x, y] of route) assert.ok(wfWalkable(x, y), `route pt ${x},${y} (${lane}→${toward}) not walkable`);
            const [ex] = route[route.length - 1];
            assert.ok(toward === "blue" ? ex < -10 : ex > 10, "route must end at the target base's statue mouth");
            // Consecutive waypoints stay close enough for segment-walk marching.
            for (let i = 1; i < route.length; i++) {
                const d = Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
                assert.ok(d < 12, `waypoint gap ${d.toFixed(1)} too wide`);
            }
        }
    }
});

test("themes cover every id and village mapping falls back to central", () => {
    for (const id of ["central", "forest", "snow", "volcano", "shadow"] as const) assert.equal(WF_THEMES[id].id, id);
    assert.equal(wfThemeForVillage("Snowpeak"), "snow");
    assert.equal(wfThemeForVillage("Emberfall"), "volcano");
    assert.equal(wfThemeForVillage("Verdant Grove"), "forest");
    assert.equal(wfThemeForVillage("Umbral Rest"), "shadow");
    assert.equal(wfThemeForVillage("somewhere else"), "central");
    assert.equal(wfThemeForVillage(null), "central");
});
