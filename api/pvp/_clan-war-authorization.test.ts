import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { before, beforeEach, describe, it } from 'node:test';
import type { ClanWar } from '../clan/war/_storage.js';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'x';

const store = new Map<string, unknown>();
const copy = <T>(value: T): T => value == null ? value : JSON.parse(JSON.stringify(value)) as T;
let api: typeof import('./_clan-war-authorization.js');

before(async () => {
    const { kv } = await import('../_storage.js');
    kv.get = async <T,>(key: string) => copy(store.get(key) ?? null) as T | null;
    kv.set = async (key: string, value: unknown, options?: { nx?: boolean }) => {
        if (options?.nx && store.has(key)) return null;
        store.set(key, copy(value));
        return 'OK' as const;
    };
    kv.compareSet = async (key: string, expected: unknown, value: unknown) => {
        const current = store.has(key) ? store.get(key) : null;
        if (!isDeepStrictEqual(current, expected)) return false;
        store.set(key, copy(value));
        return true;
    };
    kv.del = async (...keys: string[]) => keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
    kv.delIfEqual = async (key: string, expected: string) => {
        if (store.get(key) !== expected) return false;
        store.delete(key);
        return true;
    };
    api = await import('./_clan-war-authorization.js');
});

beforeEach(() => store.clear());

function war(mode: 'pvp1v1' | 'pvp2v2' = 'pvp1v1'): ClanWar {
    return {
        id: 'leaf-vs-sand',
        clans: ['Leaf', 'Sand'],
        villages: { Leaf: 'Leaf', Sand: 'Sand' },
        hp: { Leaf: 1000, Sand: 1000 },
        startedAt: Date.now() - 1000,
        updatedAt: Date.now(),
        declaredBy: 'alice',
        pendingChallenges: [{
            id: 'ch-12345678', mode, fromClan: 'Leaf', fromPlayer: 'alice', createdAt: Date.now(),
            status: 'accepted', expiresAt: Date.now() + 60_000, acceptedPlayer: 'bob',
        }],
        completedChallenges: [],
    };
}

describe('Clan War PvP session authorization', () => {
    it('fails closed when a PvP challenge has no sealed battle session', () => {
        assert.match(api.clanWarPvpReportAuthorityError({ mode: 'pvp1v1' }) ?? '', /cannot be client-reported/i);
        assert.match(api.clanWarPvpReportAuthorityError({ mode: 'pvp1v1', battleId: 'sealed-battle' }) ?? '', /settled.*reward claim/i);
        assert.match(api.clanWarPvpReportAuthorityError({ mode: 'pvp2v2' }) ?? '', /cannot be client-reported/i);
        assert.equal(api.clanWarPvpReportAuthorityError({ mode: 'pet1v1' }), null);
    });

    it('binds an accepted 1v1 to one random session and converges concurrent launches', async () => {
        store.set('clan-war:leaf-vs-sand', war());
        const first = await api.reserveClanWarPvpSession({
            warId: 'leaf-vs-sand', challengeId: 'ch-12345678', creator: 'bob',
            p1: 'alice', p2: 'bob', battleId: 'pvp-random-one',
        });
        assert.equal(first?.owned, true);
        assert.equal((store.get('clan-war:leaf-vs-sand') as ClanWar).pendingChallenges[0]?.battleId, 'pvp-random-one');

        const second = await api.reserveClanWarPvpSession({
            warId: 'leaf-vs-sand', challengeId: 'ch-12345678', creator: 'alice',
            p1: 'alice', p2: 'bob', battleId: 'pvp-random-two',
        });
        assert.equal(second?.owned, false);
        assert.equal(second?.battleId, 'pvp-random-one');

        const retry = await api.reserveClanWarPvpSession({
            warId: 'leaf-vs-sand', challengeId: 'ch-12345678', creator: 'bob',
            p1: 'alice', p2: 'bob', battleId: 'pvp-random-one',
        });
        assert.equal(retry?.owned, true);
        await api.requireClanWarPvpReservation(retry!);
    });

    it('stale takeover fences the old publisher and an old release cannot clear the successor', async () => {
        const stale = war();
        stale.pendingChallenges[0] = {
            ...stale.pendingChallenges[0],
            battleId: 'pvp-old',
            pvpReservedAt: Date.now() - 31_000,
        };
        store.set('clan-war:leaf-vs-sand', stale);
        const old = {
            warId: 'leaf-vs-sand', challengeId: 'ch-12345678', battleId: 'pvp-old',
            p1: 'alice', p2: 'bob', reservedAt: stale.pendingChallenges[0].pvpReservedAt!, owned: true,
        };
        const next = await api.reserveClanWarPvpSession({
            warId: 'leaf-vs-sand', challengeId: 'ch-12345678', creator: 'bob',
            p1: 'alice', p2: 'bob', battleId: 'pvp-next',
        });
        assert.equal(next?.owned, true);
        await assert.rejects(() => api.requireClanWarPvpReservation(old), /reservation-lost/);
        await api.releaseClanWarPvpReservation(old);
        assert.equal((store.get('clan-war:leaf-vs-sand') as ClanWar).pendingChallenges[0]?.battleId, 'pvp-next');
        await api.releaseClanWarPvpReservation(next!);
        assert.equal((store.get('clan-war:leaf-vs-sand') as ClanWar).pendingChallenges[0]?.battleId, undefined);
    });

    it('rejects outsiders, swapped fighters, and unsupported 2v2 aggregation', async () => {
        store.set('clan-war:leaf-vs-sand', war());
        assert.equal(await api.reserveClanWarPvpSession({
            warId: 'leaf-vs-sand', challengeId: 'ch-12345678', creator: 'mallory',
            p1: 'alice', p2: 'bob', battleId: 'pvp-one',
        }), null);
        assert.equal(await api.reserveClanWarPvpSession({
            warId: 'leaf-vs-sand', challengeId: 'ch-12345678', creator: 'bob',
            p1: 'bob', p2: 'alice', battleId: 'pvp-two',
        }), null);
        store.set('clan-war:leaf-vs-sand', war('pvp2v2'));
        assert.equal(await api.reserveClanWarPvpSession({
            warId: 'leaf-vs-sand', challengeId: 'ch-12345678', creator: 'bob',
            p1: 'alice', p2: 'bob', battleId: 'pvp-three',
        }), null);
    });
});
