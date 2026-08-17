import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { settlePvpConsumablesDurably } from './_consumable-settlement.js';
import { pvpSettlementId } from './_reward-settlement.js';
import type { PvpSession } from './session.js';

const battleId = 'pvp-consumable-12345678';
const session = {
    battleId,
    p1: { name: 'spender' },
    p2: { name: 'other' },
    status: 'done',
    winner: 'p1',
    realFighters: { p1: true, p2: true },
    itemsUsed: { p1: { smoke: 1 }, p2: {} },
    log: [],
    createdAt: 1,
    endedAt: 2,
} as unknown as PvpSession;
const lock = async <T>(_key: string, action: () => Promise<T>) => action();

describe('legacy PvP consumable durable settlement', () => {
    it('treats v1 real-side usage as corruption and needs no mutable inventory debit when empty', async () => {
        const store = _makeMemoryKv();
        const v1 = {
            ...session,
            pvpConsumableAuthorityVersion: 1,
            itemsUsed: { p1: {}, p2: {} },
        } as PvpSession;
        await settlePvpConsumablesDurably(store, v1, lock, { now: 10 });
        await assert.rejects(
            settlePvpConsumablesDurably(store, {
                ...v1,
                itemsUsed: { p1: { smoke: 1 }, p2: {} },
            }, lock, { now: 20 }),
            /pvp-consumable-authority-v1-corrupt/,
        );
    });

    it('fails closed when a sealed used item was moved before claim, then repairs after replenishment', async () => {
        const store = _makeMemoryKv();
        await store.set('save:spender', {
            _saveVersion: 1,
            character: { itemStacks: [], inventory: [] },
        });
        await assert.rejects(
            settlePvpConsumablesDurably(store, session, lock, { now: 10 }),
            /pvp-items-debit-missing/,
        );
        let record = (await store.get<Record<string, unknown>>('save:spender'))!;
        await store.set('save:spender', {
            ...record,
            character: { ...(record.character as object), itemStacks: [{ itemId: 'smoke', count: 1 }] },
        });
        await settlePvpConsumablesDurably(store, session, lock, { now: 20 });
        record = (await store.get<Record<string, unknown>>('save:spender'))!;
        assert.deepEqual((record.character as Record<string, unknown>).itemStacks, []);
    });

    it('does not re-deduct a replenished item after 50+ shared receipts churn', async () => {
        const store = _makeMemoryKv();
        await store.set('save:spender', {
            _saveVersion: 1,
            character: { itemStacks: [{ itemId: 'smoke', count: 2 }], inventory: [] },
        });
        await settlePvpConsumablesDurably(store, session, lock, { now: 10 });
        let record = (await store.get<Record<string, unknown>>('save:spender'))!;
        let character = record.character as Record<string, unknown>;
        assert.equal((character.itemStacks as Array<{ count: number }>)[0].count, 1);

        character = {
            ...character,
            itemStacks: [{ itemId: 'smoke', count: 2 }],
            serverSettlementReceipts: Array.from({ length: 80 }, (_, i) => ({ requestId: `other-${i}` })),
        };
        await store.set('save:spender', { ...record, character });
        await settlePvpConsumablesDurably(store, session, lock, { now: 20 });
        record = (await store.get<Record<string, unknown>>('save:spender'))!;
        assert.equal(((record.character as Record<string, unknown>).itemStacks as Array<{ count: number }>)[0].count, 2);
    });

    it('migrates a generic-only replay without applying the item effect again', async () => {
        const store = _makeMemoryKv();
        const settlementId = pvpSettlementId('items', battleId);
        await store.set('save:spender', {
            _saveVersion: 1,
            character: {
                itemStacks: [{ itemId: 'smoke', count: 1 }],
                inventory: [],
                serverSettlementReceipts: [{
                    requestId: settlementId,
                    fingerprint: 'items',
                    value: { settled: 1 },
                    settledAt: 5,
                }],
            },
        });
        await settlePvpConsumablesDurably(store, session, lock, { now: 10 });
        let record = (await store.get<Record<string, unknown>>('save:spender'))!;
        let character = record.character as Record<string, unknown>;
        assert.equal((character.itemStacks as Array<{ count: number }>)[0].count, 1);
        assert.ok(character.pvpRewardSettlementReceipts);

        character = {
            ...character,
            itemStacks: [{ itemId: 'smoke', count: 2 }],
            serverSettlementReceipts: [],
        };
        await store.set('save:spender', { ...record, character });
        await settlePvpConsumablesDurably(store, session, lock, { now: 20 });
        record = (await store.get<Record<string, unknown>>('save:spender'))!;
        assert.equal(((record.character as Record<string, unknown>).itemStacks as Array<{ count: number }>)[0].count, 2);
    });

    it('does not mistake a precommit CAS failure for a durable backfill acknowledgement', async () => {
        const store = _makeMemoryKv();
        const settlementId = pvpSettlementId('items', battleId);
        await store.set('save:spender', {
            _saveVersion: 1,
            character: {
                itemStacks: [{ itemId: 'smoke', count: 1 }],
                inventory: [],
                serverSettlementReceipts: [{
                    requestId: settlementId,
                    fingerprint: 'items',
                    value: { settled: 1 },
                    settledAt: 5,
                }],
            },
        });
        const originalCompareSet = store.compareSet.bind(store);
        store.compareSet = async () => { throw new Error('forced-precommit-failure'); };
        await assert.rejects(
            settlePvpConsumablesDurably(store, session, lock, { now: 10 }),
            /forced-precommit-failure/,
        );
        const afterFailure = (await store.get<Record<string, unknown>>('save:spender'))!.character as Record<string, unknown>;
        assert.equal(afterFailure.pvpRewardSettlementReceipts, undefined);

        store.compareSet = originalCompareSet;
        await settlePvpConsumablesDurably(store, session, lock, { now: 20 });
        const recovered = (await store.get<Record<string, unknown>>('save:spender'))!.character as Record<string, unknown>;
        assert.ok(recovered.pvpRewardSettlementReceipts);
        assert.equal((recovered.itemStacks as Array<{ count: number }>)[0].count, 1);
    });
});
