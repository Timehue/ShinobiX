import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'x';

const store = new Map<string, unknown>();
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

let api: typeof import('./_challenge-authorization.js');

before(async () => {
    const { kv } = await import('../_storage.js');
    kv.get = async <T,>(key: string) => copy(store.get(key) ?? null) as T | null;
    kv.set = async (key: string, value: unknown, options?: { nx?: boolean }) => {
        if (options?.nx && store.has(key)) return null;
        store.set(key, copy(value));
        return 'OK' as const;
    };
    kv.del = async (...keys: string[]) => keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
    kv.delIfEqual = async (key: string, expected: string) => {
        if (store.get(key) !== expected) return false;
        store.delete(key);
        return true;
    };
    api = await import('./_challenge-authorization.js');
});

beforeEach(() => store.clear());

function pending(id = 'challenge_1234'): import('./_challenge-authorization.js').AuthoritativeChallengeRecord {
    return {
        id,
        from: 'alice',
        to: 'bob',
        mode: 'standard',
        status: 'pending',
        createdAt: Date.now(),
        challenge: { id, fromName: 'Alice', toName: 'Bob', mode: 'standard' },
    };
}

describe('authoritative challenge reservations', () => {
    it('cannot overwrite an existing challenge record with a reused client id', async () => {
        assert.equal(await api.saveChallengeRecord(pending()), true);
        assert.equal(await api.saveChallengeRecord({ ...pending(), from: 'mallory' }), false);
        assert.equal((await api.loadChallengeRecord('challenge_1234'))?.from, 'alice');
    });

    it('requires the exact responder and fighter order', async () => {
        await api.saveChallengeRecord(pending());
        assert.equal(await api.reserveChallengeForPvpSession({
            challengeId: 'challenge_1234', creator: 'mallory', p1: 'alice', p2: 'bob', mode: 'standard', battleId: 'pvp-1',
        }), null);
        assert.equal((await api.loadChallengeRecord('challenge_1234'))?.status, 'pending');
    });

    it('is single-use and accepts only the exact bound battle', async () => {
        await api.saveChallengeRecord(pending());
        const first = await api.reserveChallengeForPvpSession({
            challengeId: 'challenge_1234', creator: 'bob', p1: 'alice', p2: 'bob', mode: 'standard', battleId: 'pvp-1',
        });
        assert.equal(first?.battleId, 'pvp-1');
        assert.equal(await api.reserveChallengeForPvpSession({
            challengeId: 'challenge_1234', creator: 'bob', p1: 'alice', p2: 'bob', mode: 'standard', battleId: 'pvp-2',
        }), null);
        assert.equal(await api.resolveChallengeRecord({
            id: 'challenge_1234', responder: 'bob', target: 'alice', resolution: 'accepted', battleId: 'pvp-wrong',
        }), null);
        const accepted = await api.resolveChallengeRecord({
            id: 'challenge_1234', responder: 'bob', target: 'alice', resolution: 'accepted', battleId: 'pvp-1',
        });
        assert.equal(accepted?.record.status, 'accepted');
        assert.equal(accepted?.replay, false);
    });

    it('declines only the exact outstanding challenge participants', async () => {
        await api.saveChallengeRecord(pending());
        assert.equal(await api.resolveChallengeRecord({
            id: 'challenge_1234', responder: 'mallory', target: 'alice', resolution: 'declined',
        }), null);
        const declined = await api.resolveChallengeRecord({
            id: 'challenge_1234', responder: 'bob', target: 'alice', resolution: 'declined',
        });
        assert.equal(declined?.record.status, 'declined');
    });
});
