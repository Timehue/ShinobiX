import { test } from "node:test";
import assert from "node:assert/strict";
import { worldSectorReconcileTarget } from "./sector-reconcile";

const base = {
    serverSector: 5,
    serverTraveling: false,
    sentSector: 20,
    currentSector: 20,
    clientTraveling: false,
};

test("snaps to the server's sector when the client has drifted (raid/event teleport)", () => {
    // Client thinks it's at 20 (a remote raid backdrop); server truthfully keeps it
    // at 5. Heal to 5 so it becomes visible in its real sector again.
    assert.equal(worldSectorReconcileTarget({ ...base, serverSector: 5, currentSector: 20, sentSector: 20 }), 5);
});

test("returns null when client and server already agree", () => {
    assert.equal(worldSectorReconcileTarget({ ...base, serverSector: 12, currentSector: 12, sentSector: 12 }), null);
});

test("never reconciles while the client is mid-travel (leads the lease during the mask)", () => {
    assert.equal(worldSectorReconcileTarget({ ...base, serverSector: 0, currentSector: 5, sentSector: 5, clientTraveling: true }), null);
});

test("never reconciles while the SERVER reports an in-flight lease (arrival-settle window)", () => {
    // Just arrived at 5; the server's lease hasn't matured yet so it still reports
    // the origin 0 with traveling=true. Must NOT bounce the arrival back to 0.
    assert.equal(worldSectorReconcileTarget({ serverSector: 0, serverTraveling: true, sentSector: 5, currentSector: 5, clientTraveling: false }), null);
});

test("ignores a stale response whose reported sector no longer matches the live one", () => {
    // A beat was sent while at 5 (its response says the server was at 5); we've since
    // moved to 20. Acting on the old response would wrongly snap us back to 5.
    assert.equal(worldSectorReconcileTarget({ ...base, serverSector: 5, sentSector: 5, currentSector: 20 }), null);
});

test("returns null for an old server that does not report its sector", () => {
    assert.equal(worldSectorReconcileTarget({ ...base, serverSector: undefined }), null);
    assert.equal(worldSectorReconcileTarget({ ...base, serverSector: null }), null);
    assert.equal(worldSectorReconcileTarget({ ...base, serverSector: NaN }), null);
});

test("floors and clamps a fractional/negative server sector", () => {
    assert.equal(worldSectorReconcileTarget({ ...base, serverSector: 5.9, currentSector: 20, sentSector: 20 }), 5);
    assert.equal(worldSectorReconcileTarget({ ...base, serverSector: -3, currentSector: 20, sentSector: 20 }), 0);
});

test("safe-zone agreement (both at 0) does not snap", () => {
    assert.equal(worldSectorReconcileTarget({ ...base, serverSector: 0, currentSector: 0, sentSector: 0 }), null);
});
