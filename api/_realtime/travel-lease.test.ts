import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_EXITS, SECTOR_TILE_COUNT } from '../../shared/sector-links.js';
import { MAX_WILD_SECTOR, WILD_SECTOR_IDS } from '../../shared/sector-geo.js';

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

// REGRESSION (the "ROAD BLOCKED / Travel could not be secured" 503): this
// validator hardcoded `<= 60` and was missed when sectors 61-66 were added, so
// setTravelLease threw on the 24 exits that touch them and api/player/travel.ts
// answered 503. Pinning it to the SHARED road graph — not to a literal — means
// the next sector added fails here instead of in the live world.
test('every road in the shared graph mints a lease the validator accepts', () => {
    const rejected = SECTOR_EXITS.filter((exit) => !travel.parseTravelLease({
        originSector: exit.sector,
        destinationSector: exit.destinationSector,
        arrivalAt: 5_000,
        arrivalTile: exit.destinationTile,
    }));
    assert.deepEqual(
        rejected.map((exit) => `${exit.sector}->${exit.destinationSector}`),
        [],
        'a crossing the road graph offers must be storable as a travel lease',
    );
});

test('travel lease accepts every real sector id, and only those', () => {
    const base = { originSector: 1, arrivalAt: 5_000 };
    for (const id of WILD_SECTOR_IDS) {
        assert.ok(travel.parseTravelLease({ ...base, destinationSector: id }), `sector ${id} is travelable`);
    }
    assert.ok(travel.parseTravelLease({ ...base, destinationSector: 99 }), "Death's Gate is travelable");
    assert.ok(travel.parseTravelLease({ originSector: 0, destinationSector: 1, arrivalAt: 5_000 }), 'village origin');
    assert.equal(travel.parseTravelLease({ ...base, destinationSector: MAX_WILD_SECTOR + 1 }), null);
    assert.equal(travel.parseTravelLease({ ...base, destinationSector: 0 }), null);
});

test('travel lease bounds the arrival tile by the board, not a literal 143', () => {
    const base = { originSector: 12, destinationSector: 13, arrivalAt: 5_000 };
    assert.equal(travel.parseTravelLease({ ...base, arrivalTile: SECTOR_TILE_COUNT - 1 })?.arrivalTile, SECTOR_TILE_COUNT - 1);
    assert.equal(travel.parseTravelLease({ ...base, arrivalTile: SECTOR_TILE_COUNT })?.arrivalTile, undefined);
});

// REGRESSION (the OTHER source of "Travel could not be secured"): settleTravelLease
// holds this same lock across mutatePlayerSave, which takes a NESTED lock:save:<name>.
// Because edge crossings are instant, the settle for the crossing you just made is
// often still holding the key when you walk into the next one. The default 5-attempt
// budget gave up at ~775ms, setTravelLease is failClosed, and api/player/travel.ts
// turned the throw into a 503 — the player did not move. Asserts the wait outlasts a
// realistic settle; only the positive is asserted so a slow CI box can't flake it.
test('a travel request outwaits a settle that is holding the lease lock', async () => {
    const name = `travel-lock-${process.pid}`;
    const lockKey = `lock:${travel.travelLeaseKey(name)}`;
    await kv.set(lockKey, 'held-by-an-in-flight-settle', { nx: true, ex: 5 });
    const release = setTimeout(() => { void kv.del(lockKey); }, 900);
    try {
        await travel.setTravelLease(name, lease);
        assert.ok(await travel.getTravelLease(name), 'the lease is written once the settle releases');
    } finally {
        clearTimeout(release);
        await kv.del(lockKey, travel.travelLeaseKey(name));
    }
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

test('an action reconciles a matured travel receipt before sector validation', async () => {
    const name = `travel-action-${process.pid}`;
    const saveKey = `save:${name}`;
    await kv.set(saveKey, {
        character: { name },
        currentSector: lease.originSector,
        pendingTravel: { destinationSector: lease.destinationSector, arrivalAt: lease.arrivalAt },
        _saveVersion: 9,
    });
    await travel.setTravelLease(name, lease);

    assert.equal(await travel.settleMaturedTravelForAction(name, lease.arrivalAt - 1), null);
    assert.equal(await travel.settleMaturedTravelForAction(name, lease.arrivalAt), lease.destinationSector);
    const saved = await kv.get<Record<string, unknown>>(saveKey);
    assert.equal(saved?.currentSector, lease.destinationSector);
    assert.equal(saved?.pendingTravel, null);
    assert.equal(saved?._saveVersion, 10);
    await kv.del(saveKey, travel.travelLeaseKey(name));
});

test('an action waits for a competing presence settle lock before committing arrival', async () => {
    const name = `travel-action-lock-${process.pid}`;
    const saveKey = `save:${name}`;
    const lockKey = `lock:${travel.travelLeaseKey(name)}`;
    await kv.set(saveKey, {
        character: { name },
        currentSector: lease.originSector,
        pendingTravel: { destinationSector: lease.destinationSector, arrivalAt: lease.arrivalAt },
        _saveVersion: 11,
    });
    await travel.setTravelLease(name, lease);
    await kv.set(lockKey, 'presence-settler', { nx: true, ex: 5 });
    const release = setTimeout(() => { void kv.del(lockKey); }, 900);
    try {
        assert.equal(await travel.settleMaturedTravelForAction(name, lease.arrivalAt), lease.destinationSector);
        const saved = await kv.get<Record<string, unknown>>(saveKey);
        assert.equal(saved?.currentSector, lease.destinationSector);
        assert.equal(saved?._saveVersion, 12);
        assert.equal(await travel.getTravelLease(name), null);
    } finally {
        clearTimeout(release);
        await kv.del(lockKey, saveKey, travel.travelLeaseKey(name));
    }
});
