import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetTradeNonceState, sendCurrency, settleTradeNonce, tradeIntentKey, tradeNonceFor } from './player-trade';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
let stored: Map<string, string>;

beforeEach(() => {
    stored = new Map<string, string>();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => { stored.set(key, value); },
        removeItem: (key: string) => { stored.delete(key); },
    } });
    resetTradeNonceState();
});

afterEach(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
});

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

test('a different intent never reuses another intent\'s nonce, and never drops it', () => {
    const keyA = tradeIntentKey('Rill', 'Dopey', 'ryo', 5_000);
    const a = tradeNonceFor(keyA);
    const b = tradeNonceFor(tradeIntentKey('Rill', 'Dopey', 'ryo', 6_000));
    assert.notEqual(a, b);
    assert.equal(tradeNonceFor(keyA), a, 'an unconfirmed transfer keeps its nonce while another one is tried');
    assert.equal(tradeIntentKey('Rill', ' dopey', 'ryo', 5000.9), tradeIntentKey('rill', 'Dopey', 'ryo', 5000), 'keys canonicalize');
});

test('an unconfirmed nonce survives the refresh the player is told to do', async () => {
    const key = tradeIntentKey('Rill', 'Dopey', 'ryo', 5_000);
    const nonce = tradeNonceFor(key);
    // A reload is a fresh module over the same tab storage.
    const reloaded = await import(`./player-trade.ts?reload=${Date.now()}`) as typeof import('./player-trade');
    assert.equal(reloaded.tradeNonceFor(key), nonce, 'the retry after a reload finishes the same transfer');
    reloaded.settleTradeNonce(key, true, nonce);
    assert.notEqual(reloaded.tradeNonceFor(key), nonce, 'a definitive answer after the reload ends the intent');
});

test('a late answer to an older attempt cannot release a newer attempt of the same intent', () => {
    const key = tradeIntentKey('Rill', 'Dopey', 'ryo', 5_000);
    const first = tradeNonceFor(key);
    settleTradeNonce(key, true, first);
    const second = tradeNonceFor(key);
    assert.notEqual(second, first);
    settleTradeNonce(key, true, first);
    assert.equal(tradeNonceFor(key), second, 'the newer nonce is still retained');
});

test('the nonce is retained in memory when tab storage is unavailable', () => {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Storage unavailable'); } });
    const key = tradeIntentKey('Rill', 'Dopey', 'ryo', 5_000);
    const nonce = tradeNonceFor(key);
    assert.equal(tradeNonceFor(key), nonce);
    settleTradeNonce(key, true, nonce);
    assert.notEqual(tradeNonceFor(key), nonce);
});

test('a stored value that is not a nonce is never sent', () => {
    const key = tradeIntentKey('Rill', 'Dopey', 'ryo', 5_000);
    stored.set(`shinobix.trade-intent:${key}`, 'not a nonce!');
    assert.match(tradeNonceFor(key), /^ryo-\d+-[a-z0-9]+$/);
});

for (const scenario of [
    { name: 'confirmed refusal', status: 400, body: { error: 'Recipient not found.' }, message: 'Recipient not found.', retained: false },
    // A timeout and a reply without a confirmation are both unconfirmed: the
    // transfer may have run, so the retry must carry the same nonce.
    { name: 'request timeout', status: 408, body: { error: 'Please retry.' }, message: 'Action unconfirmed. Refresh before retrying.', retained: true },
    { name: 'server interruption', status: 503, body: { error: 'Please retry.' }, message: 'Action unconfirmed. Refresh before retrying.', retained: true },
    { name: 'pending settlement', status: 409, body: { error: 'Still settling.', pending: true }, message: 'Action unconfirmed. Refresh before retrying.', retained: true },
    { name: 'missing confirmation', status: 200, body: {}, message: 'Action unconfirmed. Refresh before retrying.', retained: true },
    { name: 'disconnected response', status: 0, body: {}, message: 'Transfer unconfirmed. Refresh before retrying.', retained: true },
]) {
    test(`sendCurrency describes ${scenario.name} and ${scenario.retained ? 'keeps' : 'releases'} its nonce`, async (t) => {
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

test('sendCurrency returns the authoritative receipt unchanged and ends the intent', async (t) => {
    const receipt = { ok: true, debit: 5_000, credit: 4_500, burned: 500, senderBalance: 8_000, toPlayer: 'Dopey' };
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(receipt)));
    assert.deepEqual(await sendCurrency('Rill', 'Dopey', 'ryo', 5_000), receipt);
    assert.equal(stored.size, 0, 'nothing is left in tab storage');
});
