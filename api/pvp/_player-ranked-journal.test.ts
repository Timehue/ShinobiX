import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import { inspectSettlementReceipt } from '../_settlement-receipts.js';
import { mintPlayerRankedMatchTokenWithStore } from '../_ranked-match-token.js';
import {
    activatePlayerRankedAdmission,
    cancelNonterminalPlayerRankedAdmissions,
    closePetRankedSeasonGate,
    ensurePetRankedSeasonGate,
    getPlayerRankedAdmission,
} from '../pet/_ranked-preparation.js';
import type { PvpSession } from './session.js';
import { embedPvpSettlementReceipt, pvpSettlementId } from './_reward-settlement.js';
import { fencePlayerRankedSessionForClose } from './_session-mutation.js';
import {
    PLAYER_RANKED_SETTLEMENT_STAMP_LIMIT,
    PLAYER_RANKED_SETTLEMENT_STAMP_FIELD,
    getPlayerRankedJournal,
    publishPlayerRankedTerminal,
    settlePlayerRankedJournal,
} from './_player-ranked-journal.js';

const NOW = 1_800_000_000_000;
const MATCH = 'player-ranked-12345678-1234-4123-8123-1234567890ab';
const BATTLE = 'pvp-12345678-1234-4123-8123-1234567890ab';

function clone<T>(value: T): T {
    return structuredClone(value);
}

async function setup() {
    const store = _makeMemoryKv();
    await store.set('ranked:season:current', { id: 1, startedAt: NOW, endsAt: NOW + 10_000 });
    await ensurePetRankedSeasonGate(store, 1, NOW);
    await Promise.all([
        store.set('save:alice', { _saveVersion: 1, character: { name: 'Alice', rankedRating: 1000, rankedWins: 0, serverSettlementReceipts: [] } }),
        store.set('save:bob', { _saveVersion: 1, character: { name: 'Bob', rankedRating: 1000, rankedLosses: 0, serverSettlementReceipts: [] } }),
    ]);
    const token = await mintPlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'bob', aLevel: 25, bLevel: 25, aRating: 1000, bRating: 1000,
        now: NOW + 1, matchId: MATCH,
    });
    await activatePlayerRankedAdmission(store, token.matchId, BATTLE, NOW + 2);
    const session = {
        battleId: BATTLE,
        p1: { name: 'Alice' },
        p2: { name: 'Bob' },
        status: 'done',
        winner: 'p1',
        ranked: false,
        rankedKind: 'player',
        playerRankedAuthorityVersion: 2,
        rankedMatchId: MATCH,
        rankedSeasonId: 1,
        rankedSeasonEpoch: 1,
        p1Rating: 1000,
        p2Rating: 1000,
        joined: { p1: true, p2: true },
        rewardAuthority: 'ranked',
        baseRewards: false,
        realFighters: { p1: true, p2: true },
        itemCharges: { p1: {}, p2: {} },
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt: NOW,
    } as unknown as PvpSession;
    await store.set(`pvp:${BATTLE}`, session, { ex: 900 });
    return { store, session };
}

function char(record: unknown): Record<string, any> {
    return ((record as { character?: unknown })?.character ?? {}) as Record<string, any>;
}

describe('player ranked terminal journal', () => {
    it('seals one immutable terminal and ignores shared-receipt churn on replay', async () => {
        const { store, session } = await setup();
        const journal = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        const first = await settlePlayerRankedJournal(store, journal, NOW + 4);
        assert.equal(first.journal.state, 'completed');
        const aliceOnce = char(await store.get('save:alice'));
        const bobOnce = char(await store.get('save:bob'));
        assert.equal(aliceOnce.rankedRating, 1012);
        assert.equal(aliceOnce.rankedWins, 1);
        assert.equal(bobOnce.rankedRating, 988);
        assert.equal(bobOnce.rankedLosses, 1);
        assert.ok(aliceOnce[PLAYER_RANKED_SETTLEMENT_STAMP_FIELD][MATCH]);

        // The old 50-entry generic receipt ring can churn arbitrarily; a
        // completed journal remains replay truth even after bounded save data.
        const aliceRecord = await store.get<Record<string, unknown>>('save:alice');
        const bobRecord = await store.get<Record<string, unknown>>('save:bob');
        await store.set('save:alice', {
            ...aliceRecord,
            character: { ...aliceOnce, serverSettlementReceipts: Array.from({ length: 80 }, (_, i) => ({ id: `other-${i}` })) },
        });
        await store.set('save:bob', {
            ...bobRecord,
            character: { ...bobOnce, serverSettlementReceipts: Array.from({ length: 80 }, (_, i) => ({ id: `other-${i}` })) },
        });
        const replay = await settlePlayerRankedJournal(store, MATCH, NOW + 5);
        assert.deepEqual(replay.ratings, { a: 1012, b: 988 });
        assert.equal(char(await store.get('save:alice')).rankedWins, 1);
        assert.equal(char(await store.get('save:bob')).rankedLosses, 1);
        assert.equal(session.ranked === true, false, 'd76a ranked payout branch stays inert after ring churn');
        assert.equal(session.baseRewards === true, false, 'd76a base payout branch stays inert after ring churn');
    });

    it('recovers winner/loser save commit acknowledgements without double Elo', async () => {
        const { store: base, session } = await setup();
        const journal = await publishPlayerRankedTerminal(base, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        const lost = new Set<string>();
        const store = {
            ...base,
            async compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) {
                const committed = await base.compareSet(key, expected, value, options);
                if (committed && (key === 'save:alice' || key === 'save:bob') && !lost.has(key)) {
                    lost.add(key);
                    throw new Error(`lost-${key}-ack`);
                }
                return committed;
            },
        };
        const settled = await settlePlayerRankedJournal(store, journal, NOW + 4);
        assert.equal(settled.journal.state, 'completed');
        assert.deepEqual([...lost].sort(), ['save:alice', 'save:bob']);
        assert.equal(char(await base.get('save:alice')).rankedRating, 1012);
        assert.equal(char(await base.get('save:bob')).rankedRating, 988);
    });

    it('recognizes an old-worker-first legacy payout and only backfills the v2 fence', async () => {
        const { store, session } = await setup();
        const journal = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        const settlementId = pvpSettlementId('rating', BATTLE);
        const aliceRecord = await store.get<Record<string, unknown>>('save:alice');
        const bobRecord = await store.get<Record<string, unknown>>('save:bob');
        assert.ok(aliceRecord && bobRecord);
        await store.set('save:alice', {
            ...aliceRecord,
            _saveVersion: 2,
            character: embedPvpSettlementReceipt(
                { ...char(aliceRecord), rankedRating: 1012, rankedWins: 1 },
                [], settlementId, 'rating-winner', NOW + 3,
            ),
        });
        await store.set('save:bob', {
            ...bobRecord,
            _saveVersion: 2,
            character: embedPvpSettlementReceipt(
                { ...char(bobRecord), rankedRating: 988, rankedLosses: 1 },
                [], settlementId, 'rating-loser', NOW + 3,
            ),
        });

        await settlePlayerRankedJournal(store, journal, NOW + 4);

        const alice = char(await store.get('save:alice'));
        const bob = char(await store.get('save:bob'));
        assert.equal(alice.rankedRating, 1012);
        assert.equal(alice.rankedWins, 1);
        assert.equal(bob.rankedRating, 988);
        assert.equal(bob.rankedLosses, 1);
        assert.equal(alice[PLAYER_RANKED_SETTLEMENT_STAMP_FIELD][MATCH].ratingAfter, 1012);
        assert.equal(bob[PLAYER_RANKED_SETTLEMENT_STAMP_FIELD][MATCH].ratingAfter, 988);
    });

    it('new-worker-first writes the legacy receipt in the same Elo CAS and fences a d76a replay', async () => {
        const { store, session } = await setup();
        const journal = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        await settlePlayerRankedJournal(store, journal, NOW + 4);

        const settlementId = pvpSettlementId('rating', BATTLE);
        const alice = char(await store.get('save:alice'));
        const bob = char(await store.get('save:bob'));
        assert.equal(inspectSettlementReceipt(alice, settlementId, 'rating-winner').status, 'replay');
        assert.equal(inspectSettlementReceipt(bob, settlementId, 'rating-loser').status, 'replay');

        // This is the old worker's economic branch: a replay receipt means it
        // must not apply its otherwise-identical +12/-12 mutations.
        assert.equal(alice.rankedRating, 1012);
        assert.equal(alice.rankedWins, 1);
        assert.equal(bob.rankedRating, 988);
        assert.equal(bob.rankedLosses, 1);
    });

    it('bounds dedicated settlement stamps while completed journals remain replay authority', async () => {
        const { store, session } = await setup();
        const oldStamps = Object.fromEntries(Array.from({ length: PLAYER_RANKED_SETTLEMENT_STAMP_LIMIT }, (_, index) => [
            `player-ranked-${index.toString(16).padStart(8, '0')}-1234-4123-8123-1234567890ab`,
            {
                fingerprint: 'a'.repeat(64),
                seasonId: 1,
                role: 'winner',
                settledAt: NOW - index - 1,
                ratingAfter: 1000,
            },
        ]));
        for (const slug of ['alice', 'bob']) {
            const record = await store.get<Record<string, unknown>>(`save:${slug}`);
            await store.set(`save:${slug}`, {
                ...record,
                character: { ...char(record), [PLAYER_RANKED_SETTLEMENT_STAMP_FIELD]: oldStamps },
            });
        }
        const journal = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        await settlePlayerRankedJournal(store, journal, NOW + 4);

        for (const slug of ['alice', 'bob']) {
            const stamps = char(await store.get(`save:${slug}`))[PLAYER_RANKED_SETTLEMENT_STAMP_FIELD];
            assert.equal(Object.keys(stamps).length, PLAYER_RANKED_SETTLEMENT_STAMP_LIMIT);
            assert.ok(stamps[MATCH]);
        }
        const replay = await settlePlayerRankedJournal(store, MATCH, NOW + 5);
        assert.equal(replay.journal.state, 'completed');
        assert.equal(char(await store.get('save:alice')).rankedWins, 1);
        assert.equal(char(await store.get('save:bob')).rankedLosses, 1);
    });

    it('recovers a terminal gate commit whose acknowledgement was lost', async () => {
        const { store: base, session } = await setup();
        let lost = false;
        const store = {
            ...base,
            async compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) {
                const committed = await base.compareSet(key, expected, value, options);
                if (committed && key === 'ranked:season:authority' && !lost) {
                    lost = true;
                    throw new Error('lost-terminal-gate-ack');
                }
                return committed;
            },
        };
        const journal = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        assert.equal(lost, true);
        assert.equal(journal.terminal.winner, 'a');
        assert.equal((await getPlayerRankedAdmission(base, MATCH))?.phase, 'terminal');
    });

    it('repairs a crash after gate terminalization but before journal publication without recomputing eligibility', async () => {
        const { store: base, session } = await setup();
        let failed = false;
        let eligibilityChecks = 0;
        const store = {
            ...base,
            async set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }) {
                if (key === `player:ranked-journal:${MATCH}` && !failed) {
                    failed = true;
                    throw new Error('journal-precommit');
                }
                return base.set(key, value, options);
            },
        };
        await assert.rejects(() => publishPlayerRankedTerminal(store, session, {
            now: NOW + 3,
            eligible: async () => { eligibilityChecks += 1; return true; },
        }), /journal-precommit/);
        assert.equal((await getPlayerRankedAdmission(base, MATCH))?.phase, 'terminal');
        assert.equal(await getPlayerRankedJournal(base, MATCH), null);

        const repaired = await publishPlayerRankedTerminal(base, session, {
            now: NOW + 4,
            eligible: async () => { throw new Error('must-not-recompute'); },
        });
        assert.equal(eligibilityChecks, 1);
        assert.equal(repaired.terminal.rankedEligible, true);
    });

    it('recognizes a journal publication commit whose acknowledgement was lost', async () => {
        const { store: base, session } = await setup();
        let lost = false;
        const store = {
            ...base,
            async set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }) {
                const result = await base.set(key, value, options);
                if (key === `player:ranked-journal:${MATCH}` && !lost) {
                    lost = true;
                    throw new Error('lost-journal-ack');
                }
                return result;
            },
        };
        const journal = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        assert.equal(lost, true);
        assert.equal(journal.terminal.matchId, MATCH);
        assert.equal((await getPlayerRankedJournal(base, MATCH))?.terminal.fingerprint, journal.terminal.fingerprint);
    });

    it('leaves a discoverable partial journal on loser precommit failure and either helper finishes it', async () => {
        const { store: base, session } = await setup();
        const journal = await publishPlayerRankedTerminal(base, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        let failed = false;
        const store = {
            ...base,
            async compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) {
                if (key === 'save:bob' && !failed) {
                    failed = true;
                    throw new Error('loser-precommit');
                }
                return base.compareSet(key, expected, value, options);
            },
        };
        await assert.rejects(() => settlePlayerRankedJournal(store, journal, NOW + 4), /loser-precommit/);
        const partial = await getPlayerRankedJournal(base, MATCH);
        assert.deepEqual(partial?.confirmations, { a: true, b: false });
        assert.equal(char(await base.get('save:alice')).rankedRating, 1012);
        assert.equal(char(await base.get('save:bob')).rankedRating, 1000);

        const recovered = await settlePlayerRankedJournal(base, MATCH, NOW + 5);
        assert.equal(recovered.journal.state, 'completed');
        assert.equal(char(await base.get('save:alice')).rankedWins, 1);
        assert.equal(char(await base.get('save:bob')).rankedLosses, 1);
    });

    it('exact save CAS defeats a paused stale writer and preserves the successor mutation', async () => {
        const { store: base, session } = await setup();
        const journal = await publishPlayerRankedTerminal(base, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        let raced = false;
        const store = {
            ...base,
            async compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) {
                if (key === 'save:alice' && !raced) {
                    raced = true;
                    const stale = clone(expected as Record<string, unknown>);
                    const successor = {
                        ...stale,
                        _saveVersion: Number(stale._saveVersion ?? 0) + 1,
                        character: { ...char(stale), ryo: 777 },
                    };
                    assert.equal(await base.compareSet(key, expected, successor), true);
                    return false;
                }
                return base.compareSet(key, expected, value, options);
            },
        };
        await settlePlayerRankedJournal(store, journal, NOW + 4);
        const alice = char(await base.get('save:alice'));
        assert.equal(alice.ryo, 777);
        assert.equal(alice.rankedRating, 1012);
        assert.equal(alice.rankedWins, 1);
    });

    it('seals anti-alt eligibility once and terminalization wins the close race', async () => {
        const { store, session } = await setup();
        let checks = 0;
        const journal = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 3,
            eligible: async () => { checks += 1; return false; },
        });
        const closing = await closePetRankedSeasonGate(store, 1, NOW + 4);
        assert.deepEqual(await cancelNonterminalPlayerRankedAdmissions(store, closing, NOW + 5), []);
        const replay = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 6,
            eligible: async () => { throw new Error('must-not-recompute'); },
        });
        assert.equal(checks, 1);
        assert.equal(replay.terminal.rankedEligible, false);
        await settlePlayerRankedJournal(store, journal, NOW + 7);
        assert.equal(char(await store.get('save:alice')).rankedRating, 1000);
        assert.equal(char(await store.get('save:bob')).rankedRating, 1000);
    });

    it('close cancellation winning first rejects stale terminal publication and applies no rating', async () => {
        const { store, session } = await setup();
        await store.set(`pvp:${BATTLE}`, { ...session, status: 'active', winner: null }, { ex: 900 });
        const closing = await closePetRankedSeasonGate(store, 1, NOW + 3);
        const admission = await getPlayerRankedAdmission(store, MATCH);
        assert.ok(admission && closing.transitionId);
        await fencePlayerRankedSessionForClose(store, admission, closing.transitionId, NOW + 4);
        const cancelled = await cancelNonterminalPlayerRankedAdmissions(store, closing, NOW + 4);
        assert.equal(cancelled.length, 1);
        await assert.rejects(() => publishPlayerRankedTerminal(store, session, {
            now: NOW + 5,
            eligible: async () => true,
        }), /admission-cancelled/);
        assert.equal((await getPlayerRankedAdmission(store, MATCH))?.phase, 'cancelled');
        assert.equal(char(await store.get('save:alice')).rankedRating, 1000);
        assert.equal(char(await store.get('save:bob')).rankedRating, 1000);
    });

    it('completed replay after a season reset returns current ratings and never reapplies delta', async () => {
        const { store, session } = await setup();
        const journal = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        await settlePlayerRankedJournal(store, journal, NOW + 4);
        const aliceRecord = await store.get<Record<string, unknown>>('save:alice');
        const bobRecord = await store.get<Record<string, unknown>>('save:bob');
        await store.set('save:alice', { ...aliceRecord, character: { ...char(aliceRecord), rankedRating: 1006 } });
        await store.set('save:bob', { ...bobRecord, character: { ...char(bobRecord), rankedRating: 994 } });
        const replay = await settlePlayerRankedJournal(store, MATCH, NOW + 5);
        assert.deepEqual(replay.ratings, { a: 1006, b: 994 });
        assert.equal(char(await store.get('save:alice')).rankedWins, 1);
        assert.equal(char(await store.get('save:bob')).rankedLosses, 1);
    });
});
