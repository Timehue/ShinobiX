import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { initSentry, reportError } from './sentry';

describe('client Sentry fail-open gate', () => {
    it('is an inert no-op when the build has no DSN', () => {
        let listenerCount = 0;
        const previousWindow = globalThis.window;
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: { addEventListener: () => { listenerCount += 1; } },
        });
        try {
            assert.doesNotThrow(() => initSentry());
            assert.doesNotThrow(() => reportError(new Error('disabled')));
            assert.equal(listenerCount, 0);
        } finally {
            if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
        }
    });
});
