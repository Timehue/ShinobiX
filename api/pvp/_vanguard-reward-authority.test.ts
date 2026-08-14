import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import { reserveEconomicReceipt } from '../_economic-receipt.js';
import { writeVersionedPlayerSaveWithStore } from '../save/_mutate-player-save.js';
import type { PlayerRankedTerminal } from './_player-ranked-journal.js';
import type { PvpSession } from './session.js';
import {
    VANGUARD_REWARD_SETTLEMENT_FIELD,
    VANGUARD_REWARD_INTENT_VERSION,
    grantVanguardRewardsForSession,
    hasDurableVanguardTerminalOutcome,
    parseVanguardRewardSettlementMarker,
    type GrantResult,
    type VanguardRewardOptions,
} from './_vanguard-rewards.js';

const NOW = 1_800_000_000_000;
const MATCH = 'player-ranked-12345678-1234-4123-8123-1234567890ab';
const BATTLE = 'pvp-12345678-1234-4123-8123-1234567890ab';

function rankedFixture(overrides: {
    winnerCharacter?: Record<string, unknown>;
    loserCharacter?: Record<string, unknown>;
    session?: Partial<PvpSession>;
    terminal?: Partial<PlayerRankedTerminal>;
} = {}): { session: PvpSession; terminal: PlayerRankedTerminal } {
    const winnerCharacter = {
        name: 'Alice', profession: 'vanguard', professionRank: 1, professionXp: 0,
        honorSeals: 0, level: 30, masterySpec: {},
        ...overrides.winnerCharacter,
    };
    const loserCharacter = {
        name: 'Bob', level: 30, createdAt: NOW - 4 * 24 * 60 * 60 * 1000,
        ...overrides.loserCharacter,
    };
    const session = {
        battleId: BATTLE,
        p1: { name: 'Alice', character: winnerCharacter },
        p2: { name: 'Bob', character: loserCharacter },
        status: 'done',
        winner: 'p1',
        createdAt: NOW,
        lastMoveAt: NOW + 20_000,
        joined: { p1: true, p2: true },
        rewardAuthority: 'ranked',
        baseRewards: false,
        ranked: false,
        rankedKind: 'player',
        playerRankedAuthorityVersion: 2,
        rankedMatchId: MATCH,
        rankedSeasonId: 1,
        rankedSeasonEpoch: 1,
        ...overrides.session,
    } as unknown as PvpSession;
    const terminal = {
        matchId: MATCH,
        battleId: BATTLE,
        a: 'alice',
        b: 'bob',
        aRating: 1000,
        bRating: 1000,
        seasonId: 1,
        seasonEpoch: 1,
        winner: 'a',
        rankedEligible: true,
        terminalAt: NOW + 20_100,
        fingerprint: 'a'.repeat(64),
        ...overrides.terminal,
    } as PlayerRankedTerminal;
    return { session, terminal };
}

async function setup(overrides: Parameters<typeof rankedFixture>[0] = {}) {
    const store = _makeMemoryKv();
    const fixture = rankedFixture(overrides);
    await Promise.all([
        store.set('save:alice', {
            _saveVersion: 1,
            character: structuredClone(fixture.session.p1.character),
        }),
        store.set('save:bob', {
            _saveVersion: 1,
            character: structuredClone(fixture.session.p2.character),
        }),
    ]);
    const options: VanguardRewardOptions = {
        store,
        lock: async (_key, action) => action(),
        rankedTerminal: fixture.terminal,
        now: NOW + 20_200,
        overlap: async () => false,
        activeEscorters: async () => [],
    };
    return { store, ...fixture, options };
}

function character(record: unknown): Record<string, any> {
    return ((record as { character?: unknown })?.character ?? {}) as Record<string, any>;
}

function intentKey(battleId = BATTLE): string {
    return `pvp:vanguard-rewarded:${battleId}`;
}

describe('Vanguard reward V2 durable authority', { concurrency: false }, () => {
    it('aborts a definitive precommit save CAS failure and grants exactly once on retry', async () => {
        const { store: base, session, options } = await setup();
        let rejectSave = true;
        const store = {
            ...base,
            async compareSet(key: string, expected: unknown | null, value: unknown, opts?: { ex?: number }) {
                if (key === 'save:alice' && rejectSave) {
                    rejectSave = false;
                    return false;
                }
                return base.compareSet(key, expected, value, opts);
            },
        };
        await assert.rejects(
            grantVanguardRewardsForSession(session, { ...options, store }),
            /player-save-version-conflict/,
        );
        assert.equal(character(await base.get('save:alice')).honorSeals, 0);
        assert.equal((await base.get<any>(intentKey()))?.state, 'aborted');

        const granted = await grantVanguardRewardsForSession(session, { ...options, store: base, now: NOW + 20_300 });
        assert.deepEqual(granted, { granted: true, seals: 1, xp: 100 });
        const replay = await grantVanguardRewardsForSession(session, { ...options, store: base, now: NOW + 20_400 });
        assert.equal(replay.reason, 'already-granted');
        const saved = character(await base.get('save:alice'));
        assert.equal(saved.honorSeals, 1);
        assert.equal(saved.professionXp, 100);
    });

    it('recovers a committed save with a lost acknowledgement after a follow-on autosave', async () => {
        const { store: base, session, terminal, options } = await setup();
        let loseAck = true;
        const lostAckStore = {
            ...base,
            async compareSet(key: string, expected: unknown | null, value: unknown, opts?: { ex?: number }) {
                const committed = await base.compareSet(key, expected, value, opts);
                if (key === 'save:alice' && committed && loseAck) {
                    loseAck = false;
                    throw new Error('winner-save-lost-ack');
                }
                return committed;
            },
        };
        const first = await grantVanguardRewardsForSession(session, { ...options, store: lostAckStore });
        assert.equal(first.granted, true);

        const after = await base.get<Record<string, unknown>>('save:alice');
        assert.ok(after);
        await writeVersionedPlayerSaveWithStore(base, 'save:alice', after, {
            ...character(after),
            nindo: 'follow-on autosave',
        });
        await base.del(intentKey()); // simulate external expiry/loss; save marker remains authority

        const replay = await grantVanguardRewardsForSession(session, { ...options, store: base, now: NOW + 30_000 });
        assert.equal(replay.reason, 'already-granted');
        const saved = character(await base.get('save:alice'));
        assert.equal(saved.honorSeals, 1);
        assert.equal(saved.professionXp, 100);
        assert.equal(saved.nindo, 'follow-on autosave');
        assert.equal(await hasDurableVanguardTerminalOutcome(base, terminal), true);
    });

    it('helps forward a crash after the save marker and before external commit', async () => {
        const { store: base, session, options } = await setup();
        let crashBeforeCommit = true;
        const store = {
            ...base,
            async compareSet(key: string, expected: unknown | null, value: unknown, opts?: { ex?: number }) {
                if (key === intentKey()
                    && (value as { state?: unknown })?.state === 'committed'
                    && crashBeforeCommit) {
                    crashBeforeCommit = false;
                    throw new Error('crash-before-intent-commit');
                }
                return base.compareSet(key, expected, value, opts);
            },
        };
        await assert.rejects(
            grantVanguardRewardsForSession(session, { ...options, store }),
            /crash-before-intent-commit/,
        );
        const once = character(await base.get('save:alice'));
        assert.equal(once.honorSeals, 1);
        assert.equal(parseVanguardRewardSettlementMarker(once[VANGUARD_REWARD_SETTLEMENT_FIELD])?.state, 'settled');
        assert.equal((await base.get<any>(intentKey()))?.state, 'pending');

        const replay = await grantVanguardRewardsForSession(session, { ...options, store: base, now: NOW + 20_300 });
        assert.equal(replay.reason, 'already-granted');
        assert.equal((await base.get<any>(intentKey()))?.state, 'committed');
        assert.equal(character(await base.get('save:alice')).honorSeals, 1);
    });

    it('recovers fulfilled-false/null acknowledgements for both external intent phases', async () => {
        const { store: base, session, options } = await setup();
        let loseReserveAck = true;
        let loseCommitAck = true;
        const store = {
            ...base,
            async compareSet(key: string, expected: unknown | null, value: unknown, opts?: { ex?: number }) {
                const committed = await base.compareSet(key, expected, value, opts);
                if (key === intentKey() && committed
                    && (value as { state?: unknown })?.state === 'pending'
                    && loseReserveAck) {
                    loseReserveAck = false;
                    return false;
                }
                if (key === intentKey() && committed
                    && (value as { state?: unknown })?.state === 'committed'
                    && loseCommitAck) {
                    loseCommitAck = false;
                    return null as never;
                }
                return committed;
            },
        };

        const granted = await grantVanguardRewardsForSession(session, { ...options, store });
        assert.deepEqual(granted, { granted: true, seals: 1, xp: 100 });
        assert.equal((await base.get<any>(intentKey()))?.state, 'committed');
        assert.equal(character(await base.get('save:alice')).honorSeals, 1);
    });

    it('keeps the exact marker authoritative after more than 50 generic receipts churn', async () => {
        const { store, session, terminal, options } = await setup();
        await grantVanguardRewardsForSession(session, options);
        const prior = await store.get<Record<string, unknown>>('save:alice');
        assert.ok(prior);
        await writeVersionedPlayerSaveWithStore(store, 'save:alice', prior, {
            ...character(prior),
            serverSettlementReceipts: Array.from({ length: 80 }, (_, i) => ({ id: `other-${i}` })),
        });
        await store.del(intentKey());
        assert.equal(await hasDurableVanguardTerminalOutcome(store, terminal), true, 'marker survives the >7-day/external-expiry fallback');
        const replay = await grantVanguardRewardsForSession(session, { ...options, now: NOW + 8 * 24 * 60 * 60 * 1000 });
        assert.equal(replay.reason, 'already-granted');
        const saved = character(await store.get('save:alice'));
        assert.equal(saved.honorSeals, 1);
        assert.equal(saved.professionXp, 100);
        assert.equal(saved.serverSettlementReceipts.length, 80);
    });

    it('does not race a paused old v4 owner and accepts only its committed result', async () => {
        const previous = process.env.ENABLE_VANGUARD_REWARD_V2;
        process.env.ENABLE_VANGUARD_REWARD_V2 = '1';
        try {
            const { store, session, options } = await setup({
                session: { ranked: true, playerRankedAuthorityVersion: undefined, baseRewards: true },
            });
            const legacyFingerprint = `vanguard:${BATTLE}:alice:bob`;
            await store.set(intentKey(), {
                version: 4,
                state: 'pending',
                ownerId: 'old-worker',
                fingerprint: legacyFingerprint,
                createdAt: NOW,
                leaseExpiresAt: NOW + 1,
                metadata: { battleId: BATTLE, winner: 'alice', loser: 'bob' },
            });
            await assert.rejects(
                grantVanguardRewardsForSession(session, { ...options, rankedTerminal: undefined, store }),
                /legacy-owner-pending/,
            );
            assert.equal(character(await store.get('save:alice')).honorSeals, 0);

            const prior = await store.get<Record<string, unknown>>('save:alice');
            assert.ok(prior);
            await writeVersionedPlayerSaveWithStore(store, 'save:alice', prior, {
                ...character(prior), honorSeals: 1, professionXp: 100, professionRank: 2,
            });
            await store.set(intentKey(), {
                version: 4,
                state: 'committed',
                ownerId: 'old-worker',
                fingerprint: legacyFingerprint,
                createdAt: NOW,
                metadata: { battleId: BATTLE, winner: 'alice', loser: 'bob' },
            });
            const replay = await grantVanguardRewardsForSession(session, {
                ...options, rankedTerminal: undefined, store, now: NOW + 30_000,
            });
            assert.equal(replay.reason, 'already-granted');
            assert.equal(character(await store.get('save:alice')).honorSeals, 1);
        } finally {
            if (previous === undefined) delete process.env.ENABLE_VANGUARD_REWARD_V2;
            else process.env.ENABLE_VANGUARD_REWARD_V2 = previous;
        }
    });

    it('fences a paused V2 owner after lease expiry and its resume cannot overwrite the successor', async () => {
        const { store, session, options } = await setup({
            winnerCharacter: { clan: 'Ember', activePetId: 'pet-1' },
        });
        let enteredResolve!: () => void;
        let resumeResolve!: () => void;
        const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
        const resume = new Promise<void>((resolve) => { resumeResolve = resolve; });
        const paused = grantVanguardRewardsForSession(session, {
            ...options,
            activeEscorters: async () => {
                enteredResolve();
                await resume;
                return [];
            },
        });
        await entered;
        const successor = await grantVanguardRewardsForSession(session, {
            ...options,
            now: NOW + 40_000,
            activeEscorters: async () => [],
        });
        assert.equal(successor.granted, true);
        resumeResolve();
        const stale = await paused;
        assert.equal(stale.reason, 'already-granted');
        const saved = character(await store.get('save:alice'));
        assert.equal(saved.honorSeals, 1);
        assert.equal(saved.professionXp, 100);
    });

    it('resumes an exact save fence after crashing before the intent-owner CAS, including unrelated churn', async () => {
        const { store: base, session, options } = await setup({
            winnerCharacter: { clan: 'Ember', activePetId: 'pet-1' },
        });
        await assert.rejects(
            grantVanguardRewardsForSession(session, {
                ...options,
                activeEscorters: async () => { throw new Error('owner-crash'); },
            }),
            /owner-crash/,
        );
        const pending = await base.get<any>(intentKey());
        assert.equal(pending?.state, 'pending');

        let crashFence = true;
        const crashStore = {
            ...base,
            async compareSet(key: string, expected: unknown | null, value: unknown, opts?: { ex?: number }) {
                if (key === intentKey()
                    && (value as { ownerId?: unknown })?.ownerId !== pending.ownerId
                    && crashFence) {
                    crashFence = false;
                    throw new Error('crash-after-save-fence');
                }
                return base.compareSet(key, expected, value, opts);
            },
        };
        await assert.rejects(
            grantVanguardRewardsForSession(session, {
                ...options, store: crashStore, now: NOW + 40_000, activeEscorters: async () => [],
            }),
            /crash-after-save-fence/,
        );
        const fenced = character(await base.get('save:alice'))[VANGUARD_REWARD_SETTLEMENT_FIELD];
        assert.equal(parseVanguardRewardSettlementMarker(fenced)?.state, 'reserved');

        // A current exact-CAS autosave advances the already-fenced record and
        // must not make the durable successor marker unrecoverable.
        const current = await base.get<Record<string, unknown>>('save:alice');
        assert.ok(current);
        await writeVersionedPlayerSaveWithStore(base, 'save:alice', current, {
            ...character(current), nindo: 'churn after fence',
        });
        const recovered = await grantVanguardRewardsForSession(session, {
            ...options, store: base, now: NOW + 50_000, activeEscorters: async () => [],
        });
        assert.equal(recovered.granted, true);
        const saved = character(await base.get('save:alice'));
        assert.equal(saved.honorSeals, 1);
        assert.equal(saved.nindo, 'churn after fence');
    });

    it('keeps generic V2 default-off for drain, then uses the marker after explicit cutover', async () => {
        const previous = process.env.ENABLE_VANGUARD_REWARD_V2;
        delete process.env.ENABLE_VANGUARD_REWARD_V2;
        try {
            const { store, session, options } = await setup({
                session: { ranked: true, playerRankedAuthorityVersion: undefined, baseRewards: true },
            });
            let legacyCalls = 0;
            const legacyResult: GrantResult = { granted: false, reason: 'capped' };
            const drained = await grantVanguardRewardsForSession(session, {
                ...options,
                rankedTerminal: undefined,
                legacyGrant: async () => { legacyCalls += 1; return legacyResult; },
            });
            assert.deepEqual(drained, legacyResult);
            assert.equal(legacyCalls, 1);
            assert.equal(await store.get(intentKey()), null);
            assert.equal(character(await store.get('save:alice'))[VANGUARD_REWARD_SETTLEMENT_FIELD], undefined);

            process.env.ENABLE_VANGUARD_REWARD_V2 = '1';
            const cutover = await grantVanguardRewardsForSession(session, {
                ...options,
                rankedTerminal: undefined,
                store,
                now: NOW + 20_300,
                overlap: async () => false,
            });
            assert.equal(cutover.granted, true);
            assert.equal((await store.get<any>(intentKey()))?.version, VANGUARD_REWARD_INTENT_VERSION);
            assert.equal(parseVanguardRewardSettlementMarker(
                character(await store.get('save:alice'))[VANGUARD_REWARD_SETTLEMENT_FIELD],
            )?.state, 'settled');
        } finally {
            if (previous === undefined) delete process.env.ENABLE_VANGUARD_REWARD_V2;
            else process.env.ENABLE_VANGUARD_REWARD_V2 = previous;
        }
    });

    it('makes a new-first V2 receipt inert to an old v4 reservation worker', async () => {
        const previous = process.env.ENABLE_VANGUARD_REWARD_V2;
        process.env.ENABLE_VANGUARD_REWARD_V2 = '1';
        try {
            const { store, session, options } = await setup({
                winnerCharacter: { clan: 'Ember', activePetId: 'pet-1' },
                session: { ranked: true, playerRankedAuthorityVersion: undefined, baseRewards: true },
            });
            let enteredResolve!: () => void;
            let resumeResolve!: () => void;
            const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
            const resume = new Promise<void>((resolve) => { resumeResolve = resolve; });
            const newWorker = grantVanguardRewardsForSession(session, {
                ...options,
                rankedTerminal: undefined,
                activeEscorters: async () => {
                    enteredResolve();
                    await resume;
                    return [];
                },
            });
            await entered;
            const oldWorker = await reserveEconomicReceipt(store, {
                key: intentKey(),
                fingerprint: `vanguard:${BATTLE}:alice:bob`,
                ttlSeconds: 7 * 24 * 60 * 60,
            });
            assert.equal(oldWorker.status, 'replay', 'old parser treats the V2 row as already spent');
            resumeResolve();
            assert.equal((await newWorker).granted, true);
            assert.equal(character(await store.get('save:alice')).honorSeals, 1);
        } finally {
            if (previous === undefined) delete process.env.ENABLE_VANGUARD_REWARD_V2;
            else process.env.ENABLE_VANGUARD_REWARD_V2 = previous;
        }
    });

    it('binds too-quick and cap economics to terminal truth', async () => {
        const quick = await setup({
            session: { lastMoveAt: NOW + 5_000 },
            terminal: { terminalAt: NOW + 60_000 },
        });
        const quickResult = await grantVanguardRewardsForSession(quick.session, {
            ...quick.options,
            rankedTerminal: quick.terminal,
            now: NOW + 60_100,
        });
        assert.equal(quickResult.reason, 'too-quick');
        assert.equal(character(await quick.store.get('save:alice')).professionXp, 0);

        const rewardDate = new Date(NOW + 20_000).toISOString().slice(0, 10);
        const capped = await setup({
            winnerCharacter: {
                vanguardDailyResetDate: rewardDate,
                dailyHonorSealsEarned: 150,
                dailyHonorSealsByTarget: { bob: 3 },
            },
        });
        const cappedResult = await grantVanguardRewardsForSession(capped.session, capped.options);
        assert.deepEqual(cappedResult, { granted: true, seals: 0, xp: 100 });
        const saved = character(await capped.store.get('save:alice'));
        assert.equal(saved.honorSeals, 0);
        assert.equal(saved.professionXp, 100);
        assert.equal(saved.dailyHonorSealsEarned, 150);
    });

    it('keeps ranked escort lookup failure retryable instead of sealing an undergrant', async () => {
        const { store, session, options } = await setup({
            winnerCharacter: { clan: 'Ember', activePetId: 'pet-1' },
        });
        await assert.rejects(
            grantVanguardRewardsForSession(session, {
                ...options,
                activeEscorters: async () => { throw new Error('escort-store-down'); },
            }),
            /escort-store-down/,
        );
        assert.equal(character(await store.get('save:alice')).honorSeals, 0);
        assert.equal((await store.get<any>(intentKey()))?.state, 'pending');
        const recovered = await grantVanguardRewardsForSession(session, {
            ...options, now: NOW + 40_000, activeEscorters: async () => [],
        });
        assert.equal(recovered.granted, true);
    });
});
