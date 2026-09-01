import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'test';
process.env.SESSION_SECRET = 'delete-account-test-secret';

/*
 * Deleting a player is two separable jobs, and conflating them is a live
 * hazard: the admin "clear auth lock" tool frees a stuck credential while
 * deliberately KEEPING the character's save. These pin that split.
 */

const store = new Map<string, unknown>();
const hashes = new Map<string, Record<string, unknown>>();
const clone = <T>(v: T): T => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)) as T);

let detachPlayerReferences: typeof import('./_delete-player-account.js').detachPlayerReferences;
let deletePlayerAccount: typeof import('./_delete-player-account.js').deletePlayerAccount;

before(async () => {
    const { kv } = await import('./_storage.js');
    kv.get = async <T,>(key: string) => clone(store.get(key)) as T | null;
    kv.set = async (key: string, value: unknown, options?: { nx?: boolean }) => {
        if (options?.nx && store.has(key)) return null;
        store.set(key, clone(value));
        return 'OK' as const;
    };
    kv.del = async (...keys: string[]) => keys.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0);
    kv.incr = async (key: string) => { const n = (Number(store.get(key)) || 0) + 1; store.set(key, n); return n; };
    kv.hdel = async (key: string, ...fields: string[]) => {
        const h = hashes.get(key);
        if (!h) return 0;
        return fields.reduce((n, f) => (f in h ? (delete h[f], n + 1) : n), 0);
    };

    const mod = await import('./_delete-player-account.js');
    detachPlayerReferences = mod.detachPlayerReferences;
    deletePlayerAccount = mod.deletePlayerAccount;
});

beforeEach(() => {
    store.clear();
    hashes.clear();
    hashes.set('player:registry', { wanderer: { lastSeen: 1 }, kaze: { lastSeen: 2 } });
    store.set('auth:wanderer', { hash: 'scrypt:x', salt: 's', sessionEpoch: 0 });
    store.set('save:wanderer', { character: { name: 'wanderer', clan: 'Storm Petals' } });
    store.set('friends:wanderer', ['kaze']);
    store.set('player-friends:wanderer', ['kaze']);
    store.set('save:clan-stormpetals', {
        founderName: 'Kaze',
        members: [{ name: 'Kaze' }, { name: 'wanderer' }],
        roleOverrides: { wanderer: 'officer' },
        joinRequests: [{ name: 'wanderer' }],
    });
    store.set('mod:ip:wanderer', { lastIp: '1.2.3.4', ips: ['1.2.3.4'] });
    store.set('mod:by-ip:1.2.3.4', ['wanderer', 'realplayer']);
});

describe('player deletion', () => {
    it('detaches back-references without touching the account itself', async () => {
        const result = await detachPlayerReferences('wanderer');

        const clan = store.get('save:clan-stormpetals') as { members: { name: string }[]; roleOverrides: Record<string, string> };
        assert.deepEqual(clan.members.map((m) => m.name), ['Kaze'], 'the clan must stop counting a departed member');
        assert.equal(clan.roleOverrides.wanderer, undefined);
        assert.deepEqual(store.get('mod:by-ip:1.2.3.4'), ['realplayer'], 'a dead name must not hold an alt-detection slot');
        assert.equal(store.has('friends:wanderer'), false);
        assert.equal(store.has('player-friends:wanderer'), false);

        // The half this function must NOT do.
        assert.equal(store.has('auth:wanderer'), true, 'the credential is not this function\'s business');
        assert.equal(store.has('save:wanderer'), true, 'nor is the save');
        assert.deepEqual(result.failures, []);
    });

    it('is safe to run when the player has no clan, friends, or moderation rows', async () => {
        store.set('save:kaze', { character: { name: 'kaze' } });
        const result = await detachPlayerReferences('kaze');
        assert.deepEqual(result.failures, []);
    });

    it('refuses an empty slug rather than operating on bare keys', async () => {
        const result = await detachPlayerReferences('!!!');
        assert.deepEqual(result.failures, ['empty slug']);
        assert.equal(store.has('friends:wanderer'), true, 'nothing else may be touched');
        assert.equal(store.has('player-friends:wanderer'), true, 'nothing else may be touched');
    });

    it('full deletion removes the account AND every reference, in that safe order', async () => {
        store.set('auth-session:wanderer', 0);
        await deletePlayerAccount('wanderer');

        assert.equal(store.has('auth:wanderer'), false);
        assert.equal(store.has('save:wanderer'), false);
        assert.equal(store.has('friends:wanderer'), false);
        assert.equal(store.has('player-friends:wanderer'), false);
        assert.equal((hashes.get('player:registry') ?? {}).wanderer, undefined);
        // The clan is read off the save, so detaching has to happen before the
        // save is deleted — if the order regressed, this roster would still
        // name the departed member.
        const clan = store.get('save:clan-stormpetals') as { members: { name: string }[] };
        assert.deepEqual(clan.members.map((m) => m.name), ['Kaze']);
        // Revocation state outlives the account so the freed name cannot be
        // inherited by an old token.
        assert.equal(Number(store.get('auth-session:wanderer')), 1);
    });
});
