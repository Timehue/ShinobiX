import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    buildBattleReceipt,
    mergeSettlement,
    receiptKey,
    receiptWroteKey,
    writeBattleReceipt,
    patchBattleSettlement,
    readBattleReceipt,
    type BattleReceipt,
} from './_receipts.js';
import type { PvpFighter, PvpSession } from './pvp/session.js';

// ─── In-memory KV double (get/set with NX semantics) ──────────────────────────
function makeFakeKv() {
    const store = new Map<string, unknown>();
    return {
        store,
        async get<T = unknown>(key: string): Promise<T | null> {
            return (store.has(key) ? store.get(key) : null) as T | null;
        },
        async set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }): Promise<'OK' | null> {
            if (options?.nx && store.has(key)) return null;
            store.set(key, value);
            return 'OK';
        },
    };
}

function fighter(name: string, hp: number, statuses: PvpFighter['statuses'] = []): PvpFighter {
    return {
        name, hp, maxHp: 1000, chakra: 0, maxChakra: 0, stamina: 0, maxStamina: 0,
        shield: 0, statuses, character: {}, pos: 0,
    };
}

function doneSession(over: Partial<PvpSession> = {}): PvpSession {
    return {
        battleId: 'b1',
        p1: fighter('Alice', 720),
        p2: fighter('Bob', 0, [{ name: 'Poison', rounds: 2, kind: 'negative' }]),
        round: 5,
        activePlayer: 'p1',
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: ['Alice uses Fire Jutsu:', '⚔️ Alice wins!'],
        status: 'done',
        winner: 'p1',
        createdAt: 500,
        ranked: true,
        rankedKind: 'player',
        p1Rating: 1000,
        p2Rating: 1000,
        ...over,
    } as PvpSession;
}

const PRIOR_FLAG = process.env.DISABLE_COMBAT_RECEIPTS;
beforeEach(() => { delete process.env.DISABLE_COMBAT_RECEIPTS; });
afterEach(() => {
    if (PRIOR_FLAG === undefined) delete process.env.DISABLE_COMBAT_RECEIPTS;
    else process.env.DISABLE_COMBAT_RECEIPTS = PRIOR_FLAG;
});

describe('buildBattleReceipt (pure)', () => {
    it('maps session fields, copies the log, and snapshots final statuses', () => {
        const r = buildBattleReceipt(doneSession(), 9999);
        assert.equal(r.battleId, 'b1');
        assert.equal(r.ranked, true);
        assert.equal(r.rankedKind, 'player');
        assert.equal(r.startedAt, 500);
        assert.equal(r.endedAt, 9999);
        assert.equal(r.rounds, 5);
        assert.equal(r.winner, 'p1');
        assert.deepEqual(r.log, ['Alice uses Fire Jutsu:', '⚔️ Alice wins!']);
        assert.equal(r.p1.name, 'Alice');
        assert.equal(r.p1.hp, 720);
        assert.equal(r.p2.hp, 0);
        assert.deepEqual(r.p2.finalStatuses, [{ name: 'Poison', rounds: 2 }]);
        assert.equal(r.settlement, undefined);
    });

    it('does not alias the session log array (copy, not reference)', () => {
        const s = doneSession();
        const r = buildBattleReceipt(s, 1);
        s.log.push('mutated after build');
        assert.equal(r.log.length, 2, 'receipt log should be a snapshot, immune to later session mutation');
    });

    it('floors negative/overshoot hp to a clean non-negative integer', () => {
        const r = buildBattleReceipt(doneSession({ p2: fighter('Bob', -55) }), 1);
        assert.equal(r.p2.hp, 0);
    });
});

describe('writeBattleReceipt (idempotent, best-effort)', () => {
    it('writes the receipt + NX marker the first time a battle resolves', async () => {
        const kv = makeFakeKv();
        const ok = await writeBattleReceipt(doneSession(), { now: 1234, kv });
        assert.equal(ok, true);
        assert.ok(kv.store.has(receiptWroteKey('b1')));
        const stored = kv.store.get(receiptKey('b1')) as BattleReceipt;
        assert.equal(stored.battleId, 'b1');
        assert.equal(stored.endedAt, 1234);
    });

    it('is idempotent — a second resolve does NOT overwrite the receipt', async () => {
        const kv = makeFakeKv();
        await writeBattleReceipt(doneSession(), { now: 1000, kv });
        // Simulate a replayed terminal move with a later timestamp + different log.
        const second = await writeBattleReceipt(
            doneSession({ log: ['REPLAYED'] }),
            { now: 5000, kv },
        );
        assert.equal(second, false, 'NX marker should block the second write');
        const stored = kv.store.get(receiptKey('b1')) as BattleReceipt;
        assert.equal(stored.endedAt, 1000, 'original receipt is preserved');
        assert.deepEqual(stored.log, ['Alice uses Fire Jutsu:', '⚔️ Alice wins!']);
    });

    it('no-ops for an unresolved (still active) session', async () => {
        const kv = makeFakeKv();
        const ok = await writeBattleReceipt(doneSession({ status: 'active', winner: null }), { now: 1, kv });
        assert.equal(ok, false);
        assert.equal(kv.store.size, 0);
    });

    it('no-ops when DISABLE_COMBAT_RECEIPTS=1', async () => {
        process.env.DISABLE_COMBAT_RECEIPTS = '1';
        const kv = makeFakeKv();
        const ok = await writeBattleReceipt(doneSession(), { now: 1, kv });
        assert.equal(ok, false);
        assert.equal(kv.store.size, 0);
    });
});

describe('mergeSettlement (pure)', () => {
    it('merges patch fields and stamps settledAt', () => {
        const base = buildBattleReceipt(doneSession(), 1);
        const merged = mergeSettlement(base, { winnerRyo: 500, winnerXp: 120 }, 42);
        assert.equal(merged.settlement?.winnerRyo, 500);
        assert.equal(merged.settlement?.winnerXp, 120);
        assert.equal(merged.settlement?.settledAt, 42);
    });

    it('preserves prior settlement fields across patches (last-writer-wins per field)', () => {
        const base = buildBattleReceipt(doneSession(), 1);
        const first = mergeSettlement(base, { winnerRyo: 500, settledAt: 10 }, 10);
        const second = mergeSettlement(first, { ratingDelta: 18 }, 20);
        assert.equal(second.settlement?.winnerRyo, 500, 'earlier field survives');
        assert.equal(second.settlement?.ratingDelta, 18);
        assert.equal(second.settlement?.settledAt, 10, 'explicit settledAt is kept');
    });
});

describe('patchBattleSettlement (best-effort)', () => {
    it('patches an existing receipt', async () => {
        const kv = makeFakeKv();
        await writeBattleReceipt(doneSession(), { now: 1, kv });
        await patchBattleSettlement('b1', { winnerRyo: 750, ratingDelta: 16 }, { now: 99, kv });
        const stored = await readBattleReceipt('b1', { kv });
        assert.equal(stored?.settlement?.winnerRyo, 750);
        assert.equal(stored?.settlement?.ratingDelta, 16);
        assert.equal(stored?.settlement?.settledAt, 99);
    });

    it('no-ops when the receipt does not exist', async () => {
        const kv = makeFakeKv();
        await patchBattleSettlement('missing', { winnerRyo: 1 }, { now: 1, kv });
        assert.equal(kv.store.size, 0);
    });
});
