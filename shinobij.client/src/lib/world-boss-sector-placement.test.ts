// The roaming world boss used to be drawn as a big walking sprite on the world
// atlas, with a "WORLD THREAT" callout there opening its team queue. The owner's
// rule: the boss stands IN its sector, and clicking it there starts the queue.
// The atlas keeps only the sector glow.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPlayableWildSector } from "../../../shared/sector-geo";
import { isWalkableTile } from "../../../shared/sector-walk-mask";
import { RESOURCE_NODES, WORLD_BOSS_CRYSTAL_NODES } from "../../../shared/resource-nodes";
import { STORY_FIELD_JOURNEYS } from "../../../shared/story-field-work";
import { sectorFloorLayout } from "./sector-floor-layout";
import { worldBossSectorTile } from "./world-boss-sector-placement";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const worldMap = read("../screens/WorldMap.tsx");
const overlay = read("../components/WorldSectorOverlayLayer.tsx");
const standee = read("../components/SectorWorldBossStandee.tsx");
const hook = read("../components/WorldBossMapOverlay.tsx");

const PLAYABLE = Array.from({ length: 120 }, (_, index) => index + 1).filter(isPlayableWildSector);

test("the boss stands on open ground in every sector it can roam to", () => {
    assert.ok(PLAYABLE.length > 30, "the playable sector list drifted");
    for (const sector of PLAYABLE) {
        const walkable = (tile: number) => tile >= 0 && tile < 144 && isWalkableTile(sector, tile);
        const tile = worldBossSectorTile(sector, candidate => isWalkableTile(sector, candidate));
        assert.ok(Number.isInteger(tile) && tile >= 0 && tile < 144, `sector ${sector}: tile ${tile}`);
        assert.ok(isWalkableTile(sector, tile), `sector ${sector}: tile ${tile} is not walkable`);
        assert.equal(worldBossSectorTile(sector, candidate => isWalkableTile(sector, candidate)), tile, "placement must be deterministic");
        // The ~3-tile figure and the name under its feet stand clear of walls
        // and buildings, with its head on the board. (2026-10-13: sector 9 put
        // Donkaku on the village wall with its head off the top of the view.)
        // On a phone the figure is drawn wider than three tiles, so the whole
        // 3x3 body box must be open ground (the 10-13 audit caught Donkaku's
        // shoulder over the Ashen Leaf compound at 360x640).
        const row = Math.floor(tile / 12), col = tile % 12;
        assert.ok(row >= 3, `sector ${sector}: the boss's head would leave the board`);
        assert.ok(col > 0 && col < 11, `sector ${sector}: the boss at ${tile} hangs off the board's side`);
        const body = [-2, -1, 0].flatMap(dr => [-1, 0, 1].map(dc => tile + dr * 12 + dc));
        for (const around of [...body, tile + 12]) {
            assert.ok(walkable(around), `sector ${sector}: the boss at ${tile} overlaps blocked tile ${around}`);
        }

        const layout = sectorFloorLayout(sector);
        for (const exit of layout?.exits ?? []) assert.notEqual(tile, exit.tile, `sector ${sector}: the boss blocks a road exit`);
        for (const [kind, site] of Object.entries(layout?.sites ?? {})) {
            if (!site) continue;
            assert.notEqual(tile, site.approach, `sector ${sector}: the boss stands on the ${kind} approach`);
        }
    }
});

test("the boss never covers a gathering spot or story marker, nor takes their taps", () => {
    // 2026-10-13 audit: in sector 22 the boss stood under resource-10, whose
    // icon sat on its head and whose approach tile its footprint swallowed.
    const markers = new Map<number, number[]>();
    const mark = (sector: number, tile: number) => markers.set(sector, [...(markers.get(sector) ?? []), tile]);
    for (const node of [...RESOURCE_NODES, ...WORLD_BOSS_CRYSTAL_NODES]) mark(node.sector, node.target);
    for (const journey of Object.values(STORY_FIELD_JOURNEYS)) for (const point of Object.values(journey.points)) mark(point.sector, point.tile);
    for (const sector of PLAYABLE) {
        const tile = worldBossSectorTile(sector, candidate => isWalkableTile(sector, candidate));
        const row = Math.floor(tile / 12), col = tile % 12;
        for (const marked of markers.get(sector) ?? []) {
            // Two columns each side: a phone's 48px touch floor makes a gathering
            // icon nearly two tiles wide (sector 9's Hollow Shard vein, 360x640).
            const covered = Math.abs(marked % 12 - col) <= 2 && Math.floor(marked / 12) - row >= -2 && Math.floor(marked / 12) - row <= 1;
            assert.ok(!covered, `sector ${sector}: the boss at ${tile} covers the marker on ${marked}`);
        }
        const footprint = [tile, tile - 12, tile - 24];
        for (const node of [...RESOURCE_NODES, ...WORLD_BOSS_CRYSTAL_NODES].filter(n => n.sector === sector)) {
            assert.ok(!footprint.includes(node.approach), `sector ${sector}: the boss takes the taps for ${node.id}'s approach`);
        }
    }
});

test("the boss falls back to the nearest walkable tile when every clear tile is blocked", () => {
    const sector = PLAYABLE[0]!;
    assert.equal(worldBossSectorTile(sector, candidate => candidate === 140), 140);
});

test("the atlas no longer draws the boss or opens its queue", () => {
    const overview = worldMap.slice(worldMap.indexOf("{wmZoom.active ? ("));
    assert.ok(overview.length > 0, "missing final world overview");
    assert.doesNotMatch(overview, /WorldBossQueueHost|WorldBossSectorFlag|mapSprite|world-boss-map-call/u);
    assert.match(overview, /atlas-sector-world-boss/u, "the boss's sector still glows on the atlas");
    assert.match(overview, /onClick=\{\(\) => triggerTravelPoint\(sector\.id\)\}/u, "the boss sector travels like any other");
    assert.doesNotMatch(hook, /export function WorldBossSectorFlag|travelToSector/u);
});

test("the boss stands in its sector and clicking it opens the queue there", () => {
    // Only a player standing in the boss's sector sees it there.
    assert.match(worldMap, /worldBoss=\{sectorIsCurrent \? worldBossStandeeIn\(selectedSector\) : null\}/u);
    assert.match(hook, /event && sector != null && sector === selectedSector\s*\? \{ bossId: event\.bossId, name: event\.bossName, paused: event\.movementPaused, onOpen: openQueue \}/u);
    assert.match(overlay, /\{worldBoss && <SectorWorldBossStandee sector=\{sector\} \{\.\.\.worldBoss\} \/>\}/u);
    // The sector board is transformed, so the fixed dialog must leave it.
    assert.match(worldMap, /worldBossQueueOpen && !vaultRaid && createPortal\(<Suspense fallback=\{null\}><WorldBossQueueHost/u);
    // The hook only opens the queue for a player standing with the boss.
    assert.match(hook, /if \(sector === currentSector && !isTraveling\) setQueueOpen\(true\);/u);
    // Continuous-world canvas taps reach the boss through its footprint.
    assert.match(standee, /data-footprint=\{footprint\}/u);
    assert.match(standee, /onClick=\{onOpen\}/u);
});
