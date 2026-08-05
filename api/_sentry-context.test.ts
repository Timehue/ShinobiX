import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { captureExpressException, safeRequestErrorContext } from './_sentry-context.js';

describe('Sentry request correlation', () => {
    it('uses a route template and request id without raw path/query/body data', () => {
        const req = {
            id: 'req_abc-123',
            method: 'post',
            baseUrl: '/api',
            route: { path: '/save/:name' },
            path: '/save/VisiblePlayer',
            originalUrl: '/api/save/VisiblePlayer?token=secret',
            body: { password: 'secret' },
        } as never;
        assert.deepEqual(safeRequestErrorContext(req), {
            requestId: 'req_abc-123',
            method: 'POST',
            route: '/api/save/:name',
            subsystem: 'api',
        });
    });

    it('captures safely with bounded tags and no request object', () => {
        const calls: Array<[string, string]> = [];
        let captured: unknown;
        const sentry = {
            withScope(callback: (scope: { setTag(name: string, value: string): void; setTransactionName(name: string): void }) => void) {
                callback({
                    setTag: (name, value) => calls.push([name, value]),
                    setTransactionName: (value) => calls.push(['transaction', value]),
                });
            },
            captureException(error: unknown) { captured = error; },
        };
        const error = new Error('boom');
        assert.equal(captureExpressException(sentry, {
            id: 'req12345', method: 'GET', baseUrl: '', route: { path: '/missions/:id' },
        } as never, error), true);
        assert.equal(captured, error);
        assert.deepEqual(calls, [
            ['transaction', 'GET /missions/:id'],
            ['request_id', 'req12345'],
            ['route_template', '/missions/:id'],
            ['gameplay_subsystem', 'missions'],
        ]);
    });
});
