import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import type { PvpSession } from './session.js';
import {
    pvpActionReceiptKey,
    replayCommittedPvpActionReceipt,
    withPvpActionReceiptReplay,
} from './_action-receipt-replay.js';

function fighter(name: string, hp: number) {
    return {
        name, hp, maxHp: 100, chakra: 50, maxChakra: 50,
        stamina: 50, maxStamina: 50, shield: 0, statuses: [],
        character: {}, pos: name === 'alice' ? 0 : 1,
    };
}

function session(): PvpSession {
    return {
        battleId: 'receipt-replay-battle',
        stateRevision: 4,
        p1: fighter('alice', 100),
        p2: fighter('bob', 100),
        round: 1,
        activePlayer: 'p1',
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: ['Battle begins.'],
        status: 'active',
        winner: null,
        createdAt: 100,
    };
}

describe('committed PvP action receipt replay', () => {
    it('repairs JSON-roundtripped combat CAS without a marker-before-body gap', async () => {
        const previous = process.env.DISABLE_COMBAT_RECEIPTS;
        process.env.DISABLE_COMBAT_RECEIPTS = '0';
        try {
            const pre = session();
            const post: PvpSession = {
                ...pre,
                p2: { ...pre.p2, hp: 0 },
                ap: { ...pre.ap, p1: 60 },
                actionsThisTurn: 1,
                log: [...pre.log, 'alice attacks.', 'alice wins!'],
                status: 'done',
                winner: 'p1',
            };
            const candidate = withPvpActionReceiptReplay(pre, post, {
                role: 'p1',
                actionId: 'basicAttack',
                actionName: 'Basic Attack',
                actionType: 'basicAttack',
                moveToken: 'move-final',
            }, 500);
            const committed = JSON.parse(JSON.stringify({
                ...candidate,
                stateRevision: 5,
                endedAt: 501,
                recentMoveTokens: ['move-final'],
            })) as PvpSession;
            const rows = new Map<string, unknown>();
            let commits = 0;
            const store = {
                async get<T>(key: string): Promise<T | null> {
                    const value = rows.get(key);
                    return value === undefined ? null : JSON.parse(JSON.stringify(value)) as T;
                },
                async compareSet(key: string, expected: unknown, value: unknown) {
                    const current = rows.has(key) ? rows.get(key) : null;
                    if (!isDeepStrictEqual(current, expected)) return false;
                    rows.set(key, JSON.parse(JSON.stringify(value)));
                    commits += 1;
                    // Model a remote commit whose boolean acknowledgement was lost.
                    return false;
                },
            };

            assert.equal(await replayCommittedPvpActionReceipt(store as never, committed), true);
            assert.equal(await replayCommittedPvpActionReceipt(store as never, committed), true);
            assert.equal(commits, 1);
            const key = pvpActionReceiptKey(committed.battleId, 5);
            const receipt = rows.get(key) as { moveToken?: string; winner?: string; createdAt?: number };
            assert.equal(receipt.moveToken, 'move-final');
            assert.equal(receipt.winner, 'p1');
            assert.equal(receipt.createdAt, 500);
            assert.equal([...rows.keys()].some((keyName) => keyName.includes('receipt:act-tok:')), false,
                'the body key itself is authority; no separate marker may suppress it');
        } finally {
            if (previous === undefined) delete process.env.DISABLE_COMBAT_RECEIPTS;
            else process.env.DISABLE_COMBAT_RECEIPTS = previous;
        }
    });

    it('keeps an older capsule replayable after a non-action revision advances', async () => {
        const previous = process.env.DISABLE_COMBAT_RECEIPTS;
        process.env.DISABLE_COMBAT_RECEIPTS = '0';
        try {
            const pre = session();
            const candidate = withPvpActionReceiptReplay(pre, {
                ...pre,
                log: [...pre.log, 'alice waits.'],
            }, {
                role: 'p1', actionId: 'wait', actionName: 'Wait', actionType: 'wait', moveToken: 'move-wait',
            }, 600);
            const later = { ...candidate, stateRevision: 6 } as PvpSession;
            const rows = new Map<string, unknown>();
            const store = {
                async get<T>(key: string): Promise<T | null> { return (rows.get(key) as T | undefined) ?? null; },
                async compareSet(key: string, expected: unknown, value: unknown) {
                    if ((rows.get(key) ?? null) !== expected) return false;
                    rows.set(key, value);
                    return true;
                },
            };
            assert.equal(await replayCommittedPvpActionReceipt(store as never, later), true);
            assert.ok(rows.has(pvpActionReceiptKey(later.battleId, 5)));
        } finally {
            if (previous === undefined) delete process.env.DISABLE_COMBAT_RECEIPTS;
            else process.env.DISABLE_COMBAT_RECEIPTS = previous;
        }
    });
});
