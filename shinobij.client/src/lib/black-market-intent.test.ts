import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { brokerPullIntent, clearBrokerPullIntent, resetBrokerPullIntentsForTests } from './black-market-intent';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
beforeEach(() => {
    resetBrokerPullIntentsForTests();
    values = new Map();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
    } });
});
afterEach(() => {
    resetBrokerPullIntentsForTests();
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('an unanswered purchase survives reload and retains its original payment across midnight', () => {
    const intent = brokerPullIntent('Kaito', 'certificate', '2026-10-18');
    resetBrokerPullIntentsForTests();
    assert.deepEqual(brokerPullIntent(' KAITO ', 'ryo', '2026-10-19'), intent);
    clearBrokerPullIntent('Kaito', intent.requestId);
    const next = brokerPullIntent('Kaito', 'ryo', '2026-10-19');
    assert.notEqual(next.requestId, intent.requestId);
    assert.equal(next.payment, 'ryo');
});

test('another player or an old response cannot clear a newer pending purchase', () => {
    const first = brokerPullIntent('Kaito', 'certificate', '2026-10-18');
    const other = brokerPullIntent('Miraa', 'ryo', '2026-10-18');
    clearBrokerPullIntent('Kaito', first.requestId);
    const second = brokerPullIntent('Kaito', 'certificate', '2026-10-18');
    clearBrokerPullIntent('Kaito', first.requestId);
    assert.deepEqual(brokerPullIntent('Kaito', 'ryo', '2026-10-18'), second);
    assert.deepEqual(brokerPullIntent('Miraa', 'certificate', '2026-10-18'), other);
});

test('blocked storage still preserves an uncertain purchase in memory', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage blocked'); } });
    const first = brokerPullIntent('Kaito', 'certificate', '2026-10-18');
    assert.deepEqual(brokerPullIntent('Kaito', 'ryo', '2026-10-18'), first);
    clearBrokerPullIntent('Kaito', first.requestId);
    assert.notEqual(brokerPullIntent('Kaito', 'certificate', '2026-10-18').requestId, first.requestId);
});
