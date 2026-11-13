import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { close, flush, getClient } from '@sentry/react';
import { strict as assert } from 'node:assert';
import { initSentry, reportError } from './sentry';
import { beforeSend, dataCollection, init, captureSanitizedException } from './sentry-runtime';

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


describe('client Sentry collection policy', () => {
    it('applies restrictive collection and scrubbing at the lazy initialization boundary', () => {
        const source = readFileSync(new URL('./sentry.ts', import.meta.url), 'utf8');
        assert.match(source, /dataCollection: module\.dataCollection/);
        assert.match(source, /beforeSend: module\.beforeSend/);
        assert.match(source, /tracesSampleRate: 0/);
        assert.doesNotMatch(source, /sendDefaultPii/);
        assert.match(source, /integration\.name !== "GlobalHandlers" && integration\.name !== "BrowserSession"/);
    });
    it('explicitly disables every SDK 11 data collection category', () => {
        assert.deepEqual(dataCollection, {
            userInfo: false,
            cookies: false,
            httpHeaders: { request: false, response: false },
            httpBodies: [],
            urlQueryParams: false,
            genAI: { inputs: false, outputs: false },
            mcp: { inputs: false, outputs: false },
            databaseQueryData: false,
            queues: false,
            graphQL: { document: false, variables: false },
            stackFrameVariables: false,
            frameContextLines: 0,
        });
    });
});


it('SDK 11 uses the restrictive policy and sanitizes captured errors before transport', async () => {
    const envelopes: unknown[] = [];
    init({
        dsn: 'https://public@example.invalid/1',
        dataCollection,
        beforeSend,
        tracesSampleRate: 0,
        integrations: (defaults) => defaults.filter((integration) => integration.name !== 'GlobalHandlers' && integration.name !== 'BrowserSession'),
        transport: () => ({
            send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; },
            flush: async () => true,
        }),
    });
    try {
        assert.deepEqual(getClient()?.getOptions().dataCollection, dataCollection);
        assert.equal(getClient()?.getIntegrationByName('BrowserSession'), undefined);
        assert.equal(captureSanitizedException(new Error('password=private-transport-value')), true);
        assert.equal(await flush(2_000), true);
        const serialized = JSON.stringify(envelopes);
        assert.match(serialized, /REDACTED/);
        assert.match(serialized, /stacktrace/);
        assert.doesNotMatch(serialized, /private-transport-value/);
        assert.equal(envelopes.length, 1);
    } finally {
        await close(2_000);
    }
});
