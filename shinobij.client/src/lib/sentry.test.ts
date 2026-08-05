import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { initSentry, reportError } from './sentry';
import { beforeSend } from './sentry-runtime';

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

    it('keeps stack diagnostics while dropping browser event data containers', () => {
        const event = beforeSend({
            message: 'password=private-value',
            request: { url: 'https://example.invalid/?token=private' },
            user: { username: 'private-player' },
            extra: { playerSave: { inventory: ['private-item'] } },
            contexts: { state: { chat: 'private-chat' } },
            breadcrumbs: [{ message: 'private-breadcrumb' }],
            exception: { values: [{ type: 'Error', value: 'Bearer private-token', stacktrace: { frames: [] } }] },
        });
        const serialized = JSON.stringify(event);
        assert.match(serialized, /stacktrace/);
        assert.match(serialized, /REDACTED/);
        assert.doesNotMatch(serialized, /private-/);
    });
});
