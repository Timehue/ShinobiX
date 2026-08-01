import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { enqueueClaim, removeClaim, readClaimOutbox, flushClaimOutbox, CLAIM_OUTBOX_MAX_AGE_MS, type ClaimOutboxStorage } from './claim-outbox';

/*
 * P0-2: the durable combat-claim outbox. A mission win parked here must
 * survive until the (idempotent) queue endpoint acks it — network failures
 * keep the entry, definitive server answers remove it, ancient entries expire.
 */

function fakeStorage(): ClaimOutboxStorage & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
    };
}

describe('claim outbox durability', () => {
    it('parks, dedupes, and removes wins per player', () => {
        const storage = fakeStorage();
        enqueueClaim('Rill', 'combat-e-1', storage);
        enqueueClaim('Rill', 'combat-e-1', storage);
        enqueueClaim('Rill', 'combat-d-2', storage);
        enqueueClaim('Other', 'combat-e-1', storage);
        assert.deepEqual(readClaimOutbox('Rill', storage).map((e) => e.missionId), ['combat-e-1', 'combat-d-2']);
        removeClaim('Rill', 'combat-e-1', storage);
        assert.deepEqual(readClaimOutbox('Rill', storage).map((e) => e.missionId), ['combat-d-2']);
        assert.deepEqual(readClaimOutbox('Other', storage).map((e) => e.missionId), ['combat-e-1']);
    });

    it('expires entries older than the outbox horizon', () => {
        const storage = fakeStorage();
        storage.setItem('combatClaimOutbox.v1:rill', JSON.stringify([
            { missionId: 'stale', addedAt: Date.now() - CLAIM_OUTBOX_MAX_AGE_MS - 1000 },
            { missionId: 'fresh', addedAt: Date.now() },
        ]));
        assert.deepEqual(readClaimOutbox('Rill', storage).map((e) => e.missionId), ['fresh']);
    });

    it('tolerates corrupt storage', () => {
        const storage = fakeStorage();
        storage.setItem('combatClaimOutbox.v1:rill', '{not json');
        assert.deepEqual(readClaimOutbox('Rill', storage), []);
        enqueueClaim('Rill', 'combat-e-1', storage); // recovers by rewriting
        assert.equal(readClaimOutbox('Rill', storage).length, 1);
    });
});

describe('claim outbox flush', () => {
    it('removes acked entries, keeps failed ones, and reports the newest save version', async () => {
        const storage = fakeStorage();
        enqueueClaim('Rill', 'acked', storage);
        enqueueClaim('Rill', 'still-offline', storage);
        const version = await flushClaimOutbox('Rill', storage, async (_player, missionId) =>
            missionId === 'acked' ? { saveVersion: 42 } : null);
        assert.equal(version, 42);
        assert.deepEqual(readClaimOutbox('Rill', storage).map((e) => e.missionId), ['still-offline']);
    });

    it('treats a definitive queued:false decision (result without version) as an ack', async () => {
        const storage = fakeStorage();
        enqueueClaim('Rill', 'decided', storage);
        const version = await flushClaimOutbox('Rill', storage, async () => ({ saveVersion: undefined }));
        assert.equal(version, undefined);
        assert.deepEqual(readClaimOutbox('Rill', storage), []);
    });
});
