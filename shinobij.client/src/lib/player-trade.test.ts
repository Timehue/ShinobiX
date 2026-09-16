import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetTradeNonceState, sendCurrency, settleTradeNonce, tradeIntentKey, tradeNonceFor } from './player-trade';

beforeEach(() => resetTradeNonceState());

test('one nonce per intent, retained across an unconfirmed attempt', () => {
    const key = tradeIntentKey('Rill', 'Dopey ', 'ryo', 5_000);
    const first = tradeNonceFor(key);
    assert.match(first, /^[A-Za-z0-9_-]+$/, 'the server strips anything else');
    assert.equal(tradeNonceFor(key), first, 'the retry of the same intent carries the same nonce');
    settleTradeNonce(key, false);
    assert.equal(tradeNonceFor(key), first, 'a non-definitive answer keeps it');
    settleTradeNonce(key, true);
    assert.notEqual(tradeNonceFor(key), first, 'a definitive answer ends the intent');
});

test('a different intent never reuses another intent\'s nonce', () => {
    const a = tradeNonceFor(tradeIntentKey('Rill', 'Dopey', 'ryo', 5_000));
    const b = tradeNonceFor(tradeIntentKey('Rill', 'Dopey', 'ryo', 6_000));
    assert.notEqual(a, b);
    assert.equal(tradeIntentKey('Rill', ' dopey', 'ryo', 5000.9), tradeIntentKey('rill', 'Dopey', 'ryo', 5000), 'keys canonicalize');
});

for (const scenario of [
    { name: 'confirmed refusal', status: 400, body: { error: 'Recipient not found.' }, message: 'Recipient not found.', retained: false },
    { name: 'request timeout', status: 408, body: { error: 'Please retry.' }, message: 'Action unconfirmed. Refresh before retrying.', retained: false },
    { name: 'server interruption', status: 503, body: { error: 'Please retry.' }, message: 'Action unconfirmed. Refresh before retrying.', retained: true },
    { name: 'pending settlement', status: 409, body: { error: 'Still settling.', pending: true }, message: 'Action unconfirmed. Refresh before retrying.', retained: true },
    { name: 'missing confirmation', status: 200, body: {}, message: 'Action unconfirmed. Refresh before retrying.', retained: false },
    { name: 'disconnected response', status: 0, body: {}, message: 'Transfer unconfirmed. Refresh before retrying.', retained: true },
]) {
    test(`sendCurrency describes ${scenario.name} without changing its nonce policy`, async (t) => {
        const key = tradeIntentKey('Rill', 'Dopey', 'ryo', 5_000);
        const nonce = tradeNonceFor(key);
        t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
            assert.equal(JSON.parse(String(init.body)).nonce, nonce);
            if (scenario.status === 0) throw new TypeError('Failed to fetch');
            return new Response(JSON.stringify(scenario.body), { status: scenario.status });
        });
        const result = await sendCurrency('Rill', 'Dopey', 'ryo', 5_000);
        assert.equal(result.ok, false);
        assert.equal(result.error, scenario.message);
        assert.equal(result.pending, scenario.name === 'pending settlement' ? true : undefined);
        assert.equal(tradeNonceFor(key) === nonce, scenario.retained);
    });
}

test('sendCurrency returns the authoritative receipt unchanged', async (t) => {
    const receipt = { ok: true, debit: 5_000, credit: 4_500, burned: 500, senderBalance: 8_000, toPlayer: 'Dopey' };
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(receipt)));
    assert.deepEqual(await sendCurrency('Rill', 'Dopey', 'ryo', 5_000), receipt);
});
