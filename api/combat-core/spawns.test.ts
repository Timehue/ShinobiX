import test from 'node:test';
import assert from 'node:assert/strict';
import { combatFormationPositions, combatSpawnPositions } from './spawns.js';
import { GRID_H, GRID_W } from './constants.js';
import { hexDistance, hexNeighbors } from './grid.js';

test('PvP varies across encounters, stays reproducible, and preserves mirrored board reach', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
        const options = { mirrored: true };
        const spawns = combatSpawnPositions(String(seed), options);
        assert.deepEqual(spawns, combatSpawnPositions(String(seed), options));
        const [a, b] = [spawns.allies[0]!, spawns.enemies[0]!];
        seen.add(`${a}:${b}`);
        assert.equal(b, GRID_W * GRID_H - 1 - a);
        assert.equal(hexDistance(a, b), 7);
        const distances = (start: number) => Array.from({ length: GRID_W * GRID_H }, (_, tile) => hexDistance(start, tile)).sort((x, y) => x - y);
        assert.deepEqual(distances(a), distances(b));
    }
    assert.equal(seen.size, 7, 'all seven mirrored formations at the existing opening distance are sampled');
});

test('2v2 teams have mirrored, distinct positions and safe separation', () => {
    for (let seed = 0; seed < 200; seed++) {
        const s = combatSpawnPositions(String(seed), { allies: 2, enemies: 2, mirrored: true, openingDistance: 9 });
        assert.equal(new Set([...s.allies, ...s.enemies]).size, 4);
        s.allies.forEach((a, i) => {
            assert.equal(s.enemies[i], GRID_W * GRID_H - 1 - a);
            assert.equal(hexDistance(a, s.enemies[i]!), 9);
            assert.ok(s.enemies.every(b => hexDistance(a, b) >= 5));
        });
    }
});

test('PvE packs avoid blocked tiles, collisions and disconnected pockets', () => {
    const blockedTiles = [62, 33, 57, 81, 0, ...hexNeighbors(0), 44, 92];
    for (let seed = 0; seed < 80; seed++) {
        const s = combatSpawnPositions(String(seed), { enemies: 13, blockedTiles });
        const all = [...s.allies, ...s.enemies];
        assert.equal(new Set(all).size, 14);
        const reachable = new Set(s.allies);
        for (const tile of reachable) for (const next of hexNeighbors(tile)) if (!blockedTiles.includes(next)) reachable.add(next);
        all.forEach(tile => {
            assert.ok(tile >= 0 && tile < GRID_W * GRID_H);
            assert.ok(!blockedTiles.includes(tile));
            assert.ok(reachable.has(tile));
        });
        assert.ok(s.enemies.every(tile => hexDistance(s.allies[0]!, tile) >= 5));
    }
});

test('dense terrain falls back to connected free tiles without clearing terrain', () => {
    const free = [64, 65, 66, 67];
    const blockedTiles = Array.from({ length: 120 }, (_, i) => i).filter(i => !free.includes(i));
    const s = combatSpawnPositions('narrow-corridor', { enemies: 2, blockedTiles });
    assert.equal(new Set([...s.allies, ...s.enemies]).size, 3);
    assert.ok([...s.allies, ...s.enemies].every(tile => free.includes(tile)));
    assert.equal(blockedTiles.length, 116);
});

test('invalid or impossible formations fail instead of overlapping fighters', () => {
    assert.throws(() => combatSpawnPositions('invalid', { enemies: 0 }), /Invalid/);
    assert.throws(() => combatSpawnPositions('invalid', { allies: 2, mirrored: true }), /Invalid/);
    assert.throws(() => combatSpawnPositions('invalid', { openingDistance: Infinity }), /Invalid/);
    assert.throws(() => combatSpawnPositions('invalid', { openingDistance: 0 }), /Invalid/);
    assert.throws(() => combatFormationPositions('invalid', { allies: [62], enemies: [62] }), /Invalid/);
    assert.throws(() => combatFormationPositions('invalid', { allies: [], enemies: [57] }), /Invalid/);
    assert.throws(() => combatFormationPositions('invalid', { allies: [120], enemies: [57] }), /Invalid/);
    assert.throws(() => combatSpawnPositions('full', { blockedTiles: Array.from({ length: 120 }, (_, i) => i) }), /no connected/);
});

test('PvE can use a connected room wholly inside one board half', () => {
    const free = [25, 26, 27];
    const blockedTiles = Array.from({ length: 120 }, (_, i) => i).filter(i => !free.includes(i));
    const s = combatSpawnPositions('one-sided-room', { enemies: 2, blockedTiles });
    assert.equal(new Set([...s.allies, ...s.enemies]).size, 3);
    assert.ok([...s.allies, ...s.enemies].every(tile => free.includes(tile)));
    assert.throws(() => combatSpawnPositions('competitive', { mirrored: true, blockedTiles }), /no connected/);
});

test('terrain can force a formation to the edge without changing its spacing', () => {
    const free = [48, 49, 61];
    const blockedTiles = Array.from({ length: 120 }, (_, i) => i).filter(i => !free.includes(i));
    const s = combatFormationPositions('edge-room', { allies: [62], enemies: [63, 75], blockedTiles });
    assert.deepEqual(s, { allies: [48], enemies: [49, 61] });
});

test('a group still places every fighter when no intact formation fits the room', () => {
    const free = [25, 26, 27, 28];
    const blockedTiles = Array.from({ length: 120 }, (_, i) => i).filter(i => !free.includes(i));
    const s = combatFormationPositions('small-room', { allies: [62], enemies: [33, 57, 81], blockedTiles });
    assert.equal(s.allies.length, 1);
    assert.equal(s.enemies.length, 3);
    assert.equal(new Set([...s.allies, ...s.enemies]).size, 4);
    assert.ok([...s.allies, ...s.enemies].every(tile => free.includes(tile)));
});

test('separate walkable pockets cannot be mistaken for a connected battlefield', () => {
    const free = [0, 1, 118, 119];
    const blockedTiles = Array.from({ length: 120 }, (_, i) => i).filter(i => !free.includes(i));
    assert.throws(() => combatSpawnPositions('split-rooms', { enemies: 2, blockedTiles }), /no connected/);
});

test('varied obstacle maps place every fighter whenever a large enough connected room exists', () => {
    for (let seed = 0; seed < 90; seed++) {
        let state = seed + 1;
        const blockedTiles = Array.from({ length: 120 }, (_, i) => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296 < (seed % 3 + 1) * .23 ? i : -1;
        }).filter(tile => tile >= 0);
        const free = new Set(Array.from({ length: 120 }, (_, i) => i).filter(tile => !blockedTiles.includes(tile)));
        const rooms: number[][] = [];
        while (free.size) {
            const room = [free.values().next().value!];
            free.delete(room[0]!);
            for (let i = 0; i < room.length; i++) for (const next of hexNeighbors(room[i]!)) {
                if (free.delete(next)) room.push(next);
            }
            rooms.push(room);
        }
        const enemyCount = seed % 3 + 1;
        const builders = [
            () => combatSpawnPositions(String(seed), { enemies: enemyCount, blockedTiles }),
            () => combatFormationPositions(String(seed), { allies: [62], enemies: [33, 57, 81].slice(0, enemyCount), blockedTiles }),
        ];
        for (const build of builders) {
            if (!rooms.some(room => room.length >= enemyCount + 1)) {
                assert.throws(build, /no connected/);
                continue;
            }
            const s = build();
            const tiles = [...s.allies, ...s.enemies];
            assert.equal(tiles.length, enemyCount + 1);
            assert.equal(new Set(tiles).size, tiles.length);
            assert.ok(rooms.some(room => tiles.every(tile => room.includes(tile))), `seed ${seed}: all fighters need one clear connected room`);
        }
    }
});

test('random group openings preserve every authored pairwise hex distance', () => {
    for (const original of [[62, 44, 92, 20, 18, 42, 66, 90, 114, 22, 46, 70, 94, 118], [62, 33, 57, 81], [62, 45, 81]]) {
        const seen = new Set<string>();
        for (let i = 0; i < 80; i++) {
            const options = { allies: original.slice(0, 1), enemies: original.slice(1), blockedTiles: [45, 81] };
            const spawns = combatFormationPositions(String(i), options);
            assert.deepEqual(spawns, combatFormationPositions(String(i), options));
            const tiles = [...spawns.allies, ...spawns.enemies];
            assert.equal(new Set(tiles).size, original.length);
            assert.ok(tiles.every(tile => !options.blockedTiles.includes(tile)));
            for (let a = 0; a < tiles.length; a++) for (let b = 0; b < tiles.length; b++) {
                assert.equal(hexDistance(tiles[a]!, tiles[b]!), hexDistance(original[a]!, original[b]!));
            }
            seen.add(tiles.join(':'));
        }
        assert.ok(seen.size >= 2);
    }
});
