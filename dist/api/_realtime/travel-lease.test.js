"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
let kv;
let travel;
(0, node_test_1.before)(async () => {
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
(0, node_test_1.test)('travel lease keeps an active traveler at the origin and settles at the destination', () => {
    strict_1.default.equal(travel.travelLeaseSectorAt(lease, 4_999), 12);
    strict_1.default.equal(travel.travelLeaseSectorAt(lease, 5_000), 13);
});
(0, node_test_1.test)('travel lease never exposes an active traveler as a sleeper', () => {
    strict_1.default.equal(travel.sleeperSectorForTravelLease(lease, 4_999), null);
    strict_1.default.equal(travel.sleeperSectorForTravelLease(lease, 5_000), 13);
});
(0, node_test_1.test)('travel lease parsing rejects invalid sectors and clamps optional tile shape', () => {
    strict_1.default.deepEqual(travel.parseTravelLease(JSON.stringify(lease)), lease);
    strict_1.default.equal(travel.parseTravelLease({ ...lease, destinationSector: 0 }), null);
    strict_1.default.deepEqual(travel.parseTravelLease({ ...lease, arrivalTile: 900 }), {
        originSector: 12,
        destinationSector: 13,
        arrivalAt: 5_000,
    });
});
(0, node_test_1.test)('matured travel is committed to the versioned save before its lease is deleted', async () => {
    const name = `travel-lease-${process.pid}`;
    const saveKey = `save:${name}`;
    await kv.set(saveKey, {
        character: { name },
        currentSector: lease.originSector,
        pendingTravel: { destinationSector: lease.destinationSector, arrivalAt: lease.arrivalAt },
        _saveVersion: 4,
    });
    await travel.setTravelLease(name, lease);
    strict_1.default.equal(await travel.settleTravelLease(name, lease, lease.arrivalAt - 1), false);
    strict_1.default.ok(await travel.getTravelLease(name), 'active lease is retained');
    strict_1.default.equal(await travel.settleTravelLease(name, lease, lease.arrivalAt), true);
    const saved = await kv.get(saveKey);
    strict_1.default.equal(saved?.currentSector, lease.destinationSector);
    strict_1.default.equal(saved?.pendingTravel, null);
    strict_1.default.equal(saved?._saveVersion, 5);
    strict_1.default.equal(await travel.getTravelLease(name), null, 'lease clears only after the save commit');
    await kv.del(saveKey);
});
