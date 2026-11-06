import assert from 'node:assert/strict';
import { test } from 'node:test';
import { riftArrivalRoom, riftBreachSites } from './rift-breach-layout';
import { generateHollowGateFloor } from './hollow-gate-generate';
import { generateHollowGateShrineRun } from './hollow-gate-dungeon';
import { computeHollowGateVisible } from './hollow-gate-visibility';
import { hollowGateVariantDims, variantFromEventConfig } from './hollow-gate-variant';
import { riftEventConfig } from './rift-run';
import { hollowRifts } from '../data/hollow-rifts';

test('authored rifts mark only the arrival room and the way down, never over a doorway', () => {
    for (const rift of hollowRifts) for (let floor = 1; floor <= rift.floors; floor++) for (let seed = 1; seed <= 10; seed++) {
        let state = seed;
        const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
        const dims = hollowGateVariantDims(variantFromEventConfig(riftEventConfig(rift)));
        const run = generateHollowGateFloor(floor, floor === rift.floors, dims, random);
        const where = `${rift.id}, floor ${floor}, seed ${seed}`;
        const entryRoom = run.tiles[run.playerY * run.width + run.playerX].roomId;
        assert.equal(riftArrivalRoom(run.tiles, run.width, run.roomPrefabs != null), entryRoom, `${where}: the arrival room is the spawn room`);
        const visible = computeHollowGateVisible(run), sites = riftBreachSites(run.tiles, run.width, entryRoom);
        const stairs = run.tiles.findIndex(t => t.kind === (floor === rift.floors ? 'boss' : 'descend'));
        const stairRoom = run.tiles[stairs].roomId;
        assert(sites.some(site => site.roomId === entryRoom && site.cells.every(i => visible.has(i))), `${where} has a visible arrival breach`);
        assert(sites.some(site => site.roomId === stairRoom), `${where} marks the way down`);
        assert.deepEqual(new Set(sites.map(site => site.roomId)), new Set([entryRoom, stairRoom]), `${where}: no other room gets a breach`);
        for (const site of sites) {
            assert(site.cells.length >= 2);
            assert(site.cells.every(i => run.tiles[i]?.kind === 'wall'), 'the physical breach sits in authoritative solid stone');
            // Never in front of a walled-up doorway on the room's own edge.
            const [ix, iy] = site.angle === 0 ? [0, 1] : site.angle === 180 ? [0, -1] : site.angle === -90 ? [1, 0] : [-1, 0];
            for (const i of site.cells) {
                const inner = run.tiles[(Math.floor(i / run.width) + iy) * run.width + i % run.width + ix];
                assert(inner?.kind !== 'wall' && inner?.terrain !== 'wall', `${where}: breach of room ${site.roomId} faces a sealed doorway`);
                // Backed by rock or the board edge, never a seam between rooms.
                const ox = i % run.width - ix, oy = Math.floor(i / run.width) - iy;
                const outer = ox < 0 || oy < 0 || ox >= run.width || oy >= run.height ? undefined : run.tiles[oy * run.width + ox];
                assert(!outer || outer.kind === 'wall' || outer.terrain === 'wall', `${where}: breach of room ${site.roomId} sits in a one-cell seam`);
            }
        }
    }
});

test('real rift runs (secret passage stamped) on the crypt and the older BSP board keep both signposts', () => {
    for (const rift of hollowRifts) {
        const variant = variantFromEventConfig(riftEventConfig(rift));
        for (let floor = 1; floor <= rift.floors; floor++) for (let s = 1; s <= 12; s++) for (const legacy of [false, true]) {
            const run = legacy
                ? generateHollowGateShrineRun(floor, variant, `breach-${rift.id}-${s}`, false, true, 'bsp', { width: 25, height: 17 })
                : generateHollowGateShrineRun(floor, variant, `breach-${rift.id}-${s}`);
            const where = `${rift.id}, floor ${floor}, seed ${s}, ${legacy ? 'bsp 25x17' : 'crypt'}`;
            assert.equal(run.roomPrefabs != null, !legacy, `${where}: only the crypt board carries prefabs`);
            const spawn = run.tiles[run.playerY * run.width + run.playerX].roomId;
            const arrival = riftArrivalRoom(run.tiles, run.width, run.roomPrefabs != null);
            assert.equal(arrival, spawn, `${where}: the arrival room is the spawn room`);
            const sites = riftBreachSites(run.tiles, run.width, arrival);
            const stairs = run.tiles.findIndex(t => t.kind === 'descend' || t.kind === 'boss');
            assert.deepEqual(new Set(sites.map(site => site.roomId)), new Set([spawn, run.tiles[stairs].roomId]), `${where}: exactly the two signposts`);
            const touchesSecret = (i: number) => [i - 1, i + 1, i - run.width, i + run.width].some(j => run.tiles[j]?.secret);
            assert(sites.every(site => !site.cells.some(touchesSecret)), `${where}: a breach touches a secret passage`);
        }
    }
});

test('stone touching a secret passage is never used', () => {
    // The sealed room again, with a secret passage in the corner (0, 0), right
    // beside the north run 1..3 the arrival breach would otherwise take.
    const { w, tiles } = sealedNorthRoom();
    const withSecret = tiles.map((tile, i) => (i === 0 ? { ...tile, kind: 'empty', terrain: 'corridor_floor', secret: true } : tile));
    const [site] = riftBreachSites(withSecret, w, 0);
    assert.equal(site.angle, 0);
    assert.deepEqual(site.cells, [5, 6, 7], 'the breach moves to the run that does not touch the secret passage');
});

// A 7 x 5 room inside rock; its north doorway (4, 1) is walled up, so the
// whole north boundary is stone.
function sealedNorthRoom(extra: (x: number, y: number) => string | null = () => null) {
    const w = 9, h = 7;
    return { w, tiles: Array.from({ length: w * h }, (_, i) => {
        const x = i % w, y = Math.floor(i / w);
        const inRoom = x >= 1 && x <= 7 && y >= 1 && y <= 5;
        const sealedDoor = x === 4 && y === 1;
        return { kind: extra(x, y) ?? (inRoom && !sealedDoor ? 'empty' : 'wall'), roomId: inRoom && !sealedDoor ? 0 : null };
    }) };
}

test('a breach is never centred on a walled-up doorway', () => {
    const { w, tiles } = sealedNorthRoom();
    const [site] = riftBreachSites(tiles, w, 0);
    assert.equal(site.angle, 0);
    assert(!site.cells.includes(4), 'the breach is not in front of the sealed doorway');
    assert.deepEqual(site.cells, [1, 2, 3]);
});

test('the way-down breach goes on the wall nearest the stairs', () => {
    // Stairs in the south-east corner: the east wall (x = 8) is nearest.
    const { w, tiles } = sealedNorthRoom((x, y) => (x === 7 && y === 4 ? 'descend' : null));
    const [site] = riftBreachSites(tiles, w, null);
    assert.equal(site.angle, 90);
    assert(site.cells.every(i => i % w === 8));
    // ...and slides along that wall to the stairs' row (y = 4 is the middle).
    assert.deepEqual(site.cells.map(i => Math.floor(i / w)), [3, 4, 5]);
});

test('a one-cell seam of rock between two rooms never holds a breach', () => {
    // Two rooms side by side with a single column of rock (x = 4) between
    // them; the arrival room's only other walls are on the board edge.
    const w = 9, h = 3;
    const tiles = Array.from({ length: w * h }, (_, i) => {
        const x = i % w;
        return x === 4 ? { kind: 'wall', roomId: null } : { kind: 'empty', roomId: x < 4 ? 0 : 1 };
    });
    assert.deepEqual(riftBreachSites(tiles, w, 0), []);
});

test('rooms that are neither the arrival nor the way down stay plain', () => {
    const { w, tiles } = sealedNorthRoom();
    assert.deepEqual(riftBreachSites(tiles, w, null), []);
    assert.deepEqual(riftBreachSites(tiles, w, 3), []);
});

test('a completely open boundary does not invent an impassable breach', () => {
    const tiles = Array.from({ length: 25 }, (_, i) => ({ kind: 'empty', roomId: i >= 6 && i <= 18 ? 0 : null }));
    assert.deepEqual(riftBreachSites(tiles, 5, 0), []);
});
