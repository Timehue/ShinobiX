import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'chronicle-pack-isolated-handler-test-secret';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
let PLAYER = 'packreceiptowner';
let playerSequence = 0;
const REQUEST_ID = 'chronicle-pack-request-000001';
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let handler: Handler;
let migrationVersion: number;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ PET_BREEDING_MIGRATION_VERSION: migrationVersion } = await import('../pet/_owned-pet.js'));
    handler = (await import('./open-pack.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    // Keep the real per-account limiter: each independent fixture is a new account.
    PLAYER = `packreceiptowner${++playerSequence}`;
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: {
        name: PLAYER, level: 20, ryo: 1234, chroniclePoints: 1000, fateShards: 100,
        starterCardsClaimed: true, tileCards: [], petBreedingMigrationVersion: migrationVersion,
    } });
});

async function post(body: Json, options: { loseSuccessResponse?: boolean; caller?: string } = {}) {
    const output = { status: 200, body: {} as Json, committedResponse: null as Json | null };
    let loseSuccess = options.loseSuccessResponse;
    const response = {
        setHeader: () => response,
        status: (status: number) => { output.status = status; return response; },
        json: (value: Json) => {
            if (loseSuccess && output.status === 200 && value.ok === true) {
                loseSuccess = false;
                output.committedResponse = structuredClone(value);
                throw new Error('injected loss of HTTP acknowledgement after pack save committed');
            }
            output.body = value;
            return response;
        },
        end: () => response,
    };
    await handler({
        method: 'POST', body: { playerName: PLAYER, ...body }, query: {},
        headers: { 'x-player-token': issuePlayerToken(options.caller ?? PLAYER) },
        socket: { remoteAddress: '203.0.113.118' },
    } as never, response as never);
    return output;
}

async function stored() {
    const record = await kv.get<Json>(`save:${PLAYER}`);
    assert.ok(record);
    return { record, character: record.character as Json, version: Number(record._saveVersion) };
}

type Refund = { chroniclePoints: number; fateShards: number };
/** Random draws can repeat a card past its playset (about 0.2% of elemental
 *  packs from an empty collection); such copies convert instead of landing. */
const keptCount = (...bodies: Json[]) => bodies.reduce((sum, body) =>
    sum + (body.cards as string[]).length - ((body.converted as unknown[] | undefined)?.length ?? 0), 0);
const refundOf = (currency: string, ...bodies: Json[]) => bodies.reduce((sum, body) =>
    sum + Number((body.refund as Refund | undefined)?.[currency as keyof Refund] ?? 0), 0);

test('pack telemetry counts the rarity of the card ID actually awarded', async () => {
    const { betaDateKey, betaMetricKey, flushBetaMetrics } = await import('../_beta-metrics.js');
    const { BUILTIN_CLASH } = await import('../clan/war/_card-catalog.js');
    const result = await post({ packType: 'epic', requestId: REQUEST_ID });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const cardId = (result.body.cards as string[])[0];
    const rarity = BUILTIN_CLASH[cardId]?.rarity;
    assert.ok(rarity === 'rare' || rarity === 'epic');
    await flushBetaMetrics();
    const day = await kv.get<Json>(betaMetricKey(betaDateKey()));
    assert.ok(day);
    assert.equal((day.rareGrants as Json)[`card:${rarity}`], 1);
});

for (const [packType, currency, cost, count] of [
    ['standard', 'chroniclePoints', 100, 5],
    ['fire', 'chroniclePoints', 100, 5],
    ['water', 'chroniclePoints', 100, 5],
    ['earth', 'chroniclePoints', 100, 5],
    ['wind', 'chroniclePoints', 100, 5],
    ['lightning', 'chroniclePoints', 100, 5],
    ['snare', 'chroniclePoints', 100, 5],
    ['jutsu', 'chroniclePoints', 100, 5],
    ['epic', 'fateShards', 6, 1],
    ['legendary', 'fateShards', 20, 1],
    ['epic-five', 'fateShards', 35, 5],
    ['legendary-five', 'fateShards', 100, 5],
] as const) {
    test(`${packType}: lost committed response retries the original cards and spends once`, async () => {
        const initial = await stored();
        const lost = await post({ packType, requestId: REQUEST_ID }, { loseSuccessResponse: true });
        assert.equal(lost.status, 500, 'HTTP delivery failed after the handler committed its mutation');
        assert.ok(lost.committedResponse);
        const committed = await stored();
        assert.equal(lost.committedResponse.cost, cost);
        assert.equal((lost.committedResponse.cards as string[]).length, count);
        assert.equal(committed.character[currency], Number(initial.character[currency]) - cost + refundOf(currency, lost.committedResponse));
        assert.equal((committed.character.tileCards as string[]).length, keptCount(lost.committedResponse));
        const retry = await post({ packType, requestId: REQUEST_ID });
        assert.equal(retry.status, 200, JSON.stringify(retry.body));
        const recovered = await stored();
        assert.equal(recovered.character[currency], committed.character[currency], 'retry must not debit a second pack');
        assert.deepEqual(recovered.character.tileCards, committed.character.tileCards, 'retry must not draw more cards');
        assert.deepEqual(retry.body.cards, lost.committedResponse.cards, 'same purchase returns its original reveal');
        assert.deepEqual(retry.body.converted, lost.committedResponse.converted, 'and its original conversions');
        assert.deepEqual(retry.body.refund, lost.committedResponse.refund);
        assert.equal(retry.body.replayed, true);
        assert.equal(recovered.version, committed.version, 'receipt replay publishes no new save version');
        assert.deepEqual(retry.body.character, recovered.character);
        assert.equal(recovered.character.ryo, initial.character.ryo);
    });
}

test('overlapping duplicates settle one purchase while distinct IDs each buy a pack', async () => {
    const duplicates = await Promise.all(Array.from({ length: 3 }, () => post({ packType: 'standard', requestId: REQUEST_ID })));
    for (const result of duplicates) assert.equal(result.status, 200, JSON.stringify(result.body));
    const one = await stored();
    assert.equal(one.character.chroniclePoints, 900 + refundOf('chroniclePoints', duplicates[0].body));
    assert.equal((one.character.tileCards as string[]).length, keptCount(duplicates[0].body));
    for (const result of duplicates) assert.deepEqual(result.body.cards, duplicates[0].body.cards);

    const separate = await Promise.all(['second', 'third'].map((suffix) => post({ packType: 'standard', requestId: `${REQUEST_ID}-${suffix}` })));
    for (const result of separate) assert.equal(result.status, 200, JSON.stringify(result.body));
    const three = await stored();
    const bodies = [duplicates[0].body, ...separate.map((result) => result.body)];
    assert.equal(three.character.chroniclePoints, 700 + refundOf('chroniclePoints', ...bodies),
        '1000 opening = 700 closing + three 100-point purchases (plus any duplicate rebate)');
    assert.equal((three.character.tileCards as string[]).length, keptCount(...bodies));
    const oldReplay = await post({ packType: 'standard', requestId: REQUEST_ID });
    assert.deepEqual(oldReplay.body.cards, duplicates[0].body.cards);
    assert.deepEqual(oldReplay.body.character, three.character, 'old receipt returns current authority, not the old saved wallet');
    assert.equal((await stored()).version, three.version);
});

test('malformed IDs and reused IDs with another pack type reject without mutations', async () => {
    const initial = await stored();
    for (const requestId of ['short', 'invalid/request/123456', 'x'.repeat(81), 12345]) {
        const bad = await post({ packType: 'standard', requestId });
        assert.equal(bad.status, 400, JSON.stringify(bad.body));
    }
    assert.deepEqual((await stored()).record, initial.record);
    assert.equal((await post({ packType: 'standard', requestId: REQUEST_ID })).status, 200);
    const committed = await stored();
    const conflict = await post({ packType: 'epic', requestId: REQUEST_ID });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
    assert.deepEqual((await stored()).record, committed.record);
});

test('insufficient funds, locked Chronicle and foreign identity leave the purchase uncommitted', async () => {
    const original = await stored();
    await kv.set(`save:${PLAYER}`, { ...original.record, character: { ...original.character, chroniclePoints: 99 } });
    const unfunded = await stored();
    assert.equal((await post({ packType: 'standard', requestId: REQUEST_ID })).status, 409);
    assert.deepEqual((await stored()).record, unfunded.record);
    await kv.set(`save:${PLAYER}`, original.record);
    assert.equal((await post({ packType: 'standard', requestId: REQUEST_ID }, { caller: 'anotherpackowner' })).status, 401);
    await kv.set(`save:${PLAYER}`, { ...original.record, character: { ...original.character, starterCardsClaimed: false } });
    assert.equal((await post({ packType: 'standard', requestId: REQUEST_ID })).status, 409);
    await kv.set(`save:${PLAYER}`, original.record);
    const accepted = await post({ packType: 'standard', requestId: REQUEST_ID });
    assert.equal(accepted.status, 200, 'a rejected precommit request did not consume the ID');
    assert.equal((await stored()).character.chroniclePoints, 900 + refundOf('chroniclePoints', accepted.body));
});

test('legacy callers without an ID keep distinct-purchase behavior', async () => {
    const first = await post({ packType: 'standard' });
    const second = await post({ packType: 'standard', requestId: null });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const result = await stored();
    assert.equal(result.character.chroniclePoints, 800 + refundOf('chroniclePoints', first.body, second.body));
    assert.equal((result.character.tileCards as string[]).length, keptCount(first.body, second.body));
});

test('malformed stored receipt state fails closed without buying a new pack', async () => {
    const initial = await stored();
    await kv.set(`save:${PLAYER}`, { ...initial.record, character: { ...initial.character, serverSettlementReceipts: 'broken' } });
    const before = await stored();
    assert.equal((await post({ packType: 'standard', requestId: REQUEST_ID })).status, 409);
    assert.deepEqual((await stored()).record, before.record);
});

test('a failed save CAS is uncommitted and a retry pays only once', async () => {
    const compareSet = kv.compareSet;
    const before = await stored();
    let rejected = false;
    kv.compareSet = async (...args: Parameters<typeof compareSet>) => {
        if (!rejected && args[0] === `save:${PLAYER}`) { rejected = true; return false; }
        return compareSet(...args);
    };
    try {
        const failed = await post({ packType: 'epic', requestId: REQUEST_ID });
        assert.equal(failed.status, 500);
        assert.deepEqual((await stored()).record, before.record);
    } finally { kv.compareSet = compareSet; }
    assert.equal((await post({ packType: 'epic', requestId: REQUEST_ID })).status, 200);
    assert.equal((await post({ packType: 'epic', requestId: REQUEST_ID })).status, 200);
    const after = await stored();
    // One 6-shard Elite pack; a single card from an empty collection never converts.
    assert.equal(after.character.fateShards, 94);
    assert.equal((after.character.tileCards as string[]).length, 1);
});

test('a committed CAS with a lost storage acknowledgement retains the exact draw and receipt', async () => {
    const compareSet = kv.compareSet;
    let interrupted = false;
    kv.compareSet = async (...args: Parameters<typeof compareSet>) => {
        const committed = await compareSet(...args);
        if (committed && !interrupted && args[0] === `save:${PLAYER}`) {
            interrupted = true;
            throw new Error('injected loss of storage CAS acknowledgement after commit');
        }
        return committed;
    };
    let first: Awaited<ReturnType<typeof post>>;
    try {
        first = await post({ packType: 'standard', requestId: REQUEST_ID });
        assert.equal(first.status, 200, 'existing CAS readback recovers the committed write');
    } finally { kv.compareSet = compareSet; }
    const beforeRetry = await stored();
    const retry = await post({ packType: 'standard', requestId: REQUEST_ID });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body.cards, first.body.cards);
    assert.deepEqual((await stored()).record, beforeRetry.record);
    assert.equal(beforeRetry.character.chroniclePoints, 900 + refundOf('chroniclePoints', first.body));
    assert.equal((beforeRetry.character.tileCards as string[]).length, keptCount(first.body));
});

test('a duplicate beyond the playset converts in the committed write and replays identically', async () => {
    const { BUILTIN_CLASH, isMarketplaceCard } = await import('../clan/war/_card-catalog.js');
    // A full playset of every Elite-pool card: whatever the server draws converts.
    const elitePool = Object.entries(BUILTIN_CLASH)
        .filter(([id, card]) => (card.rarity === 'rare' || card.rarity === 'epic') && isMarketplaceCard(id))
        .map(([id]) => id);
    const seeded = elitePool.flatMap((id) => [id, id, id]);
    const initial = await stored();
    await kv.set(`save:${PLAYER}`, { ...initial.record, character: { ...initial.character, tileCards: seeded } });
    const opened = await post({ packType: 'epic', requestId: REQUEST_ID });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    const [cardId] = opened.body.cards as string[];
    const epic = BUILTIN_CLASH[cardId].rarity === 'epic';
    assert.deepEqual(opened.body.converted, [{ index: 0, cardId, chroniclePoints: epic ? 0 : 5, fateShards: epic ? 1 : 0 }]);
    assert.deepEqual(opened.body.refund, { chroniclePoints: epic ? 0 : 5, fateShards: epic ? 1 : 0 });
    const committed = await stored();
    assert.equal(committed.character.fateShards, 100 - 6 + (epic ? 1 : 0));
    assert.equal(committed.character.chroniclePoints, 1000 + (epic ? 0 : 5));
    assert.deepEqual(committed.character.tileCards, seeded, 'no fourth copy lands');
    assert.equal(opened.body.balance, committed.character.fateShards);

    const replay = await post({ packType: 'epic', requestId: REQUEST_ID });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(replay.body.converted, opened.body.converted);
    assert.deepEqual(replay.body.refund, opened.body.refund);
    assert.deepEqual((await stored()).record, committed.record, 'a replay credits nothing a second time');
});

test('a receipt written before conversions shipped replays as no conversion; a forged one is refused', async () => {
    assert.equal((await post({ packType: 'standard', requestId: REQUEST_ID })).status, 200);
    const committed = await stored();
    const receipts = committed.character.serverSettlementReceipts as Array<{ value: Json }>;
    const strip = (mutate: (value: Json) => void) => receipts.map((receipt) => {
        const value = structuredClone(receipt.value);
        mutate(value);
        return { ...receipt, value };
    });
    await kv.set(`save:${PLAYER}`, { ...committed.record, character: { ...committed.character,
        serverSettlementReceipts: strip((value) => { delete value.converted; delete value.refund; }) } });
    const legacy = await post({ packType: 'standard', requestId: REQUEST_ID });
    assert.equal(legacy.status, 200, JSON.stringify(legacy.body));
    assert.equal(legacy.body.replayed, true);
    assert.deepEqual(legacy.body.converted, []);
    assert.deepEqual(legacy.body.refund, { chroniclePoints: 0, fateShards: 0 });

    for (const forged of [
        'yes',
        [{ index: 9, cardId: 'tc-01', chroniclePoints: 5, fateShards: 0 }],
        [{ index: 0, cardId: 'not-the-drawn-card', chroniclePoints: 5, fateShards: 0 }],
        [{ index: 0, cardId: '', chroniclePoints: -5, fateShards: 0 }],
    ]) {
        await kv.set(`save:${PLAYER}`, { ...committed.record, character: { ...committed.character,
            serverSettlementReceipts: strip((value) => {
                value.converted = Array.isArray(forged) && forged[0].cardId === ''
                    ? [{ ...forged[0], cardId: (value.cards as string[])[0] }]
                    : forged;
            }) } });
        const refused = await post({ packType: 'standard', requestId: REQUEST_ID });
        assert.equal(refused.status, 409, JSON.stringify(forged));
    }
});

test('a fresh pack records its spend and rebate once; a replay records nothing', async () => {
    const { drainBackgroundWork } = await import('../_background-work.js');
    const { BUILTIN_CLASH } = await import('../clan/war/_card-catalog.js');
    const { CARD_PLAYSET_COPIES } = await import('./_pack.js');
    const legendaries = Object.entries(BUILTIN_CLASH)
        .filter(([, card]) => card.rarity === 'legendary').map(([id]) => id);
    // Earlier tests' fire-and-forget telemetry must land before the baseline.
    await drainBackgroundWork();
    const aggBefore = (await kv.get<{ created: number; destroyed: number }>('econ:agg:fateShards')) ?? { created: 0, destroyed: 0 };
    const initial = await stored();
    await kv.set(`save:${PLAYER}`, { ...initial.record, character: { ...initial.character,
        tileCards: legendaries.flatMap((id) => Array(CARD_PLAYSET_COPIES).fill(id)) } });
    const opened = await post({ packType: 'legendary', requestId: REQUEST_ID });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.deepEqual(opened.body.refund, { chroniclePoints: 0, fateShards: 3 });
    await drainBackgroundWork();
    type Txn = { txnId: string; currency: string; delta: number; source: string; balanceAfter?: number };
    const mine = async () => ((await kv.get<Txn[]>('econ:txns')) ?? []).filter((txn) => txn.txnId.includes(PLAYER));
    const logged = await mine();
    assert.deepEqual(logged.map(({ txnId, currency, delta, source, balanceAfter }) => ({ txnId, currency, delta, source, balanceAfter })).sort((a, b) => a.txnId.localeCompare(b.txnId)), [
        { txnId: `card-pack:${PLAYER}:${REQUEST_ID}`, currency: 'fateShards', delta: -20, source: 'cardpack.open', balanceAfter: 83 },
        { txnId: `card-pack:${PLAYER}:${REQUEST_ID}:fs`, currency: 'fateShards', delta: 3, source: 'cardpack.duplicate', balanceAfter: 83 },
    ]);
    assert.deepEqual(await kv.get('econ:agg:fateShards'), { created: aggBefore.created + 3, destroyed: aggBefore.destroyed + 20 });

    const replay = await post({ packType: 'legendary', requestId: REQUEST_ID });
    assert.equal(replay.body.replayed, true);
    await drainBackgroundWork();
    assert.equal((await mine()).length, 2, 'a replay records nothing');
});
