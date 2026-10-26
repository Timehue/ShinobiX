process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'bank-contract-fixture-session-secret';

import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { apiErrorContract } from '../../shared/api-contract.js';
import { bankInterestResponseContract } from '../../shared/bank-contract.js';

let kv: typeof import('../_storage.js').kv;
let token: typeof import('../_auth.js').issuePlayerToken;
let reset: typeof import('../_ratelimit.js').__resetRateLimitsForTest;
type Handler = (req: never, res: never) => Promise<unknown>;
let handlers: Handler[];
const name = 'bankcontract';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: reset } = await import('../_ratelimit.js'));
    handlers = [(await import('./transfer.js')).default, (await import('./claim-interest.js')).default] as unknown as Handler[];
});

beforeEach(async () => {
    reset();
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, level: 20, ryo: 1000, bankRyo: 10000, villageUpgrades: { bank: 50 }, lastBankInterestAt: 0 } });
});

async function call(handler: (typeof handlers)[number], body: unknown, authenticated = true, method = 'POST') {
    let status = 200;
    let data: unknown;
    const res = { setHeader() {}, status(value: number) { status = value; return res; }, json(value: unknown) { data = value; return res; }, end() {} };
    await handler({ method, body, query: {}, headers: authenticated ? { 'x-player-name': name, 'x-player-token': token(name) } : {}, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return { status, data };
}

test('bank routes retain method, authentication and legacy malformed JSON status behavior', async t => {
    t.mock.method(console, 'error', () => {});
    for (const handler of handlers) {
        const body = { playerName: name, action: 'deposit', amount: 10 };
        assert.equal((await call(handler, body, false)).status, 401);
        assert.equal((await call(handler, body, true, 'GET')).status, 405);
        assert.equal((await call(handler, body, true, 'OPTIONS')).status, 200);
        const malformed = await call(handler, '{');
        assert.equal(malformed.status, 500, 'retain legacy direct-handler JSON status; Express rejects malformed HTTP JSON upstream');
        assert.equal(apiErrorContract.parse(malformed.data).error, 'Internal server error.');
        for (const raw of [[], false, 3, {}]) assert.equal((await call(handler, raw)).status, 400);
    }
    assert.equal((await kv.get<{ _saveVersion: number }>(`save:${name}`))?._saveVersion, 1);
});

test('interest credits once; a repeated request returns a validated cooldown without advancing version', async () => {
    const first = await call(handlers[1], { playerName: name });
    assert.equal(first.status, 200);
    const credit = bankInterestResponseContract.parse(first.data);
    assert.equal(credit.eligible, true);
    assert.equal(credit.claimed, 50);
    const again = bankInterestResponseContract.parse((await call(handlers[1], JSON.stringify({ playerName: name }))).data);
    assert.equal(again.eligible, false);
    assert.equal(again.claimed, 0);
    assert.equal(again._saveVersion, credit._saveVersion);
    const saved = await kv.get<{ character: { bankRyo: number } }>(`save:${name}`);
    assert.equal(saved?.character.bankRyo, 10050);
});
