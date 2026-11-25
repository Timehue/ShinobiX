import assert from 'node:assert/strict';
import test from 'node:test';
import { COAST_WORLD } from '../../../../shared/coast-world';
import { pathInMask } from '../../../../shared/sector-walk-mask';
import { roomDuties } from '../../../../shared/coast-room-duties';

const sites = Object.values(COAST_WORLD.layouts).flatMap(layout => Object.values(layout.sites)).filter(site => site.floors.length);

test('every painted coast interior has three distinct requests at reachable stations', () => {
    assert.deepEqual(Object.keys(roomDuties).sort(), sites.map(site => site.id).sort());
    for (const site of sites) {
        const duty = roomDuties[site.id]!;
        assert.notEqual(duty.inspect, duty.operate);
        for (const station of [duty.inspect, duty.operate]) {
            const rooms = site.floors.filter(floor => floor.stations.some(entry => entry.name === station));
            assert.equal(rooms.length, 1, site.name + ' / ' + station);
            const floor = rooms[0], at = floor.stations.find(entry => entry.name === station)!.approach;
            const entrances = site.floors.flatMap(other => other.stairs.filter(stair => site.floors[stair.to] === floor).map(stair => stair.arrival));
            for (const entry of [floor.spawn, ...entrances]) assert.ok(pathInMask(floor.mask, entry, at), site.id + ' / ' + station);
        }
        for (const field of ['action', 'reading', 'result'] as const) assert.equal(new Set(duty.cases.map(card => card[field])).size, 3, site.id);
    }
});
