process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'bank-handler-test-secret-32-bytes-long';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * /api/bank/transfer — F16, driven through the mounted handler.
 *
 * A wallet/bank move had no replay identity: a retry after a lost response
 * was a second move. `requestId` now settles with the in-save receipt
 * convention, so the move and its proof land in one write and a same-id retry
 * returns the previous operation. Also pins the restored `direction` alias:
 * the Bank screen has sent `direction` while the server only read `action`.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let handler: Handler;
let PET_BREEDING_MIGRATION_VERSION: number;

const PLAYER = 'bankreceiptowner';
const REQUEST_ID = 'bank-op-0000000000000001';
let ipSeed = 0;

function response() {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function post(body: Json) {
    const token = issuePlayerToken(PLAYER);
    const ip = `10.50.0.${++ipSeed}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, ...body },
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': PLAYER, 'x-player-token': token, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

async function stored() {
    const record = await kv.get<Json>(`save:${PLAYER}`);
    const character = record?.character as Json;
    return { ryo: Number(character.ryo), bankRyo: Number(character.bankRyo), version: Number(record?._saveVersion) };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    handler = (await import('./transfer.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, level: 20, ryo: 1_000, bankRyo: 0, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION } });
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('bank transfer — operation identity', { concurrency: false }, () => {
    it('a same-id retry returns the previous operation; the money moves once', async () => {
        const first = await post({ action: 'deposit', amount: 300, requestId: REQUEST_ID });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        const afterFirst = await stored();
        assert.deepEqual({ ryo: afterFirst.ryo, bankRyo: afterFirst.bankRyo }, { ryo: 700, bankRyo: 300 });

        const retry = await post({ action: 'deposit', amount: 300, requestId: REQUEST_ID });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(retry.body?.replayed, true);
        assert.equal(retry.body?.ryo, 700);
        assert.equal(retry.body?.bankRyo, 300);
        const afterRetry = await stored();
        assert.deepEqual({ ryo: afterRetry.ryo, bankRyo: afterRetry.bankRyo }, { ryo: 700, bankRyo: 300 }, 'no second move');
        assert.equal(afterRetry.version, afterFirst.version, 'a replay publishes no new version');
        assert.equal(retry.body?._saveVersion, afterFirst.version, 'the caller can adopt a coherent version');
        assert.ok(retry.body?.character, 'the authoritative character rides the replay');
    });

    it('the same id with a different payload is refused', async () => {
        await post({ action: 'deposit', amount: 300, requestId: REQUEST_ID });
        const changed = await post({ action: 'withdraw', amount: 300, requestId: REQUEST_ID });
        assert.equal(changed.statusCode, 409, JSON.stringify(changed.body));
        const after = await stored();
        assert.deepEqual({ ryo: after.ryo, bankRyo: after.bankRyo }, { ryo: 700, bankRyo: 300 });
    });

    it('accepts the Bank screen\'s `direction` field as the action', async () => {
        const out = await post({ direction: 'deposit', amount: 250 });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const after = await stored();
        assert.deepEqual({ ryo: after.ryo, bankRyo: after.bankRyo }, { ryo: 750, bankRyo: 250 });
    });

    it('a request without an id still moves (legacy client), and a malformed id is refused', async () => {
        const out = await post({ action: 'withdraw', amount: 100 });
        assert.equal(out.statusCode, 400, 'nothing banked yet');
        const bad = await post({ action: 'deposit', amount: 100, requestId: 'short' });
        assert.equal(bad.statusCode, 400);
        assert.equal((await stored()).ryo, 1_000);
    });
});
