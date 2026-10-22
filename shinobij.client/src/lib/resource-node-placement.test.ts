// Gathering requires suitable painted terrain, rather than one node per sector.
// Each new node had to land somewhere a player can see and tap it: never on a
// structure, the village gate, a road exit or a story marker, and never touching
// another marker, because on a phone the 48px touch floor makes every icon
// nearly two tiles wide. The first draft broke the second rule six times.
import assert from "node:assert/strict";
import test from "node:test";
import { RESOURCE_NODES, WORLD_BOSS_CRYSTAL_NODES } from "../../../shared/resource-nodes";
import { STORY_FIELD_JOURNEYS } from "../../../shared/story-field-work";
import { sectorExits } from "../../../shared/sector-links";
import { sectorFloorLayout } from "./sector-floor-layout";

const GRID = 12;
/** Nodes 1..24 predate the pass; their placement was reviewed separately. */
const ADDED = RESOURCE_NODES.filter(node => Number(node.id.slice(9)) > 24);
const cheb = (a: number, b: number) => Math.max(Math.abs(a % GRID - b % GRID), Math.abs(Math.floor(a / GRID) - Math.floor(b / GRID)));

function storyTiles(sector: number): number[] {
    return Object.values(STORY_FIELD_JOURNEYS).flatMap(journey => Object.values(journey.points))
        .filter(point => point.sector === sector).map(point => point.tile);
}

function ownedTiles(sector: number): Map<number, string> {
    const owned = new Map<number, string>();
    const layout = sectorFloorLayout(sector);
    for (const [kind, site] of Object.entries(layout?.sites ?? {})) {
        if (!site) continue;
        owned.set(site.approach, `${kind} approach`);
        const [left, top, size] = site.footprint;
        if (left === undefined || top === undefined || !size) continue;
        for (let k = 0; k < size * size; k += 1) owned.set((top + Math.floor(k / size)) * GRID + left + (k % size), `${kind} footprint`);
    }
    if (layout?.village) {
        const col = Math.min(GRID - 1, Math.floor(layout.village.left / 100 * GRID));
        const row = Math.min(GRID - 1, Math.floor(layout.village.top / 100 * GRID));
        for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) owned.set((row + dr) * GRID + col + dc, "village gate");
        owned.set(layout.village.approach, "village approach");
    }
    for (const exit of [...(layout?.exits ?? []), ...sectorExits(sector)]) owned.set(exit.tile, "road exit");
    for (const tile of storyTiles(sector)) owned.set(tile, "story marker");
    return owned;
}

test("the added gathering nodes never stand on a structure, gate, road exit or story marker", () => {
    assert.equal(ADDED.length, 63);
    for (const node of ADDED) {
        const owned = ownedTiles(node.sector);
        for (const [label, tile] of [["target", node.target], ["approach", node.approach]] as const) {
            assert.ok(!owned.has(tile), `${node.id} (sector ${node.sector}) ${label} ${tile} is on the ${owned.get(tile)}`);
        }
    }
});

test("the added gathering nodes never touch another marker on the board", () => {
    for (const node of ADDED) {
        const others = [...RESOURCE_NODES, ...WORLD_BOSS_CRYSTAL_NODES]
            .filter(other => other.sector === node.sector && other.id !== node.id).map(other => [other.id, other.target] as const);
        for (const tile of storyTiles(node.sector)) others.push(["story marker", tile]);
        for (const [id, tile] of others) {
            assert.ok(cheb(node.target, tile) >= 2, `${node.id} (sector ${node.sector}) at ${node.target} touches ${id} at ${tile}`);
        }
    }
});
