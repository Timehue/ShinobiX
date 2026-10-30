import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { WARFRONT_TERRAIN, warfrontTerrainPoint } from "./pet-warfront-contract";
import { WARFRONT_TERRAIN as serverTerrain } from "../../../api/_pet-sim/pet-warfront-contract";

test("the server and both visual routes share the same tactical terrain", () => {
    assert.deepEqual(serverTerrain, WARFRONT_TERRAIN);
    assert.equal(new Set(WARFRONT_TERRAIN.map(c => `${c.col},${c.row}`)).size, WARFRONT_TERRAIN.length);
    for (const cell of WARFRONT_TERRAIN) {
        assert.ok(cell.col >= 2 && cell.col <= 4, "terrain cannot occupy deployment cells");
        assert.ok(cell.row >= 0 && cell.row <= 4);
        assert.deepEqual(warfrontTerrainPoint(cell.col, cell.row), [(cell.col - 3) * 3.2, (cell.row - 2) * 3]);
    }
    const blocked = new Set(WARFRONT_TERRAIN.filter(c => c.kind !== "mist").map(c => `${c.col},${c.row}`));
    const reached = new Set(["0,0"]), queue = [[0, 0]];
    for (const [col, row] of queue) for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = col + dc, r = row + dr, key = `${c},${r}`;
        if (c < 0 || c >= 7 || r < 0 || r >= 5 || blocked.has(key) || reached.has(key)) continue;
        reached.add(key); queue.push([c, r]);
    }
    assert.equal(reached.size, 35 - blocked.size, "solid terraces must leave every open cell and both deployment sides connected");
});

test("retained shrine meshes fit inside the terrain collision cells", () => {
    const glb = readFileSync(new URL("../../public/assets/warfront/shrine-terrain-v1.glb", import.meta.url));
    assert.ok(glb.length < 160_000, "two static props should not add a large model download");
    assert.equal(glb.toString("ascii", 0, 4), "glTF");
    const jsonLength = glb.readUInt32LE(12);
    const model = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));
    const binaryStart = 20 + jsonLength + 8;
    const meshes = model.nodes.filter((node: { mesh?: number }) => node.mesh !== undefined).map((node: { mesh: number; name: string }) => ({ ...model.meshes[node.mesh], name: node.name }));
    assert.deepEqual(meshes.map((mesh: { name: string }) => mesh.name).sort(), ["cover", "pillar"]);
    for (const mesh of meshes) {
        assert.equal(mesh.primitives.length, 1, "each prop is one merged draw");
        const accessor = model.accessors[mesh.primitives[0].attributes.POSITION];
        const view = model.bufferViews[accessor.bufferView];
        assert.equal(accessor.componentType, 5126);
        for (let i = 0; i < accessor.count; i++) {
            const offset = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (view.byteStride ?? 12);
            const x = glb.readFloatLE(offset), y = glb.readFloatLE(offset + 4), z = glb.readFloatLE(offset + 8);
            assert.ok(Math.abs(x) < 1.6 && Math.abs(z) < 1.5, `${mesh.name} extends into a walkable neighboring cell`);
            const phoneScale = mesh.name === "pillar" ? 1.35 : 1.1;
            assert.ok(Math.abs(x * phoneScale) < 1.6 && Math.abs(z * phoneScale) < 1.5, "phone readability scale must also fit inside the same collision cell");
            assert.ok(y >= -.05 && y < 2.6, "terrain must sit on the court and preserve actor visibility");
        }
    }
});
