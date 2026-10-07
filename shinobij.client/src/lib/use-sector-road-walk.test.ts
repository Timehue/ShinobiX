import test from 'node:test';
import assert from 'node:assert/strict';
import { sectorExits } from '../../../shared/sector-links';
import { createRoadApproach } from './use-sector-road-walk';

const east = sectorExits(31).find(exit => exit.destinationSector === 27)!;
const other = sectorExits(31).find(exit => exit.id !== east.id)!;
test('road crossing waits for the actual exit arrival and consumes it once', () => {
    const walk = createRoadApproach();
    walk.arrive(31, 85);
    assert.equal(walk.request(east), null);
    assert.equal(walk.arrive(31, east.tile - 1), null);
    assert.equal(walk.arrive(27, east.tile), null);
    assert.equal(walk.arrive(31, east.tile), east);
    assert.equal(walk.arrive(31, east.tile), null);
});
test('new input cancels an approach; a replacement exit owns its own arrival', () => {
    const walk = createRoadApproach();
    walk.request(east); walk.cancel();
    assert.equal(walk.arrive(31, east.tile), null);
    walk.reset(); walk.request(east); walk.request(other);
    assert.equal(walk.arrive(31, east.tile), null);
    assert.equal(walk.arrive(31, other.tile), other);
});
test('a player already standing at the mouth can cross; leaving retires all work', () => {
    const walk = createRoadApproach();
    walk.arrive(31, east.tile);
    assert.equal(walk.request(east), east);
    walk.depart();
    assert.equal(walk.request(east), null);
    assert.equal(walk.arrive(31, east.tile), east);
    walk.reset();
    assert.equal(walk.request(east), null);
    walk.reset();
    assert.equal(walk.arrive(31, east.tile), null);
});
