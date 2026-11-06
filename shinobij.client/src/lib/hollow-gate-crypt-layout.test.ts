import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHollowGateShrineRun, hollowGateSeededRandom } from "./hollow-gate-dungeon";
import { hollowGateCryptLayout } from "./hollow-gate-crypt-layout";
import { validateHollowGateFloorManifest } from "../../../api/hollow-gate/_floor-manifest";

test("crypt floors pass the server's floor seal on every depth, at the sealed 31 x 21 size", () => {
    for (let n = 0; n < 60; n += 1) {
        const floor = 1 + (n % 5);
        const run = generateHollowGateShrineRun(floor, undefined, `crypt-seed-${n}`);
        assert.deepEqual([run.width, run.height], [31, 21]);
        assert.ok(run.roomPrefabs, "crypt rooms carry their prefab");
        const sealed = validateHollowGateFloorManifest({ floor, finalFloor: floor >= 5, width: run.width, height: run.height,
            playerX: run.playerX, playerY: run.playerY, tiles: run.tiles });
        assert.ok(sealed.ok, `seed ${n}: ${sealed.ok ? "" : sealed.reason}`);
        // The stairs (or the boss) wait in the stair hall.
        const target = run.tiles.find((t) => t.kind === "descend" || t.kind === "boss")!;
        assert.equal(run.roomPrefabs![target.roomId!], "stair");
    }
});

test("rooms are painted prefabs: 7 x 5 and 5 x 5 chambers and 15 x 5 halls, every doorway a passage or rock", () => {
    let roomTotal = 0, small = 0;
    for (let n = 0; n < 40; n += 1) {
        const layout = hollowGateCryptLayout(31, 21, hollowGateSeededRandom(`crypt-shape-${n}`, 1))!;
        roomTotal += layout.rooms.length;
        layout.rooms.forEach((r, id) => {
            const prefab = layout.prefabs[id];
            if (prefab === "small") small += 1;
            assert.equal(r.h, 5);
            assert.equal(r.w, prefab === "hall" ? 15 : prefab === "small" ? 5 : 7);
            const doorCols = prefab === "hall" ? [3, 11] : [Math.floor(r.w / 2)];
            // Every cell of the rect is floor except doorways filled with rock,
            // which sit at the middle of a side (or a hall half's side).
            for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) {
                const t = layout.terrain[y * 31 + x];
                if (t === "wall") {
                    const midRow = y === r.y + 2 && (x === r.x || x === r.x + r.w - 1);
                    const midCol = (y === r.y || y === r.y + 4) && doorCols.includes(x - r.x);
                    assert.ok(midRow || midCol, `rock only fills a doorway (room ${id} at ${x},${y})`);
                }
            }
        });
        assert.equal(layout.prefabs[layout.stairRoom], "hall");
    }
    assert.ok(roomTotal / 40 >= 8, `about nine rooms a floor, got ${(roomTotal / 40).toFixed(1)}`);
    assert.ok(small > 20, "small caves break up the grid");
});

test("runs sealed at an older board size keep the BSP rooms at that size", () => {
    const old = generateHollowGateShrineRun(2, undefined, "crypt-old", false, true, "auto", { width: 25, height: 17 });
    assert.deepEqual([old.width, old.height], [25, 17]);
    assert.equal(old.roomPrefabs, undefined);
});
