// The roaming world boss used to be drawn as a big walking sprite on the world
// atlas, with a "WORLD THREAT" callout there opening its team queue. The owner's
// rule: the boss stands IN its sector, and clicking it there starts the queue.
// The atlas keeps only the sector glow.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPlayableWildSector } from "../../../shared/sector-geo";
import { isWalkableTile } from "../../../shared/sector-walk-mask";
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
        const row = Math.floor(tile / 12), col = tile % 12;
        assert.ok(row >= 3, `sector ${sector}: the boss's head would leave the board`);
        for (const around of [tile - 12, tile - 24, tile + 12, ...(col > 0 ? [tile - 1] : []), ...(col < 11 ? [tile + 1] : [])]) {
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
    assert.match(worldMap, /const sectorOverlayWorldBoss = sectorIsCurrent && worldBossEvent && worldBossSector === selectedSector/u);
    assert.match(worldMap, /onOpen: openWorldBossQueue/u);
    assert.match(worldMap, /worldBoss=\{sectorOverlayWorldBoss\}/u);
    assert.match(overlay, /\{worldBoss && <SectorWorldBossStandee sector=\{sector\} \{\.\.\.worldBoss\} \/>\}/u);
    // The sector board is transformed, so the fixed dialog must leave it.
    assert.match(worldMap, /worldBossQueueOpen && !vaultRaid && createPortal\(<Suspense fallback=\{null\}><WorldBossQueueHost/u);
    // The hook only opens the queue for a player standing with the boss.
    assert.match(hook, /if \(sector === currentSector && !isTraveling\) setQueueOpen\(true\);/u);
    // Continuous-world canvas taps reach the boss through its footprint.
    assert.match(standee, /data-footprint=\{footprint\}/u);
    assert.match(standee, /onClick=\{onOpen\}/u);
});
