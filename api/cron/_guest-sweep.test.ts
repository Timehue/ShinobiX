import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertKvLockContext, currentKvLockContext, poisonKvLockContext } from '../_kv-lock-context.js';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'test';
process.env.SESSION_SECRET = 'guest-sweep-test-secret';

const store = new Map<string, unknown>();
const hashes = new Map<string, Record<string, unknown>>();
const clone = <T>(value: T): T => (
    value === undefined || value === null ? value : JSON.parse(JSON.stringify(value)) as T
);

let runGuestSweep: typeof import('./_guest-sweep.js').runGuestSweep;
let GUEST_INACTIVITY_MS: number;
let afterRead: ((key: string) => Promise<void>) | undefined;
let beforeDelete: ((keys: string[]) => void) | undefined;
let beforeRegistryDelete: (() => void) | undefined;

const NOW = 1_800_000_000_000;
const LONG_AGO = NOW - 30 * 24 * 60 * 60 * 1000;
const RECENTLY = NOW - 60_000;

before(async () => {
    const { kv } = await import('../_storage.js');
    kv.get = async <T,>(key: string) => {
        assertKvLockContext();
        const value = clone(store.get(key)) as T | null;
        await afterRead?.(key);
        return value;
    };
    kv.set = async (key: string, value: unknown, options?: { nx?: boolean }) => {
        assertKvLockContext();
        if (options?.nx && store.has(key)) return null;
        store.set(key, clone(value));
        return 'OK' as const;
    };
    kv.del = async (...keys: string[]) => {
        assertKvLockContext();
        beforeDelete?.(keys);
        return keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
    };
    kv.delIfEqual = async (key: string, expected: unknown) => {
        assertKvLockContext();
        if (!store.has(key) || JSON.stringify(store.get(key)) !== JSON.stringify(expected)) return false;
        return store.delete(key);
    };
    kv.incr = async (key: string) => {
        assertKvLockContext();
        const next = (Number(store.get(key)) || 0) + 1;
        store.set(key, next);
        return next;
    };
    kv.keys = async (pattern: string) => {
        const prefix = pattern.replace(/\*$/, '');
        return [...store.keys()].filter((key) => key.startsWith(prefix));
    };
    kv.hgetall = async <T,>(key: string) => (clone(hashes.get(key)) ?? null) as T | null;
    kv.hset = async (key: string, fields: Record<string, unknown>) => {
        hashes.set(key, { ...(hashes.get(key) ?? {}), ...clone(fields) });
        return Object.keys(fields).length;
    };
    kv.hdel = async (key: string, ...fields: string[]) => {
        assertKvLockContext();
        if (key === 'player:registry') beforeRegistryDelete?.();
        const hash = hashes.get(key);
        if (!hash) return 0;
        return fields.reduce((count, field) => {
            if (!(field in hash)) return count;
            delete hash[field];
            return count + 1;
        }, 0);
    };

    runGuestSweep = (await import('./_guest-sweep.js')).runGuestSweep;
    GUEST_INACTIVITY_MS = (await import('../player-auth.js')).GUEST_INACTIVITY_MS;
});

beforeEach(() => {
    afterRead = undefined;
    beforeDelete = undefined;
    beforeRegistryDelete = undefined;
    store.clear();
    hashes.clear();
    process.env.GUEST_SWEEP_ENABLED = '1';
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.GUEST_SWEEP_ENABLED;
});

/** Seed an account plus a save, and optionally a registry activity stamp. */
function seed(slug: string, record: Record<string, unknown>, opts: { lastSeen?: number; save?: unknown } = {}) {
    store.set(`auth:${slug}`, record);
    store.set(`save:${slug}`, opts.save ?? { character: { name: slug } });
    if (opts.lastSeen !== undefined) {
        hashes.set('player:registry', { ...(hashes.get('player:registry') ?? {}), [slug]: { lastSeen: opts.lastSeen } });
    }
}

describe('guest sweep', () => {
    it('keeps a busy First Pact guest fully intact and reports reclamation only after a successful retry', { timeout: 3_000 }, async () => {
        seed('busyguest', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: LONG_AGO });
        store.set('auth-session:busyguest', 0);
        store.set('first-pact:busyguest', { mainStep: 'complete' });
        store.set('friends:busyguest', ['someone']);
        store.set('lock:first-pact:busyguest', 'other-owner');
        const initialAuth = clone(store.get('auth:busyguest'));
        const failed = await runGuestSweep(NOW);
        assert.ok(failed.failures.some(failure => failure.includes('Could not acquire lock')));
        assert.deepEqual(failed.expired, [], 'lock refusal is not confirmed reclamation');
        assert.deepEqual(store.get('auth:busyguest'), initialAuth);
        assert.equal(store.get('auth-session:busyguest'), 0);
        assert.equal(store.has('save:busyguest'), true);
        assert.deepEqual(store.get('friends:busyguest'), ['someone']);
        store.delete('lock:first-pact:busyguest');
        const retried = await runGuestSweep(NOW);
        assert.deepEqual(retried.failures, []);
        assert.deepEqual(retried.expired, ['busyguest']);
        assert.equal(store.has('auth:busyguest'), false);
        assert.equal(store.has('save:busyguest'), false);
    });

    for (const failurePoint of ['pact', 'save', 'registry']) {
        it(`does not report or strand a guest after ${failurePoint} cleanup fails, and a fresh sweep retries`, async () => {
            seed('retryguest', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: LONG_AGO });
            store.set('auth-session:retryguest', 0);
            store.set('first-pact:retryguest', { mainStep: 'complete' });
            const initialAuth = clone(store.get('auth:retryguest'));
            const fail = () => {
                const context = currentKvLockContext();
                assert.ok(context);
                beforeDelete = undefined;
                beforeRegistryDelete = undefined;
                throw poisonKvLockContext(context, new Error(`refused ${failurePoint} deletion`));
            };
            if (failurePoint === 'registry') beforeRegistryDelete = fail;
            else beforeDelete = keys => {
                if (keys.includes(failurePoint === 'pact' ? 'first-pact:retryguest' : 'save:retryguest')) fail();
            };
            const failed = await runGuestSweep(NOW);
            assert.ok(failed.failures.some(failure => failure.includes(`refused ${failurePoint}`)));
            assert.deepEqual(failed.expired, [], 'partial cleanup must not be called reclaimed');
            assert.deepEqual(store.get('auth:retryguest'), initialAuth);
            assert.equal(store.get('auth-session:retryguest'), 0);
            // The fixture has no TTL clock; expire only abandoned lock rows.
            for (const key of store.keys()) if (key.startsWith('lock:')) store.delete(key);
            const retried = await runGuestSweep(NOW);
            assert.deepEqual(retried.failures, []);
            assert.deepEqual(retried.expired, ['retryguest']);
            assert.equal(store.has('auth:retryguest'), false);
            assert.equal(store.has('save:retryguest'), false);
            assert.equal(store.get('auth-session:retryguest'), 1);
        });
    }

    it('retains an aligned auth row after final auth deletion is refused, so the next exact-generation sweep succeeds', async () => {
        seed('lastdelete', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: LONG_AGO });
        store.set('auth-session:lastdelete', 0);
        store.set('first-pact:lastdelete', { mainStep: 'complete' });
        const { issuePlayerToken, verifyPlayerToken } = await import('../_auth.js');
        const oldToken = issuePlayerToken('lastdelete', undefined, 0)!;
        beforeDelete = keys => {
            if (!keys.includes('auth:lastdelete')) return;
            beforeDelete = undefined;
            const context = currentKvLockContext();
            assert.ok(context);
            throw poisonKvLockContext(context, new Error('refused final auth deletion'));
        };
        const failed = await runGuestSweep(NOW);
        assert.deepEqual(failed.expired, []);
        assert.ok(failed.failures.some(failure => failure.includes('refused final auth')));
        assert.equal(store.has('save:lastdelete'), false, 'fallible character cleanup precedes final auth deletion');
        assert.equal(store.get('auth-session:lastdelete'), 1);
        assert.equal((store.get('auth:lastdelete') as { sessionEpoch: number }).sessionEpoch, 1, 'the retry anchor passes the unchanged epoch equality guard');
        assert.equal(await verifyPlayerToken(oldToken), null, 'aligning a retained auth row must not revive an old token');
        for (const key of store.keys()) if (key.startsWith('lock:')) store.delete(key);
        const retried = await runGuestSweep(NOW);
        assert.deepEqual(retried.failures, []);
        assert.deepEqual(retried.expired, ['lastdelete']);
        assert.equal(store.has('auth:lastdelete'), false);
        assert.equal(store.get('auth-session:lastdelete'), 2);
    });

    it('preserves a guest claimed with a password after its idle scan snapshot', async () => {
        seed('lateclaim', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: LONG_AGO });
        store.set('friends:lateclaim', ['someone']);
        const { kv } = await import('../_storage.js');
        const { withKvLock } = await import('../_lock.js');
        afterRead = async (key) => {
            if (key !== 'auth:lateclaim') return;
            afterRead = undefined;
            await withKvLock(key, async () => {
                await kv.incr('auth-session:lateclaim');
                await kv.set(key, { guest: true, createdAt: LONG_AGO, hash: 'scrypt:owned', salt: 'synthetic', sessionEpoch: 1 });
            }, { failClosed: true });
        };
        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, [], 'a stale guest selection cannot authorize deletion');
        assert.equal(store.has('auth:lateclaim'), true);
        assert.equal(store.has('save:lateclaim'), true);
        assert.deepEqual(store.get('friends:lateclaim'), ['someone'], 'no reference cleanup may precede the fresh check');
        assert.equal(store.get('auth-session:lateclaim'), 1);
    });

    it('preserves a Google claim completed after the guest scan', async () => {
        seed('lategoogle', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: LONG_AGO });
        store.set('first-pact:lategoogle', { mainStep: 'complete' });
        afterRead = async (key) => {
            if (key !== 'auth:lategoogle') return;
            afterRead = undefined;
            store.set(key, { createdAt: LONG_AGO, google: { sub: 'late-google-sub', email: '', linkedAt: NOW }, sessionEpoch: 1 });
            store.set('auth-session:lategoogle', 1);
            store.set('auth-google:late-google-sub', { name: 'lategoogle' });
        };
        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, []);
        assert.equal(store.has('auth:lategoogle'), true);
        assert.equal(store.has('save:lategoogle'), true);
        assert.equal(store.has('first-pact:lategoogle'), true);
        assert.deepEqual(store.get('auth-google:late-google-sub'), { name: 'lategoogle' });
    });

    it('does not delete a replacement guest with the same timestamps and a retained new epoch', async () => {
        seed('reused', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0, guestResumeHash: 'a'.repeat(64) }, { lastSeen: LONG_AGO });
        afterRead = async (key) => {
            if (key !== 'auth:reused') return;
            afterRead = undefined;
            store.set(key, { guest: true, createdAt: LONG_AGO, sessionEpoch: 1, guestResumeHash: 'b'.repeat(64) });
            store.set('auth-session:reused', 1);
            store.set('save:reused', { character: { name: 'reused', ryo: 77 } });
        };
        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, [], 'old selection is tied to the original account generation');
        assert.equal(store.has('auth:reused'), true);
        assert.deepEqual(store.get('save:reused'), { character: { name: 'reused', ryo: 77 } });
        assert.equal(store.get('auth-session:reused'), 1);
    });

    it('rechecks current registry activity instead of the bulk-scan snapshot', async () => {
        seed('returned', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: LONG_AGO });
        afterRead = async (key) => {
            if (key !== 'auth:returned') return;
            afterRead = undefined;
            hashes.set('player:registry', { returned: { lastSeen: RECENTLY } });
        };
        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, []);
        assert.equal(store.has('save:returned'), true);
        assert.equal((hashes.get('player:registry') ?? {}).returned !== undefined, true);
    });

    it('preserves a recently saved guest even when its derived activity index is stale', async () => {
        seed('saving', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: LONG_AGO });
        afterRead = async (key) => {
            if (key !== 'auth:saving') return;
            afterRead = undefined;
            store.set('save:saving', { character: { name: 'saving' }, _saveAt: RECENTLY });
        };
        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, []);
        assert.equal(store.has('auth:saving'), true);
        assert.equal(store.has('save:saving'), true);
    });

    it('recognizes a successful bound resume as activity before its first save', async () => {
        seed('resumed', {
            guest: true, createdAt: LONG_AGO, sessionEpoch: 0,
            guestResumeHash: 'a'.repeat(64), guestResumeExpiresAt: RECENTLY + GUEST_INACTIVITY_MS,
        }, { lastSeen: LONG_AGO });
        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, []);
        assert.equal(store.has('auth:resumed'), true);
        assert.equal(store.has('save:resumed'), true);
    });

    it('does not infer activity from malformed bound resume metadata', async () => {
        seed('malformedresume', {
            guest: true, createdAt: LONG_AGO, sessionEpoch: 0,
            guestResumeHash: 'wrong', guestResumeExpiresAt: RECENTLY + GUEST_INACTIVITY_MS,
        }, { lastSeen: LONG_AGO });
        seed('malformedexpiry', {
            guest: true, createdAt: LONG_AGO, sessionEpoch: 0,
            guestResumeHash: 'a'.repeat(64), guestResumeExpiresAt: String(RECENTLY + GUEST_INACTIVITY_MS),
        }, { lastSeen: LONG_AGO });
        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired.sort(), ['malformedexpiry', 'malformedresume']);
    });

    it('keeps save and account leases through every destructive cleanup operation', async () => {
        seed('guarded', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: LONG_AGO });
        store.set('friends:guarded', ['someone']);
        const { kv } = await import('../_storage.js');
        const originalDel = kv.del;
        const protectedDeletes: string[] = [];
        kv.del = async (...keys) => {
            for (const key of keys.filter((value) => ['auth:guarded', 'save:guarded', 'friends:guarded'].includes(value))) {
                const leases = currentKvLockContext()?.leases.map((lease) => lease.key) ?? [];
                assert.ok(leases.includes('lock:save:guarded'), `${key} must exclude concurrent save writes`);
                assert.ok(leases.includes('lock:auth:guarded'), `${key} must exclude claims and name reuse`);
                protectedDeletes.push(key);
            }
            return originalDel(...keys);
        };
        try {
            const result = await runGuestSweep(NOW);
            assert.deepEqual(result.failures, []);
            assert.deepEqual(result.expired, ['guarded']);
            assert.deepEqual(protectedDeletes.sort(), ['auth:guarded', 'friends:guarded', 'save:guarded']);
        } finally { kv.del = originalDel; }
    });

    it('deletes an abandoned guest and everything keyed to it', async () => {
        seed('wanderer', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: LONG_AGO });
        store.set('friends:wanderer', ['someone']);
        store.set('player-friends:wanderer', ['someone']);
        store.set('first-pact:wanderer', { mainStep: 'complete' });
        store.set('first-pact:someone', { mainStep: 'meet-scribe-vey' });

        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, ['wanderer']);
        assert.equal(store.has('auth:wanderer'), false);
        assert.equal(store.has('save:wanderer'), false);
        assert.equal(store.has('friends:wanderer'), false);
        assert.equal(store.has('player-friends:wanderer'), false);
        assert.equal(store.has('first-pact:wanderer'), false, 'the reclaimed name must lose its standalone story state');
        assert.equal(store.has('first-pact:someone'), true, 'sweeping one guest must not touch another account');
        assert.equal((hashes.get('player:registry') ?? {}).wanderer, undefined, 'must not linger on the leaderboard');
        assert.deepEqual(result.failures, []);
    });

    it('rotates the session epoch instead of deleting it, so the freed name cannot be inherited', async () => {
        seed('wanderer', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: LONG_AGO });
        store.set('auth-session:wanderer', 0);

        await runGuestSweep(NOW);

        // Deleting this key would read back as epoch 0, and a token minted for
        // the old guest would then authenticate as whoever registers the name
        // next. The epoch has to survive the account.
        assert.equal(store.has('auth-session:wanderer'), true, 'revocation state must outlive the account');
        assert.equal(Number(store.get('auth-session:wanderer')), 1, 'and must have moved past every issued token');
    });

    it('keeps a guest who is still playing', async () => {
        seed('active', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: RECENTLY });
        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, []);
        assert.equal(store.has('auth:active'), true);
    });

    it('keeps a guest created recently who has not saved yet', async () => {
        seed('fresh', { guest: true, createdAt: RECENTLY, sessionEpoch: 0 });
        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, []);
        assert.equal(store.has('auth:fresh'), true);
    });

    it('leaves a guest with no timestamp at all alone', async () => {
        // Missing data is not evidence of abandonment.
        seed('undated', { guest: true, sessionEpoch: 0 });
        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, []);
        assert.equal(store.has('auth:undated'), true);
    });

    it('never deletes a guest who set a password, however stale', async () => {
        // The `change` action spreads the record when setting a FIRST password,
        // so `guest: true` survives on an account that now has a real, portable
        // credential. Selecting on the flag alone deleted exactly the players
        // who had done the thing we ask them to do.
        seed('committed', { guest: true, hash: 'scrypt:x', salt: 's', createdAt: LONG_AGO }, { lastSeen: LONG_AGO });

        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, [], 'a password-holder is nobody to reclaim');
        assert.equal(store.has('auth:committed'), true);
        assert.equal(result.guests, 0, 'and it is not counted as a guest at all');
    });

    it('still deletes a guest holding half a credential', async () => {
        // Neither half alone can verify a password, so the account still has no
        // way back in — it is abandoned, not committed. Both directions, because
        // `isPasswordlessRecord` treats a missing hash and a missing salt alike
        // and the sweep must agree, or a corrupt row would become permanently
        // unsweepable while still being unenterable.
        seed('halfway', { guest: true, hash: 'scrypt:x', createdAt: LONG_AGO }, { lastSeen: LONG_AGO });
        seed('halfsalt', { guest: true, salt: 'deadbeef', createdAt: LONG_AGO }, { lastSeen: LONG_AGO });

        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired.sort(), ['halfsalt', 'halfway']);
    });

    it('never touches a password or Google account, however stale', async () => {
        seed('veteran', { hash: 'scrypt:x', salt: 's', sessionEpoch: 0 }, { lastSeen: LONG_AGO });
        seed('linked', { google: { sub: 'g-1', email: '', linkedAt: 1 }, createdAt: LONG_AGO }, { lastSeen: LONG_AGO });

        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, []);
        assert.equal(store.has('auth:veteran'), true);
        assert.equal(store.has('auth:linked'), true);
        assert.equal(result.guests, 0, 'neither is a guest');
    });

    it('spares a guest who has since linked Google, right up to the boundary', async () => {
        // A claimed guest has its flag cleared, which is the whole protection.
        seed('claimed', { google: { sub: 'g-2', email: '', linkedAt: NOW }, createdAt: LONG_AGO }, { lastSeen: LONG_AGO });
        // And a guest exactly on the cutoff is still inside the window.
        seed('borderline', { guest: true, createdAt: NOW - GUEST_INACTIVITY_MS }, { lastSeen: NOW - GUEST_INACTIVITY_MS });

        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, []);
    });

    it('takes the recovery code with the account, so a freed name cannot inherit it', async () => {
        seed('wanderer', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: LONG_AGO });
        store.set('auth-recovery:wanderer', { hash: 'x', salt: 'y', issuedAt: LONG_AGO });

        await runGuestSweep(NOW);
        assert.equal(store.has('auth-recovery:wanderer'), false);
    });

    it('reports without deleting until the sweep is switched on', async () => {
        delete process.env.GUEST_SWEEP_ENABLED;
        seed('wanderer', { guest: true, createdAt: LONG_AGO }, { lastSeen: LONG_AGO });

        const result = await runGuestSweep(NOW);
        assert.equal(result.enabled, false);
        assert.deepEqual(result.expired, ['wanderer'], 'a dry run still reports what it would take');
        assert.equal(store.has('auth:wanderer'), true, 'and takes nothing');
    });

    it('ignores the auth-session and auth-google rows that share the prefix', async () => {
        store.set('auth-session:someone', 4);
        store.set('auth-google:g-1', { name: 'someone' });
        seed('wanderer', { guest: true, createdAt: LONG_AGO }, { lastSeen: LONG_AGO });

        const result = await runGuestSweep(NOW);
        assert.equal(result.scanned, 1, 'only real account rows are accounts');
        assert.equal(store.has('auth-google:g-1'), true);
    });

    it('releases the Google identity index when a linked guest is swept', async () => {
        // Only reachable if a link half-completed, but the index row must not
        // outlive the account or that Google account can never sign in again.
        seed('halflinked', { guest: true, createdAt: LONG_AGO, google: { sub: 'g-9', email: '', linkedAt: 1 } }, { lastSeen: LONG_AGO });
        store.set('auth-google:g-9', { name: 'halflinked' });

        await runGuestSweep(NOW);
        assert.equal(store.has('auth-google:g-9'), false);
    });

    it('drops the guest from a clan roster, role table, and join queue', async () => {
        seed('wanderer', { guest: true, createdAt: LONG_AGO }, {
            lastSeen: LONG_AGO,
            save: { character: { name: 'wanderer', clan: 'Storm Petals' } },
        });
        store.set('save:clan-stormpetals', {
            founderName: 'Kaze',
            members: [{ name: 'Kaze' }, { name: 'wanderer' }],
            roleOverrides: { wanderer: 'officer', kaze: 'founder' },
            joinRequests: [{ name: 'wanderer' }],
        });

        await runGuestSweep(NOW);

        const clan = store.get('save:clan-stormpetals') as {
            members: { name: string }[];
            roleOverrides: Record<string, string>;
            joinRequests: { name: string }[];
        };
        assert.deepEqual(clan.members.map((m) => m.name), ['Kaze'], 'a departed member must stop counting toward the clan');
        assert.equal(clan.roleOverrides.wanderer, undefined);
        assert.equal(clan.roleOverrides.kaze, 'founder', 'other members are untouched');
        assert.deepEqual(clan.joinRequests, []);
    });

    it('removes the guest from the moderation reverse indexes', async () => {
        seed('wanderer', { guest: true, createdAt: LONG_AGO }, { lastSeen: LONG_AGO });
        store.set('mod:ip:wanderer', { lastIp: '1.2.3.4', ips: ['1.2.3.4'], lastSeenAt: LONG_AGO });
        store.set('mod:fp:wanderer', { lastFp: 'abc', fps: ['abc'], lastSeenAt: LONG_AGO });
        store.set('mod:by-ip:1.2.3.4', ['wanderer', 'realplayer']);
        store.set('mod:by-fp:abc', ['wanderer']);

        await runGuestSweep(NOW);

        // These lists are capped, so dead names left behind evict live players
        // from alt detection.
        assert.deepEqual(store.get('mod:by-ip:1.2.3.4'), ['realplayer']);
        assert.equal(store.has('mod:by-fp:abc'), false, 'an emptied index row is removed rather than left blank');
        assert.equal(store.has('mod:ip:wanderer'), false);
        assert.equal(store.has('mod:fp:wanderer'), false);
    });

    it('keeps a ban in place, so sweeping is not a way to shed one', async () => {
        seed('wanderer', { guest: true, createdAt: LONG_AGO }, { lastSeen: LONG_AGO });
        store.set('mod:ban:wanderer', { until: NOW + 86_400_000, reason: 'cheating', permanent: false });

        await runGuestSweep(NOW);
        assert.equal(store.has('mod:ban:wanderer'), true);
    });

    it('keeps going after one account fails', async () => {
        seed('brokenone', { guest: true, createdAt: LONG_AGO }, { lastSeen: LONG_AGO });
        seed('wanderer', { guest: true, createdAt: LONG_AGO }, { lastSeen: LONG_AGO });

        const { kv } = await import('../_storage.js');
        const realGet = kv.get;
        kv.get = (async <T,>(key: string) => {
            if (key === 'save:brokenone') throw new Error('simulated storage failure');
            return realGet<T>(key);
        }) as typeof kv.get;
        try {
            const result = await runGuestSweep(NOW);
            assert.ok(result.failures.length > 0, 'the failure is reported, not swallowed');
            assert.equal(store.has('auth:wanderer'), false, 'the healthy account is still swept');
        } finally {
            kv.get = realGet;
        }
    });
});
