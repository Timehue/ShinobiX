import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStrongholdTiles, STRONGHOLD_DIMS, STRONGHOLD_ROOMS } from '../../../shared/sector-stronghold';
import { planUndergroundFurnishings } from './underground-room-furnishings';
const rooms = STRONGHOLD_ROOMS.map(r => ({ ...r, roomId: r.id, right: r.x + r.width, bottom: r.y + r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }));
const tiles = buildStrongholdTiles(12), width = STRONGHOLD_DIMS.width;
test('every base room has a functional furnishing plan, with paired reserves and entrance guards in the treasury', () => {
    const plan = planUndergroundFurnishings(rooms, tiles, width, false, true);
    for (const room of rooms) assert(plan.some(p => p.roomId === room.id), `${room.name} has a purposeful furnishing`);
    const treasury = plan.filter(p => p.roomId === 11);
    assert.deepEqual(treasury.map(p => p.role), ['guardian', 'guardian', 'reserve-chest', 'reserve-chest']);
    assert(treasury.filter(p => p.role === 'guardian').every(p => p.y < rooms[11].cy));
    assert(treasury.filter(p => p.role === 'reserve-chest').every(p => p.y > rooms[11].cy));
    assert.equal(plan.some(p => p.role === 'gate'), false, 'only real geometry supplies doorways');
    assert.equal(plan.filter(p => p.roomId === 8)[0].role, 'cistern');
    assert(plan.filter(p => p.roomId === 5).some(p => p.role === 'training-dummy'));
    assert(plan.length <= 26, 'room dressing does not grow into repeated filler');
});
test('furnishings keep all doorway lanes and gameplay nodes clear and never overlap one another', () => {
    const plan = planUndergroundFurnishings(rooms, tiles, width, false, true);
    for (const prop of plan) {
        const room = rooms[prop.roomId], tile = tiles[Math.floor(prop.y) * width + Math.floor(prop.x)];
        assert.equal(tile.kind, 'empty'); assert.notEqual(tile.terrain, 'door');
        assert(Math.abs(prop.x - room.cx) >= prop.width / 2 + .55);
        assert(Math.abs(prop.y - room.cy) >= .8);
        for (const other of plan) {
            if (prop === other) continue;
            const overlap = Math.abs(prop.x - other.x) < (prop.width + other.width) / 2
                && prop.y > other.y - other.height && other.y > prop.y - prop.height;
            assert.equal(overlap, false, `${prop.purpose} overlaps ${other.purpose}`);
        }
    }
});
test('an authored content node replaces its decorative corner; caves have at most one perimeter prop per ordinary room', () => {
    const occupied = tiles.map(t => ({ ...t }));
    const props = planUndergroundFurnishings(rooms, occupied, width, false, true);
    const first = props[0]; occupied[Math.floor(first.y) * width + Math.floor(first.x)].kind = 'boss';
    assert.equal(planUndergroundFurnishings(rooms, occupied, width, false, true).some(p => p.x === first.x && p.y === first.y), false);
    const cave = planUndergroundFurnishings(rooms, tiles, width, true, false);
    for (const room of rooms) assert(cave.filter(p => p.roomId === room.roomId).length <= (room.roomId === 11 ? 2 : 1));
});
