import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import {
    acknowledgePvpRewardCompletion,
    markPvpRewardServerCreditsCompleted,
    pvpRewardCompletionStatus,
    reservePvpRewardCompletion,
} from './_reward-completion.js';

function memoryStore(options: { throwAfterAckCommit?: boolean } = {}) {
    const rows = new Map<string, unknown>();
    let throwAfterAckCommit = options.throwAfterAckCommit === true;
    return {
        rows,
        store: {
            async get<T>(key: string): Promise<T | null> {
                const value = rows.get(key);
                return value === undefined ? null : JSON.parse(JSON.stringify(value)) as T;
            },
            async set(key: string, value: unknown, opts?: { nx?: boolean }) {
                if (opts?.nx && rows.has(key)) return null;
                rows.set(key, JSON.parse(JSON.stringify(value)));
                return 'OK' as const;
            },
            async compareSet(key: string, expected: unknown, value: unknown) {
                const current = rows.has(key) ? rows.get(key) : null;
                if (!isDeepStrictEqual(current, expected)) return false;
                rows.set(key, JSON.parse(JSON.stringify(value)));
                if (throwAfterAckCommit) {
                    throwAfterAckCommit = false;
                    throw new Error('ack response lost');
                }
                return true;
            },
        },
    };
}

describe('durable PvP browser-completion receipt', () => {
    it('repairs a lost claim response without any browser storage', async () => {
        const { store } = memoryStore();
        const first = await reservePvpRewardCompletion(store as never, 'claim', 'win', true, 86_400, 10);
        assert.deepEqual(first, {
            alreadyClaimed: false,
            completionPending: true,
            serverCreditsPending: false,
        });

        // The browser saw no response and persisted no local marker. Server
        // state alone still instructs the authoritative retry to run callbacks.
        const replay = await reservePvpRewardCompletion(store as never, 'claim', 'win', true, 86_400, 11);
        assert.deepEqual(replay, {
            alreadyClaimed: true,
            completionPending: true,
            serverCreditsPending: false,
        });
    });

    it('recovers a completion CAS whose acknowledgement is lost', async () => {
        const { store } = memoryStore({ throwAfterAckCommit: true });
        await reservePvpRewardCompletion(store as never, 'claim', 'loss', true, 86_400, 20);
        assert.equal(await acknowledgePvpRewardCompletion(store as never, 'claim', 'loss', 86_400, 21), 'completed');
        const replay = await reservePvpRewardCompletion(store as never, 'claim', 'loss', true, 86_400, 22);
        assert.deepEqual(replay, {
            alreadyClaimed: true,
            completionPending: false,
            serverCreditsPending: false,
        });
    });

    it('treats pre-protocol receipts as completed and isolates outcome authority', async () => {
        const { rows, store } = memoryStore();
        rows.set('legacy', 'legacy-nx-marker');
        assert.deepEqual(
            await reservePvpRewardCompletion(store as never, 'legacy', 'win', true, 86_400, 30),
            { alreadyClaimed: true, completionPending: false, serverCreditsPending: false },
        );
        await reservePvpRewardCompletion(store as never, 'claim', 'win', true, 86_400, 31);
        await assert.rejects(
            acknowledgePvpRewardCompletion(store as never, 'claim', 'loss', 86_400, 32),
            /outcome-conflict/,
        );
    });

    it('fails closed on malformed object receipts in status, reserve, credit, and ACK paths', async () => {
        const malformed = [
            {
                version: 2, outcome: 'win', claimedAt: 1,
                completionState: 'completed', completedAt: null,
                serverCreditsState: 'completed', serverCreditsCompletedAt: 1,
            },
            {
                version: 2, outcome: 'win', claimedAt: 1,
                completionState: 'pending', completedAt: 2,
                serverCreditsState: 'completed', serverCreditsCompletedAt: 1,
            },
            {
                version: 2, outcome: 'win', claimedAt: 1,
                completionState: 'completed', completedAt: 2,
                serverCreditsState: 'pending', serverCreditsCompletedAt: null,
            },
            {
                version: 2, outcome: 'win', claimedAt: 1,
                completionState: 'pending', completedAt: null,
                serverCreditsState: 'pending', serverCreditsCompletedAt: 2,
            },
            {
                version: 2, outcome: 'win', claimedAt: 1,
                completionState: 'pending', completedAt: null,
                serverCreditsState: 'completed', serverCreditsCompletedAt: null,
            },
            {
                version: 2, outcome: 'win', claimedAt: 1,
                completionRequired: false,
                completionState: 'pending', completedAt: null,
                serverCreditsState: 'completed', serverCreditsCompletedAt: 2,
            },
            {
                version: 2, outcome: 'win', claimedAt: 1,
                completionState: 'completed', completedAt: 2,
                serverCreditsState: 'completed', serverCreditsCompletedAt: 2,
                forged: true,
            },
        ];
        for (const [index, row] of malformed.entries()) {
            const { rows, store } = memoryStore();
            const key = `malformed-${index}`;
            rows.set(key, row);
            assert.equal(pvpRewardCompletionStatus(row), 'invalid');
            await assert.rejects(
                reservePvpRewardCompletion(store as never, key, 'win', true, 86_400, 40),
                /receipt-invalid/,
            );
            await assert.rejects(
                markPvpRewardServerCreditsCompleted(store as never, key, 'win', 86_400, 41),
                /receipt-invalid/,
            );
            await assert.rejects(
                acknowledgePvpRewardCompletion(store as never, key, 'win', 86_400, 42),
                /receipt-invalid/,
            );
        }
    });

    it('retains explicit old-v2 compatibility only when its completion fields are coherent', async () => {
        const { rows, store } = memoryStore();
        rows.set('old-v2', {
            version: 2,
            outcome: 'loss',
            claimedAt: 1,
            completionState: 'pending',
            completedAt: null,
        });
        assert.equal(pvpRewardCompletionStatus(rows.get('old-v2')), 'pending');
        assert.deepEqual(
            await reservePvpRewardCompletion(store as never, 'old-v2', 'loss', true, 86_400, 2),
            { alreadyClaimed: true, completionPending: true, serverCreditsPending: false },
        );
    });

    it('keeps false-NX followed by a missing read retryable', async () => {
        const store = {
            async get() { return null; },
            async set() { return null; },
            async compareSet() { return false; },
        };
        await assert.rejects(
            reservePvpRewardCompletion(store as never, 'expired-race', 'win', true, 86_400, 40),
            /reservation-unconfirmed/,
        );
    });

    it('refuses a browser ACK until server credits are durably sealed', async () => {
        const { store } = memoryStore();
        const reservation = await reservePvpRewardCompletion(
            store as never,
            'credit-barrier',
            'win',
            true,
            86_400,
            50,
            true,
        );
        assert.deepEqual(reservation, {
            alreadyClaimed: false,
            completionPending: true,
            serverCreditsPending: true,
        });
        assert.equal(
            await acknowledgePvpRewardCompletion(store as never, 'credit-barrier', 'win', 86_400, 51),
            'not-ready',
        );

        const retry = await reservePvpRewardCompletion(
            store as never,
            'credit-barrier',
            'win',
            true,
            86_400,
            52,
            true,
        );
        assert.equal(retry.serverCreditsPending, true);
        assert.equal(
            await markPvpRewardServerCreditsCompleted(store as never, 'credit-barrier', 'win', 86_400, 53),
            'completed',
        );
        assert.equal(
            await acknowledgePvpRewardCompletion(store as never, 'credit-barrier', 'win', 86_400, 54),
            'completed',
        );
    });

    it('keeps a legacy no-ACK claim valid while server credits are pending and recovers a lost mark ACK', async () => {
        const { rows, store } = memoryStore({ throwAfterAckCommit: true });
        const reservation = await reservePvpRewardCompletion(
            store as never,
            'legacy-credit-barrier',
            'win',
            false,
            86_400,
            60,
            true,
        );
        assert.deepEqual(reservation, {
            alreadyClaimed: false,
            completionPending: false,
            serverCreditsPending: true,
        });
        assert.equal(pvpRewardCompletionStatus(rows.get('legacy-credit-barrier')), 'pending');
        assert.equal(
            await markPvpRewardServerCreditsCompleted(
                store as never,
                'legacy-credit-barrier',
                'win',
                86_400,
                61,
            ),
            'completed',
        );
        assert.equal(pvpRewardCompletionStatus(rows.get('legacy-credit-barrier')), 'completed');
        assert.deepEqual(
            await reservePvpRewardCompletion(
                store as never,
                'legacy-credit-barrier',
                'win',
                false,
                86_400,
                62,
                true,
            ),
            { alreadyClaimed: true, completionPending: false, serverCreditsPending: false },
        );
    });

    it('binds a new receipt to the supplied immutable terminal deadline', async () => {
        const { rows, store } = memoryStore();
        await reservePvpRewardCompletion(
            store as never,
            'absolute-deadline',
            'loss',
            true,
            999,
            100,
            true,
            500,
        );
        assert.equal((rows.get('absolute-deadline') as { expiresAt: number }).expiresAt, 500);
    });

    it('binds reserve, server-credit mark, and browser ACK to one session generation', async () => {
        const { store } = memoryStore();
        await reservePvpRewardCompletion(
            store as never,
            'generation',
            'win',
            true,
            86_400,
            200,
            true,
            90_000_000,
            100,
        );
        await assert.rejects(
            reservePvpRewardCompletion(
                store as never,
                'generation',
                'win',
                true,
                86_400,
                201,
                true,
                90_000_000,
                101,
            ),
            /generation-conflict/,
        );
        await assert.rejects(
            markPvpRewardServerCreditsCompleted(
                store as never,
                'generation',
                'win',
                86_400,
                202,
                101,
            ),
            /generation-conflict/,
        );
        await assert.rejects(
            acknowledgePvpRewardCompletion(
                store as never,
                'generation',
                'win',
                86_400,
                203,
                101,
            ),
            /generation-conflict/,
        );
        assert.equal(
            await markPvpRewardServerCreditsCompleted(
                store as never,
                'generation',
                'win',
                86_400,
                204,
                100,
            ),
            'completed',
        );
        assert.equal(
            await acknowledgePvpRewardCompletion(
                store as never,
                'generation',
                'win',
                86_400,
                205,
                100,
            ),
            'completed',
        );
    });

    it('rejects exotic receipt prototypes', () => {
        const exotic = Object.assign(Object.create({ inherited: true }), {
            version: 2,
            outcome: 'win',
            claimedAt: 1,
            completionState: 'completed',
            completedAt: 2,
            serverCreditsState: 'completed',
            serverCreditsCompletedAt: 2,
        });
        assert.equal(pvpRewardCompletionStatus(exotic), 'invalid');
    });
});
