import { before, test } from 'node:test';
import assert from 'node:assert/strict';

let kv: typeof import('../_storage.js').kv;
let travel: typeof import('./travel-lease.js');

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    ({ kv } = await import('../_storage.js'));
    travel = await import('./travel-lease.js');
});

const lease = {
    originSector: 12,
    destinationSector: 13,
    arrivalAt: 5_000,
    arrivalTile: 44,
};

test('travel lease keeps an active traveler at the origin and settles at the destination', () => {
    assert.equal(travel.travelLeaseSectorAt(lease, 4_999), 12);
    assert.equal(travel.travelLeaseSectorAt(lease, 5_000), 13);
});

test('travel lease never exposes an active traveler as a sleeper', () => {
    assert.equal(travel.sleeperSectorForTravelLease(lease, 4_999), null);
    assert.equal(travel.sleeperSectorForTravelLease(lease, 5_000), 13);
});

test('travel lease parsing rejects invalid sectors and clamps optional tile shape', () => {
    assert.deepEqual(travel.parseTravelLease(JSON.stringify(lease)), lease);
    assert.equal(travel.parseTravelLease({ ...lease, destinationSector: 0 }), null);
    assert.deepEqual(travel.parseTravelLease({ ...lease, arrivalTile: 900 }), {
        originSector: 12,
        destinationSector: 13,
        arrivalAt: 5_000,
    });
});

test('matured travel is committed to the versioned save before its lease is deleted', async () => {
    const name = `travel-lease-${process.pid}`;
    const saveKey = `save:${name}`;
    await kv.set(saveKey, {
        character: { name },
        currentSector: lease.originSector,
        pendingTravel: { destinationSector: lease.destinationSector, arrivalAt: lease.arrivalAt },
        _saveVersion: 4,
    });
    await travel.setTravelLease(name, lease);

    assert.equal(await travel.settleTravelLease(name, lease, lease.arrivalAt - 1), false);
    assert.ok(await travel.getTravelLease(name), 'active lease is retained');
    assert.equal(await travel.settleTravelLease(name, lease, lease.arrivalAt), true);

    const saved = await kv.get<Record<string, unknown>>(saveKey);
    assert.equal(saved?.currentSector, lease.destinationSector);
    assert.equal(saved?.pendingTravel, null);
    assert.equal(saved?._saveVersion, 5);
    assert.equal(await travel.getTravelLease(name), null, 'lease clears only after the save commit');
    await kv.del(saveKey);
});
