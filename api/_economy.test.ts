import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { drainBackgroundWork } from './_background-work.js';
import { assertKvLockContext, currentKvLockContext, poisonKvLockContext, withKvLeaseContext } from './_kv-lock-context.js';
import {
    recordEconomyTxn,
    readEconomySnapshot,
    applyTxnToAgg,
    duplicateTxnIds,
    econAggKey,
    econDayKey,
    econPlayerDayKey,
    econPlayerIndexKey,
    econExchangeSampleKey,
    econUtcDay,
    foldSourceCount,
    isHighFrequencyEconSource,
    readPlayerEconomyDays,
    summarizePlayerEconomy,
    recordExchangeResourceSale,
    exchangeResourceSample,
    addExchangeSample,
    weightedMedian,
    exchangeWindowStat,
    summarizeExchangeResources,
    readExchangeResourceReport,
    ECON_TXN_LIST_KEY,
    MAX_ECON_TXNS,
    ECON_DAY_TTL_SECONDS,
    ECON_PLAYER_DAY_TTL_SECONDS,
    ECON_EXPLOIT_RYO_PER_DAY,
    ECON_EXPLOIT_FS_PER_DAY,
    EXCHANGE_SAMPLE_DAILY_CAP,
    EXCHANGE_SAMPLE_PAIR_DAILY_CAP,
    EXCHANGE_SAMPLE_TTL_SECONDS,
    EXCHANGE_GIFT_FLOOR_RYO,
    type EconTxn,
    type EconPlayerDayRow,
    type ExchangeResourceSample,
} from './_economy.js';
import { BLACK_MARKET_DIAL_LOOP_THRESHOLD } from './_black-market-loop.js';

// Minimal in-memory KV with just get/set (what _economy needs). `_ex` keeps the
// TTL each key was last written with.
function memKv() {
    const m = new Map<string, unknown>();
    const ex = new Map<string, number | undefined>();
    return {
        async get<T>(k: string): Promise<T | null> { return (m.has(k) ? structuredClone(m.get(k)) : null) as T | null; },
        async set(k: string, v: unknown, options?: { ex?: number }): Promise<'OK'> { m.set(k, structuredClone(v)); ex.set(k, options?.ex); return 'OK' as const; },
        _m: m,
        _ex: ex,
    };
}

test('applyTxnToAgg routes + to created and − to destroyed; ignores zero', () => {
    assert.deepEqual(applyTxnToAgg({ created: 0, destroyed: 0 }, 100), { created: 100, destroyed: 0 });
    assert.deepEqual(applyTxnToAgg({ created: 100, destroyed: 0 }, -30), { created: 100, destroyed: 30 });
    assert.deepEqual(applyTxnToAgg({ created: 5, destroyed: 5 }, 0), { created: 5, destroyed: 5 });
});

test('recordEconomyTxn accumulates created/destroyed and writes a capped recent list', async () => {
    const store = memKv();
    await recordEconomyTxn({ txnId: 'a', player: 'rill', currency: 'ryo', delta: 2500, source: 'bank.interest' }, { kv: store });
    await recordEconomyTxn({ txnId: 'b', player: 'rill', currency: 'ryo', delta: -250, source: 'trade.burn' }, { kv: store });
    const agg = store._m.get(econAggKey('ryo'));
    assert.deepEqual(agg, { created: 2500, destroyed: 250 });
    const list = store._m.get(ECON_TXN_LIST_KEY) as EconTxn[];
    assert.equal(list.length, 2);
    assert.equal(list[0].txnId, 'b', 'newest-first');
});

test('recordEconomyTxn is a no-op for zero delta and unknown currency', async () => {
    const store = memKv();
    await recordEconomyTxn({ txnId: 'z', player: 'p', currency: 'ryo', delta: 0, source: 's' }, { kv: store });
    await recordEconomyTxn({ txnId: 'u', player: 'p', currency: 'doubloons', delta: 99, source: 's' }, { kv: store });
    assert.equal(store._m.get(ECON_TXN_LIST_KEY), undefined);
    assert.equal(store._m.get(econAggKey('ryo')), undefined);
});

test('duplicateTxnIds flags replays', () => {
    const txns = [
        { txnId: 'x', ts: 1, player: 'p', currency: 'ryo', delta: 1, source: 's' },
        { txnId: 'y', ts: 2, player: 'p', currency: 'ryo', delta: 1, source: 's' },
        { txnId: 'x', ts: 3, player: 'p', currency: 'ryo', delta: 1, source: 's' },
    ] as EconTxn[];
    assert.deepEqual(duplicateTxnIds(txns), ['x']);
});

test('readEconomySnapshot reports net supply per currency + dup flags', async () => {
    const store = memKv();
    await recordEconomyTxn({ txnId: 'm1', player: 'rill', currency: 'ryo', delta: 1000, source: 'bank.interest' }, { kv: store });
    await recordEconomyTxn({ txnId: 'm1', player: 'rill', currency: 'ryo', delta: 1000, source: 'bank.interest' }, { kv: store }); // replay
    await recordEconomyTxn({ txnId: 's1', player: 'rill', currency: 'ryo', delta: -400, source: 'trade.burn' }, { kv: store });
    const snap = await readEconomySnapshot(50, { kv: store });
    assert.deepEqual(snap.aggregates.ryo, { created: 2000, destroyed: 400, net: 1600 });
    assert.deepEqual(snap.duplicateTxnIds, ['m1']);
    assert.equal(snap.recent.length, 3);
    assert.deepEqual(snap.today.ryo, { 'bank.interest': { c: 2000, d: 0, n: 2 }, 'trade.burn': { c: 0, d: 400, n: 1 } });
    assert.equal(snap.players?.window.activePlayers, 1);
    assert.equal(snap.exchange?.series.length, 14);
});

test('concurrent economy projections preserve aggregate and recent-list counts', async () => {
    const store = memKv();
    await Promise.all(Array.from({ length: 20 }, (_, i) => recordEconomyTxn({
        txnId: `concurrent-${i}`, player: 'rill', currency: 'ryo', delta: 10, source: 'test',
    }, { kv: store })));
    assert.deepEqual(store._m.get(econAggKey('ryo')), { created: 200, destroyed: 0 });
    assert.equal((store._m.get(ECON_TXN_LIST_KEY) as EconTxn[]).length, 20);
});

test('detached economy projection survives parent completion and remains tracked for shutdown', async () => {
    const store = memKv();
    const originalGet = store.get;
    let unblock!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    store.get = async <T>(key: string): Promise<T | null> => {
        entered();
        await blocked;
        assert.equal(currentKvLockContext(), undefined, 'injected telemetry store must not inherit the save lease');
        assertKvLockContext();
        return originalGet<T>(key);
    };
    let pending!: Promise<void>;
    await withKvLeaseContext('lock:save:economy-observation', 'parent', async () => {
        pending = recordEconomyTxn({ txnId: 'detached', player: 'rill', currency: 'ryo', delta: 17, source: 'test' }, { kv: store });
        await started;
    });
    let drained = false;
    const drain = drainBackgroundWork().then(() => { drained = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(drained, false, 'storage shutdown must wait for admitted telemetry');
    unblock();
    await pending;
    await drain;
    assert.deepEqual(store._m.get(econAggKey('ryo')), { created: 17, destroyed: 0 });
});

test('failed economy telemetry has independent poison and cannot revive a poisoned currency writer', async () => {
    const store = memKv();
    const failure = new Error('telemetry storage failed');
    store.get = async () => withKvLeaseContext('lock:telemetry:economy-test', 'telemetry', async () => {
        throw poisonKvLockContext(currentKvLockContext()!, failure);
    });
    await withKvLeaseContext('lock:save:economy-poison', 'parent', async () => {
        const parent = currentKvLockContext()!;
        await recordEconomyTxn({ txnId: 'failed', player: 'rill', currency: 'ryo', delta: 17, source: 'test' }, { kv: store });
        assert.equal(parent.health.error, undefined, 'telemetry failure must not poison the real currency write');
        assertKvLockContext();
        store._m.set('save:rill', { ryo: 50 });
        const parentFailure = poisonKvLockContext(parent, new Error('currency lease lost'));
        await recordEconomyTxn({ txnId: 'already-poisoned', player: 'rill', currency: 'ryo', delta: 17, source: 'test' }, { kv: store });
        assert.throws(() => assertKvLockContext(), (error) => error === parentFailure);
        assert.deepEqual(store._m.get('save:rill'), { ryo: 50 });
    });
    assert.equal(store._m.has(ECON_TXN_LIST_KEY), false);
    assert.equal(store._m.has(econAggKey('ryo')), false);
});

// ─── Write-amplification guard (BTEI-09) ──────────────────────────────────────

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 9, 17, 12);
const TODAY = econUtcDay(NOW);

test('high-frequency sources update the aggregates, day and player rows but skip the recent list', async () => {
    assert.equal(isHighFrequencyEconSource('pvp.win'), true);
    assert.equal(isHighFrequencyEconSource('mission.claim'), true);
    assert.equal(isHighFrequencyEconSource('trade.burn'), false);
    assert.equal(isHighFrequencyEconSource('dungeon.clear'), false);
    const store = memKv();
    await recordEconomyTxn({ txnId: 'pvp-1', player: 'rill', currency: 'ryo', delta: 810, source: 'pvp.win', ts: NOW }, { kv: store });
    assert.deepEqual(store._m.get(econAggKey('ryo')), { created: 810, destroyed: 0 });
    assert.deepEqual(store._m.get(econDayKey(TODAY, 'ryo')), { 'pvp.win': { c: 810, d: 0, n: 1 } });
    assert.deepEqual(store._m.get(econPlayerDayKey(TODAY, 'rill')), { ryo: { 'pvp.win': { c: 810, d: 0, n: 1 } } });
    assert.equal(store._m.has(ECON_TXN_LIST_KEY), false, 'a high-frequency txn must not rewrite the recent list');
    // The caller can force either way.
    await recordEconomyTxn({ txnId: 'pvp-2', player: 'rill', currency: 'ryo', delta: 5, source: 'pvp.win', ts: NOW }, { kv: store, list: true });
    await recordEconomyTxn({ txnId: 'burn-1', player: 'rill', currency: 'ryo', delta: -5, source: 'trade.burn', ts: NOW }, { kv: store, list: false });
    assert.deepEqual((store._m.get(ECON_TXN_LIST_KEY) as EconTxn[]).map((t) => t.txnId), ['pvp-2']);
});

test('the day and player rows fold created, destroyed and count by source, with their TTLs', async () => {
    const store = memKv();
    await recordEconomyTxn({ txnId: 'a', player: 'Rill', currency: 'ryo', delta: 300, source: 'bank.interest', ts: NOW }, { kv: store });
    await recordEconomyTxn({ txnId: 'b', player: 'rill', currency: 'ryo', delta: -120, source: 'cafeteria.meal', ts: NOW }, { kv: store });
    await recordEconomyTxn({ txnId: 'c', player: 'rill', currency: 'ryo', delta: -80, source: 'cafeteria.meal', ts: NOW }, { kv: store });
    await recordEconomyTxn({ txnId: 'd', player: 'kaze', currency: 'fateShards', delta: 2, source: 'daily.login', ts: NOW }, { kv: store });
    assert.deepEqual(store._m.get(econDayKey(TODAY, 'ryo')), {
        'bank.interest': { c: 300, d: 0, n: 1 },
        'cafeteria.meal': { c: 0, d: 200, n: 2 },
    });
    assert.deepEqual(store._m.get(econPlayerDayKey(TODAY, 'rill')), {
        ryo: { 'bank.interest': { c: 300, d: 0, n: 1 }, 'cafeteria.meal': { c: 0, d: 200, n: 2 } },
    });
    assert.deepEqual(store._m.get(econPlayerIndexKey(TODAY)), ['rill', 'kaze'], 'each player is indexed once');
    assert.equal(store._ex.get(econDayKey(TODAY, 'ryo')), ECON_DAY_TTL_SECONDS);
    assert.equal(store._ex.get(econPlayerDayKey(TODAY, 'rill')), ECON_PLAYER_DAY_TTL_SECONDS);
    assert.equal(store._ex.get(econPlayerIndexKey(TODAY)), ECON_PLAYER_DAY_TTL_SECONDS);
    assert.deepEqual(foldSourceCount({}, 's', 0), {}, 'a zero delta folds nothing');
});

test('the recent list holds at most 1,000 txns, newest first', async () => {
    assert.equal(MAX_ECON_TXNS, 1000);
    const store = memKv();
    store._m.set(ECON_TXN_LIST_KEY, Array.from({ length: MAX_ECON_TXNS }, (_, i) => ({ ts: i, txnId: `old-${i}`, player: 'p', currency: 'ryo', delta: 1, source: 'trade.burn' })));
    await recordEconomyTxn({ txnId: 'newest', player: 'p', currency: 'ryo', delta: -1, source: 'trade.burn', ts: NOW }, { kv: store });
    const list = store._m.get(ECON_TXN_LIST_KEY) as EconTxn[];
    assert.equal(list.length, MAX_ECON_TXNS);
    assert.equal(list[0].txnId, 'newest');
    assert.equal(list[list.length - 1].txnId, `old-${MAX_ECON_TXNS - 2}`);
});

test('listed and unlisted txns racing on one currency keep the aggregate exact', async () => {
    // One lock per currency guards econ:agg on both paths, so neither path can
    // read a stale aggregate and overwrite the other's update.
    const store = memKv();
    await Promise.all(Array.from({ length: 40 }, (_, i) => recordEconomyTxn({
        txnId: `race-${i}`, player: `p${i % 4}`, currency: 'ryo', delta: i % 2 ? 7 : -3, source: i % 2 ? 'pvp.win' : 'trade.burn', ts: NOW,
    }, { kv: store })));
    assert.deepEqual(store._m.get(econAggKey('ryo')), { created: 140, destroyed: 60 });
    assert.deepEqual(store._m.get(econDayKey(TODAY, 'ryo')), { 'pvp.win': { c: 140, d: 0, n: 20 }, 'trade.burn': { c: 0, d: 60, n: 20 } });
    assert.equal((store._m.get(ECON_TXN_LIST_KEY) as EconTxn[]).length, 20, 'only the burns are listed');
    assert.deepEqual((store._m.get(econPlayerIndexKey(TODAY)) as string[]).sort(), ['p0', 'p1', 'p2', 'p3']);
    const p1 = store._m.get(econPlayerDayKey(TODAY, 'p1')) as EconPlayerDayRow;
    assert.deepEqual(p1.ryo?.['pvp.win'], { c: 70, d: 0, n: 10 });
});

test('Exchange transfer legs stay out of the faucet/sink aggregate; the fee is the sink', async () => {
    const store = memKv();
    await recordEconomyTxn({ txnId: 'x:buy', player: 'buyer', currency: 'ryo', delta: -1000, source: 'sunscar.exchange', ts: NOW }, { kv: store });
    await recordEconomyTxn({ txnId: 'x:sell', player: 'seller', currency: 'ryo', delta: 950, source: 'sunscar.exchange', ts: NOW }, { kv: store });
    assert.equal(store._m.has(econAggKey('ryo')), false, 'a transfer neither creates nor destroys currency');
    await recordEconomyTxn({ txnId: 'x:fee', player: 'seller', currency: 'ryo', delta: -50, source: 'exchange.fee', ts: NOW }, { kv: store });
    assert.deepEqual(store._m.get(econAggKey('ryo')), { created: 0, destroyed: 50 });
    assert.deepEqual(store._m.get(econDayKey(TODAY, 'ryo')), {
        'sunscar.exchange': { c: 950, d: 1000, n: 2 },
        'exchange.fee': { c: 0, d: 50, n: 1 },
    }, 'the day row keeps transfer volume for drill-down');
    assert.equal((store._m.get(ECON_TXN_LIST_KEY) as EconTxn[]).length, 3);
});

test('a junk timestamp falls back to now instead of throwing out of the telemetry path', async () => {
    const store = memKv();
    await recordEconomyTxn({ txnId: 'junk-ts', player: 'p', currency: 'ryo', delta: 5, source: 'trade.burn', ts: Number.NaN }, { kv: store });
    await recordEconomyTxn({ txnId: 'huge-ts', player: 'p', currency: 'ryo', delta: 5, source: 'trade.burn', ts: 1e300 }, { kv: store });
    assert.deepEqual(store._m.get(econAggKey('ryo')), { created: 10, destroyed: 0 });
});

// ─── Per-player readout (framework 8.4) ───────────────────────────────────────

test('the PvP purse percentiles and the exploit alarm come from the player-day rows', async () => {
    const store = memKv();
    // Ten fighters with purses of 100..1,000 ryo, recorded unlisted.
    for (let i = 1; i <= 10; i++) {
        await recordEconomyTxn({ txnId: `win-${i}`, player: `fighter${i}`, currency: 'ryo', delta: i * 100, source: 'pvp.win', ts: NOW }, { kv: store });
    }
    await recordEconomyTxn({ txnId: 'whale', player: 'whale', currency: 'ryo', delta: ECON_EXPLOIT_RYO_PER_DAY + 1, source: 'mission.claim', ts: NOW }, { kv: store });
    await recordEconomyTxn({ txnId: 'shards', player: 'shards', currency: 'fateShards', delta: ECON_EXPLOIT_FS_PER_DAY + 1, source: 'mission.claim', ts: NOW }, { kv: store });
    // An Exchange sale is a transfer, not a faucet: a big seller is not an exploit.
    await recordEconomyTxn({ txnId: 'sale', player: 'trader', currency: 'ryo', delta: 5_000_000, source: 'sunscar.exchange', ts: NOW }, { kv: store });
    await recordEconomyTxn({ txnId: 'meal', player: 'fighter1', currency: 'ryo', delta: -50, source: 'cafeteria.meal', ts: NOW }, { kv: store });
    await recordEconomyTxn({ txnId: 'yday', player: 'shards', currency: 'fateShards', delta: 9, source: 'daily.login', ts: NOW - DAY_MS }, { kv: store });

    const days = await readPlayerEconomyDays([econUtcDay(NOW - DAY_MS), TODAY], { kv: store });
    const summary = summarizePlayerEconomy(days);
    const today = summary.days.find((d) => d.date === TODAY)!;
    assert.deepEqual(today.pvpPurse, { n: 10, p50: 500, p90: 900, p99: 1000, max: 1000 });
    assert.deepEqual(today.exploitAlarms.map((a) => a.player).sort(), ['shards', 'whale']);
    assert.equal(today.activePlayers, 13);
    assert.equal(today.sourcePlayers['pvp.win'], 10);
    assert.equal(summary.window.activePlayers, 13);
    assert.equal(summary.window.fateShardsEarned?.max, ECON_EXPLOIT_FS_PER_DAY + 1 + 9, 'FS earned sums across the window');
    assert.deepEqual(summary.window.sinkPlayers['cafeteria.meal'], { players: 1, share: 1 / 13 });
    assert.equal(summary.window.sinkPlayers['sunscar.exchange'], undefined, 'a transfer is not a sink');
});

// ─── Exchange thermometer (BTEI-07) ───────────────────────────────────────────

function sale(over: Partial<Parameters<typeof exchangeResourceSample>[0]> = {}) {
    return { id: 'lot-1', seller: 'seller', buyer: 'buyer', asset: { kind: 'resource', id: 'fateShards' }, quantity: 3, price: 390_000, currency: 'ryo', fee: 19_500, completedAt: NOW, ...over };
}
function sample(over: Partial<ExchangeResourceSample> = {}): ExchangeResourceSample {
    return { id: `s-${Math.random().toString(36).slice(2)}`, r: 'fateShards', cur: 'ryo', p: 130_000, q: 1, pair: 'a|b', fee: 6_500, ts: NOW, ...over };
}

test('a sold resource lot becomes one sample; anything else records nothing', () => {
    assert.deepEqual(exchangeResourceSample(sale()), { id: 'lot-1', r: 'fateShards', cur: 'ryo', p: 130_000, q: 3, pair: 'buyer|seller', fee: 19_500, ts: NOW });
    assert.equal(exchangeResourceSample(sale({ asset: { kind: 'item', id: 'fateShards' } })), null, 'an item listing is not a price sample');
    assert.equal(exchangeResourceSample(sale({ asset: { kind: 'resource', id: 'honorSeals' } })), null);
    assert.equal(exchangeResourceSample(sale({ buyer: undefined })), null);
    assert.equal(exchangeResourceSample(sale({ asset: { kind: 'resource', id: 'boneCharms' }, currency: 'fateShards', price: 4, quantity: 20 }))?.p, 0);
});

test('samples are de-duplicated by listing and capped per day and per pair', () => {
    let samples: ExchangeResourceSample[] = [];
    const first = sample({ id: 'one' });
    samples = addExchangeSample(samples, first);
    assert.equal(addExchangeSample(samples, { ...first, p: 1 }), samples, 'a repeated listing id is ignored');
    for (let i = 0; i < EXCHANGE_SAMPLE_PAIR_DAILY_CAP + 5; i++) samples = addExchangeSample(samples, sample({ id: `pair-${i}`, pair: 'wash|trade' }));
    assert.equal(samples.filter((s) => s.pair === 'wash|trade').length, EXCHANGE_SAMPLE_PAIR_DAILY_CAP, 'one pair cannot fill the day');
    for (let i = 0; samples.length < EXCHANGE_SAMPLE_DAILY_CAP; i++) samples = addExchangeSample(samples, sample({ id: `fill-${i}`, pair: `x${i}|y${i}` }));
    assert.equal(addExchangeSample(samples, sample({ id: 'over', pair: 'late|pair' })).length, EXCHANGE_SAMPLE_DAILY_CAP);
});

test('recordExchangeResourceSale stores the day sample with its TTL, once per listing', async () => {
    const store = memKv();
    await recordExchangeResourceSale(sale(), { kv: store });
    await recordExchangeResourceSale(sale(), { kv: store });
    await recordExchangeResourceSale(sale({ id: 'item-lot', asset: { kind: 'item', id: 'rustfang-kunai' } }), { kv: store });
    const key = econExchangeSampleKey(TODAY);
    assert.deepEqual((store._m.get(key) as ExchangeResourceSample[]).map((s) => [s.id, s.p, s.q]), [['lot-1', 130_000, 3]]);
    assert.equal(store._ex.get(key), EXCHANGE_SAMPLE_TTL_SECONDS);
});

test('weightedMedian weights by quantity and takes the lower median at an exact half', () => {
    assert.equal(weightedMedian([{ p: 120_000, w: 10 }, { p: 200_000, w: 1 }, { p: 200_000, w: 1 }]), 120_000);
    assert.equal(weightedMedian([{ p: 300, w: 1 }, { p: 100, w: 1 }, { p: 200, w: 1 }]), 200);
    assert.equal(weightedMedian([{ p: 100, w: 1 }, { p: 200, w: 1 }]), 100);
    assert.equal(weightedMedian([]), null);
});

test('a window needs 5 sales from 3 pairs before it reports a median', () => {
    const fixed = EXCHANGE_GIFT_FLOOR_RYO.fateShards;
    const four = ['a|b', 'c|d', 'e|f', 'g|h'].map((pair) => sample({ pair }));
    assert.deepEqual([exchangeWindowStat(four, 'fateShards', fixed).median, exchangeWindowStat(four, 'fateShards', fixed).reason], [null, 'insufficient-data']);
    const twoPairs = [...Array(5)].map((_, i) => sample({ pair: i % 2 ? 'a|b' : 'c|d' }));
    assert.equal(exchangeWindowStat(twoPairs, 'fateShards', fixed).median, null);
    const enough = ['a|b', 'c|d', 'e|f', 'a|b', 'c|d'].map((pair) => sample({ pair }));
    assert.equal(exchangeWindowStat(enough, 'fateShards', fixed).median, 130_000);
});

test('one colluding pair cannot steer the median, at any price or quantity', () => {
    const fixed = EXCHANGE_GIFT_FLOOR_RYO.fateShards;
    const honest = ['a|b', 'c|d', 'e|f', 'g|h', 'i|j'].map((pair) => sample({ pair }));
    // A 9,999-FS lot at a high price weighs 10 units, then the 20% pair cap.
    const whaleHigh = sample({ pair: 'wash|alt', q: 9_999, p: 300_000 });
    assert.equal(exchangeWindowStat([...honest, whaleHigh], 'fateShards', fixed).median, 130_000);
    // A 9,999-FS lot sold for 1 ryo is gift-priced: out of the median entirely.
    const giftLot = sample({ pair: 'wash|alt', q: 9_999, p: 0, fee: 0 });
    const withGift = exchangeWindowStat([...honest, giftLot], 'fateShards', fixed);
    assert.equal(withGift.median, 130_000);
    assert.equal(withGift.belowFloor, 1);
    // In a thin market (three pairs) every pair is held to the smallest pair's weight.
    const thin = [sample({ pair: 'a|b' }), sample({ pair: 'a|b' }), sample({ pair: 'c|d' }), sample({ pair: 'c|d' }), whaleHigh];
    assert.equal(exchangeWindowStat(thin, 'fateShards', fixed).median, 130_000);
});

function daysOf(perDay: (daysAgo: number) => ExchangeResourceSample[], span = 14): Record<string, ExchangeResourceSample[]> {
    const out: Record<string, ExchangeResourceSample[]> = {};
    for (let daysAgo = 0; daysAgo < span; daysAgo++) out[econUtcDay(NOW - daysAgo * DAY_MS)] = perDay(daysAgo);
    return out;
}
const fivePairs = (p: number, daysAgo: number) => ['a|b', 'c|d', 'e|f', 'g|h', 'i|j'].map((pair, i) => sample({ id: `d${daysAgo}-${i}`, pair, p, fee: Math.floor(p * 0.05), ts: NOW - daysAgo * DAY_MS }));

test('the 14-day series trips the black-market dial only after 7 days at the loop threshold', () => {
    const hot = summarizeExchangeResources(daysOf((d) => fivePairs(200_000, d)), TODAY);
    assert.equal(hot.series.length, 14);
    assert.equal(hot.series[13].date, TODAY);
    assert.equal(hot.series[13].trailing7.fateShards.median, 200_000);
    assert.ok(hot.series[13].loopProduct! > 1, 'a 200k FS median makes the pull print ryo');
    assert.deepEqual(hot.series[13].loopAssumed, ['boneCharms', 'auraStones']);
    assert.equal(hot.blackMarketDial.trip, true);
    assert.ok(hot.blackMarketDial.consecutiveDays >= 7);

    // Six hot days are not seven.
    const sixHot = summarizeExchangeResources(daysOf((d) => fivePairs(d < 6 ? 200_000 : 100_000, d)), TODAY);
    assert.ok(sixHot.series[13].loopProduct! >= BLACK_MARKET_DIAL_LOOP_THRESHOLD);
    assert.equal(sixHot.blackMarketDial.trip, false);

    const cool = summarizeExchangeResources(daysOf((d) => fivePairs(100_000, d)), TODAY);
    assert.ok(cool.series[13].loopProduct! < BLACK_MARKET_DIAL_LOOP_THRESHOLD);
    assert.equal(cool.blackMarketDial.consecutiveDays, 0);
});

test('no data never trips the dial or the weekly-move revert', () => {
    const empty = summarizeExchangeResources({}, TODAY);
    assert.equal(empty.series[13].trailing7.fateShards.median, null);
    assert.equal(empty.series[13].loopProduct, null);
    assert.equal(empty.blackMarketDial.trip, false);
    assert.equal(empty.fsMedianWeekMove, null);
    assert.equal(empty.fsMedianWeekMoveAlarm, false);
});

test('a 25%+ week-on-week FS median move raises the revert alarm', () => {
    const moved = summarizeExchangeResources(daysOf((d) => fivePairs(d < 7 ? 140_000 : 100_000, d)), TODAY);
    assert.ok(Math.abs(moved.fsMedianWeekMove! - 0.4) < 1e-9, String(moved.fsMedianWeekMove));
    assert.equal(moved.fsMedianWeekMoveAlarm, true);
    const steady = summarizeExchangeResources(daysOf((d) => fivePairs(d < 7 ? 110_000 : 100_000, d)), TODAY);
    assert.equal(steady.fsMedianWeekMoveAlarm, false);
});

test('gift-priced resource lots are listed for review, never silently averaged in', () => {
    const days = daysOf((d) => fivePairs(130_000, d));
    days[TODAY] = [...days[TODAY], sample({ id: 'gift', pair: 'main|alt', q: 9_999, p: 0, fee: 0 })];
    const report = summarizeExchangeResources(days, TODAY);
    assert.equal(report.series[13].trailing7.fateShards.median, 130_000);
    assert.deepEqual(report.giftPricedSales.map((s) => [s.id, s.pair, s.q, s.date]), [['gift', 'main|alt', 9_999, TODAY]]);
    // The relative floor: 25% of the trailing-30-day median.
    assert.equal(report.series[13].trailing7.fateShards.floor, 32_500);
});

test('readExchangeResourceReport reads the recorded samples back by day', async () => {
    const store = memKv();
    const pairs = [['s1', 'b1'], ['s2', 'b2'], ['s3', 'b3'], ['s1', 'b2'], ['s2', 'b3']];
    for (const [i, [seller, buyer]] of pairs.entries()) {
        await recordExchangeResourceSale(sale({ id: `lot-${i}`, seller, buyer, quantity: 1, price: 150_000, fee: 7_500 }), { kv: store });
    }
    const report = await readExchangeResourceReport({ kv: store, now: NOW });
    assert.equal(report.today, TODAY);
    assert.equal(report.series[13].daily.fateShards.median, 150_000);
    assert.equal(report.series[13].daily.fateShards.distinctPairs, 5);
});
