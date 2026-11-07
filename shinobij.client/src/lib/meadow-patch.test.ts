import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HARVEST_NODES, RESOURCE_NODES, harvestNodeAt, resourceNodePosition } from "../../../shared/resource-nodes";
import { sectorBiomeOf } from "../../../shared/sector-geo";
import { MEADOW_MARKER_LIFT, meadowMarkerPosition, meadowPatchArt, meadowPatchTurn } from "./meadow-patch";

const publicFile = (src: string) => fileURLToPath(new URL(`../../public${src}`, import.meta.url));

test("every meadow bloom draws a painted patch that exists, dusk-toned in shadow sectors", () => {
    for (const node of HARVEST_NODES) {
        for (const family of ["gather-field-herb", "gather-binding-fiber"] as const) {
            const art = meadowPatchArt({ sector: node.sector, family });
            assert.ok(existsSync(publicFile(art)), `${node.id}: ${art}`);
            assert.equal(art.includes("dusk-"), sectorBiomeOf(node.sector) === "shadow", node.id);
            assert.match(art, family === "gather-field-herb" ? /herb/ : /fiber/);
        }
    }
});

test("patches turn per spot but never change between renders", () => {
    const turns = HARVEST_NODES.map(meadowPatchTurn);
    assert.ok(new Set(turns).size > 30, "neighbouring meadows do not look stamped");
    for (const turn of turns) assert.ok(turn >= 0 && turn < 360);
    assert.deepEqual(HARVEST_NODES.map(meadowPatchTurn), turns);
});

test("meadow markers lift half a tile so their pin points into the patch; other markers stay put", () => {
    const meadow = harvestNodeAt(HARVEST_NODES[0], 0), plain = resourceNodePosition(meadow), lifted = meadowMarkerPosition(meadow);
    assert.equal(lifted.left, plain.left);
    assert.ok(Math.abs(plain.top - lifted.top - MEADOW_MARKER_LIFT / 12 * 100) < 1e-9);
    for (const node of RESOURCE_NODES.slice(0, 10)) assert.deepEqual(meadowMarkerPosition(node), resourceNodePosition(node));
});
