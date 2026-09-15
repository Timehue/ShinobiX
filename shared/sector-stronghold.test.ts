import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceStronghold, buildStrongholdTiles, canStepStronghold, strongholdRooms, STRONGHOLD_DIMS, STRONGHOLD_ROOMS, STRONGHOLD_SPAWN, STRONGHOLD_VAULT, type StrongholdVisit } from './sector-stronghold.js';

test('Death’s Gate reskin preserves all twelve rooms and opens the Blood Altar for dueling', () => {
    const tiles = buildStrongholdTiles(99);
    assert.equal(tiles.filter(t => t.kind === 'boss').length, 0);
    assert.equal(strongholdRooms(99).length, 12);
    assert.equal(strongholdRooms(99)[11].name, 'Blood Altar');
    assert.equal(canStepStronghold(STRONGHOLD_VAULT - 1, STRONGHOLD_VAULT, 99), true);
    assert.equal(canStepStronghold(STRONGHOLD_VAULT - 1, STRONGHOLD_VAULT, 12), false);
    assert.deepEqual(tiles.map(t => t.terrain), buildStrongholdTiles(12).map(t => t.terrain));
});

test('all twelve chambers and the vault are connected; everyone gets identical geometry', () => {
    const tiles = buildStrongholdTiles();
    assert.deepEqual(tiles, buildStrongholdTiles());
    assert.equal(new Set(tiles.filter(t => t.roomId != null).map(t => t.roomId)).size, 12);
    const reached = new Set([STRONGHOLD_SPAWN]);
    const queue = [STRONGHOLD_SPAWN];
    for (let head = 0; head < queue.length; head++) {
        for (const next of [queue[head] - 1, queue[head] + 1, queue[head] - STRONGHOLD_DIMS.width, queue[head] + STRONGHOLD_DIMS.width]) {
            if (!reached.has(next) && (canStepStronghold(queue[head], next) || next === STRONGHOLD_VAULT)) { reached.add(next); queue.push(next); }
        }
    }
    for (const room of STRONGHOLD_ROOMS) assert.ok(reached.has((room.y + 2) * STRONGHOLD_DIMS.width + room.x + 3), room.name);
    assert.ok(reached.has(STRONGHOLD_VAULT));
});

test('only successful adjacent steps build threat, and the 25th step blocks movement for a patrol', () => {
    let visit: StrongholdVisit = { id: 'visit', layoutVersion: 1, sector: 12, tile: STRONGHOLD_SPAWN, steps: 0, threat: 0, version: 0, visited: [STRONGHOLD_SPAWN] };
    assert.equal(advanceStronghold(visit, visit.tile), null);
    assert.equal(advanceStronghold(visit, 0), null);
    assert.equal(canStepStronghold(36, 37), false);
    for (let step = 1; step <= 25; step++) {
        visit = advanceStronghold(visit, STRONGHOLD_SPAWN + step % 2)!;
        assert.equal(visit.steps, step);
        assert.equal(visit.threat, step * 4);
    }
    assert.equal(advanceStronghold(visit, STRONGHOLD_SPAWN), null);
    assert.equal(advanceStronghold({ ...visit, threat: 0, patrolId: 'pending' }, STRONGHOLD_SPAWN), null);
});
