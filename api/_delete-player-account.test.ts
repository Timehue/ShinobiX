import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertKvLockContext, currentKvLockContext, poisonKvLockContext } from './_kv-lock-context.js';

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
let deletePlayerFirstPactState: typeof import('./_delete-player-account.js').deletePlayerFirstPactState;
let withKvLock: typeof import('./_lock.js').withKvLock;
let beforeDelete: ((keys: string[]) => void) | undefined;

before(async () => {
    const { kv } = await import('./_storage.js');
    kv.get = async <T,>(key: string) => { assertKvLockContext(); return clone(store.get(key)) as T | null; };
    kv.set = async (key: string, value: unknown, options?: { nx?: boolean }) => {
        assertKvLockContext();
        if (options?.nx && store.has(key)) return null;
        store.set(key, clone(value));
        return 'OK' as const;
    };
    kv.del = async (...keys: string[]) => {
        assertKvLockContext();
        beforeDelete?.(keys);
        return keys.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0);
    };
    kv.delIfEqual = async (key: string, expected: unknown) => {
        assertKvLockContext();
        if (JSON.stringify(store.get(key)) !== JSON.stringify(expected)) return false;
        store.delete(key);
        return true;
    };
    kv.incr = async (key: string) => { assertKvLockContext(); const n = (Number(store.get(key)) || 0) + 1; store.set(key, n); return n; };
    kv.hdel = async (key: string, ...fields: string[]) => {
        assertKvLockContext();
        const h = hashes.get(key);
        if (!h) return 0;
        return fields.reduce((n, f) => (f in h ? (delete h[f], n + 1) : n), 0);
    };

    const mod = await import('./_delete-player-account.js');
    detachPlayerReferences = mod.detachPlayerReferences;
    deletePlayerAccount = mod.deletePlayerAccount;
    deletePlayerFirstPactState = mod.deletePlayerFirstPactState;
    ({ withKvLock } = await import('./_lock.js'));
});

beforeEach(() => {
    beforeDelete = undefined;
    store.clear();
    hashes.clear();
    hashes.set('player:registry', { wanderer: { lastSeen: 1 }, kaze: { lastSeen: 2 } });
    store.set('auth:wanderer', { hash: 'scrypt:x', salt: 's', sessionEpoch: 0 });
    store.set('save:wanderer', { character: { name: 'wanderer', clan: 'Storm Petals' } });
    store.set('first-pact:wanderer', { mainStep: 'complete' });
    store.set('first-pact:kaze', { mainStep: 'meet-scribe-vey' });
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
    store.set('mod:ip-v2:wanderer', { lastIp: '86.123.45.67', ips: ['86.123.45.67'] });
    store.set('mod:by-ip-v2:86.123.45.67', ['wanderer', 'realplayer']);
});

describe('player deletion', () => {
    it('detaches only a Google index still owned by the account being removed', async () => {
        const record = store.get('auth:wanderer') as Record<string, unknown>;
        store.set('auth:wanderer', { ...record, google: { sub: 'deletion-subject' } });
        store.set('auth-google:deletion-subject', { name: 'replacement' });
        const result = await deletePlayerAccount('wanderer');
        assert.deepEqual(store.get('auth-google:deletion-subject'), { name: 'replacement' });
        assert.equal(result.removed.includes('auth-google:deletion-subject'), false);
        assert.equal(store.has('lock:auth:wanderer'), false);
        assert.equal(store.has('lock:auth-google:deletion-subject'), false);
    });

    it('releases a matching Google owner index under the subject lock', async () => {
        const record = store.get('auth:wanderer') as Record<string, unknown>;
        store.set('auth:wanderer', { ...record, google: { sub: 'deletion-subject' } });
        store.set('auth-google:deletion-subject', { name: 'wanderer' });
        const result = await deletePlayerAccount('wanderer');
        assert.equal(store.has('auth-google:deletion-subject'), false);
        assert.equal(result.removed.includes('auth-google:deletion-subject'), true);
        assert.equal(store.has('lock:auth-google:deletion-subject'), false);
    });

    it('detaches back-references without touching the account itself', async () => {
        const result = await detachPlayerReferences('wanderer');

        const clan = store.get('save:clan-stormpetals') as { members: { name: string }[]; roleOverrides: Record<string, string> };
        assert.deepEqual(clan.members.map((m) => m.name), ['Kaze'], 'the clan must stop counting a departed member');
        assert.equal(clan.roleOverrides.wanderer, undefined);
        assert.deepEqual(store.get('mod:by-ip:1.2.3.4'), ['realplayer'], 'a dead name must not hold an alt-detection slot');
        assert.deepEqual(store.get('mod:by-ip-v2:86.123.45.67'), ['realplayer'], 'trusted IP indexes need the same cleanup');
        assert.equal(store.has('friends:wanderer'), false);
        assert.equal(store.has('player-friends:wanderer'), false);

        // The half this function must NOT do.
        assert.equal(store.has('auth:wanderer'), true, 'the credential is not this function\'s business');
        assert.equal(store.has('save:wanderer'), true, 'nor is the save');
        assert.equal(store.has('first-pact:wanderer'), true, 'credential-only cleanup must preserve owned story state too');
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
        const result = await deletePlayerAccount('wanderer');

        assert.equal(store.has('auth:wanderer'), false);
        assert.equal(store.has('save:wanderer'), false);
        assert.equal(store.has('first-pact:wanderer'), false, 'a freed name must not inherit the prior First Pact');
        assert.equal(store.has('first-pact:kaze'), true, 'another player\'s First Pact must remain untouched');
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
        assert.ok(result.removed.includes('first-pact:wanderer'));
        assert.ok(result.removed.every((key) => key !== 'first-pact:kaze'));
    });

    it('waits for an already-held First Pact mutation and removes its final write', async () => {
        let releaseMutation!: () => void;
        let mutationEntered!: () => void;
        const entered = new Promise<void>((resolve) => { mutationEntered = resolve; });
        const release = new Promise<void>((resolve) => { releaseMutation = resolve; });

        const mutation = withKvLock('first-pact:wanderer', async () => {
            mutationEntered();
            await release;
            store.set('first-pact:wanderer', { mainStep: 'complete', writtenByMutation: true });
        }, { failClosed: true });
        await entered;

        let cleanupSettled = false;
        const cleanup = deletePlayerFirstPactState('wanderer').finally(() => { cleanupSettled = true; });
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(cleanupSettled, false, 'cleanup must wait while the pact mutation owns its lock');

        releaseMutation();
        await mutation;
        assert.equal(await cleanup, 'first-pact:wanderer');
        assert.equal(store.has('first-pact:wanderer'), false, 'cleanup runs after and removes the mutation\'s final state');
        assert.equal(store.has('first-pact:kaze'), true, 'the serialized cleanup remains scoped to one account');
    });

    it('keeps the save and registry when First Pact cleanup cannot acquire its lock', { timeout: 3_000 }, async () => {
        store.set('lock:first-pact:wanderer', 'another-owner');
        store.set('auth-session:wanderer', 0);
        store.set('auth-recovery:wanderer', { hash: 'existing-code' });
        const before = clone([...store]);

        const result = await deletePlayerAccount('wanderer');

        assert.ok(result.failures.some((failure) => failure.includes('Could not acquire lock')));
        assert.equal(store.has('save:wanderer'), true, 'lock failure must happen before save deletion');
        assert.equal(store.has('first-pact:wanderer'), true, 'the contended story record remains available for retry');
        assert.deepEqual((hashes.get('player:registry') ?? {}).wanderer, { lastSeen: 1 }, 'registry removal must wait too');
        assert.deepEqual([...store], before, 'a busy cleanup authority must precede auth revocation and all reference teardown');
    });

    for (const failedKey of ['first-pact:wanderer', 'save:wanderer']) {
        it(`retains credentials after a fenced ${failedKey} cleanup failure and completes a fresh retry`, async () => {
            const originalAuth = clone(store.get('auth:wanderer'));
            store.set('auth-session:wanderer', 0);
            beforeDelete = (keys) => {
                if (!keys.includes(failedKey)) return;
                beforeDelete = undefined;
                const context = currentKvLockContext();
                assert.ok(context, 'cleanup must be protected');
                throw poisonKvLockContext(context, new Error(`refused ${failedKey} cleanup`));
            };
            const refused = await deletePlayerAccount('wanderer');
            assert.ok(refused.failures.some(failure => failure.includes(`refused ${failedKey}`)));
            assert.deepEqual(store.get('auth:wanderer'), originalAuth, 'auth remains the retry anchor');
            assert.equal(store.get('auth-session:wanderer'), 0, 'pre-revocation cleanup failure must not revoke credentials');
            assert.equal(store.has('save:wanderer'), true);
            // The fixture has no TTL clock. Expire only the lock rows left by the
            // poisoned callback before a separate fresh request retries.
            for (const key of store.keys()) if (key.startsWith('lock:')) store.delete(key);
            const retried = await deletePlayerAccount('wanderer');
            assert.deepEqual(retried.failures, []);
            assert.equal(store.has('auth:wanderer'), false);
            assert.equal(store.has('save:wanderer'), false);
            assert.equal(store.has('first-pact:wanderer'), false);
            assert.equal(store.get('auth-session:wanderer'), 1);
        });
    }

    it('holds auth and First Pact authority through every destructive account operation', async () => {
        const deletes: string[] = [];
        beforeDelete = (keys) => {
            const leases = currentKvLockContext()?.leases.map(lease => lease.key) ?? [];
            assert.ok(leases.includes('lock:auth:wanderer'));
            assert.ok(leases.includes('lock:first-pact:wanderer'));
            deletes.push(...keys);
        };
        const result = await deletePlayerAccount('wanderer');
        assert.deepEqual(result.failures, []);
        assert.equal(deletes[0], 'first-pact:wanderer');
        assert.equal(deletes.at(-1), 'auth:wanderer', 'the credential row is deleted only after other cleanup succeeds');
    });
});
