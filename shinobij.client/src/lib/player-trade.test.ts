import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetTradeNonceState, settleTradeNonce, tradeIntentKey, tradeNonceFor } from './player-trade';

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
