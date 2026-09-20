import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { EXCHANGE_MARKET_DEFAULT_QUERY } from '../../../shared/sunscar-exchange';
import { clearExchangeReturnContext, peekExchangeReturnContext, saveExchangeReturnContext, takeExchangeReturnContext } from './exchange-return';

const realStorage = globalThis.sessionStorage;
afterEach(() => { Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: realStorage }); });

function memoryStorage(blocked = false): Storage {
    const values = new Map<string, string>();
    return {
        get length() { return values.size; },
        clear() { if (blocked) throw new Error('blocked'); values.clear(); },
        getItem(key) { if (blocked) throw new Error('blocked'); return values.get(key) ?? null; },
        key(index) { return [...values.keys()][index] ?? null; },
        removeItem(key) { if (blocked) throw new Error('blocked'); values.delete(key); },
        setItem(key, value) { if (blocked) throw new Error('blocked'); values.set(key, value); },
    };
}

test('Exchange return context is account-scoped, bounded and consumed deliberately', () => {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: memoryStorage() });
    const id = 'a'.repeat(32);
    assert.equal(saveExchangeReturnContext('Alpha', id, { ...EXCHANGE_MARKET_DEFAULT_QUERY, page: 3, search: 'fox' }, 1_000), true);
    assert.equal(peekExchangeReturnContext('Bravo', 1_001), null);
    const alpha = peekExchangeReturnContext('Alpha', 1_001);
    assert.equal(alpha?.listingId, id);
    assert.equal(alpha?.market.page, 3);
    assert.equal(alpha?.market.search, 'fox');
    assert.equal(takeExchangeReturnContext('Alpha', 1_001)?.listingId, id);
    assert.equal(peekExchangeReturnContext('Alpha', 1_001), null);
});

test('expired or unavailable optional storage never traps navigation', () => {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: memoryStorage() });
    assert.equal(saveExchangeReturnContext('Alpha', 'a'.repeat(32), EXCHANGE_MARKET_DEFAULT_QUERY, 1_000), true);
    assert.equal(peekExchangeReturnContext('Alpha', 1_000 + 31 * 60_000), null);
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: memoryStorage(true) });
    assert.equal(saveExchangeReturnContext('Alpha', 'a'.repeat(32), EXCHANGE_MARKET_DEFAULT_QUERY), false);
    assert.equal(peekExchangeReturnContext('Alpha'), null);
    assert.doesNotThrow(() => clearExchangeReturnContext('Alpha'));
});

test('tampered market state is discarded instead of reaching Exchange controls', () => {
    const storage = memoryStorage();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
    storage.setItem('sunscar-exchange:return:alpha', JSON.stringify({
        v: 1, account: 'alpha', origin: 'sunscarFestival', listingId: 'a'.repeat(32),
        market: { ...EXCHANGE_MARKET_DEFAULT_QUERY, page: -4, sort: 'not-a-sort' }, expiresAt: Date.now() + 60_000,
    }));
    assert.equal(peekExchangeReturnContext('Alpha'), null);
    assert.equal(storage.length, 0);
});
