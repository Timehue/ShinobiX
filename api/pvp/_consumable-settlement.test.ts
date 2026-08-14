import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import { inspectSettlementReceipt } from '../_settlement-receipts.js';
import { pvpSettlementId } from './_reward-settlement.js';
import { settlePvpConsumablesDurably } from './_consumable-settlement.js';
import type { PvpSession } from './session.js';

const BATTLE = 'pvp-consumables-12345678-1234-4123-8123-1234567890ab';
const NOW = 1_800_000_000_000;

function terminalSession(): PvpSession {
    return {
        battleId: BATTLE,
        p1: { name: 'Alice' },
        p2: { name: 'Bob' },
        status: 'done',
        winner: 'p1',
        realFighters: { p1: true, p2: true },
        itemsUsed: {
            p1: { potion: 2, bomb: 1 },
            p2: { potion: 1 },
        },
    } as unknown as PvpSession;
}

function save(name: string) {
    return {
        _saveVersion: 1,
        character: {
            name,
            itemStacks: [
                { itemId: 'potion', count: 2 },
                { itemId: 'bomb', count: 1 },
            ],
            inventory: ['potion', 'bomb', 'keepsake'],
            serverSettlementReceipts: [],
        },
    };
}

const lock = async <T>(_key: string, action: () => Promise<T>): Promise<T> => action();

function character(record: unknown): Record<string, any> {
    return ((record as { character?: unknown })?.character ?? {}) as Record<string, any>;
}

describe('durable PvP consumable settlement', () => {
    it('deducts both real fighters from the terminal without any client claim and replays exactly once', async () => {
        const store = _makeMemoryKv();
        await Promise.all([
            store.set('save:alice', save('Alice')),
            store.set('save:bob', save('Bob')),
        ]);
        const session = terminalSession();

        await settlePvpConsumablesDurably(store, session, lock, { now: NOW });
        const aliceOnce = character(await store.get('save:alice'));
        const bobOnce = character(await store.get('save:bob'));
        assert.deepEqual(aliceOnce.itemStacks, []);
        assert.deepEqual(aliceOnce.inventory, ['potion', 'bomb', 'keepsake']);
        assert.deepEqual(bobOnce.itemStacks, [{ itemId: 'potion', count: 1 }, { itemId: 'bomb', count: 1 }]);
        assert.deepEqual(bobOnce.inventory, ['potion', 'bomb', 'keepsake']);
        const receiptId = pvpSettlementId('items', BATTLE);
        assert.equal(inspectSettlementReceipt(aliceOnce, receiptId, 'items').status, 'replay');
        assert.equal(inspectSettlementReceipt(bobOnce, receiptId, 'items').status, 'replay');

        await settlePvpConsumablesDurably(store, session, lock, { now: NOW + 1 });
        assert.deepEqual(character(await store.get('save:alice')), aliceOnce);
        assert.deepEqual(character(await store.get('save:bob')), bobOnce);
    });

    it('recognizes a committed save whose acknowledgement was lost and does not re-deduct on replay', async () => {
        const base = _makeMemoryKv();
        await Promise.all([
            base.set('save:alice', save('Alice')),
            base.set('save:bob', save('Bob')),
        ]);
        let lost = false;
        const store = {
            ...base,
            async compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) {
                const committed = await base.compareSet(key, expected, value, options);
                if (committed && key === 'save:alice' && !lost) {
                    lost = true;
                    throw new Error('lost-consumable-save-ack');
                }
                return committed;
            },
        } satisfies KvLike;

        await settlePvpConsumablesDurably(store, terminalSession(), lock, { now: NOW });
        assert.equal(lost, true);
        const aliceOnce = character(await base.get('save:alice'));
        assert.deepEqual(aliceOnce.itemStacks, []);

        await settlePvpConsumablesDurably(base, terminalSession(), lock, { now: NOW + 1 });
        assert.deepEqual(character(await base.get('save:alice')), aliceOnce);
    });
});
