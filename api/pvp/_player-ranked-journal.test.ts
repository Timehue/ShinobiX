import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import { inspectSettlementReceipt } from '../_settlement-receipts.js';
import { mintPlayerRankedMatchTokenWithStore } from '../_ranked-match-token.js';
import { buildPublicLeaderboards, buildPublicPlayerIndexEntry, REGISTRY_KEY } from '../player/_public-index.js';
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
import { settlePvpConsumablesDurably } from './_consumable-settlement.js';
import {
    RANKED_FORMAT_NEUTRAL_EQUIPMENT,
    RANKED_FORMAT_VERSION,
    sealRankedFormatItemCharges,
} from './_ranked-format.js';
import {
    PLAYER_RANKED_SETTLEMENT_STAMP_LIMIT,
    PLAYER_RANKED_SETTLEMENT_STAMP_FIELD,
    getPlayerRankedJournal,
    parsePlayerRankedSettlingPointer,
    playerRankedJournalKey,
    playerRankedSettlingKey,
    publishPlayerRankedTerminal,
    settlePlayerRankedJournal,
} from './_player-ranked-journal.js';
import { confirmPlayerRankedTerminalEffects } from './_ranked-terminal-effects.js';

const NOW = 1_800_000_000_000;
const MATCH = 'player-ranked-12345678-1234-4123-8123-1234567890ab';
const BATTLE = 'pvp-12345678-1234-4123-8123-1234567890ab';

function clone<T>(value: T): T {
    return structuredClone(value);
}

function reorderedObjectKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reorderedObjectKeys);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => [key, reorderedObjectKeys(entry)]));
    }
    return value;
}

async function setup() {
    const store = _makeMemoryKv();
    await store.set('ranked:season:current', { id: 1, startedAt: NOW, endsAt: NOW + 10_000 });
    await ensurePetRankedSeasonGate(store, 1, NOW);
    await Promise.all([
        store.set('save:alice', { _saveVersion: 1, character: { name: 'Alice', rankedRating: 1000, rankedWins: 0, serverSettlementReceipts: [] } }),
        store.set('save:bob', { _saveVersion: 1, character: { name: 'Bob', rankedRating: 1000, rankedLosses: 0, serverSettlementReceipts: [] } }),
    ]);
    await store.hset(REGISTRY_KEY, {
        alice: buildPublicPlayerIndexEntry({ name: 'Alice', rankedRating: 1000 }, 'alice'),
        bob: buildPublicPlayerIndexEntry({ name: 'Bob', rankedRating: 1000 }, 'bob'),
    });
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

/** The gate row loses this match's admission out of band. */
async function dropAdmission(store: KvLike, matchId: string) {
    const raw = await store.get<Record<string, any>>('ranked:season:authority');
    assert.ok(raw);
    const next = {
        ...raw,
        playerAdmissions: raw.playerAdmissions.filter((entry: { matchId: string }) => entry.matchId !== matchId),
    };
    assert.equal(await store.compareSet('ranked:season:authority', raw, next), true);
    assert.equal(await getPlayerRankedAdmission(store, matchId), null);
}

const noLock = async <T>(_key: string, action: () => Promise<T>): Promise<T> => action();

describe('player ranked terminal journal', () => {
    it('settles a journal whose database reordered its terminal fields', async () => {
        const { store, session } = await setup();
        const published = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        // Postgres JSONB does not preserve the insertion order used when the
        // terminal fingerprint was sealed. Production got stuck at this read.
        await store.set(playerRankedJournalKey(MATCH), reorderedObjectKeys(published));
        const recovered = await getPlayerRankedJournal(store, MATCH);
        assert.equal(recovered?.terminal.fingerprint, published.terminal.fingerprint);
        const settled = await settlePlayerRankedJournal(store, MATCH, NOW + 4);
        assert.equal(settled.journal.state, 'completed');
        assert.equal(await getPlayerRankedAdmission(store, MATCH), null);
        const rematchId = 'player-ranked-12345678-1234-4123-8123-1234567890ac';
        const rematch = await mintPlayerRankedMatchTokenWithStore(store, {
            a: 'alice', b: 'bob', aLevel: 25, bLevel: 25, aRating: 1012, bRating: 988,
            now: NOW + 5, matchId: rematchId,
        });
        assert.equal(rematch.matchId, rematchId);
        assert.equal(char(await store.get('save:alice')).rankedRating, 1012);
        assert.equal(char(await store.get('save:bob')).rankedRating, 988);
    });

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
        const registry = await store.hgetall<Record<string, ReturnType<typeof buildPublicPlayerIndexEntry>>>(REGISTRY_KEY);
        assert.equal(registry?.alice?.rankedWins, 1);
        assert.equal(registry?.bob?.rankedLosses, 1);
        assert.deepEqual(buildPublicLeaderboards(Object.values(registry ?? [])).find(board => board.id === 'ranked')?.rows
            .map(row => [row.name, row.value]), [['Alice', 1012], ['Bob', 988]]);
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

    it('retries a failed leaderboard projection before confirming the ranked result', async () => {
        const { store: base, session } = await setup();
        const journal = await publishPlayerRankedTerminal(base, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        let failProjection = true;
        const interrupted: KvLike = {
            ...base,
            async hset(key, value) {
                if (key === REGISTRY_KEY && failProjection) throw new Error('ranked-index-unavailable');
                return base.hset(key, value);
            },
        };
        await assert.rejects(() => settlePlayerRankedJournal(interrupted, journal, NOW + 4), /ranked-index-unavailable/);
        assert.equal(char(await base.get('save:alice')).rankedRating, 1012);
        assert.equal((await base.hgetall<Record<string, { rankedRating: number }>>(REGISTRY_KEY))?.alice?.rankedRating, 1000);
        assert.equal((await getPlayerRankedJournal(base, MATCH))?.state, 'pending');

        failProjection = false;
        const recovered = await settlePlayerRankedJournal(interrupted, MATCH, NOW + 5);
        assert.equal(recovered.journal.state, 'completed');
        assert.equal(char(await base.get('save:alice')).rankedWins, 1);
        assert.equal(char(await base.get('save:bob')).rankedLosses, 1);
        assert.equal((await base.hgetall<Record<string, { rankedRating: number }>>(REGISTRY_KEY))?.alice?.rankedRating, 1012);
        assert.equal((await base.hgetall<Record<string, { rankedRating: number }>>(REGISTRY_KEY))?.bob?.rankedRating, 988);
    });

    it('accepts the conserved Ranked Format item ledger without debiting inventory', async () => {
        const { store, session } = await setup();
        const thrown = RANKED_FORMAT_NEUTRAL_EQUIPMENT.thrown;
        const p1Charges = sealRankedFormatItemCharges();
        p1Charges[thrown] -= 1;
        const rankedSession = {
            ...session,
            rankedFormatVersion: RANKED_FORMAT_VERSION,
            itemCharges: { p1: p1Charges, p2: sealRankedFormatItemCharges() },
            itemsUsed: { p1: { [thrown]: 1 }, p2: {} },
        } satisfies PvpSession;
        await store.set(`pvp:${BATTLE}`, rankedSession, { ex: 900 });
        const aliceRecord = await store.get<Record<string, unknown>>('save:alice');
        await store.set('save:alice', {
            ...aliceRecord,
            character: { ...char(aliceRecord), itemStacks: [{ itemId: thrown, count: 3 }] },
        });

        const journal = await publishPlayerRankedTerminal(store, rankedSession, {
            now: NOW + 3,
            eligible: async () => true,
        });
        await settlePvpConsumablesDurably(
            store,
            rankedSession,
            async <T>(_key: string, action: () => Promise<T>) => action(),
            { now: NOW + 4, playerRankedJournal: journal },
        );
        assert.deepEqual(char(await store.get('save:alice')).itemStacks, [{ itemId: thrown, count: 3 }]);
        const settled = await settlePlayerRankedJournal(store, journal, NOW + 5);
        assert.equal(settled.journal.state, 'completed');
    });

    it('rejects a forged Ranked Format item ledger before terminal publication', async () => {
        const { store, session } = await setup();
        const rankedSession = {
            ...session,
            rankedFormatVersion: RANKED_FORMAT_VERSION,
            itemCharges: { p1: sealRankedFormatItemCharges(), p2: sealRankedFormatItemCharges() },
            itemsUsed: { p1: { forged: 1 }, p2: {} },
        } satisfies PvpSession;
        await assert.rejects(
            publishPlayerRankedTerminal(store, rankedSession, {
                now: NOW + 3,
                eligible: async () => true,
            }),
            /player-ranked-format-item-ledger-invalid/,
        );
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

    it('publishes a pending journal whose gate admission was lost from its sealed terminal', async () => {
        const { store, session } = await setup();
        const sealed = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 3,
            eligible: async () => true,
        });
        await dropAdmission(store, MATCH);

        const republished = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 4,
            eligible: async () => { throw new Error('must-not-recompute'); },
        });

        assert.deepEqual(republished, sealed, 'the sealed terminal is the authority, not a new one');
        const settled = await settlePlayerRankedJournal(store, republished, NOW + 5, { completeAdmission: false });
        assert.equal(settled.journal.state, 'completed');
        assert.equal(char(await store.get('save:alice')).rankedRating, 1012);
        assert.equal(char(await store.get('save:bob')).rankedRating, 988);
        const replay = await settlePlayerRankedJournal(store, MATCH, NOW + 6);
        assert.deepEqual(replay.ratings, { a: 1012, b: 988 }, 'a replay never applies the delta again');
    });

    it('never lets a session that disagrees with the sealed terminal publish without its admission', async () => {
        const { store, session } = await setup();
        await publishPlayerRankedTerminal(store, session, { now: NOW + 3, eligible: async () => true });
        await dropAdmission(store, MATCH);
        const retry = { now: NOW + 4, eligible: async () => { throw new Error('must-not-recompute'); } };
        for (const forged of [
            { ...session, winner: 'p2' },
            { ...session, rankedSeasonEpoch: 2 },
            { ...session, battleId: 'pvp-12345678-1234-4123-8123-1234567890ff' },
            { ...session, p2: { name: 'Mallory' } },
        ]) {
            await assert.rejects(
                publishPlayerRankedTerminal(store, forged as unknown as PvpSession, retry),
                /player-ranked-(journal-conflict|item-session-conflict)/,
            );
        }
        await assert.rejects(
            publishPlayerRankedTerminal(store, { ...session, joined: { p1: true, p2: false } } as PvpSession, retry),
            /player-ranked-terminal-participants-unconfirmed/,
        );
        assert.equal((await getPlayerRankedJournal(store, MATCH))?.state, 'pending');
        assert.equal(char(await store.get('save:alice')).rankedRating, 1000);
    });

    it('reports a lost admission with no sealed terminal as void, and a recorded one as a no-contest', async () => {
        const { store, session } = await setup();
        await dropAdmission(store, MATCH);
        const publish = () => publishPlayerRankedTerminal(store, session, { now: NOW + 3, eligible: async () => true });

        await assert.rejects(publish(), /player-ranked-admission-missing/);
        await store.set(`player:ranked-cancelled:${MATCH}`, {
            matchId: MATCH, battleId: BATTLE, seasonId: 1, seasonEpoch: 1,
            cancelledAt: NOW + 2, reason: 'season-close-no-contest',
        });
        await assert.rejects(publish(), /player-ranked-admission-cancelled/);
        assert.equal(await getPlayerRankedJournal(store, MATCH), null);
    });

    it('a helper that settles the whole match mid-publication is not mistaken for a void', async () => {
        const { store, session } = await setup();
        let raced = false;
        const journal = await publishPlayerRankedTerminal(store, session, {
            now: NOW + 3,
            // Runs after this publication read the admission and before its
            // terminal CAS: another claim terminalizes, settles and removes it.
            eligible: async () => {
                raced = true;
                await confirmPlayerRankedTerminalEffects(store, session, {
                    eligible: async () => true,
                    lock: noLock,
                    now: NOW + 4,
                });
                return true;
            },
        });
        assert.equal(raced, true);
        assert.equal(journal.state, 'completed');
        assert.equal(journal.terminal.terminalAt, NOW + 4, 'the winner\'s sealed terminal, not this attempt\'s');
        assert.equal(await getPlayerRankedAdmission(store, MATCH), null);
        assert.equal(char(await store.get('save:alice')).rankedRating, 1012);
    });

    it('publishes the settlement sweep pointer before the journal it describes', async () => {
        const { store, session } = await setup();
        const order: string[] = [];
        const observed: KvLike = {
            ...store,
            async set(key, value, options) {
                if (key === playerRankedSettlingKey(MATCH) || key === playerRankedJournalKey(MATCH)) order.push(key);
                return store.set(key, value, options);
            },
        };
        await publishPlayerRankedTerminal(observed, session, { now: NOW + 3, eligible: async () => true });
        assert.deepEqual(order, [playerRankedSettlingKey(MATCH), playerRankedJournalKey(MATCH)]);
        const pointer = parsePlayerRankedSettlingPointer(await store.get(playerRankedSettlingKey(MATCH)));
        assert.deepEqual(pointer && {
            matchId: pointer.matchId, battleId: pointer.battleId, since: pointer.since, attempts: pointer.attempts,
        }, { matchId: MATCH, battleId: BATTLE, since: NOW + 3, attempts: 0 });

        // A replayed publication never recreates or resets the pointer.
        await store.del(playerRankedSettlingKey(MATCH));
        await publishPlayerRankedTerminal(observed, session, { now: NOW + 4, eligible: async () => true });
        assert.equal(await store.get(playerRankedSettlingKey(MATCH)), null);
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
