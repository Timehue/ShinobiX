// OWNER 2026-10-14: the roaming world boss walked in place on one tile. It now
// patrols its sector's road toward the village it attacks: from the road it
// came in by to the exit it will leave by, a stand there facing the way it is
// headed, and back. The server still moves it one sector per 13-minute hop.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPlayableWildSector, VILLAGE_OUTSKIRTS } from "../../../shared/sector-geo";
import { SECTOR_ROAD_PAIRS, sectorExits } from "../../../shared/sector-links";
import { isWalkableTile } from "../../../shared/sector-walk-mask";
import { RESOURCE_NODES, WORLD_BOSS_CRYSTAL_NODES } from "../../../shared/resource-nodes";
import { STORY_FIELD_JOURNEYS } from "../../../shared/story-field-work";
import { WORLD_BOSS_DEFINITIONS, WORLD_BOSS_EVENT_HOP_MS } from "../../../shared/world-boss-event";
import { inferSpriteNativeFacing } from "./battlefield-sprite";
import { sectorFloorLayout } from "./sector-floor-layout";
import {
    tilesAlong,
    worldBossPatrol,
    worldBossPatrolElapsed,
    WORLD_BOSS_PATROL_ENTRY_HOLD_MS,
    WORLD_BOSS_PATROL_EXIT_HOLD_MS,
    WORLD_BOSS_PATROL_TILES_PER_SEC,
} from "./world-boss-patrol";
import { worldBossGround, worldBossSectorTile, worldBossTileToward } from "./world-boss-sector-placement";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const PLAYABLE = Array.from({ length: 120 }, (_, index) => index + 1).filter(isPlayableWildSector);
const ROADS = SECTOR_ROAD_PAIRS.filter(([a, b]) => isPlayableWildSector(a) && isPlayableWildSector(b));
const roadsFrom = (sector: number) => ROADS.flatMap(([a, b]) => a === sector ? [b] : b === sector ? [a] : []);
const walkableIn = (sector: number) => (tile: number) => isWalkableTile(sector, tile);
const exitTo = (sector: number, destination: number) => sectorExits(sector).find(exit => exit.destinationSector === destination);
const span = (a: number, b: number) => Math.hypot(a % 12 - b % 12, Math.floor(a / 12) - Math.floor(b / 12));
/** Four-way flood fill, written apart from the patrol's own search. (A
 *  diagonal that needs both tiles it cuts between joins nothing four-way
 *  steps cannot, so the two agree on what connects.) */
function joins(from: number, to: number, pass: (tile: number) => boolean): boolean {
    const seen = new Set([from]), queue = [from];
    for (let i = 0; i < queue.length; i += 1) {
        const tile = queue[i]!;
        if (tile === to) return true;
        for (const next of [tile - 12, tile + 12, tile % 12 > 0 ? tile - 1 : -1, tile % 12 < 11 ? tile + 1 : -1]) {
            if (next < 0 || next >= 144 || seen.has(next) || !(next === to || pass(next))) continue;
            seen.add(next);
            queue.push(next);
        }
    }
    return false;
}
const length = (waypoints: readonly number[]) => waypoints.slice(1).reduce((sum, tile, i) => sum + span(waypoints[i]!, tile), 0);

test("every road the boss roams leaves its sector by a road exit", () => {
    assert.ok(ROADS.length > 60, "the road graph drifted");
    for (const [a, b] of ROADS) {
        assert.ok(exitTo(a, b), `sector ${a} has no exit toward ${b}`);
        assert.ok(exitTo(b, a), `sector ${b} has no exit toward ${a}`);
    }
});

test("the boss patrols walkable ground from the road it came in by to the exit it leaves by", () => {
    let patrols = 0;
    for (const sector of PLAYABLE) {
        const walkable = walkableIn(sector);
        const ground = worldBossGround(sector, walkable);
        const home = worldBossSectorTile(sector, walkable);
        for (const to of roadsFrom(sector)) {
            const end = worldBossTileToward(ground, exitTo(sector, to)!.tile);
            for (const from of [null, ...roadsFrom(sector).filter(other => other !== to)]) {
                const patrol = worldBossPatrol(sector, from, to, walkable);
                const where = `sector ${sector} (${from ?? "spawn"} → ${to})`;
                const again = worldBossPatrol(sector, from, to, walkable);
                assert.deepEqual([again.waypoints, again.cycleMs], [patrol.waypoints, patrol.cycleMs], `${where}: not deterministic`);
                assert.ok(patrol.cycleMs > 0, `${where}: the boss stands still`);
                assert.equal(patrol.waypoints.at(-1), end, `${where}: it does not head for the exit`);
                // From its entry road, else its usual spot, else across the board
                // from the exit (anywhere, then only where head-safe ground
                // reaches the exit end), exit-clear starts first. The first that
                // head-safe ground joins to the exit end wins.
                const exitTile = exitTo(sector, to)!.tile, across = (11 - Math.floor(exitTile / 12)) * 12 + (11 - exitTile % 12);
                const headSafe = (tile: number) => tile === end || ground.standable(tile);
                const candidates = [
                    ...(from == null ? [] : [worldBossTileToward(ground, exitTo(sector, from)!.tile)]),
                    home,
                    worldBossTileToward(ground, across),
                    worldBossTileToward(ground, across, tile => joins(tile, end, headSafe)),
                ];
                const starts = [...candidates.filter(ground.clearOfExits), ...candidates.filter(start => !ground.clearOfExits(start))]
                    .filter(start => span(start, end) >= 2.5);
                const begins = patrol.waypoints[0]!;
                assert.equal(begins, starts.find(start => joins(start, end, tile => tile === start || headSafe(tile))) ?? starts[0],
                    `${where}: it starts at ${begins}, not the first usable of ${starts.join(", ")}`);
                // A figure three tiles tall keeps its head on the board the whole way.
                for (const tile of patrol.waypoints) assert.ok(Math.floor(tile / 12) >= 3, `${where}: at ${tile} its head leaves the board`);
                assert.ok(length(patrol.waypoints) >= 2.5, `${where}: a ${length(patrol.waypoints).toFixed(1)}-tile walk is no patrol`);
                for (const tile of patrol.waypoints) assert.ok(walkable(tile), `${where}: waypoint ${tile} is not walkable`);
                for (let i = 1; i < patrol.waypoints.length; i += 1) {
                    for (const tile of tilesAlong(patrol.waypoints[i - 1]!, patrol.waypoints[i]!)) {
                        assert.ok(walkable(tile), `${where}: the stride ${patrol.waypoints[i - 1]} → ${patrol.waypoints[i]} crosses blocked tile ${tile}`);
                    }
                }
                patrols += 1;
            }
        }
    }
    assert.ok(patrols > 200, `only ${patrols} patrols checked`);
});

test("it marches to the exit, stands facing the way it is headed, and walks back", () => {
    let checked = 0;
    for (const sector of PLAYABLE) {
        for (const to of roadsFrom(sector)) {
            const direction = exitTo(sector, to)!.direction;
            const patrol = worldBossPatrol(sector, null, to, walkableIn(sector));
            const walkMs = length(patrol.waypoints) / WORLD_BOSS_PATROL_TILES_PER_SEC * 1000;
            assert.ok(Math.abs(patrol.cycleMs - (2 * walkMs + WORLD_BOSS_PATROL_EXIT_HOLD_MS + WORLD_BOSS_PATROL_ENTRY_HOLD_MS)) < 1);

            const outbound = patrol.poseAt(walkMs / 2);
            assert.equal(outbound.walking, true, "it walks out to the exit");
            const atExit = patrol.poseAt(walkMs + WORLD_BOSS_PATROL_EXIT_HOLD_MS / 2);
            const end = patrol.waypoints.at(-1)!;
            assert.deepEqual([atExit.col, atExit.row, atExit.walking], [end % 12, Math.floor(end / 12), false], "it stands at the exit end");
            if (direction === "east") assert.equal(atExit.facing, 1, `sector ${sector}: it should face the east road`);
            if (direction === "west") assert.equal(atExit.facing, -1, `sector ${sector}: it should face the west road`);
            const homeward = patrol.poseAt(walkMs * 1.5 + WORLD_BOSS_PATROL_EXIT_HOLD_MS);
            assert.equal(homeward.walking, true, "it walks back");
            // Wherever the march has a sideways leg, it faces the way it walks.
            for (let ms = 0; ms < patrol.cycleMs; ms += 250) {
                const now = patrol.poseAt(ms), next = patrol.poseAt(ms + 1);
                if (now.walking && next.walking && Math.abs(next.col - now.col) > 1e-9) {
                    assert.equal(now.facing, next.col > now.col ? 1 : -1, `sector ${sector}: it walks backwards at ${ms} ms`);
                }
            }
            checked += 1;
        }
    }
    assert.ok(checked > 100);
});

test("the keyframes the browser plays agree with the pose script reads", () => {
    const sector = PLAYABLE.find(s => roadsFrom(s).length >= 2)!;
    const [from, to] = roadsFrom(sector);
    const patrol = worldBossPatrol(sector, from, to, walkableIn(sector));
    assert.equal(patrol.frames[0]!.offset, 0);
    assert.equal(patrol.frames.at(-1)!.offset, 1);
    for (let i = 1; i < patrol.frames.length; i += 1) assert.ok(patrol.frames[i]!.offset >= patrol.frames[i - 1]!.offset);
    for (const frame of patrol.frames.slice(0, -1)) {
        const pose = patrol.poseAt(frame.offset * patrol.cycleMs);
        assert.ok(Math.abs(pose.col - frame.col) < 1e-9 && Math.abs(pose.row - frame.row) < 1e-9, `frame at ${frame.offset} disagrees`);
    }
    // The cycle repeats, on the server's clock, for every player alike.
    const same = (a: ReturnType<typeof patrol.poseAt>, b: ReturnType<typeof patrol.poseAt>) =>
        Math.abs(a.col - b.col) < 1e-6 && Math.abs(a.row - b.row) < 1e-6 && a.walking === b.walking && a.facing === b.facing;
    for (const ms of [0, 1_234, 9_876]) {
        assert.ok(same(patrol.poseAt(ms + 7 * patrol.cycleMs), patrol.poseAt(ms)), `a later cycle disagrees at ${ms} ms`);
        assert.ok(same(patrol.poseAt(ms - patrol.cycleMs), patrol.poseAt(ms)), `an earlier cycle disagrees at ${ms} ms`);
    }
    assert.ok(patrol.untilChange(0) > 0 && patrol.untilChange(0) <= patrol.cycleMs);
});

test("at the village gate it marches on the gate itself", () => {
    let checked = 0;
    for (const gateSector of Object.values(VILLAGE_OUTSKIRTS)) {
        const approach = sectorFloorLayout(gateSector)?.village?.approach;
        if (approach === undefined || !isPlayableWildSector(gateSector)) continue;
        const walkable = walkableIn(gateSector);
        const from = roadsFrom(gateSector)[0]!;
        const patrol = worldBossPatrol(gateSector, from, gateSector, walkable);
        assert.ok(patrol.cycleMs > 0, `sector ${gateSector}: it stands still at the gate`);
        assert.equal(patrol.waypoints.at(-1), worldBossTileToward(worldBossGround(gateSector, walkable), approach));
        checked += 1;
    }
    assert.ok(checked > 0, "no village gate sector has a painted village approach");
});

test("each boss's walk sheet is flipped from the same facing as its battle sprite", () => {
    // A consistency check between two hand-kept tables, not a look at the art:
    // the battle sprite is cut from walk frame 0 (scripts/gen-world-boss-combat-art.mjs),
    // so the map flip and the battle board must agree. (Seen 10-14: Murogane's
    // sheet faces right, Chicxulub's left, Donkaku's nearly front-on.)
    for (const boss of WORLD_BOSS_DEFINITIONS) assert.equal(boss.mapSpriteFacing, inferSpriteNativeFacing(boss.battleSprite), boss.id);
});

test("the patrol runs on the hop's clock, so a forming team stops it at one point for everyone", () => {
    const readAt = 5_000_000;
    // Moving: hop time already spent in the sector, plus the time since the read.
    const moving = { serverNow: readAt, nextHopInMs: WORLD_BOSS_EVENT_HOP_MS - 40_000, paused: false };
    assert.equal(worldBossPatrolElapsed(moving, readAt), 40_000);
    assert.equal(worldBossPatrolElapsed(moving, readAt + 2_500), 42_500);
    // Paused: the hop clock is frozen, so is the patrol, however late the read is seen.
    const paused = { ...moving, paused: true };
    assert.equal(worldBossPatrolElapsed(paused, readAt + 25_000), 40_000);
    // Two players reading at different moments of one walk agree.
    const later = { serverNow: readAt + 20_000, nextHopInMs: moving.nextHopInMs - 20_000, paused: false };
    assert.equal(worldBossPatrolElapsed(later, readAt + 31_000), worldBossPatrolElapsed(moving, readAt + 31_000));
    // At the village gate it no longer hops, and the server clock alone serves.
    assert.equal(worldBossPatrolElapsed({ serverNow: readAt, nextHopInMs: 0, paused: false }, readAt + 7), readAt + 7);
});

test("every player's browser computes the same route", () => {
    // Math.hypot may differ in its last bit between engines; a route or end
    // tile chosen on a near-tie must not differ between Chrome and Safari.
    for (const file of ["./world-boss-patrol.ts", "./world-boss-sector-placement.ts"]) {
        assert.doesNotMatch(read(file).replace(/\/\*[\s\S]*?\*\//gu, ""), /Math\.hypot\(/u, `${file} uses Math.hypot`);
    }
});

test("standing at either end, the boss never covers a road exit's tile", () => {
    // It stands at each end for seconds every cycle; over an exit tile, a tap
    // to cross that road (the one a player following it takes) opened the queue.
    let ends = 0;
    for (const sector of PLAYABLE) {
        const ground = worldBossGround(sector, walkableIn(sector));
        for (const to of roadsFrom(sector)) for (const from of [null, ...roadsFrom(sector).filter(other => other !== to)]) {
            const { waypoints } = worldBossPatrol(sector, from, to, walkableIn(sector));
            for (const end of [waypoints[0]!, waypoints.at(-1)!]) {
                assert.ok(ground.clearOfExits(end), `sector ${sector} (${from ?? "spawn"} → ${to}): standing on ${end} it covers a road exit`);
                ends += 1;
            }
        }
    }
    assert.ok(ends > 400);
    // The box check itself, against a hand-placed east exit on row 5 (tile 71):
    // a figure 2.52 tiles wide must stand two columns in to clear it.
    const sector = PLAYABLE.find(s => sectorExits(s).some(exit => exit.tile === 71))!;
    const ground = worldBossGround(sector, () => true);
    assert.equal(ground.clearOfExits(5 * 12 + 10), false, "one column in, its shoulder covers the exit");
    assert.equal(ground.clearOfExits(5 * 12 + 9), true, "two columns in, it is clear");
});

test("the standee walks the patrol on the hop's clock, and holds while a team forms", () => {
    const standee = read("../components/SectorWorldBossStandee.tsx");
    const css = read("../styles/world-boss-map.css");
    const hook = read("../components/WorldBossMapOverlay.tsx");
    assert.match(standee, /walk\.currentTime = worldBossPatrolElapsed\(clock\.current, worldBossServerNow\(\)\) % patrol\.cycleMs;/u);
    assert.match(standee, /if \(paused\) \{\s*walk\.pause\(\);\s*\} else \{\s*walk\.play\(\);/u);
    assert.match(standee, /> RESYNC_MS\) walk\.currentTime = target;/u, "a read puts a walking boss back in step");
    assert.match(standee, /\}, \[readAt, nextHopInMs, paused, patrol\]\);/u);
    assert.match(standee, /const obstacles = useSectorObstacles\(\);/u, "the route follows the obstacle switch");
    assert.match(hook, /readAt: view\.serverNow, nextHopInMs: event\.nextHopInMs/u);
    assert.match(standee, /prefersReducedMotion\(\)\) \{\s*show\(rest\);\s*return;/u, "Reduce Motion keeps it on its usual tile");
    // It only cycles its walk frames while it actually moves.
    assert.match(css, /\.sector-world-boss-sprite \{[^}]*animation: world-boss-breathe 2\.8s ease-in-out infinite;/u);
    assert.doesNotMatch(css.slice(css.indexOf(".sector-world-boss-sprite {"), css.indexOf(".sector-world-boss.is-walking")), /world-boss-walk /u);
    assert.match(css, /\.sector-world-boss\.is-walking \.sector-world-boss-sprite \{\s*animation: world-boss-walk /u);
});

test("the walking boss never takes another board piece's taps", () => {
    // It now walks past trail signs, wanderers, structures, the village
    // entrance (which it marches on at the final stand), story markers and
    // gathering spots, so it sits under every one of them, read from the
    // stylesheets that place them. (A tie loses too: the boss renders last.)
    const zIndexOf = (css: string, selector: string) => {
        const at = css.indexOf(selector);
        assert.ok(at >= 0, `missing rule ${selector}`);
        const block = css.slice(at, css.indexOf("}", at));
        const z = /z-index:\s*(-?\d+)/u.exec(block);
        assert.ok(z, `${selector} sets no z-index`);
        return Number(z[1]);
    };
    const boss = zIndexOf(read("../styles/world-boss-map.css"), ".sector-world-boss-track {");
    const board = {
        "trail signs": zIndexOf(read("../styles/index/29-clan-exchange-storefront.css"), ".sector-trace-overlay {"),
        wanderers: zIndexOf(read("../styles/index/11-sector-explore-village-themes.css"), ".sector-wanderer-overlay {"),
        "structures and the village entrance": zIndexOf(read("../styles/index/39-sector-world.css"), ".sector-ground-landmark, .sector-village-entrance {"),
        "cairns and authored story markers": zIndexOf(read("../styles/index/39-sector-world.css"), ".sector-ground-cairn, button.atlas-landmark.sector-story-authored {"),
        "story field markers": zIndexOf(read("../styles/index/29-clan-exchange-storefront.css"), "button.atlas-landmark.sector-story-field-marker {"),
        "gathering spots": zIndexOf(read("../components/resource-gathering.css"), ".resource-node-layer{"),
    };
    for (const [piece, z] of Object.entries(board)) assert.ok(boss < z, `the boss (z ${boss}) would cover ${piece} (z ${z})`);

    // Canvas taps: a tile a gathering spot or story marker sits on is never
    // part of the boss's tap footprint, wherever it walks.
    let checked = 0;
    for (const sector of PLAYABLE) {
        const ground = worldBossGround(sector, walkableIn(sector));
        const marked = new Set([
            ...[...RESOURCE_NODES, ...WORLD_BOSS_CRYSTAL_NODES].filter(node => node.sector === sector).flatMap(node => [node.target, node.approach]),
            ...Object.values(STORY_FIELD_JOURNEYS).flatMap(journey => Object.values(journey.points)).filter(point => point.sector === sector).map(point => point.tile),
        ]);
        for (let tile = 0; tile < 144; tile += 1) {
            for (const reached of ground.footprint(tile)) assert.ok(!marked.has(reached), `sector ${sector}: standing on ${tile}, the boss takes the taps on ${reached}`);
        }
        checked += marked.size;
    }
    assert.ok(checked > 50, "no gathering spots or story markers were checked");
});

test("the queue popup shows the boss the player clicked while it loads", () => {
    // 2026-10-14: clicking Donkaku opened a Chicxulub banner over "Checking the
    // world signal…", because the dialog fell back to the first boss until its
    // own read landed.
    const worldMap = read("../screens/WorldMap.tsx");
    const host = read("../components/WorldBossQueueHost.tsx");
    const dialog = read("../screens/WorldBossQueueDialog.tsx");
    assert.match(worldMap, /<WorldBossQueueHost boss=\{worldBossEvent\}/u);
    assert.match(host, /knownBoss=\{boss\}/u);
    assert.match(dialog, /const bossId = event\?\.bossId \?\? knownBoss\?\.bossId;/u);
    assert.doesNotMatch(dialog, /worldBossDefinition\(event\?\.bossId\)/u);
    assert.match(dialog, /\{event\?\.bossName \?\? knownBoss\?\.bossName \?\?/u);
    // The World Bosses hub's Roaming Boss tab had the same flash: it paints no
    // boss until its first read lands, then the event's own, and names a
    // boss's trait only while an event is active.
    const hub = read("../screens/WorldBossEvent.tsx");
    assert.match(hub, /const bossKnown = view !== null;/u);
    assert.match(hub, /\$\{bossKnown \? `, url\("\$\{boss\.keyArt\}"\)` : ""\}/u);
    assert.match(hub, /\{event && <p className="world-boss-trait">/u);
});
