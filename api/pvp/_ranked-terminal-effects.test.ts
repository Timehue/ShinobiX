import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import { hasRecentIpOrFpOverlapStrict } from '../_player-ips.js';
import { mintPlayerRankedMatchTokenWithStore } from '../_ranked-match-token.js';
import {
    activatePlayerRankedAdmission,
    getPlayerRankedAdmission,
    ensurePetRankedSeasonGate,
} from '../pet/_ranked-preparation.js';
import type { PvpSession } from './session.js';
import {
    getPlayerRankedJournal,
    playerRankedJournalKey,
    publishPlayerRankedTerminal,
    settlePlayerRankedJournal,
} from './_player-ranked-journal.js';
import { settlePvpConsumablesDurably } from './_consumable-settlement.js';
import {
    confirmPlayerRankedTerminalEffects,
    recoverCompletedPlayerRankedFinalizations,
} from './_ranked-terminal-effects.js';

const NOW = 1_850_000_000_000;
const MATCH = 'player-ranked-92345678-1234-4123-8123-1234567890ab';
const BATTLE = 'pvp-92345678-1234-4123-8123-1234567890ab';
const lock = async <T>(_key: string, action: () => Promise<T>): Promise<T> => action();

function save(name: string) {
    return {
        _saveVersion: 1,
        character: {
            name,
            level: 25,
            rankedRating: 1000,
            rankedWins: 0,
            rankedLosses: 0,
            profession: 'ninja',
            serverSettlementReceipts: [],
        },
    };
}

async function setup(
    winner: 'p1' | 'p2' | 'draw' = 'p1',
    matchId = MATCH,
    battleId = BATTLE,
) {
    const store = _makeMemoryKv();
    await store.set('ranked:season:current', { id: 1, startedAt: NOW, endsAt: NOW + 100_000 });
    await ensurePetRankedSeasonGate(store, 1, NOW);
    await Promise.all([
        store.set('save:alice', save('Alice')),
        store.set('save:bob', save('Bob')),
    ]);
    const token = await mintPlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'bob', aLevel: 25, bLevel: 25, aRating: 1000, bRating: 1000,
        now: NOW + 1, matchId,
    });
    await activatePlayerRankedAdmission(store, token.matchId, battleId, NOW + 2);
    const session = {
        battleId,
        p1: { name: 'Alice' },
        p2: { name: 'Bob' },
        status: 'done',
        winner,
        ranked: false,
        rankedKind: 'player',
        playerRankedAuthorityVersion: 2,
        rankedMatchId: matchId,
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
    await store.set(`pvp:${battleId}`, session);
    return { store, session };
}

describe('unified player-ranked terminal saga', () => {
    it('keeps a partial second-save failure discoverable and retry completes exactly once', async () => {
        const { store: base, session } = await setup();
        let failed = false;
        const interrupted: KvLike = {
            ...base,
            async compareSet(key, expected, value, options) {
                if (key === 'save:bob' && !failed) {
                    failed = true;
                    throw new Error('terminal-second-save-precommit');
                }
                return base.compareSet(key, expected, value, options);
            },
        };
        await assert.rejects(() => confirmPlayerRankedTerminalEffects(interrupted, session, {
            eligible: async () => true,
            lock,
            now: NOW + 3,
        }), /terminal-second-save-precommit/);
        assert.equal((await getPlayerRankedAdmission(base, MATCH))?.phase, 'terminal');
        assert.equal((await getPlayerRankedJournal(base, MATCH))?.confirmations.a, true);
        assert.equal((await getPlayerRankedJournal(base, MATCH))?.confirmations.b, false);

        await recoverCompletedPlayerRankedFinalizations(base, lock);
        assert.equal(await getPlayerRankedAdmission(base, MATCH), null);
        assert.equal((await getPlayerRankedJournal(base, MATCH))?.state, 'completed');
        assert.equal((await base.get<Record<string, any>>('save:alice'))?.character.rankedRating, 1012);
        assert.equal((await base.get<Record<string, any>>('save:bob'))?.character.rankedRating, 988);
    });

    it('queue traffic recovers an exact terminal session CAS before gate terminalization', async () => {
        const { store, session } = await setup('draw');
        assert.equal((await getPlayerRankedAdmission(store, MATCH))?.phase, 'active');
        assert.equal(await getPlayerRankedJournal(store, MATCH), null);

        await recoverCompletedPlayerRankedFinalizations(store, lock, { eligible: async () => true });

        assert.equal(await getPlayerRankedAdmission(store, MATCH), null);
        assert.equal((await getPlayerRankedJournal(store, MATCH))?.state, 'completed');
        assert.equal((await store.get<Record<string, any>>('save:alice'))?.character.rankedRating, 1000);
        assert.equal((await store.get<Record<string, any>>('save:bob'))?.character.rankedRating, 1000);
        assert.equal(session.status, 'done');
    });

    it('storage uncertainty cannot seal V2 eligibility and the exact terminal remains retryable', async () => {
        const { store: base, session } = await setup();
        const unavailable: KvLike = {
            ...base,
            async keys(pattern) {
                if (pattern.startsWith('player-ip:') || pattern.startsWith('player-fp:')) {
                    throw new Error('ranked-overlap-read-unavailable');
                }
                return base.keys(pattern);
            },
        };
        await assert.rejects(() => publishPlayerRankedTerminal(unavailable, session, {
            eligible: async (a, b) => !(await hasRecentIpOrFpOverlapStrict(a, b, unavailable)),
            now: NOW + 3,
        }), /ranked-overlap-read-unavailable/);
        assert.equal((await getPlayerRankedAdmission(base, MATCH))?.phase, 'active');
        assert.equal(await getPlayerRankedJournal(base, MATCH), null);
        assert.equal((await base.get<PvpSession>(`pvp:${BATTLE}`))?.status, 'done');

        const sealed = await publishPlayerRankedTerminal(base, session, {
            eligible: async (a, b) => !(await hasRecentIpOrFpOverlapStrict(a, b, base)),
            now: NOW + 4,
        });
        assert.equal(sealed.terminal.rankedEligible, true);
        assert.equal((await getPlayerRankedAdmission(base, MATCH))?.phase, 'terminal');
    });

    it('never honors an eligible terminal admission against unconfirmed participant evidence', async () => {
        const { store, session } = await setup();
        await publishPlayerRankedTerminal(store, session, { eligible: async () => true, now: NOW + 3 });
        const inconsistent = { ...session, joined: { p1: true, p2: false } } as PvpSession;
        await assert.rejects(
            publishPlayerRankedTerminal(store, inconsistent, {
                eligible: async () => { throw new Error('eligibility-must-stay-sealed'); },
                now: NOW + 4,
            }),
            /player-ranked-terminal-participants-unconfirmed/,
        );
        assert.equal((await getPlayerRankedAdmission(store, MATCH))?.phase, 'terminal');
        assert.equal((await store.get<Record<string, any>>('save:alice'))?.character.rankedRating, 1000);
        assert.equal((await store.get<Record<string, any>>('save:bob'))?.character.rankedRating, 1000);
    });

    it('queue traffic resumes a legacy partial V2 item-confirmation journal', async () => {
        const { store, session } = await setup('draw');
        const published = await publishPlayerRankedTerminal(store, session, {
            eligible: async () => true,
            now: NOW + 3,
        });
        await store.set(playerRankedJournalKey(MATCH), {
            ...published,
            items: {
                a: { ...published.items.a, confirmed: true },
                b: { ...published.items.b, confirmed: false },
            },
        });

        await recoverCompletedPlayerRankedFinalizations(store, lock);

        const recovered = await getPlayerRankedJournal(store, MATCH);
        assert.equal(recovered?.items.a.confirmed, true);
        assert.equal(recovered?.items.b.confirmed, true);
        assert.equal(recovered?.state, 'completed');
        assert.equal(await getPlayerRankedAdmission(store, MATCH), null);
    });

    it('a missing terminal session cannot release admission without exact durable Vanguard outcome proof', async () => {
        const { store, session } = await setup();
        const journal = await publishPlayerRankedTerminal(store, session, {
            eligible: async () => true,
            now: NOW + 3,
        });
        await settlePvpConsumablesDurably(store, session, lock, {
            now: NOW + 3,
            playerRankedJournal: journal,
        });
        await settlePlayerRankedJournal(store, MATCH, NOW + 3, { completeAdmission: false });
        await store.del(`pvp:${BATTLE}`);

        await assert.rejects(
            recoverCompletedPlayerRankedFinalizations(store, lock),
            /player-ranked-vanguard-settlement-pending/,
        );
        assert.equal((await getPlayerRankedAdmission(store, MATCH))?.phase, 'terminal');
    });

    it('recovers a second-save commit whose acknowledgement is lost', async () => {
        const { store: base, session } = await setup();
        let lost = false;
        const interrupted: KvLike = {
            ...base,
            async compareSet(key, expected, value, options) {
                const committed = await base.compareSet(key, expected, value, options);
                if (committed && key === 'save:bob' && !lost) {
                    lost = true;
                    throw new Error('terminal-second-save-lost-ack');
                }
                return committed;
            },
        };
        await confirmPlayerRankedTerminalEffects(interrupted, session, {
            eligible: async () => true,
            lock,
            now: NOW + 3,
        });
        assert.equal(lost, true);
        assert.equal(await getPlayerRankedAdmission(base, MATCH), null);
        assert.equal((await base.get<Record<string, any>>('save:alice'))?.character.rankedRating, 1012);
        assert.equal((await base.get<Record<string, any>>('save:bob'))?.character.rankedRating, 988);
    });

    it('a draw removes its admission immediately and both players can reserve a successor', async () => {
        const { store, session } = await setup('draw');
        await confirmPlayerRankedTerminalEffects(store, session, {
            eligible: async () => true,
            lock,
            now: NOW + 3,
        });
        assert.equal(await getPlayerRankedAdmission(store, MATCH), null);
        const successor = await mintPlayerRankedMatchTokenWithStore(store, {
            a: 'alice', b: 'bob', aLevel: 25, bLevel: 25, aRating: 1000, bRating: 1000,
            now: NOW + 4,
            matchId: 'player-ranked-a2345678-1234-4123-8123-1234567890ab',
        });
        assert.equal(successor.a, 'alice');
        assert.equal(successor.b, 'bob');
    });

    it('queue traffic repairs bound-then-crash after TTL expiry and admits a successor', async () => {
        const realNow = Date.now;
        let clock = NOW;
        Date.now = () => clock;
        try {
            const { store: base, session } = await setup();
            let failed = false;
            const interrupted: KvLike = {
                ...base,
                async compareSet(key, expected, value, options) {
                    const next = value as { playerAdmissions?: Array<{ matchId?: string }> };
                    const prior = expected as { playerAdmissions?: Array<{ matchId?: string }> } | null;
                    if (key === 'ranked:season:authority'
                        && prior?.playerAdmissions?.some((entry) => entry.matchId === MATCH)
                        && !next.playerAdmissions?.some((entry) => entry.matchId === MATCH)
                        && !failed) {
                        failed = true;
                        throw new Error('terminal-admission-remove-precommit');
                    }
                    return base.compareSet(key, expected, value, options);
                },
            };
            await assert.rejects(() => confirmPlayerRankedTerminalEffects(interrupted, session, {
                eligible: async () => true,
                lock,
                now: NOW + 3,
            }), /terminal-admission-remove-precommit/);
            assert.equal((await getPlayerRankedAdmission(base, MATCH))?.phase, 'terminal');
            assert.equal((await getPlayerRankedJournal(base, MATCH))?.state, 'completed');

            clock += 901_000;
            assert.equal(await base.get(`pvp:${BATTLE}`), null);
            await recoverCompletedPlayerRankedFinalizations(base, lock);
            assert.equal(await getPlayerRankedAdmission(base, MATCH), null);
            const successor = await mintPlayerRankedMatchTokenWithStore(base, {
                a: 'alice', b: 'bob', aLevel: 25, bLevel: 25, aRating: 1012, bRating: 988,
                now: clock + 1,
                matchId: 'player-ranked-b2345678-1234-4123-8123-1234567890ab',
            });
            assert.equal(successor.matchId, 'player-ranked-b2345678-1234-4123-8123-1234567890ab');
        } finally {
            Date.now = realNow;
        }
    });
});
