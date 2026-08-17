import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { describe, it } from 'node:test';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import { PVP_TERMINAL_REPLAY_TTL } from '../combat-core/constants.js';
import { makePlayerRankedAdmission, type PlayerRankedAdmission } from '../pet/_ranked-preparation.js';
import {
    boundExactPvpSession,
    commitPvpSessionMutation,
    fencePlayerRankedSessionForClose,
} from './_session-mutation.js';
import type { PvpSession } from './session.js';

const MATCH = 'player-ranked-12345678-1234-4123-8123-1234567890ab';
const BATTLE = 'pvp-12345678-1234-4123-8123-1234567890ab';
const NOW = 1_800_000_000_000;

function v2Ranked(patch: Partial<PvpSession> = {}): Partial<PvpSession> {
    return {
        ranked: false,
        rankedKind: 'player',
        playerRankedAuthorityVersion: 2,
        rankedMatchId: MATCH,
        rankedSeasonId: 1,
        rankedSeasonEpoch: 1,
        rewardAuthority: 'ranked',
        baseRewards: false,
        ...patch,
    };
}

function session(patch: Partial<PvpSession> = {}): PvpSession {
    return {
        battleId: BATTLE,
        p1: { name: 'Alice' },
        p2: { name: 'Bob' },
        round: 1,
        activePlayer: 'p1',
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: [],
        status: 'active',
        winner: null,
        createdAt: NOW,
        ...patch,
    } as PvpSession;
}

describe('exact PvP session mutation authority', () => {
    for (const acknowledgement of [false, null] as const) {
        it(`recovers a fulfilled-${String(acknowledgement)} commit and keeps a ranked terminal durable`, async () => {
            const expected = session(v2Ranked({ stateRevision: 6 }));
            const desired = session(v2Ranked({ status: 'done', winner: 'p1', stateRevision: 400 }));
            let row: PvpSession | null = expected;
            const options: Array<{ ex?: number } | undefined> = [];
            const store = {
                async get<T>() { return structuredClone(row) as T | null; },
                async compareSet(_key: string, before: unknown, next: unknown, option?: { ex?: number }) {
                    options.push(option);
                    if (!isDeepStrictEqual(row, before)) return false;
                    row = structuredClone(next) as PvpSession;
                    return acknowledgement as never;
                },
            } satisfies Pick<KvLike, 'get' | 'compareSet'>;

            const result = await commitPvpSessionMutation(store, 'pvp:test', expected, desired, {
                moveToken: 'move-1',
                ttlSeconds: 17,
            });

            assert.equal(result.status, 'committed');
            assert.deepEqual(row?.recentMoveTokens, ['move-1']);
            assert.equal(row?.stateRevision, 7,
                'the exact expected row, never a caller-prepared desired revision, owns the successor');
            assert.deepEqual(options, [undefined], 'terminal CAS must not carry the ordinary 15m TTL');
        });
    }

    it('recovers a thrown postcommit acknowledgement and proves the ordinary TTL', async () => {
        const expected = session();
        const desired = session({ round: 2, activePlayer: 'p2' });
        let row: PvpSession | null = expected;
        let calls = 0;
        const options: Array<{ ex?: number } | undefined> = [];
        const store = {
            async get<T>() { return structuredClone(row) as T | null; },
            async compareSet(_key: string, before: unknown, next: unknown, option?: { ex?: number }) {
                calls += 1;
                options.push(option);
                if (!isDeepStrictEqual(row, before)) return false;
                row = structuredClone(next) as PvpSession;
                if (calls === 1) throw new Error('lost-session-ack');
                return true;
            },
        } satisfies Pick<KvLike, 'get' | 'compareSet'>;

        const result = await commitPvpSessionMutation(store, 'pvp:test', expected, desired, { ttlSeconds: 77 });

        assert.equal(result.status, 'committed');
        assert.equal(calls, 2);
        assert.deepEqual(options, [{ ex: 77 }, { ex: 77 }]);
    });

    it('recovers a JSON-canonical false acknowledgement when undefined fields disappear', async () => {
        const expected = JSON.parse(JSON.stringify(session({ stateRevision: 3 }))) as PvpSession;
        const desired = { ...expected, round: 2, recentMoveTokens: undefined };
        let row: PvpSession | null = expected;
        let calls = 0;
        const store = {
            async get<T>() {
                return row === null ? null : JSON.parse(JSON.stringify(row)) as T;
            },
            async compareSet(_key: string, before: unknown, next: unknown) {
                calls += 1;
                if (!isDeepStrictEqual(row, before)) return false;
                // Remote JSON storage drops object properties whose value is
                // undefined, then loses the successful boolean acknowledgement.
                row = JSON.parse(JSON.stringify(next)) as PvpSession;
                return calls === 1 ? false : true;
            },
        } satisfies Pick<KvLike, 'get' | 'compareSet'>;

        const result = await commitPvpSessionMutation(store, 'pvp:json', expected, desired);

        assert.equal(result.status, 'committed');
        assert.equal(result.session.stateRevision, 4);
        assert.equal(Object.prototype.hasOwnProperty.call(result.session, 'recentMoveTokens'), false);
        assert.deepEqual(result.session, row);
    });

    it('rejects an expired-lease stale writer after its successor commits', async () => {
        const beforeLeaseExpiry = session({ stateRevision: 10 });
        const staleA = session({ stateRevision: 900, round: 2, activePlayer: 'p2', log: ['A'] });
        const successorB = session({ stateRevision: 11, round: 3, activePlayer: 'p1', log: ['B'] });
        let row: PvpSession | null = beforeLeaseExpiry;
        let raced = false;
        const store = {
            async get<T>() { return structuredClone(row) as T | null; },
            async compareSet(_key: string, before: unknown, next: unknown) {
                if (!raced) {
                    raced = true;
                    assert.ok(isDeepStrictEqual(row, beforeLeaseExpiry));
                    row = structuredClone(successorB);
                }
                if (!isDeepStrictEqual(row, before)) return false;
                row = structuredClone(next) as PvpSession;
                return true;
            },
        } satisfies Pick<KvLike, 'get' | 'compareSet'>;

        const result = await commitPvpSessionMutation(store, 'pvp:test', beforeLeaseExpiry, staleA);

        assert.equal(result.status, 'conflict');
        assert.deepEqual(result.session, successorB);
        assert.deepEqual(row, successorB, 'the stale A writer must not overwrite successor B');
        assert.equal(row?.stateRevision, 11, 'the losing candidate cannot publish its caller-supplied revision');
    });

    it('requires an acknowledged exact CAS before compacting a durable terminal', async () => {
        const terminal = session(v2Ranked({ status: 'done', winner: 'p1' }));
        let row: PvpSession | null = terminal;
        let calls = 0;
        const options: Array<{ ex?: number } | undefined> = [];
        const store = {
            async get<T>() { return structuredClone(row) as T | null; },
            async compareSet(_key: string, before: unknown, next: unknown, option?: { ex?: number }) {
                calls += 1;
                options.push(option);
                if (!isDeepStrictEqual(row, before)) return false;
                row = structuredClone(next) as PvpSession;
                if (calls === 1) throw new Error('lost-compaction-ack');
                return true;
            },
        } satisfies Pick<KvLike, 'get' | 'compareSet'>;

        await boundExactPvpSession(store, 'pvp:test', terminal, 123);

        assert.equal(calls, 2, 'exact readback alone cannot prove that TTL metadata committed');
        assert.deepEqual(options, [{ ex: 123 }, { ex: 123 }]);
    });

    it('keeps a legacy d76a player-ranked terminal on the ordinary bounded TTL', async () => {
        const expected = session({ ranked: true, rankedKind: 'player' });
        const desired = session({ ranked: true, rankedKind: 'player', status: 'done', winner: 'p1' });
        let row: PvpSession | null = expected;
        const options: Array<{ ex?: number } | undefined> = [];
        const store = {
            async get<T>() { return structuredClone(row) as T | null; },
            async compareSet(_key: string, before: unknown, next: unknown, option?: { ex?: number }) {
                options.push(option);
                if (!isDeepStrictEqual(row, before)) return false;
                row = structuredClone(next) as PvpSession;
                return true;
            },
        } satisfies Pick<KvLike, 'get' | 'compareSet'>;

        assert.equal((await commitPvpSessionMutation(store, 'pvp:legacy', expected, desired, { ttlSeconds: 41 })).status, 'committed');
        // Still bounded rather than durable — that is what separates a legacy
        // d76a terminal from a V2 one, which commits with no `ex` at all. The
        // bound is now floored at the terminal replay horizon instead of taking
        // the caller's value: this row is what claim and recovery read back, so
        // honouring a 41-second TTL would drop a disconnected player's reward
        // long before they could claim it.
        assert.deepEqual(options, [{ ex: PVP_TERMINAL_REPLAY_TTL }]);
        assert.ok(PVP_TERMINAL_REPLAY_TTL >= 41, 'the floor must never shorten a caller TTL');
    });

    function activeAdmission(): PlayerRankedAdmission {
        return {
            ...makePlayerRankedAdmission({
                matchId: MATCH,
                a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
                createdAt: NOW, seasonId: 1, seasonEpoch: 1,
            }),
            phase: 'active',
            battleId: BATTLE,
            activatedAt: NOW + 1,
        };
    }

    it('terminal-CAS-before-close-fence wins the exact session boundary', async () => {
        const base = _makeMemoryKv();
        const active = session(v2Ranked());
        const terminal = session(v2Ranked({ status: 'done', winner: 'p1' }));
        await base.set(`pvp:${BATTLE}`, active, { ex: 900 });
        let raced = false;
        const store = {
            ...base,
            async compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) {
                const candidate = value as PvpSession;
                if (key === `pvp:${BATTLE}` && candidate.rankedCloseFence && !raced) {
                    raced = true;
                    assert.equal(await base.compareSet(key, expected, terminal), true);
                    return false;
                }
                return base.compareSet(key, expected, value, options);
            },
        } satisfies KvLike;

        const result = await fencePlayerRankedSessionForClose(
            store,
            activeAdmission(),
            'ranked-season-1-2',
            NOW + 2,
        );

        assert.equal(result.status, 'terminal');
        assert.deepEqual(await base.get(`pvp:${BATTLE}`), terminal);
    });

    it('close-fence-before-terminal makes the paused move CAS lose without overwriting', async () => {
        const store = _makeMemoryKv();
        const active = session(v2Ranked());
        const terminal = session(v2Ranked({ status: 'done', winner: 'p1' }));
        await store.set(`pvp:${BATTLE}`, active, { ex: 900 });

        assert.equal((await fencePlayerRankedSessionForClose(
            store,
            activeAdmission(),
            'ranked-season-1-2',
            NOW + 2,
        )).status, 'fenced');
        const stale = await commitPvpSessionMutation(store, `pvp:${BATTLE}`, active, terminal);

        assert.equal(stale.status, 'conflict');
        assert.equal((await store.get<PvpSession>(`pvp:${BATTLE}`))?.status, 'active');
        assert.equal((await store.get<PvpSession>(`pvp:${BATTLE}`))?.rankedCloseFence?.transitionId, 'ranked-season-1-2');
    });

    it('tombstones a missing prepublication session so a paused creator cannot publish', async () => {
        const store = _makeMemoryKv();
        const active = session(v2Ranked());
        const result = await fencePlayerRankedSessionForClose(
            store,
            activeAdmission(),
            'ranked-season-1-2',
            NOW + 2,
        );
        assert.equal(result.status, 'fenced');
        assert.equal(await store.set(`pvp:${BATTLE}`, active, { nx: true, ex: 900 }), null);
    });
});
