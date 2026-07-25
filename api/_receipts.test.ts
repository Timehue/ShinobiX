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
    buildActionReceipt,
    writeActionReceipt,
    readActionReceipts,
    actionReceiptKey,
    actionSeqKey,
    actionTokenKey,
    type BattleReceipt,
    type ActionReceiptInput,
    buildActionDisplay,
    sanitizeImageRef,
    buildHistorySummary,
    mergeHistoryEntry,
    indexBattleForParticipants,
    readBattleHistory,
    historyKey,
    HISTORY_MAX_ENTRIES,
    RECEIPT_TTL_SEC,
    type BattleHistorySummary,
} from './_receipts.js';
import type { PvpFighter, PvpSession } from './pvp/session.js';

// ─── In-memory KV double (get/set/incr/keys/mget with NX semantics) ──────────
function makeFakeKv() {
    const store = new Map<string, unknown>();
    const ttl = new Map<string, number | undefined>();
    return {
        store,
        ttl,
        async get<T = unknown>(key: string): Promise<T | null> {
            return (store.has(key) ? store.get(key) : null) as T | null;
        },
        async set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }): Promise<'OK' | null> {
            if (options?.nx && store.has(key)) return null;
            store.set(key, value);
            ttl.set(key, options?.ex);
            return 'OK';
        },
        async incr(key: string): Promise<number> {
            const next = (Number(store.get(key)) || 0) + 1;
            store.set(key, next);
            return next;
        },
        async keys(pattern: string): Promise<string[]> {
            const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
            return [...store.keys()].filter((k) => re.test(k));
        },
        async mget<T = unknown>(...keys: string[]): Promise<(T | null)[]> {
            return keys.map((k) => (store.has(k) ? (store.get(k) as T) : null));
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

// ─── Per-action combat receipts ───────────────────────────────────────────────

function activeSession(over: Partial<PvpSession> = {}): PvpSession {
    return {
        battleId: 'b1',
        p1: fighter('Alice', 1000),
        p2: fighter('Bob', 1000),
        round: 1,
        activePlayer: 'p1',
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: ['⚔️ Alice vs Bob — Battle begins!'],
        status: 'active',
        winner: null,
        createdAt: 500,
        ...over,
    } as PvpSession;
}

// A standard "Alice casts a 60-AP jutsu at Bob for 320 damage" transition.
function castInput(over: Partial<ActionReceiptInput> = {}): ActionReceiptInput {
    const pre = activeSession();
    const post: PvpSession = {
        ...pre,
        p1: { ...pre.p1, pos: 5 },                 // actor moved a tile
        p2: { ...pre.p2, hp: 680 },                // target took 320
        ap: { p1: 40, p2: 100 },                   // spent 60 AP
        log: [...pre.log, 'Alice uses Fireball: flames roar to life!', 'Bob takes 320 damage.'],
    };
    return { pre, post, role: 'p1', actionId: 'fireball', actionName: 'Fireball', actionType: 'jutsu', ...over };
}

describe('buildActionReceipt (pure)', () => {
    it('captures the action name, its narrative lines, and compact deltas', () => {
        const r = buildActionReceipt(castInput({ moveToken: 'mt1' }), 1, 9999);
        assert.equal(r.battleId, 'b1');
        assert.equal(r.seq, 1);
        assert.equal(r.round, 1);
        assert.equal(r.moveToken, 'mt1');
        assert.equal(r.actorRole, 'p1');
        assert.equal(r.actorName, 'Alice');
        assert.equal(r.targetRole, 'p2');
        assert.equal(r.targetName, 'Bob');
        assert.equal(r.actionId, 'fireball');
        assert.equal(r.actionName, 'Fireball');
        assert.equal(r.actionType, 'jutsu');
        assert.equal(r.result, 'applied');
        // Flavor/cast line first, then what it did — exactly this action's suffix.
        assert.deepEqual(r.summaryLines, ['Alice uses Fireball: flames roar to life!', 'Bob takes 320 damage.']);
        assert.equal(r.targetDelta.hp, -320);
        assert.equal(r.actorDelta.pos, 5);
        assert.equal(r.actorDelta.hp, undefined, 'unchanged vitals are omitted');
        assert.equal(r.apSpent, 60);
        assert.equal(r.winner, undefined, 'winner only set on the terminal action');
        assert.equal(r.createdAt, 9999);
    });

    it('classifies the terminal action as battle_end and records the winner', () => {
        const input = castInput();
        input.post = { ...input.post, p2: { ...input.post.p2, hp: 0 }, status: 'done', winner: 'p1' };
        const r = buildActionReceipt(input, 7, 1);
        assert.equal(r.result, 'battle_end');
        assert.equal(r.winner, 'p1');
    });
});

describe('writeActionReceipt (append-only, idempotent, best-effort)', () => {
    it('assigns a monotonic seq and stores one receipt per committed action', async () => {
        const kv = makeFakeKv();
        const first = await writeActionReceipt(castInput({ moveToken: 'mt1' }), { now: 1, kv });
        const second = await writeActionReceipt(castInput({ moveToken: 'mt2', role: 'p2', actionName: 'Counter' }), { now: 2, kv });
        assert.equal(first?.seq, 1);
        assert.equal(second?.seq, 2);
        assert.equal(kv.store.get(actionSeqKey('b1')), 2);
        assert.ok(kv.store.has(actionReceiptKey('b1', 1)));
        assert.ok(kv.store.has(actionReceiptKey('b1', 2)));
    });

    it('is idempotent per moveToken — a retried move does NOT append twice', async () => {
        const kv = makeFakeKv();
        await writeActionReceipt(castInput({ moveToken: 'mt1' }), { now: 1, kv });
        const retry = await writeActionReceipt(castInput({ moveToken: 'mt1' }), { now: 2, kv });
        assert.equal(retry, null, 'the NX token marker blocks the duplicate');
        assert.equal(kv.store.get(actionSeqKey('b1')), 1, 'seq did not advance on the retry');
        assert.ok(kv.store.has(actionTokenKey('b1', 'mt1')));
    });

    it('still records tokenless actions (e.g. auto-wait), incrementing seq each time', async () => {
        const kv = makeFakeKv();
        const a = await writeActionReceipt(castInput(), { now: 1, kv });
        const b = await writeActionReceipt(castInput(), { now: 2, kv });
        assert.equal(a?.seq, 1);
        assert.equal(b?.seq, 2);
    });

    it('no-ops when DISABLE_COMBAT_RECEIPTS=1', async () => {
        process.env.DISABLE_COMBAT_RECEIPTS = '1';
        const kv = makeFakeKv();
        const r = await writeActionReceipt(castInput({ moveToken: 'mt1' }), { now: 1, kv });
        assert.equal(r, null);
        assert.equal(kv.store.size, 0);
    });
});

describe('readActionReceipts (ordered by seq)', () => {
    it('returns every action receipt for a battle in seq order', async () => {
        const kv = makeFakeKv();
        await writeActionReceipt(castInput({ moveToken: 'mt1' }), { now: 1, kv });
        await writeActionReceipt(castInput({ moveToken: 'mt2' }), { now: 2, kv });
        await writeActionReceipt(castInput({ moveToken: 'mt3' }), { now: 3, kv });
        const entries = await readActionReceipts('b1', { kv });
        assert.equal(entries.length, 3);
        assert.deepEqual(entries.map((e) => e.seq), [1, 2, 3]);
    });

    it('returns [] for a battle with no receipts', async () => {
        const kv = makeFakeKv();
        assert.deepEqual(await readActionReceipts('nope', { kv }), []);
    });
});

// ─── Phase 1: server-owned presentation metadata ─────────────────────────────
//
// `display` exists so a battle log can show "Blazing Dragon Arc" instead of the
// raw id `starter-nin-fire-2`, and so the client can pick an icon without the
// receipt carrying art. Every field is optional: the 90 days of receipts written
// before this shipped must keep rendering.

describe('sanitizeImageRef (receipt payload safety)', () => {
    it('accepts a rooted static asset path', () => {
        assert.equal(sanitizeImageRef('/starter-avatar-one.webp'), '/starter-avatar-one.webp');
    });

    it('accepts a short /api/img reference', () => {
        assert.equal(sanitizeImageRef('/api/img?id=jutsu:fireball'), '/api/img?id=jutsu:fireball');
    });

    it('accepts an absolute https URL', () => {
        assert.equal(sanitizeImageRef('https://img.shinobijourney.com/a.webp'), 'https://img.shinobijourney.com/a.webp');
    });

    it('DROPS a data: URL so base64 art can never bloat a 90-day receipt', () => {
        assert.equal(sanitizeImageRef('data:image/webp;base64,UklGRk5DAABXRUJQ'), undefined);
    });

    it('drops other unsafe schemes and protocol-relative hosts', () => {
        assert.equal(sanitizeImageRef('javascript:alert(1)'), undefined);
        assert.equal(sanitizeImageRef('http://insecure.example/a.png'), undefined);
        assert.equal(sanitizeImageRef('blob:https://x/y'), undefined);
        assert.equal(sanitizeImageRef('//evil.host/a.png'), undefined);
    });

    it('drops an oversized reference rather than storing it', () => {
        assert.equal(sanitizeImageRef('/a' + 'b'.repeat(400) + '.webp'), undefined);
    });
});

describe('buildActionDisplay (optional, clamped)', () => {
    it('keeps label + category and the optional element/discipline', () => {
        const d = buildActionDisplay({ label: 'Blazing Dragon Arc', category: 'jutsu', element: 'Fire', discipline: 'Ninjutsu' });
        assert.equal(d?.label, 'Blazing Dragon Arc');
        assert.equal(d?.category, 'jutsu');
        assert.equal(d?.element, 'Fire');
        assert.equal(d?.discipline, 'Ninjutsu');
        assert.equal(d?.imageRef, undefined, 'no image supplied → field stays absent');
    });

    it('returns undefined without a usable label or category', () => {
        assert.equal(buildActionDisplay(undefined), undefined);
        assert.equal(buildActionDisplay({ category: 'jutsu' }), undefined);
        assert.equal(buildActionDisplay({ label: '   ', category: 'jutsu' }), undefined);
        assert.equal(buildActionDisplay({ label: 'Thing' }), undefined);
    });

    it('clamps a pathological label instead of persisting it whole', () => {
        const d = buildActionDisplay({ label: 'x'.repeat(500), category: 'jutsu' });
        assert.ok(d && d.label.length <= 80, `label should be clamped, got ${d?.label.length}`);
    });

    it('strips an unsafe image reference but keeps the rest of the block', () => {
        const d = buildActionDisplay({ label: 'Fireball', category: 'jutsu', imageRef: 'data:image/png;base64,AAAA' });
        assert.equal(d?.label, 'Fireball');
        assert.equal(d?.imageRef, undefined);
    });
});

describe('buildActionReceipt display metadata', () => {
    it('carries the server-resolved display block onto the receipt', () => {
        const input = castInput();
        input.display = { label: 'Blazing Dragon Arc', category: 'jutsu', element: 'Fire', discipline: 'Ninjutsu' };
        const r = buildActionReceipt(input, 1, 1);
        assert.equal(r.display?.label, 'Blazing Dragon Arc');
        assert.equal(r.display?.category, 'jutsu');
        assert.equal(r.display?.element, 'Fire');
    });

    it('omits display entirely when the caller supplies none (legacy receipts)', () => {
        const r = buildActionReceipt(castInput(), 1, 1);
        assert.equal(r.display, undefined, 'absent, not an empty object');
    });

    it('never lets a data: image reach the stored receipt', () => {
        const input = castInput();
        input.display = { label: 'Fireball', category: 'jutsu', imageRef: 'data:image/webp;base64,UklGRg' };
        const r = buildActionReceipt(input, 1, 1);
        assert.equal(r.display?.imageRef, undefined);
        assert.ok(!JSON.stringify(r).includes('base64'), 'no base64 payload anywhere in the receipt');
    });
});

// ─── Phase 2: durable per-player battle history index ────────────────────────
//
// A BattleReceipt is findable by battleId, but nothing let a player LIST their
// battles once the 15-min session died. These tests pin the contract that makes
// a finished fight survive: both participants indexed, newest first, capped, and
// idempotent so a retried terminal settlement can't duplicate a row.

function receiptFor(overrides: Partial<BattleReceipt> = {}): BattleReceipt {
    return {
        battleId: 'b1',
        ranked: false,
        startedAt: 1_000,
        endedAt: 2_000,
        rounds: 4,
        p1: { name: 'Alice', hp: 120, maxHp: 500, finalStatuses: [] },
        p2: { name: 'Bob', hp: 0, maxHp: 480, finalStatuses: [] },
        winner: 'p1',
        log: [],
        ...overrides,
    };
}

// Pass-through lock: the production call injects api/_lock.ts withKvLock; the
// serialization itself is that module's contract, not this one's.
const passThroughLock = async <T,>(_target: string, fn: () => Promise<T>) => fn();

describe('buildHistorySummary (participant-relative)', () => {
    it('describes the battle from the WINNER side', () => {
        const s = buildHistorySummary(receiptFor(), 'p1');
        assert.equal(s.battleId, 'b1');
        assert.equal(s.opponent, 'Bob');
        assert.equal(s.outcome, 'win');
        assert.equal(s.rounds, 4);
        assert.equal(s.ranked, false);
        assert.equal(s.mode, 'PvP');
    });

    it('describes the SAME battle from the loser side', () => {
        const s = buildHistorySummary(receiptFor(), 'p2');
        assert.equal(s.opponent, 'Alice');
        assert.equal(s.outcome, 'loss');
        assert.equal(s.winner, 'p1', 'absolute winner is preserved alongside the relative outcome');
    });

    it('marks a draw for both sides', () => {
        assert.equal(buildHistorySummary(receiptFor({ winner: 'draw' }), 'p1').outcome, 'draw');
        assert.equal(buildHistorySummary(receiptFor({ winner: 'draw' }), 'p2').outcome, 'draw');
    });

    it('records a flee against the fleeing player only', () => {
        const r = receiptFor({ winner: 'p2', fleedBy: 'p1' });
        assert.equal(buildHistorySummary(r, 'p1').outcome, 'flee');
        assert.equal(buildHistorySummary(r, 'p2').outcome, 'win');
    });

    it('labels a ranked battle', () => {
        const s = buildHistorySummary(receiptFor({ ranked: true }), 'p1');
        assert.equal(s.ranked, true);
        assert.equal(s.mode, 'Ranked');
    });
});

describe('mergeHistoryEntry (newest first, deduped, capped)', () => {
    it('puts the newest battle first', () => {
        const older = buildHistorySummary(receiptFor({ battleId: 'old', endedAt: 1 }), 'p1');
        const newer = buildHistorySummary(receiptFor({ battleId: 'new', endedAt: 9 }), 'p1');
        const merged = mergeHistoryEntry([older], newer);
        assert.deepEqual(merged.map((e) => e.battleId), ['new', 'old']);
    });

    it('DEDUPES by battleId so a retried settlement cannot duplicate a row', () => {
        const entry = buildHistorySummary(receiptFor(), 'p1');
        const once = mergeHistoryEntry([], entry);
        const twice = mergeHistoryEntry(once, entry);
        assert.equal(twice.length, 1);
    });

    it('caps the list, dropping the oldest', () => {
        let list: BattleHistorySummary[] = [];
        for (let i = 0; i < HISTORY_MAX_ENTRIES + 10; i++) {
            list = mergeHistoryEntry(list, buildHistorySummary(receiptFor({ battleId: `b${i}`, endedAt: i }), 'p1'));
        }
        assert.equal(list.length, HISTORY_MAX_ENTRIES);
        assert.equal(list[0].battleId, `b${HISTORY_MAX_ENTRIES + 9}`, 'newest retained');
        assert.ok(!list.some((e) => e.battleId === 'b0'), 'oldest dropped');
    });

    it('tolerates a missing/corrupt existing list', () => {
        const entry = buildHistorySummary(receiptFor(), 'p1');
        assert.equal(mergeHistoryEntry(null, entry).length, 1);
        assert.equal(mergeHistoryEntry(undefined, entry).length, 1);
    });
});

describe('indexBattleForParticipants (both sides, idempotent, best-effort)', () => {
    it('indexes BOTH participants under their own keys', async () => {
        const kv = makeFakeKv();
        const res = await indexBattleForParticipants(receiptFor(), { kv, lock: passThroughLock });
        assert.deepEqual(res, { p1: true, p2: true });
        const alice = await readBattleHistory('alice', { kv });
        const bob = await readBattleHistory('bob', { kv });
        assert.equal(alice[0].opponent, 'Bob');
        assert.equal(alice[0].outcome, 'win');
        assert.equal(bob[0].opponent, 'Alice');
        assert.equal(bob[0].outcome, 'loss');
    });

    it('is IDEMPOTENT — a retried terminal settlement adds no duplicate', async () => {
        const kv = makeFakeKv();
        await indexBattleForParticipants(receiptFor(), { kv, lock: passThroughLock });
        await indexBattleForParticipants(receiptFor(), { kv, lock: passThroughLock });
        await indexBattleForParticipants(receiptFor(), { kv, lock: passThroughLock });
        assert.equal((await readBattleHistory('alice', { kv })).length, 1);
        assert.equal((await readBattleHistory('bob', { kv })).length, 1);
    });

    it('accumulates distinct battles newest-first', async () => {
        const kv = makeFakeKv();
        await indexBattleForParticipants(receiptFor({ battleId: 'b1', endedAt: 10 }), { kv, lock: passThroughLock });
        await indexBattleForParticipants(receiptFor({ battleId: 'b2', endedAt: 20 }), { kv, lock: passThroughLock });
        const alice = await readBattleHistory('alice', { kv });
        assert.deepEqual(alice.map((e) => e.battleId), ['b2', 'b1']);
    });

    it('never throws when the store fails — history is display-only', async () => {
        const failing = {
            async get() { throw new Error('kv down'); },
            async set() { throw new Error('kv down'); },
        } as unknown as NonNullable<Parameters<typeof indexBattleForParticipants>[1]>['kv'];
        const res = await indexBattleForParticipants(receiptFor(), { kv: failing, lock: passThroughLock });
        assert.deepEqual(res, { p1: false, p2: false }, 'reports failure without throwing into the combat path');
    });

    it('applies the 90-day receipt TTL to the index', async () => {
        const kv = makeFakeKv();
        await indexBattleForParticipants(receiptFor(), { kv, lock: passThroughLock });
        assert.equal(kv.ttl.get(historyKey('alice')), RECEIPT_TTL_SEC);
    });

    it('skips a battle with no id', async () => {
        const kv = makeFakeKv();
        const res = await indexBattleForParticipants(receiptFor({ battleId: '' }), { kv, lock: passThroughLock });
        assert.deepEqual(res, { p1: false, p2: false });
    });
});

describe('readBattleHistory', () => {
    it('returns an empty list for a player with no battles', async () => {
        const kv = makeFakeKv();
        assert.deepEqual(await readBattleHistory('nobody', { kv }), []);
    });

    it('filters out corrupt rows rather than surfacing them', async () => {
        const kv = makeFakeKv();
        await kv.set(historyKey('alice'), [null, { battleId: '' }, { battleId: 'ok', opponent: 'Bob' }]);
        const list = await readBattleHistory('alice', { kv });
        assert.equal(list.length, 1);
        assert.equal(list[0].battleId, 'ok');
    });
});
