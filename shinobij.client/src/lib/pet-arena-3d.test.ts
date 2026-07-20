import { test } from "node:test";
import assert from "node:assert/strict";
import {
    arenaWalkTiles, arenaCameraFocus, arenaCameraDist, arenaModelHeight, arenaModelMotion,
    pipCycleIds, A3D_MIN_DIST, A3D_MAX_DIST, A3D_TILE_W, A3D_TILE_D,
} from "./pet-arena-3d";
import { FULL_MASK, FULL_COLS, FULL_ROWS } from "./pet-arena-fullmask";
import { ARENA_X, ARENA_Y, type ArenaSnapshot } from "./pet-arena-sim";

function snapWith(actors: Array<Partial<ArenaSnapshot["actors"][number]>>, scroll?: Partial<ArenaSnapshot["scroll"]>): ArenaSnapshot {
    const base = (i: number): ArenaSnapshot["actors"][number] => ({
        id: `blue-${i}`, team: "blue", slot: i, role: "tracker", x: 0, y: 0, faceX: 1, faceY: 0,
        hp: 100, maxHp: 100, energy: 0, lives: 3, state: "idle", carrying: false, statuses: [],
        respawnSecs: 0, abilityReady: false,
    });
    return {
        t: 0,
        actors: actors.map((over, i) => ({ ...base(i), ...over })),
        scroll: { state: "inactive", x: 0, y: 0, carrierId: null, channelFrac: 0, spawnSecs: 0, ...scroll },
        shrine: { state: "inactive", kind: "power", x: 0, y: 0, channelFrac: 0, spawnSecs: 0 },
        boss: { state: "inactive", x: 0, y: 0, faceX: 1, hpFrac: 1, spawnSecs: 0, winding: false, stage: 0 },
        scoreBlue: 0, scoreRed: 0, momBlue: 0, momRed: 0, odBlue: 0, odRed: 0, ringR: 0,
    };
}

test("arenaWalkTiles mirrors the sim walkmask exactly (count + bounds + determinism)", () => {
    const tiles = arenaWalkTiles();
    let walkable = 0;
    for (let i = 0; i < FULL_MASK.length; i++) if (FULL_MASK.charCodeAt(i) === 49) walkable++;
    assert.equal(tiles.length, walkable);
    assert.ok(walkable > 1000 && walkable < FULL_COLS * FULL_ROWS);
    for (const t of tiles) {
        assert.ok(t.x > -ARENA_X && t.x < ARENA_X);
        assert.ok(t.z > -ARENA_Y && t.z < ARENA_Y);
        assert.ok(t.shade >= 0 && t.shade <= 1);
    }
    // Deterministic — two calls produce identical layouts (replay/test stability).
    const again = arenaWalkTiles();
    assert.deepEqual(again[0], tiles[0]);
    assert.deepEqual(again[again.length - 1], tiles[tiles.length - 1]);
});

test("arenaWalkTiles marks void-adjacent cells as edges", () => {
    const tiles = arenaWalkTiles();
    const edges = tiles.filter((t) => t.edge);
    assert.ok(edges.length > 0 && edges.length < tiles.length);
    // Edge tiles are AO-darkened relative to the same-parity interior average.
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    assert.ok(avg(edges.map((t) => t.shade)) < avg(tiles.filter((t) => !t.edge).map((t) => t.shade)));
});

test("tile size covers the field exactly", () => {
    assert.ok(Math.abs(A3D_TILE_W * FULL_COLS - ARENA_X * 2) < 1e-9);
    assert.ok(Math.abs(A3D_TILE_D * FULL_ROWS - ARENA_Y * 2) < 1e-9);
});

test("arenaCameraFocus follows the carrier tight, else the living centroid", () => {
    const carried = arenaCameraFocus(snapWith(
        [{ x: 4, y: 2 }, { x: -6, y: -3 }],
        { state: "carried", carrierId: "blue-0" },
    ));
    assert.equal(carried.carrier, true);
    assert.equal(carried.fx, 4);
    assert.equal(carried.fz, 2);

    const centroid = arenaCameraFocus(snapWith([{ x: 2, y: 1 }, { x: 6, y: 3 }, { x: 100, y: 100, state: "dead" }]));
    assert.equal(centroid.carrier, false);
    assert.equal(centroid.fx, 4);
    assert.equal(centroid.fz, 2);

    const empty = arenaCameraFocus(snapWith([{ state: "dead" }, { state: "respawning" }]));
    assert.equal(empty.fx, 0);
    assert.ok(empty.span >= ARENA_X * 2);
});

test("arenaCameraFocus widens with spread", () => {
    const tight = arenaCameraFocus(snapWith([{ x: 0, y: 0 }, { x: 1, y: 0 }]));
    const wide = arenaCameraFocus(snapWith([{ x: -10, y: -6 }, { x: 10, y: 6 }]));
    assert.ok(wide.span > tight.span);
});

test("arenaCameraDist is monotonic in span, shrinks with wider aspect, and clamps", () => {
    assert.ok(arenaCameraDist(20, 1.78) > arenaCameraDist(10, 1.78));
    assert.ok(arenaCameraDist(20, 0.6) > arenaCameraDist(20, 1.78));
    assert.ok(arenaCameraDist(0.1, 2) >= A3D_MIN_DIST);
    assert.ok(arenaCameraDist(500, 0.4) <= A3D_MAX_DIST);
});

test("arenaModelHeight compresses species spread and clamps", () => {
    assert.ok(arenaModelHeight(2.35) > 1.0 && arenaModelHeight(2.35) < 1.2);
    assert.ok(arenaModelHeight(3.55) > arenaModelHeight(2.35));
    assert.ok(arenaModelHeight(10) <= 1.38);
    assert.ok(arenaModelHeight(0) >= 0.92);
});

test("arenaModelMotion maps sim states to skeletal motions", () => {
    assert.equal(arenaModelMotion("dead", false, false), "dead");
    assert.equal(arenaModelMotion("respawning", true, true), "dead");
    assert.equal(arenaModelMotion("dash", true, false), "dash");
    assert.equal(arenaModelMotion("channel", false, false), "windup");
    assert.equal(arenaModelMotion("attack", false, true), "strike");
    assert.equal(arenaModelMotion("attack", true, false), "run");
    assert.equal(arenaModelMotion("idle", true, false), "run");
    assert.equal(arenaModelMotion("idle", false, false), "idle");
});

test("pipCycleIds puts the player's blue squad first", () => {
    assert.deepEqual(
        pipCycleIds(["red-0", "blue-0", "red-1", "blue-1"]),
        ["blue-0", "blue-1", "red-0", "red-1"],
    );
});
