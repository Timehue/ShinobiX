import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

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

const NOW = 1_800_000_000_000;
const LONG_AGO = NOW - 30 * 24 * 60 * 60 * 1000;
const RECENTLY = NOW - 60_000;

before(async () => {
    const { kv } = await import('../_storage.js');
    kv.get = async <T,>(key: string) => clone(store.get(key)) as T | null;
    kv.set = async (key: string, value: unknown, options?: { nx?: boolean }) => {
        if (options?.nx && store.has(key)) return null;
        store.set(key, clone(value));
        return 'OK' as const;
    };
    kv.del = async (...keys: string[]) => keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
    kv.incr = async (key: string) => {
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
    it('deletes an abandoned guest and everything keyed to it', async () => {
        seed('wanderer', { guest: true, createdAt: LONG_AGO, sessionEpoch: 0 }, { lastSeen: LONG_AGO });
        store.set('friends:wanderer', ['someone']);

        const result = await runGuestSweep(NOW);
        assert.deepEqual(result.expired, ['wanderer']);
        assert.equal(store.has('auth:wanderer'), false);
        assert.equal(store.has('save:wanderer'), false);
        assert.equal(store.has('friends:wanderer'), false);
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
