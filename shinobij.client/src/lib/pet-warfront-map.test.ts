import { test } from "node:test";
import assert from "node:assert/strict";
import {
    WF_CELL_X, WF_CELL_Y, WF_COLS, WF_LANES, WF_LANE_IDS, WF_LANE_Y,
    WF_MASK, WF_ROWS, WF_SPAWNS, WF_THEMES, WF_TOWERS, WF_X,
    wfCellWalkable, wfLaneAt, wfMobRoute, wfThemeForVillage, wfWalkable,
} from "./pet-warfront-map";

const cellOf = (x: number, y: number): [number, number] => [
    Math.floor((x + WF_X) / WF_CELL_X),
    Math.floor((y + 18) / WF_CELL_Y),
];

test("battlefield mask is compact, symmetric, and intentionally sparse", () => {
    assert.equal(WF_MASK.length, WF_COLS * WF_ROWS);
    const walkable = [...WF_MASK].filter((cell) => cell === "1").length;
    const share = walkable / WF_MASK.length;
    assert.ok(share > 0.36 && share < 0.46, `walkable share ${share.toFixed(3)} should read as three causeways`);
    for (let row = 0; row < WF_ROWS; row++) for (let col = 0; col < WF_COLS; col++) {
        const value = WF_MASK[row * WF_COLS + col];
        assert.equal(value, WF_MASK[row * WF_COLS + WF_COLS - 1 - col], `x symmetry at ${col},${row}`);
        assert.equal(value, WF_MASK[(WF_ROWS - 1 - row) * WF_COLS + col], `y symmetry at ${col},${row}`);
    }
});

test("navigation has exactly three disconnected components", () => {
    const seen = new Uint8Array(WF_MASK.length);
    const components: number[] = [];
    for (let start = 0; start < WF_MASK.length; start++) {
        if (seen[start] || WF_MASK.charCodeAt(start) !== 49) continue;
        const queue = [start];
        seen[start] = 1;
        let size = 0;
        for (let at = 0; at < queue.length; at++) {
            const current = queue[at];
            size++;
            const col = current % WF_COLS;
            const row = (current - col) / WF_COLS;
            for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const nc = col + dc;
                const nr = row + dr;
                if (!wfCellWalkable(nc, nr)) continue;
                const next = nr * WF_COLS + nc;
                if (!seen[next]) { seen[next] = 1; queue.push(next); }
            }
        }
        components.push(size);
    }
    assert.equal(components.length, 3, `expected exactly three lane graphs; received ${components.length}`);
    assert.ok(Math.max(...components) - Math.min(...components) < WF_COLS, "lane graphs should be materially equal");
    for (const lane of WF_LANE_IDS) {
        const [col, row] = cellOf(0, WF_LANE_Y[lane]);
        assert.equal(wfCellWalkable(col, row), true, `${lane} center should be walkable`);
    }
    assert.equal(wfLaneAt(0, (WF_LANE_Y.n + WF_LANE_Y.m) / 2), null, "void must separate Crescent from Hollow");
    assert.equal(wfLaneAt(0, (WF_LANE_Y.m + WF_LANE_Y.s) / 2), null, "void must separate Hollow from Ember");
});

test("all spawns, towers, and route points belong to their declared lane", () => {
    for (const lane of WF_LANE_IDS) {
        for (const team of ["blue", "red"] as const) {
            const [tx, ty] = WF_TOWERS[team][lane];
            assert.ok(wfWalkable(tx, ty));
            assert.equal(wfLaneAt(tx, ty), lane);
        }
        for (const toward of ["blue", "red"] as const) {
            const route = wfMobRoute(lane, toward);
            assert.ok(route.length >= 6);
            for (const [x, y] of route) {
                assert.ok(wfWalkable(x, y), `${lane} route point ${x},${y}`);
                assert.equal(wfLaneAt(x, y), lane);
            }
        }
        for (const [x, y] of WF_LANES[lane]) assert.equal(wfLaneAt(x, y), lane);
    }
    for (const team of ["blue", "red"] as const) for (const [x, y] of WF_SPAWNS[team]) assert.ok(wfWalkable(x, y), `${team} spawn ${x},${y}`);
});

test("themes cover every village family and have a safe fallback", () => {
    for (const id of ["central", "forest", "snow", "volcano", "shadow"] as const) assert.equal(WF_THEMES[id].id, id);
    assert.equal(wfThemeForVillage("Snowpeak"), "snow");
    assert.equal(wfThemeForVillage("Emberfall"), "volcano");
    assert.equal(wfThemeForVillage("Verdant Grove"), "forest");
    assert.equal(wfThemeForVillage("Umbral Rest"), "shadow");
    assert.equal(wfThemeForVillage(null), "central");
});
