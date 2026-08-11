import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _makeMemoryKv } from '../_storage.js';
import {
    battleLockKey,
    bindClanBossBattleMarkers,
    claimClanBossBattleMarkers,
    claimTowerBattleLeases,
    clanBossBattleMarkerKey,
    ensureTowerBattleLeases,
    recoverConfirmedMissingTowerBattleLease,
    refreshClanBossBattleMarkers,
    releaseClanBossBattleMarkers,
    releaseClanBossStartMarkers,
    releaseTowerBattleLeases,
    towerBattleLeaseMembers,
    TOWER_BATTLE_LOCK_KIND,
    TOWER_BATTLE_LOCK_SCREEN,
    TOWER_BATTLE_PUBLICATION_GRACE_MS,
} from './_battle-lease.js';
import type { TowerKv, TowerLock } from './_tower-store.js';
import type { TowerActor, TowerSession } from './_tower-session.js';

function keyedLock(): TowerLock {
    const tails = new Map<string, Promise<void>>();
    return async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
        const prior = tails.get(key) ?? Promise.resolve();
        let release: () => void = () => {};
        const hold = new Promise<void>(resolve => { release = resolve; });
        const tail = prior.then(() => hold);
        tails.set(key, tail);
        await prior;
        try { return await fn(); }
        finally {
            release();
            if (tails.get(key) === tail) tails.delete(key);
        }
    };
}

function deps() {
    return {
        kv: _makeMemoryKv() as unknown as TowerKv,
        lock: keyedLock(),
        now: () => 1234,
    };
}

describe('Tower account-wide multi-member battle leases', () => {
    it('claims every member with a compatible reconnect record and replays idempotently', async () => {
        const d = deps();
        const first = await claimTowerBattleLeases({ runId: 'tower-run-1', members: ['bob', 'alice'], partyId: 'party-1' }, d);
        assert.deepEqual(first, { ok: true, members: ['alice', 'bob'], replayed: false });
        for (const member of ['alice', 'bob']) {
            assert.deepEqual(await d.kv.get(battleLockKey(member)), {
                battleId: 'tower-run-1',
                kind: TOWER_BATTLE_LOCK_KIND,
                screen: TOWER_BATTLE_LOCK_SCREEN,
                startedAt: 1234,
                meta: { runId: 'tower-run-1', partyId: 'party-1' },
            });
        }
        assert.deepEqual(await claimTowerBattleLeases({ runId: 'tower-run-1', members: ['alice', 'bob'], partyId: 'party-1' }, d), {
            ok: true,
            members: ['alice', 'bob'],
            replayed: true,
        });
    });

    it('fails all-member claim without stripping a recoverable same-run lease', async () => {
        const d = deps();
        await d.kv.set(battleLockKey('alice'), {
            battleId: 'tower-run-2', kind: TOWER_BATTLE_LOCK_KIND, screen: TOWER_BATTLE_LOCK_SCREEN,
            startedAt: 1, meta: { runId: 'tower-run-2' },
        });
        await d.kv.set(battleLockKey('bob'), { battleId: 'arena-1', kind: 'arena', screen: 'arena', startedAt: 1 });
        const result = await claimTowerBattleLeases({ runId: 'tower-run-2', members: ['alice', 'bob'] }, d);
        assert.deepEqual(result, { ok: false, code: 'member-busy', members: ['bob'] });
        assert.equal((await d.kv.get<{ battleId: string }>(battleLockKey('alice')))?.battleId, 'tower-run-2');
        assert.equal((await d.kv.get<{ battleId: string }>(battleLockKey('bob')))?.battleId, 'arena-1');
    });

    it('repairs a crash-partial claim when no member has a conflicting lock', async () => {
        const d = deps();
        await d.kv.set(battleLockKey('alice'), {
            battleId: 'tower-partial', kind: TOWER_BATTLE_LOCK_KIND, screen: TOWER_BATTLE_LOCK_SCREEN,
            startedAt: 1, meta: { runId: 'tower-partial' },
        });
        const result = await ensureTowerBattleLeases({ runId: 'tower-partial', members: ['alice', 'bob'] }, d);
        assert.deepEqual(result, { ok: true, members: ['alice', 'bob'], replayed: false });
        assert.equal((await d.kv.get<{ battleId: string }>(battleLockKey('alice')))?.battleId, 'tower-partial');
        assert.equal((await d.kv.get<{ battleId: string }>(battleLockKey('bob')))?.battleId, 'tower-partial');
    });

    it('never rolls back a pre-existing same-run lease when a later member write fails', async () => {
        const d = deps();
        const aliceLease = {
            battleId: 'tower-published', kind: TOWER_BATTLE_LOCK_KIND, screen: TOWER_BATTLE_LOCK_SCREEN,
            startedAt: 1, meta: { runId: 'tower-published' },
        };
        await d.kv.set(battleLockKey('alice'), aliceLease);
        const baseSet = d.kv.set.bind(d.kv);
        const failingKv: TowerKv = {
            ...d.kv,
            set: async (key, value, options) => {
                if (key === battleLockKey('bob')) {
                    await baseSet(key, value, options);
                    throw new Error('forwarding failed');
                }
                return baseSet(key, value, options);
            },
        };
        await assert.rejects(() => claimTowerBattleLeases({
            runId: 'tower-published', members: ['alice', 'bob'],
        }, { ...d, kv: failingKv }), /forwarding failed/);
        assert.deepEqual(await d.kv.get(battleLockKey('alice')), {
            ...aliceLease,
            startedAt: 1,
        });
        assert.equal(await d.kv.get(battleLockKey('bob')), null);
    });

    it('releases a confirmed-missing crash claim only after publication grace', async () => {
        let now = 10_000;
        const d = { ...deps(), now: () => now };
        await claimTowerBattleLeases({ runId: 'tower-crash', members: ['alice'] }, d);
        now += TOWER_BATTLE_PUBLICATION_GRACE_MS - 1;
        assert.deepEqual(await recoverConfirmedMissingTowerBattleLease('tower-crash', 'alice', d), {
            released: false,
            pending: true,
        });
        assert.notEqual(await d.kv.get(battleLockKey('alice')), null);
        now += 2;
        assert.deepEqual(await recoverConfirmedMissingTowerBattleLease('tower-crash', 'alice', d), {
            released: true,
            pending: false,
        });
        assert.equal(await d.kv.get(battleLockKey('alice')), null);
    });

    it('fails closed when confirmed-missing recovery cannot read storage', async () => {
        const d = deps();
        const originalGet = d.kv.get.bind(d.kv);
        await claimTowerBattleLeases({ runId: 'tower-read-error', members: ['alice'] }, d);
        const failingKv: TowerKv = {
            ...d.kv,
            get: async <T>(key: string) => {
                if (key === battleLockKey('alice')) throw new Error('transient read failure');
                return originalGet<T>(key);
            },
        };
        await assert.rejects(() => recoverConfirmedMissingTowerBattleLease('tower-read-error', 'alice', {
            ...d,
            kv: failingKv,
            now: () => 10_000 + TOWER_BATTLE_PUBLICATION_GRACE_MS,
        }));
        assert.equal((await originalGet<{ battleId: string }>(battleLockKey('alice')))?.battleId, 'tower-read-error');
    });

    it('release compare-checks run ownership and never clears a newer battle', async () => {
        const d = deps();
        await claimTowerBattleLeases({ runId: 'tower-old', members: ['alice', 'bob'] }, d);
        await d.kv.set(battleLockKey('bob'), { battleId: 'arena-new', kind: 'arena', screen: 'arena', startedAt: 2 });
        await releaseTowerBattleLeases('tower-old', ['alice', 'bob'], d);
        assert.equal(await d.kv.get(battleLockKey('alice')), null);
        assert.equal((await d.kv.get<{ battleId: string }>(battleLockKey('bob')))?.battleId, 'arena-new');
    });

    it('derives leases only for unique live human owners, never legacy AI assists', () => {
        const actor = (ownerSlug: string, ai: boolean, id: string): TowerActor => ({
            id, side: 'squad', ownerSlug, ai, name: id, hp: 1, maxHp: 1,
            chakra: 0, maxChakra: 0, stamina: 0, maxStamina: 0, shield: 0,
            statuses: [], cooldowns: {}, pos: 0, character: {},
        });
        const session = { actors: [
            actor('host', false, 'a'),
            actor('host', false, 'companion-copy'),
            actor('assist', true, 'b'),
        ] } as TowerSession;
        assert.deepEqual(towerBattleLeaseMembers(session), ['host']);
    });

    it('serializes concurrent Clan Boss and Tower claims so exactly one mode wins', async () => {
        const d = deps();
        const [clan, tower] = await Promise.all([
            claimClanBossBattleMarkers({ requestId: 'clan-request-0001', runId: 'cboss-concurrent', members: ['alice', 'bob'] }, d),
            claimTowerBattleLeases({ runId: 'tower-concurrent', members: ['alice', 'bob'] }, d),
        ]);
        assert.equal(Number(clan.ok) + Number(tower.ok), 1);
        for (const member of ['alice', 'bob']) {
            const hasTower = await d.kv.get(battleLockKey(member)) !== null;
            const hasClan = await d.kv.get(clanBossBattleMarkerKey(member)) !== null;
            assert.notEqual(hasTower, hasClan, `${member} belongs to one authoritative mode`);
        }
    });

    it('blocks both sequential start directions and refreshes only without a conflicting Tower lease', async () => {
        const towerFirst = deps();
        assert.equal((await claimTowerBattleLeases({ runId: 'tower-first', members: ['alice'] }, towerFirst)).ok, true);
        assert.deepEqual(await claimClanBossBattleMarkers({
            requestId: 'clan-request-0002', runId: 'cboss-second', members: ['alice'],
        }, towerFirst), { ok: false, code: 'member-busy', members: ['alice'] });

        const clanFirst = deps();
        assert.equal((await claimClanBossBattleMarkers({
            requestId: 'clan-request-0003', runId: 'cboss-first', members: ['alice'],
        }, clanFirst)).ok, true);
        assert.deepEqual(await claimTowerBattleLeases({ runId: 'tower-second', members: ['alice'] }, clanFirst), {
            ok: false, code: 'member-busy', members: ['alice'],
        });

        await clanFirst.kv.del(clanBossBattleMarkerKey('alice'));
        await refreshClanBossBattleMarkers('cboss-first', ['alice'], clanFirst);
        assert.equal((await clanFirst.kv.get<{ runId: string }>(clanBossBattleMarkerKey('alice')))?.runId, 'cboss-first');
        await clanFirst.kv.set(battleLockKey('alice'), { battleId: 'tower-new', kind: 'battleTowers' });
        await assert.rejects(() => refreshClanBossBattleMarkers('cboss-first', ['alice'], clanFirst), /another battle/);
    });

    it('releases only the exact settled Clan Boss run marker', async () => {
        const d = deps();
        await claimClanBossBattleMarkers({ requestId: 'clan-request-0004', runId: 'cboss-old', members: ['alice'] }, d);
        await bindClanBossBattleMarkers({ requestId: 'clan-request-0004', runId: 'cboss-old', members: ['alice'] }, d);
        await d.kv.set(clanBossBattleMarkerKey('alice'), {
            kind: 'clanBoss', requestId: 'clan-request-0005', runId: 'cboss-new', startedAt: 2,
        });
        await releaseClanBossBattleMarkers('cboss-old', ['alice'], d);
        assert.equal((await d.kv.get<{ runId: string }>(clanBossBattleMarkerKey('alice')))?.runId, 'cboss-new');
    });

    it('cannot release a replayed active marker using the retry\'s discarded proposal', async () => {
        const d = deps();
        await claimClanBossBattleMarkers({ requestId: 'clan-request-0006', runId: 'cboss-old', members: ['alice'] }, d);
        await bindClanBossBattleMarkers({ requestId: 'clan-request-0006', runId: 'cboss-old', members: ['alice'] }, d);
        await releaseClanBossStartMarkers('clan-request-0006', 'cboss-new-proposal', ['alice'], d);
        assert.equal((await d.kv.get<{ runId: string }>(clanBossBattleMarkerKey('alice')))?.runId, 'cboss-old');
    });
});
