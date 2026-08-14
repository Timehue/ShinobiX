import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { enqueueClaim, removeClaim, readClaimOutbox, flushClaimOutbox, CLAIM_OUTBOX_MAX_AGE_MS, type ClaimOutboxStorage } from './claim-outbox';
import type { Character } from '../types/character';

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

const authoritativeCharacter = (name: string): Character => ({
    name,
    level: 20,
    ryo: 100,
    inventory: [],
} as Character);

describe('claim outbox durability', () => {
    it('parks, dedupes, and removes wins per player', () => {
        const storage = fakeStorage();
        enqueueClaim('Rill', 'combat-e-1', 'run-e-1', storage);
        enqueueClaim('Rill', 'combat-e-1', 'run-e-1', storage);
        enqueueClaim('Rill', 'combat-d-2', 'run-d-2', storage);
        enqueueClaim('Other', 'combat-e-1', 'run-other-e-1', storage);
        assert.deepEqual(readClaimOutbox('Rill', storage).map((e) => e.missionId), ['combat-e-1', 'combat-d-2']);
        removeClaim('Rill', 'combat-e-1', 'run-e-1', storage);
        assert.deepEqual(readClaimOutbox('Rill', storage).map((e) => e.missionId), ['combat-d-2']);
        assert.deepEqual(readClaimOutbox('Other', storage).map((e) => e.missionId), ['combat-e-1']);
    });

    it('expires entries older than the outbox horizon', () => {
        const storage = fakeStorage();
        storage.setItem('combatClaimOutbox.v2:rill', JSON.stringify([
            { missionId: 'stale', runId: 'run-stale', addedAt: Date.now() - CLAIM_OUTBOX_MAX_AGE_MS - 1000 },
            { missionId: 'fresh', runId: 'run-fresh', addedAt: Date.now() },
        ]));
        assert.deepEqual(readClaimOutbox('Rill', storage).map((e) => e.missionId), ['fresh']);
        assert.doesNotMatch(storage.getItem('combatClaimOutbox.v2:rill') ?? '', /stale/);
    });

    it('tolerates corrupt storage', () => {
        const storage = fakeStorage();
        storage.setItem('combatClaimOutbox.v2:rill', '{not json');
        assert.deepEqual(readClaimOutbox('Rill', storage), []);
        enqueueClaim('Rill', 'combat-e-1', 'run-e-1', storage); // recovers by rewriting
        assert.equal(readClaimOutbox('Rill', storage).length, 1);
    });

    it('quarantines v1 entries that have no server run authority', () => {
        const storage = fakeStorage();
        storage.setItem('combatClaimOutbox.v1:rill', JSON.stringify([
            { missionId: 'combat-e-1', addedAt: Date.now() },
        ]));
        assert.deepEqual(readClaimOutbox('Rill', storage), []);
        assert.equal(storage.getItem('combatClaimOutbox.v1:rill'), null);
    });
});

describe('claim outbox flush', () => {
    it('removes acked entries, keeps failed ones, and reports the newest save version', async () => {
        const storage = fakeStorage();
        enqueueClaim('Rill', 'acked', 'run-acked', storage);
        enqueueClaim('Rill', 'still-offline', 'run-offline', storage);
        const snapshot = await flushClaimOutbox('Rill', storage, async (_player, missionId, runId) =>
            missionId === 'acked' && runId === 'run-acked'
                ? {
                    queued: true,
                    disposition: 'accepted',
                    saveVersion: 42,
                    _saveVersion: 42,
                    character: authoritativeCharacter('Rill'),
                }
                : { queued: false, disposition: 'retryable', reason: 'network-error' });
        assert.equal(snapshot?.saveVersion, 42);
        assert.equal(snapshot?.character.name, 'Rill');
        assert.deepEqual(readClaimOutbox('Rill', storage).map((e) => e.missionId), ['still-offline']);
    });

    it('retires only a definitive terminal decision', async () => {
        const storage = fakeStorage();
        enqueueClaim('Rill', 'decided', 'run-decided', storage);
        const snapshot = await flushClaimOutbox('Rill', storage, async () => ({
            queued: false,
            disposition: 'terminal',
            reason: 'expired',
        }));
        assert.equal(snapshot, undefined);
        assert.deepEqual(readClaimOutbox('Rill', storage), []);
    });

    it('preserves auth, rate, conflict, server, and network outcomes', async () => {
        const storage = fakeStorage();
        const reasons = ['auth-401', 'rate-limit-429', 'conflict-409', 'server-500', 'network-error'];
        for (const reason of reasons) enqueueClaim('Rill', reason, `run-${reason}`, storage);
        const snapshot = await flushClaimOutbox('Rill', storage, async (_player, missionId) => ({
            queued: false,
            disposition: 'retryable',
            reason: missionId,
        }));
        assert.equal(snapshot, undefined);
        assert.deepEqual(readClaimOutbox('Rill', storage).map((entry) => entry.missionId), reasons);
    });

    it('does not retire or adopt an accepted response for a different account', async () => {
        const storage = fakeStorage();
        enqueueClaim('Rill', 'combat-e-1', 'run-cross-account', storage);
        const snapshot = await flushClaimOutbox('Rill', storage, async () => ({
            queued: true,
            disposition: 'accepted',
            saveVersion: 99,
            _saveVersion: 99,
            character: authoritativeCharacter('Other'),
        }));
        assert.equal(snapshot, undefined);
        assert.equal(readClaimOutbox('Rill', storage).length, 1);
    });

    it('isolates simultaneous drains per player while coalescing the same player', async () => {
        const storage = fakeStorage();
        enqueueClaim('Rill', 'rill-mission', 'run-rill', storage);
        enqueueClaim('Other', 'other-mission', 'run-other', storage);
        const resolvers = new Map<string, (value: {
            queued: true;
            disposition: 'accepted';
            saveVersion: number;
            _saveVersion: number;
            character: Character;
        }) => void>();
        let calls = 0;
        const queue = (player: string) => new Promise<{
            queued: true;
            disposition: 'accepted';
            saveVersion: number;
            _saveVersion: number;
            character: Character;
        }>((resolve) => {
            calls += 1;
            resolvers.set(player, resolve);
        });
        const rill = flushClaimOutbox('Rill', storage, queue);
        const rillDuplicate = flushClaimOutbox('Rill', storage, queue);
        const other = flushClaimOutbox('Other', storage, queue);
        await Promise.resolve();
        assert.equal(calls, 2, 'Rill coalesces while Other drains independently');
        resolvers.get('Rill')?.({
            queued: true,
            disposition: 'accepted',
            saveVersion: 11,
            _saveVersion: 11,
            character: authoritativeCharacter('Rill'),
        });
        resolvers.get('Other')?.({
            queued: true,
            disposition: 'accepted',
            saveVersion: 7,
            _saveVersion: 7,
            character: authoritativeCharacter('Other'),
        });
        assert.equal((await rill)?.saveVersion, 11);
        assert.equal((await rillDuplicate)?.saveVersion, 11);
        assert.equal((await other)?.saveVersion, 7);
    });
});
