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
    ['epic', 'fateShards', 10, 1],
] as const) {
    test(`${packType}: lost committed response retries the original cards and spends once`, async () => {
        const initial = await stored();
        const lost = await post({ packType, requestId: REQUEST_ID }, { loseSuccessResponse: true });
        assert.equal(lost.status, 500, 'HTTP delivery failed after the handler committed its mutation');
        assert.ok(lost.committedResponse);
        const committed = await stored();
        assert.equal(committed.character[currency], Number(initial.character[currency]) - cost);
        assert.equal((committed.character.tileCards as string[]).length, count);
        const retry = await post({ packType, requestId: REQUEST_ID });
        assert.equal(retry.status, 200, JSON.stringify(retry.body));
        const recovered = await stored();
        assert.equal(recovered.character[currency], committed.character[currency], 'retry must not debit a second pack');
        assert.deepEqual(recovered.character.tileCards, committed.character.tileCards, 'retry must not draw more cards');
        assert.deepEqual(retry.body.cards, lost.committedResponse.cards, 'same purchase returns its original reveal');
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
    assert.equal(one.character.chroniclePoints, 900);
    assert.equal((one.character.tileCards as string[]).length, 5);
    for (const result of duplicates) assert.deepEqual(result.body.cards, duplicates[0].body.cards);

    const separate = await Promise.all(['second', 'third'].map((suffix) => post({ packType: 'standard', requestId: `${REQUEST_ID}-${suffix}` })));
    for (const result of separate) assert.equal(result.status, 200, JSON.stringify(result.body));
    const three = await stored();
    assert.equal(three.character.chroniclePoints, 700, '1000 opening = 700 closing + three 100-point purchases');
    assert.equal((three.character.tileCards as string[]).length, 15);
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
    assert.equal((await stored()).character.chroniclePoints, 900);
});

test('legacy callers without an ID keep distinct-purchase behavior', async () => {
    assert.equal((await post({ packType: 'standard' })).status, 200);
    assert.equal((await post({ packType: 'standard', requestId: null })).status, 200);
    const result = await stored();
    assert.equal(result.character.chroniclePoints, 800);
    assert.equal((result.character.tileCards as string[]).length, 10);
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
    assert.equal(after.character.fateShards, 90);
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
    assert.equal(beforeRetry.character.chroniclePoints, 900);
    assert.equal((beforeRetry.character.tileCards as string[]).length, 5);
});
