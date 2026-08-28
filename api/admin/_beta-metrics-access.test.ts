import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Out = { statusCode: number; body?: Record<string, unknown>; sent?: string; headers: Record<string, string> };
type Handler = (req: never, res: never) => unknown | Promise<unknown>;

function response() {
    const out: Out = { statusCode: 200, headers: {} };
    const res = {
        setHeader: (k: string, v: string) => { out.headers[String(k).toLowerCase()] = String(v); return res; },
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        send: (body: string) => { out.sent = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function request(over: Record<string, unknown> = {}) {
    return {
        method: 'GET',
        query: {},
        body: {},
        headers: { 'content-type': 'application/json' },
        socket: { remoteAddress: '127.0.0.90' },
        ...over,
    } as never;
}

/*
 * The beta report is aggregate-only, but it is still a population-wide read of
 * every save in the game. #11 lists auth and rate limit as required tests and
 * there were none, so these pin the two guards that keep it operator-only.
 */
describe('admin beta-metrics access control', () => {
    it('refuses a caller with no admin credential, before reading any save', async () => {
        const handler = (await import('./beta-metrics.js')).default as unknown as Handler;
        const { out, res } = response();
        await handler(request(), res);
        assert.equal(out.statusCode, 403);
        assert.equal(out.body?.error, 'Full admin access required.');
        // Nothing aggregate leaked alongside the refusal.
        assert.equal(out.body?.metrics, undefined);
        assert.equal(out.body?.population, undefined);
    });

    it('refuses a forged admin header just as firmly', async () => {
        const handler = (await import('./beta-metrics.js')).default as unknown as Handler;
        for (const headers of [
            { 'x-admin-password': '' },
            { 'x-admin-password': 'not-the-password' },
            { 'x-player-name': 'admin1' },
        ]) {
            const { out, res } = response();
            await handler(request({ headers }), res);
            assert.equal(out.statusCode, 403, `expected 403 for ${JSON.stringify(headers)}`);
        }
    });

    it('answers CORS preflight without requiring admin, and rejects other verbs', async () => {
        const handler = (await import('./beta-metrics.js')).default as unknown as Handler;
        const preflight = response();
        await handler(request({ method: 'OPTIONS' }), preflight.res);
        assert.equal(preflight.out.statusCode, 200);

        for (const method of ['PUT', 'DELETE', 'PATCH']) {
            const { out, res } = response();
            await handler(request({ method }), res);
            assert.equal(out.statusCode, 405, `${method} must not be served`);
        }
    });

    it('keeps the admin gate ahead of the rate limiter and the population scan', () => {
        const src = readFileSync(join(process.cwd(), 'api', 'admin', 'beta-metrics.ts'), 'utf8');
        const admin = src.indexOf('isFullAdmin(req)');
        const limit = src.indexOf("enforceRateLimit(req, res, 'admin-beta-metrics'");
        const scan = src.indexOf("kv.keys('save:*')");
        assert.ok(admin !== -1, 'the handler must require full admin');
        assert.ok(limit !== -1, 'the handler must rate limit');
        assert.ok(admin < limit, 'auth must run before the rate limiter');
        assert.ok(limit < scan, 'an unauthenticated caller must never reach the save scan');
        // The population scan stays opt-in: it is the expensive path.
        assert.match(src, /includePopulation/);
        assert.match(src, /Cache-Control['"]?,\s*['"]no-store/);
    });
});
