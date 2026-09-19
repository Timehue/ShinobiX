import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/*
 * The sector-war battle ledger past its old 200-receipt ceiling.
 *
 * The 201st battle of a war used to throw `sector-war-battle-receipt-ledger-full`
 * — and because the PvP continuation sits inside the terminal reward barrier,
 * every later sector battle then stalled both fighters' settlement. These tests
 * drive the replacement protocol (api/_sector-war-store.ts
 * commitSectorWarBattle) against the same in-memory KV the other storage tests
 * use, which mirrors production compare-and-set, NX and TTL semantics. Faults
 * are injected at every persistence boundary the protocol introduces, and the
 * lock can be switched off to model a lease that expired mid-write — the case
 * where only the compare-and-set stands between two writers.
 *
 * Every scenario ends in `audit`, which re-derives the tally and every
 * aggregate from the receipts themselves: no battle counted twice, none lost,
 * the garrison cap honoured, capture credit exactly the attacker-side winners.
 */

type KvLike = import('./_storage.js').KvLike;
type War = typeof import('./_sector-war.js');
type Store = typeof import('./_sector-war-store.js');
type Session = import('./_sector-war.js').SectorWarSession;
type Receipt = import('./_sector-war.js').SectorWarBattleReceipt;

let war: War;
let store: Store;
let makeMemoryKv: () => KvLike;

before(async () => {
    ({ _makeMemoryKv: makeMemoryKv } = await import('./_storage.js'));
    war = await import('./_sector-war.js');
    store = await import('./_sector-war-store.js');
});

const T0 = Date.UTC(2026, 8, 1, 12);
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';

type Lock = <T>(key: string, fn: () => Promise<T>) => Promise<T>;
/** A lease that expired: nothing serialises the writers but the CAS. */
const noLock: Lock = (_key, fn) => fn();
/** A lock that holds: the steady-state production path. */
function mutex(): Lock {
    const tails = new Map<string, Promise<unknown>>();
    return async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
        const prev = tails.get(key) ?? Promise.resolve();
        let release!: () => void;
        const mine = new Promise<void>((resolve) => { release = resolve; });
        tails.set(key, prev.then(() => mine));
        await prev;
        try { return await fn(); } finally { release(); }
    };
}

type FaultOp = { op: 'get' | 'compareSet' | 'keys' | 'mget'; key: string; n: number };
type FaultAction = 'ok' | 'throw-before' | 'throw-after';
/** Wrap a store so any call can fail before it happens or after it lands
 *  (a lost response). Counts writes per key. */
function faulty(base: KvLike, fault: (call: FaultOp) => FaultAction = () => 'ok') {
    let n = 0;
    const writes = new Map<string, number>();
    const run = async <T>(op: FaultOp['op'], key: string, fn: () => Promise<T>): Promise<T> => {
        const action = fault({ op, key, n: n++ });
        if (action === 'throw-before') throw new Error(`injected ${op} failure before ${key}`);
        const out = await fn();
        if (action === 'throw-after') throw new Error(`injected lost ${op} response for ${key}`);
        return out;
    };
    const wrapped = {
        writes,
        get: <T = unknown>(key: string) => run('get', key, () => base.get<T>(key)),
        compareSet: (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => run('compareSet', key, async () => {
            const ok = await base.compareSet(key, expected, value, options);
            if (ok) writes.set(key, (writes.get(key) ?? 0) + 1);
            return ok;
        }),
        keys: (pattern: string) => run('keys', pattern, () => base.keys(pattern)),
        mget: <T extends unknown[] = unknown[]>(...keys: string[]) => run('mget', keys.join(','), () => base.mget<T>(...keys)),
    };
    return wrapped;
}

function fresh(overrides: Partial<Session> = {}): Session {
    return {
        ...war.newSectorWarSession({ sector: 23, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'combat', now: T0 }),
        declarationGeneration: 1,
        ...overrides,
    };
}

async function seed(kv: KvLike, session: Session): Promise<Session> {
    await kv.set(war.sectorWarKey(session.id), session);
    return session;
}

type Battle = {
    battleId: string;
    attackerWon: boolean;
    by?: string;
    /** fought against the sealed garrison */
    garrison?: boolean;
    /** an AI mercenary battle */
    merc?: boolean;
    swing?: number;
    at: number;
    /** When the battle began (defaults to `at`); older than the instance ⇒ superseded. */
    startedAt?: number;
};

/** The shape every production caller hands commitSectorWarBattle. */
function score(kv: ReturnType<typeof faulty> | KvLike, contestId: string, b: Battle, lock: Lock = mutex()) {
    return store.commitSectorWarBattle({
        contestId,
        battleId: b.battleId,
        store: kv as never,
        lock,
        now: () => b.at,
        decide: (contest) => {
            if (contest.flipped || contest.expiredAt) return { kind: 'skip', reason: 'terminal' };
            if ((b.startedAt ?? b.at) < contest.startedAt) return { kind: 'skip', reason: 'superseded' };
            const outcome = war.applySectorWarBattle(contest, b.attackerWon, {
                now: b.at,
                roleSwing: b.swing ?? 5,
                by: b.by ?? '',
                garrisonBattle: !!b.garrison && b.attackerWon,
                mercBattle: !!b.merc || (!!b.garrison && !b.attackerWon),
            });
            return { kind: 'score', outcome, attackerWon: b.attackerWon, by: b.by ?? '', garrison: b.garrison, at: b.at };
        },
    });
}

/** Re-derive everything from the receipts and compare with the row. */
async function audit(kv: KvLike, contestId: string, opts: { expectPendingEmpty?: boolean } = {}) {
    const raw = await kv.get<Record<string, unknown>>(war.sectorWarKey(contestId));
    assert.ok(raw, 'contest row exists');
    const session = war.normalizeSectorWarSession(raw as never)!;
    const external = await store.listSectorWarInstanceReceipts(session, kv);
    const mirror = session.appliedBattles ?? [];
    const pending = session.battleLedger?.pending ?? [];
    const all = new Map<string, Receipt>();
    for (const r of [...external, ...mirror, ...pending]) {
        const prior = all.get(r.battleId);
        if (prior) assert.deepEqual(prior, r, `one battle, one set of facts (${r.battleId})`);
        all.set(r.battleId, r);
    }
    const receipts = [...all.values()];
    const sum = (rs: Receipt[]) => rs.reduce((total, r) => total + r.points, 0);
    assert.equal(session.attackerPoints, sum(receipts.filter((r) => r.attackerWon)), 'attacker tally = its receipts');
    assert.equal(session.defenderPoints, sum(receipts.filter((r) => !r.attackerWon)), 'defender tally = its receipts');
    const ledger = war.sectorWarLedgerOf(session);
    assert.equal(ledger.count, receipts.length, 'ledger counts every receipt once');
    assert.equal(ledger.garrisonPoints, sum(receipts.filter((r) => r.garrison && r.attackerWon)));
    assert.equal(war.garrisonPointsInWar(session), ledger.garrisonPoints);
    assert.equal(ledger.lastGarrisonAt, Math.max(0, ...receipts.filter((r) => r.garrison).map((r) => r.at)));
    const contributors = new Set(receipts.filter((r) => r.attackerWon && r.by).map((r) => r.by.toLowerCase()));
    assert.deepEqual(new Set(ledger.contributors.map((name) => name.toLowerCase())), contributors, 'capture credit = attacker-side winners');
    assert.ok(mirror.length <= war.SECTOR_WAR_BATTLE_RECEIPT_CAP, 'the in-row mirror never grows past the cap');
    assert.equal(mirror.length, Math.min(receipts.length, war.SECTOR_WAR_BATTLE_RECEIPT_CAP));
    if (opts.expectPendingEmpty) assert.equal(pending.length, 0, 'every receipt has its external copy');
    return { session, receipts, external, mirror, pending };
}

describe('sector-war ledger: the 200-receipt boundary is no longer a ceiling', { concurrency: false }, () => {
    it('scores the 199th, 200th and 201st unique battles, keeping the first 200 in the row', async () => {
        const kv = makeMemoryKv();
        const contest = await seed(kv, fresh());
        const results = [];
        for (let i = 1; i <= 201; i += 1) {
            const r = await score(kv, contest.id, { battleId: `b-${i}`, attackerWon: i % 3 !== 0, by: `p${i % 7}`, at: T0 + i * 1000 });
            results.push(r);
            if (i === 199 || i === 200 || i === 201) {
                assert.equal(r.status, 'applied', `battle ${i} applies`);
                const { mirror, session } = await audit(kv, contest.id, { expectPendingEmpty: true });
                assert.equal(mirror.length, Math.min(i, 200), `battle ${i}: mirror size`);
                assert.equal(session.battleLedger?.count, i);
            }
        }
        const { session, external } = await audit(kv, contest.id, { expectPendingEmpty: true });
        assert.equal(external.length, 201, 'every battle has an external receipt');
        assert.equal(war.findSectorWarBattleReceipt(session, 'b-201'), null, 'the 201st lives only externally');
        assert.equal((await store.loadSectorWarExternalReceipt(session, 'b-201', kv))?.points, 5);
        assert.ok(session.battleLedger!.count > session.appliedBattles!.length,
            'the ledger knows the war holds receipts the row does not');
        // The mirror is exactly the first 200, newest first — the shape an older
        // release reads as a complete, full ledger.
        assert.deepEqual(session.appliedBattles!.map((r) => r.battleId), Array.from({ length: 200 }, (_, i) => `b-${200 - i}`));
    });

    it('sustains 1,000 legitimate results in one war — every kind of battle — with no drift', async () => {
        const kv = makeMemoryKv();
        const contest = await seed(kv, fresh({ winCondition: 'card' }));
        const cap = war.GARRISON_POINTS_CAP;
        for (let i = 1; i <= 1000; i += 1) {
            const kind = i % 10;
            const battle: Battle = kind === 0
                ? { battleId: `g-${i}`, attackerWon: true, by: `raider${i % 5}`, garrison: true, swing: 20, at: T0 + i * 200 }
                : kind === 1
                    ? { battleId: `g-${i}`, attackerWon: false, by: '', garrison: true, swing: 20, at: T0 + i * 200 }
                    : kind === 2
                        ? { battleId: `m-${i}`, attackerWon: false, by: `holder${i % 3}`, merc: true, swing: 12, at: T0 + i * 200 }
                        : kind === 3
                            ? { battleId: `m-${i}`, attackerWon: true, by: '', merc: true, swing: 5, at: T0 + i * 200 }
                            : { battleId: `pvp-${i}`, attackerWon: i % 2 === 0, by: i % 2 === 0 ? `Raider${i % 11}` : `holder${i % 4}`, swing: 5 + (i % 9), at: T0 + i * 200 };
            const r = await score(kv, contest.id, battle);
            assert.equal(r.status, 'applied', `battle ${i}`);
        }
        const { session, receipts } = await audit(kv, contest.id, { expectPendingEmpty: true });
        assert.equal(receipts.length, 1000);
        assert.equal(war.garrisonPointsInWar(session), cap, 'garrison yield stops exactly at the authored cap, not the storage cap');
        assert.ok(receipts.some((r) => r.garrison && r.attackerWon && r.points === 0), 'capped garrison wins still leave a receipt (the re-form window keys on it)');
        // Replays from both halves of the ledger change nothing.
        for (const id of ['pvp-4', 'g-10', 'm-503', 'pvp-998']) {
            const before = await kv.get(war.sectorWarKey(contest.id));
            const again = await score(kv, contest.id, { battleId: id, attackerWon: true, by: 'someone', swing: 999, at: T0 + 999_999 });
            assert.equal(again.status, 'applied');
            assert.equal(again.status === 'applied' && again.replayed, true, `${id} replays`);
            assert.deepEqual(await kv.get(war.sectorWarKey(contest.id)), before, `${id} replay writes nothing`);
        }
    });
});

describe('sector-war ledger: exactly-once under replay and concurrency', { concurrency: false }, () => {
    it('a delayed replay long after overflow returns the original receipt and scores nothing', async () => {
        const kv = makeMemoryKv();
        const contest = await seed(kv, fresh());
        const first = await score(kv, contest.id, { battleId: 'early', attackerWon: true, by: 'aria', swing: 30, at: T0 + 1 });
        assert.equal(first.status === 'applied' && first.receipt.points, 30);
        for (let i = 0; i < 260; i += 1) await score(kv, contest.id, { battleId: `x-${i}`, attackerWon: false, by: 'kell', at: T0 + 10 + i });
        const late = await score(kv, contest.id, { battleId: 'x-250', attackerWon: false, by: 'kell', swing: 77, at: T0 + 5000 });
        assert.equal(late.status === 'applied' && late.replayed && late.receipt.points, 5, 'overflow receipt dedupes from its external copy');
        const early = await score(kv, contest.id, { battleId: 'early', attackerWon: true, by: 'aria', swing: 77, at: T0 + 5000 });
        assert.equal(early.status === 'applied' && early.replayed && early.receipt.points, 30, 'mirror receipt dedupes in-row');
        await audit(kv, contest.id, { expectPendingEmpty: true });
    });

    it('simultaneous retries of ONE result apply it once, even with no lock', async () => {
        for (const lock of [mutex(), noLock]) {
            const kv = makeMemoryKv();
            const contest = await seed(kv, fresh());
            // Put the war past the mirror so the external receipt is what dedupes.
            for (let i = 0; i < 205; i += 1) await score(kv, contest.id, { battleId: `pre-${i}`, attackerWon: true, by: 'aria', at: T0 + i });
            const settled = await Promise.allSettled(Array.from({ length: 12 }, () => score(kv, contest.id,
                { battleId: 'contested', attackerWon: true, by: 'bo', swing: 9, at: T0 + 10_000 }, lock)));
            const applied = settled.filter((s) => s.status === 'fulfilled' && s.value.status === 'applied');
            const fresh1 = applied.filter((s) => s.status === 'fulfilled' && s.value.status === 'applied' && !s.value.replayed);
            assert.ok(applied.length >= 1);
            assert.equal(fresh1.length, 1, 'exactly one writer applied it');
            for (const s of settled) {
                if (s.status === 'rejected') assert.match(String(s.reason), /version-conflict/, 'losers only ever see a retryable conflict');
            }
            const { receipts } = await audit(kv, contest.id);
            assert.equal(receipts.filter((r) => r.battleId === 'contested').length, 1);
        }
    });

    it('concurrent DIFFERENT results all land, none lost, none doubled', async () => {
        for (const lock of [mutex(), noLock]) {
            const kv = makeMemoryKv();
            const contest = await seed(kv, fresh());
            for (let i = 0; i < 195; i += 1) await score(kv, contest.id, { battleId: `pre-${i}`, attackerWon: i % 2 === 0, by: 'aria', at: T0 + i });
            // 30 writers straddling the mirror boundary at once. A writer that
            // loses every CAS round reports a retryable conflict; callers
            // (help-forward, the client, the next cron tick) retry, so do that.
            const battles = Array.from({ length: 30 }, (_, i) => ({ battleId: `c-${i}`, attackerWon: i % 3 !== 0, by: `p${i}`, swing: 3 + i, at: T0 + 20_000 + i }));
            let remaining = battles;
            for (let round = 0; remaining.length && round < 20; round += 1) {
                const settled = await Promise.allSettled(remaining.map((b) => score(kv, contest.id, b, lock)));
                remaining = remaining.filter((_, i) => settled[i]!.status === 'rejected');
            }
            assert.equal(remaining.length, 0);
            const { receipts } = await audit(kv, contest.id);
            assert.equal(receipts.length, 225);
            for (const b of battles) {
                const r = receipts.find((x) => x.battleId === b.battleId);
                assert.equal(r?.points, b.swing, `${b.battleId} kept its own points`);
            }
        }
    });
});

describe('sector-war ledger: failure at every new persistence boundary', { concurrency: false }, () => {
    async function overflowed(kv: KvLike) {
        const contest = await seed(kv, fresh());
        for (let i = 0; i < 200; i += 1) await score(kv, contest.id, { battleId: `pre-${i}`, attackerWon: true, by: 'aria', at: T0 + i });
        return contest;
    }

    it('a failure BEFORE the commit changes nothing, and the retry applies once', async () => {
        const base = makeMemoryKv();
        const contest = await overflowed(base);
        const before = await base.get(war.sectorWarKey(contest.id));
        const kv = faulty(base, (c) => (c.op === 'compareSet' && c.key === war.sectorWarKey(contest.id) ? 'throw-before' : 'ok'));
        await assert.rejects(score(kv, contest.id, { battleId: 'b', attackerWon: true, by: 'bo', at: T0 + 500 }), /injected compareSet failure/);
        assert.deepEqual(await base.get(war.sectorWarKey(contest.id)), before, 'no tally, no receipt');
        assert.equal(await base.get(war.sectorWarBattleReceiptKey(contest, 'b')), null, 'no external receipt either');
        const retry = await score(base, contest.id, { battleId: 'b', attackerWon: true, by: 'bo', at: T0 + 500 });
        assert.equal(retry.status === 'applied' && retry.replayed, false);
        await audit(base, contest.id, { expectPendingEmpty: true });
    });

    it('a lost response AFTER the commit is recognised, and a retry is a replay', async () => {
        const base = makeMemoryKv();
        const contest = await overflowed(base);
        let tripped = false;
        const kv = faulty(base, (c) => {
            if (!tripped && c.op === 'compareSet' && c.key === war.sectorWarKey(contest.id)) { tripped = true; return 'throw-after'; }
            return 'ok';
        });
        const r = await score(kv, contest.id, { battleId: 'b', attackerWon: true, by: 'bo', swing: 8, at: T0 + 500 });
        assert.equal(r.status === 'applied' && !r.replayed && r.receipt.points, 8, 'the landed write is proven, not repeated');
        const again = await score(base, contest.id, { battleId: 'b', attackerWon: true, by: 'bo', swing: 8, at: T0 + 600 });
        assert.equal(again.status === 'applied' && again.replayed, true);
        await audit(base, contest.id);
    });

    it('a crash BETWEEN the commit and the external copy leaves the battle recoverable, never re-scorable', async () => {
        const base = makeMemoryKv();
        const contest = await overflowed(base);
        const receiptKey = war.sectorWarBattleReceiptKey(contest, 'b');
        const kv = faulty(base, (c) => (c.op === 'compareSet' && c.key === receiptKey ? 'throw-before' : 'ok'));
        const r = await score(kv, contest.id, { battleId: 'b', attackerWon: false, by: 'kell', swing: 11, at: T0 + 500 });
        assert.equal(r.status, 'applied', 'the points are in: the receipt is durable in the row');
        const mid = await audit(base, contest.id);
        assert.deepEqual(mid.pending.map((p) => p.battleId), ['b'], 'the receipt waits in the write-ahead list');
        assert.equal(await base.get(receiptKey), null);
        // Replays during the gap see it in the row.
        const replay = await score(kv, contest.id, { battleId: 'b', attackerWon: false, by: 'kell', swing: 11, at: T0 + 600 });
        assert.equal(replay.status === 'applied' && replay.replayed, true);
        // "Restart": the next writer finishes the copy and retires the entry.
        const next = await score(base, contest.id, { battleId: 'c', attackerWon: true, by: 'bo', at: T0 + 700 });
        assert.equal(next.status, 'applied');
        const after = await audit(base, contest.id, { expectPendingEmpty: true });
        assert.ok(after.external.some((e) => e.battleId === 'b'), 'the deferred copy landed');
    });

    it('settlement is a restart path too: it drains pending receipts before the war goes terminal', async () => {
        const base = makeMemoryKv();
        const contest = await overflowed(base);
        const receiptKey = war.sectorWarBattleReceiptKey(contest, 'b');
        const kv = faulty(base, (c) => (c.op === 'compareSet' && c.key === receiptKey ? 'throw-before' : 'ok'));
        await score(kv, contest.id, { battleId: 'b', attackerWon: true, by: 'bo', at: T0 + 500 });
        const row = war.normalizeSectorWarSession((await base.get(war.sectorWarKey(contest.id))) as never)!;
        const drained = await store.drainSectorWarLedger(row, T0 + 1000, base);
        assert.deepEqual(drained.battleLedger?.pending, []);
        assert.equal(drained.battleLedger?.mirrorExternalized, true);
        assert.ok(await base.get(receiptKey), 'the pending receipt has its external copy');
    });

    it('a failure while clearing the pending entry is harmless: the next writer retires it', async () => {
        const base = makeMemoryKv();
        const contest = await overflowed(base);
        let contestWrites = 0;
        const kv = faulty(base, (c) => {
            if (c.op === 'compareSet' && c.key === war.sectorWarKey(contest.id)) {
                contestWrites += 1;
                if (contestWrites === 2) return 'throw-before'; // step 4's clear
            }
            return 'ok';
        });
        const r = await score(kv, contest.id, { battleId: 'b', attackerWon: true, by: 'bo', at: T0 + 500 });
        assert.equal(r.status, 'applied');
        assert.equal((await audit(base, contest.id)).pending.length, 1);
        await score(base, contest.id, { battleId: 'c', attackerWon: true, by: 'bo', at: T0 + 600 });
        await audit(base, contest.id, { expectPendingEmpty: true });
    });
});

describe('sector-war ledger: legacy rows migrate without re-awarding anything', { concurrency: false }, () => {
    function legacyReceipts(n: number, offset = 0): Receipt[] {
        return Array.from({ length: n }, (_, i) => ({
            battleId: `legacy-${offset + i}`,
            attackerWon: i % 4 !== 0,
            points: 7,
            by: i % 4 === 0 ? 'holder' : `Legacy${i % 6}`,
            ...(i % 25 === 0 ? { garrison: true as const } : {}),
            at: T0 + offset + i,
        })).reverse(); // stored newest-first
    }
    function legacyRow(receipts: Receipt[]): Session {
        return fresh({
            appliedBattles: receipts,
            attackerPoints: receipts.filter((r) => r.attackerWon).reduce((t, r) => t + r.points, 0),
            defenderPoints: receipts.filter((r) => !r.attackerWon).reduce((t, r) => t + r.points, 0),
        });
    }

    for (const size of [0, 150, 200]) {
        it(`a pre-ledger row with ${size} receipts: duplicates rejected before AND after migration, tally untouched`, async () => {
            const kv = makeMemoryKv();
            const receipts = legacyReceipts(size);
            const row = await seed(kv, legacyRow(receipts));
            if (size) {
                const before = await score(kv, row.id, { battleId: receipts[0]!.battleId, attackerWon: true, by: 'x', swing: 99, at: T0 + 9000 });
                assert.equal(before.status === 'applied' && before.replayed, true, 'pre-migration replay');
                assert.equal(await kv.get(war.sectorWarKey(row.id)).then((r) => (r as Session).battleLedger), undefined, 'a replay does not even migrate');
            }
            const fresh1 = await score(kv, row.id, { battleId: 'new', attackerWon: true, by: 'bo', swing: 4, at: T0 + 9000 });
            assert.equal(fresh1.status === 'applied' && !fresh1.replayed, true);
            const migrated = await audit(kv, row.id, { expectPendingEmpty: true });
            assert.equal(migrated.session.attackerPoints, row.attackerPoints + 4, 'only the new battle added points');
            assert.equal(migrated.session.defenderPoints, row.defenderPoints);
            assert.equal(migrated.session.battleLedger?.mirrorExternalized, size === 0, 'legacy mirror copies wait for the terminal drain');
            if (size) {
                const after = await score(kv, row.id, { battleId: receipts[size - 1]!.battleId, attackerWon: true, by: 'x', swing: 99, at: T0 + 9100 });
                assert.equal(after.status === 'applied' && after.replayed, true, 'post-migration replay');
            }
            const again = await score(kv, row.id, { battleId: 'new', attackerWon: true, by: 'bo', swing: 4, at: T0 + 9200 });
            assert.equal(again.status === 'applied' && again.replayed, true);
            // The terminal drain copies every legacy receipt out, idempotently.
            const drained = await store.drainSectorWarLedger(migrated.session, T0 + 10_000, kv);
            const drainedAgain = await store.drainSectorWarLedger(drained, T0 + 10_000, kv);
            assert.deepEqual(drainedAgain, drained);
            assert.equal((await store.listSectorWarInstanceReceipts(migrated.session, kv)).length, size + 1);
        });
    }

    it('an interrupted migration (copying 200 legacy receipts) resumes idempotently', async () => {
        const kv0 = makeMemoryKv();
        const receipts = legacyReceipts(200);
        const row = await seed(kv0, legacyRow(receipts));
        let writes = 0;
        const flaky = faulty(kv0, (c) => (c.op === 'compareSet' && c.key.startsWith(war.SECTOR_WAR_BATTLE_RECEIPT_PREFIX) && ++writes === 90 ? 'throw-before' : 'ok'));
        const session = war.normalizeSectorWarSession((await kv0.get(war.sectorWarKey(row.id))) as never)!;
        await assert.rejects(store.drainSectorWarLedger(session, T0 + 10_000, flaky as never), /injected/);
        assert.deepEqual(await kv0.get(war.sectorWarKey(row.id)), row, 'the row itself is untouched by a failed drain');
        const drained = await store.drainSectorWarLedger(session, T0 + 10_000, kv0);
        assert.equal((await store.listSectorWarInstanceReceipts(session, kv0)).length, 200);
        assert.equal(drained.battleLedger?.count, 200);
        assert.equal(drained.attackerPoints, row.attackerPoints);
    });

    it('rebuilds the aggregates when a pre-ledger writer drops them from an overflowed row', async () => {
        // During a rolling deploy (or after a rollback) a writer without the
        // ledger rebuilds the row from the fields it knows, dropping
        // battleLedger. Below the cap the mirror is complete; at the cap the
        // overflow receipts are read back from their external copies.
        const kv = makeMemoryKv();
        const contest = await seed(kv, fresh());
        for (let i = 0; i < 230; i += 1) {
            await score(kv, contest.id, { battleId: `b-${i}`, attackerWon: i % 5 !== 0, by: `p${i % 9}`, garrison: i % 50 === 0, swing: 6, at: T0 + i });
        }
        const truth = await audit(kv, contest.id, { expectPendingEmpty: true });
        const { battleLedger: _dropped, ...oldWriterRow } = truth.session;
        await kv.set(war.sectorWarKey(contest.id), oldWriterRow);
        const next = await score(kv, contest.id, { battleId: 'b-229', attackerWon: false, by: 'p1', swing: 50, at: T0 + 5000 });
        assert.equal(next.status === 'applied' && next.replayed, true, 'an overflow receipt still dedupes after the drop');
        const later = await score(kv, contest.id, { battleId: 'after', attackerWon: true, by: 'late', at: T0 + 5000 });
        assert.equal(later.status === 'applied' && !later.replayed, true);
        const rebuilt = await audit(kv, contest.id, { expectPendingEmpty: true });
        assert.equal(rebuilt.session.battleLedger?.count, 231);
        assert.equal(rebuilt.session.battleLedger?.garrisonPoints, truth.session.battleLedger?.garrisonPoints);
    });
});

describe('sector-war ledger: contest instances never share receipts', { concurrency: false }, () => {
    it('a re-siege that restarts at generation 1 still gets its own namespace', async () => {
        const kv = makeMemoryKv();
        const first = await seed(kv, fresh());
        for (let i = 0; i < 210; i += 1) await score(kv, first.id, { battleId: `w1-${i}`, attackerWon: true, by: 'aria', at: T0 + i });
        // The defended record aged out, so the next declaration minted
        // generation 1 again — same contest id, same generation.
        const second = await seed(kv, fresh({ startedAt: T0 + 5 * 86_400_000, endsAt: T0 + 8 * 86_400_000, updatedAt: T0 + 5 * 86_400_000 }));
        assert.equal(second.id, first.id);
        assert.equal(second.declarationGeneration, first.declarationGeneration);
        assert.notEqual(war.sectorWarInstanceTag(second), war.sectorWarInstanceTag(first));
        // A delayed battle from the first war never scores the second, and it
        // is not mistaken for a replay either.
        const stale = await score(kv, second.id, { battleId: 'w1-late', attackerWon: true, by: 'aria', startedAt: T0 + 1000, at: second.startedAt + 10 });
        assert.equal(stale.status === 'skipped' && stale.reason, 'superseded');
        const w1Replay = await score(kv, second.id, { battleId: 'w1-205', attackerWon: true, by: 'aria', startedAt: T0 + 205, at: second.startedAt + 10 });
        assert.equal(w1Replay.status === 'skipped' && w1Replay.reason, 'superseded', 'the first war\'s receipts are invisible to the second');
        const own = await score(kv, second.id, { battleId: 'w2-1', attackerWon: false, by: 'kell', at: second.startedAt + 20 });
        assert.equal(own.status, 'applied');
        const audited = await audit(kv, second.id, { expectPendingEmpty: true });
        assert.equal(audited.receipts.length, 1);
        assert.equal((await store.listSectorWarInstanceReceipts(first, kv)).length, 210, 'the first war\'s evidence is retained, under its own tag');
    });
});

describe('sector-war ledger: terminal wars and end-time eligibility', { concurrency: false }, () => {
    it('never writes a settled or conceded row (its cooldown TTL must survive)', async () => {
        for (const terminal of [{ flipped: true }, { expiredAt: T0 + 1000, expiredReason: 'defended' as const }]) {
            const base = makeMemoryKv();
            const contest = await seed(base, fresh(terminal));
            const kv = faulty(base);
            const r = await score(kv, contest.id, { battleId: 'late', attackerWon: true, by: 'bo', at: T0 + 2000 });
            assert.equal(r.status === 'skipped' && r.reason, 'terminal');
            assert.equal(kv.writes.size, 0, 'no write of any kind');
        }
    });

    it('past endsAt but unsettled, a battle still records a zero-point receipt, as before', async () => {
        const kv = makeMemoryKv();
        const contest = await seed(kv, fresh());
        const r = await score(kv, contest.id, { battleId: 'overtime', attackerWon: true, by: 'bo', at: contest.endsAt + 5 });
        assert.equal(r.status === 'applied' && r.receipt.points, 0);
        const { session } = await audit(kv, contest.id, { expectPendingEmpty: true });
        assert.equal(session.attackerPoints, 0);
        assert.deepEqual(session.battleLedger?.contributors, ['bo'], 'capture-credit attribution is unchanged from the full-ledger era');
    });

    it('external receipts outlive the contest end by the retention window', () => {
        const contest = fresh();
        const writtenAt = contest.startedAt + 1000;
        const ttl = war.sectorWarBattleReceiptTtlSeconds(contest, writtenAt);
        assert.equal(ttl, Math.ceil((contest.endsAt - writtenAt + war.SECTOR_WAR_BATTLE_RECEIPT_RETENTION_MS) / 1000));
        // Longer than every replay horizon it has to cover (the PvP resolution
        // receipt, recovery snapshot and token each live ~48h).
        assert.ok(war.sectorWarBattleReceiptTtlSeconds(contest, contest.endsAt + 3 * 86_400_000) > 4 * 86_400);
    });
});

describe('sector-war ledger: strict readers', () => {
    it('rejects malformed ledgers instead of trusting them', () => {
        const base = fresh();
        const good = war.sectorWarLedgerFromReceipts([], 0);
        for (const bad of [
            { ...good, version: 2 },
            { ...good, count: -1 },
            { ...good, extra: true },
            { ...good, mirrorCount: 201, count: 201 },
            { ...good, contributors: ['a', 'A'] },
            { ...good, pending: Array.from({ length: war.SECTOR_WAR_LEDGER_PENDING_CAP + 1 }, (_, i) => ({ battleId: `p${i}`, attackerWon: true, points: 1, by: '', at: 1 })) },
            { ...good, pending: [{ battleId: 'x', attackerWon: true, points: 1, by: '', at: 1, hpDealt: 1 }] },
        ]) {
            assert.throws(() => war.normalizeSectorWarSession({ ...base, battleLedger: bad } as never), /ledger-invalid/);
        }
        // A pending receipt that contradicts its own mirror entry is corruption.
        const mirrorEntry = { battleId: 'same', attackerWon: true, points: 5, by: 'a', at: 10 };
        assert.throws(() => war.normalizeSectorWarSession({
            ...base,
            appliedBattles: [mirrorEntry],
            battleLedger: { ...war.sectorWarLedgerFromReceipts([mirrorEntry], 1), pending: [{ ...mirrorEntry, points: 6 }] },
        } as never), /ledger-invalid/);
    });

    it('parses exactly the versioned external receipt shape', () => {
        const contest = fresh();
        const value = war.sectorWarExternalBattleReceipt(contest, { battleId: 'b', attackerWon: true, points: 3, by: 'a', at: 5 });
        assert.deepEqual(war.parseSectorWarExternalBattleReceipt(JSON.parse(JSON.stringify(value))), value);
        assert.equal(war.parseSectorWarExternalBattleReceipt({ ...value, version: 2 }), null);
        assert.equal(war.parseSectorWarExternalBattleReceipt({ ...value, extra: 1 }), null);
        assert.equal(war.parseSectorWarExternalBattleReceipt({ ...value, receipt: { ...value.receipt, forged: true } }), null);
        // Identity ignores the informational tally snapshot.
        assert.equal(war.sameSectorWarExternalBattleReceipt(value, { ...value, tally: { attackerPoints: 99, defenderPoints: 1 } }), true);
        assert.equal(war.sameSectorWarExternalBattleReceipt(value, { ...value, receipt: { ...value.receipt, points: 4 } }), false);
    });

    it('fails closed when a different set of facts already sits under a battle\'s receipt key', async () => {
        const kv = makeMemoryKv();
        const contest = await seed(kv, fresh());
        for (let i = 0; i < 200; i += 1) await score(kv, contest.id, { battleId: `pre-${i}`, attackerWon: true, by: 'aria', at: T0 + i });
        const forged = war.sectorWarExternalBattleReceipt(contest, { battleId: 'b', attackerWon: false, points: 50, by: 'kell', at: 7 });
        await kv.set(war.sectorWarBattleReceiptKey(contest, 'b'), forged);
        // The pre-existing receipt dedupes the battle — nothing is re-scored or overwritten.
        const r = await score(kv, contest.id, { battleId: 'b', attackerWon: true, by: 'bo', at: T0 + 500 });
        assert.equal(r.status === 'applied' && r.replayed, true);
        assert.deepEqual(await kv.get(war.sectorWarBattleReceiptKey(contest, 'b')), forged);
    });
});

describe('sector-war ledger: public projections stay bounded', () => {
    it('the client view carries neither ledger nor any receipt, however large the war', () => {
        let session = fresh();
        for (let i = 0; i < 260; i += 1) {
            const out = war.applySectorWarBattle(session, true, { now: T0 + i, roleSwing: 5, by: `p${i}` });
            session = war.recordSectorWarBattleOutcome(out, { battleId: `b-${i}`, attackerWon: true, by: `p${i}`, at: T0 + i }).session;
        }
        const view = war.projectSectorWarForClient(session, ATTACKER) as Record<string, unknown>;
        assert.equal(view.appliedBattles, undefined);
        assert.equal(view.battleLedger, undefined);
        const encoded = JSON.stringify(view);
        assert.ok(!encoded.includes('p259'), 'no per-player attribution leaks');
        assert.ok(encoded.length < 1000, `projection stays small (${encoded.length} bytes)`);
    });
});
