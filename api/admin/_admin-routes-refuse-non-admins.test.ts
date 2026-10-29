import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'admin-route-access-tests-secret';
// Distinct, non-placeholder secrets so the positive control below can authenticate.
process.env.ADMIN_PASSWORD = 'q7Zk3vPmX9rTbN2wLd5Hc8Yf';
process.env.ADMIN_CONTENT_PASSWORD = 'm4Vn8sQeJ6uGa1KxR3Wt9Bz2';

/**
 * Issue #18: "no test yet walks every admin route as an ordinary player".
 *
 * Every handler in api/admin is discovered from the directory, so a new admin route
 * is covered the day it is added. Each is called with each non-admin identity on
 * every method:
 *   - no credentials at all,
 *   - a perfectly valid ORDINARY PLAYER token (the credential a cheater has),
 *   - a wrong `x-admin-password` guess.
 * A refusal is 401/403 (or 405 for a method the route does not serve). Anything
 * else, including a 2xx, a 5xx or a handler that throws, fails the test.
 *
 * A positive control with the real admin password proves the harness reaches the
 * handlers, so a pass here cannot mean "every call died before the auth check".
 */

const REFUSED = new Set([401, 403]);
const ALLOWED = new Set([401, 403, 405]);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * Known public reads. Each is a deliberate exception, named with the exact keys it
 * may return, so it cannot grow quietly. Today there is one:
 *
 * item-review GET answers anyone with the approved item ids and nothing else. Its
 * only caller is the admin panel, which already sends the admin password, so the
 * read does not need to be public; making it admin-only is a one-line isAdmin() on
 * the GET branch, held back because it changes admin auth. When that lands, delete
 * this entry and the test will then require the refusal.
 */
const KNOWN_PUBLIC_READS: Record<string, { keys: string[]; why: string }> = {
    'item-review.ts GET': { keys: ['approvedItems'], why: 'approved item ids only (issue #18)' },
};

function publicReadProblem(name: string, method: string, body: unknown): string | null {
    const known = KNOWN_PUBLIC_READS[`${name} ${method}`];
    if (!known) return 'not a known public read';
    const keys = body && typeof body === 'object' ? Object.keys(body as object).sort() : [];
    if (JSON.stringify(keys) !== JSON.stringify([...known.keys].sort())) return `a known public read may return only ${known.keys.join(', ')}, got ${keys.join(', ') || 'nothing'}`;
    return null;
}

type Handler = (req: never, res: never) => Promise<unknown> | unknown;
const handlers = new Map<string, Handler>();
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let kv: typeof import('../_storage.js').kv;

let counter = 0;
function request(method: string, headers: Record<string, string>) {
    // A fresh address per call, so no per-IP limiter or failed-guess budget can turn
    // a later refusal into a 429 and hide whether the auth check ran.
    const n = ++counter;
    const ip = `10.97.${Math.floor(n / 250)}.${(n % 250) + 1}`;
    return {
        method,
        headers: { 'x-forwarded-for': ip, ...headers },
        query: {} as Record<string, string>,
        body: method === 'GET' ? undefined : {},
        url: '/',
        socket: { remoteAddress: ip },
    };
}

function response() {
    const r: Record<string, any> = { statusCode: 200, headers: {} as Record<string, unknown>, body: undefined as unknown, ended: false };
    r.setHeader = (k: string, v: unknown) => { r.headers[k.toLowerCase()] = v; return r; };
    r.getHeader = (k: string) => r.headers[k.toLowerCase()];
    r.status = (n: number) => { r.statusCode = n; return r; };
    r.writeHead = (n: number) => { r.statusCode = n; return r; };
    r.json = (b: unknown) => { r.body = b; r.ended = true; return r; };
    r.send = (b: unknown) => { r.body = b; r.ended = true; return r; };
    r.end = () => { r.ended = true; return r; };
    r.write = () => true;
    r.redirect = (n: number) => { r.statusCode = n; r.ended = true; return r; };
    return r;
}

async function call(name: string, method: string, headers: Record<string, string>) {
    const res = response();
    try {
        await handlers.get(name)!(request(method, headers) as never, res as never);
    } catch (err) {
        return { status: -1, threw: err instanceof Error ? err.message : String(err), body: undefined as unknown };
    }
    return { status: res.statusCode as number, threw: undefined, body: res.body };
}

before(async () => {
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ kv } = await import('../_storage.js'));
    // process.cwd() is the repo root under the test runner; import.meta is not allowed
    // here because the server build compiles api/ tests to CommonJS.
    const dir = join(process.cwd(), 'api', 'admin');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.startsWith('_') && !f.endsWith('.test.ts')).sort()) {
        const mod = await import(pathToFileURL(join(dir, file)).href);
        assert.equal(typeof mod.default, 'function', `api/admin/${file} must default-export a handler`);
        handlers.set(file, mod.default as Handler);
    }
});

describe('every api/admin route refuses everyone who is not an admin', () => {
    it('discovers the admin routes it is about to check', () => {
        // A directory read that quietly finds nothing would make every check below vacuous.
        assert.ok(handlers.size >= 20, `expected the admin routes, found ${handlers.size}: ${[...handlers.keys()].join(', ')}`);
    });

    it('answers 401/403 (or 405) to no credentials, an ordinary player token and a wrong admin password', async () => {
        const players = ['plainplayer', 'another-player'];
        const identities: Array<[string, () => Record<string, string>]> = [
            ['no credentials', () => ({})],
            ['an ordinary player token', () => ({ 'x-player-token': issuePlayerToken(players[0]) })],
            ['a second ordinary player token', () => ({ 'x-player-token': issuePlayerToken(players[1]) })],
            ['a wrong admin password', () => ({ 'x-admin-password': 'not-the-admin-password-0000' })],
            ['a player token and a wrong admin password', () => ({ 'x-player-token': issuePlayerToken(players[0]), 'x-admin-password': 'not-the-admin-password-0000' })],
        ];
        const before = new Set(await kv.keys('*'));
        const failures: string[] = [];
        const ungated: string[] = [];
        for (const name of handlers.keys()) {
            let gated = false;
            for (const [who, headers] of identities) {
                for (const method of METHODS) {
                    const r = await call(name, method, headers());
                    if (REFUSED.has(r.status)) gated = true;
                    if (r.status === 200 && !publicReadProblem(name, method, r.body)) continue;
                    if (!ALLOWED.has(r.status)) {
                        failures.push(`${name} ${method} as ${who}: ${r.threw ? `threw "${r.threw}"` : `answered ${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}`}`);
                    }
                }
            }
            if (!gated) ungated.push(name);
        }
        assert.deepEqual(failures, [], `these admin routes did not refuse a non-admin:\n  ${failures.join('\n  ')}`);
        // A route that only ever said 405 never reached an auth check on any method tried.
        assert.deepEqual(ungated, [], `these routes never answered 401/403, so none of the methods tried reached an auth gate: ${ungated.join(', ')}`);
        // Refusing must not write anything on the caller's behalf. Rate-limit and
        // failed-guess bookkeeping is the one thing a refusal may leave behind.
        const written = (await kv.keys('*')).filter((k) => !before.has(k) && !/^(rl:|ratelimit|adminpw-fail|rate)/i.test(k));
        assert.deepEqual(written, [], `a refused request wrote to storage: ${written.slice(0, 10).join(', ')}`);
    });

    it('every known public read is still public, so the exception list cannot go stale', async () => {
        for (const entry of Object.keys(KNOWN_PUBLIC_READS)) {
            const [name, method] = entry.split(' ');
            const r = await call(name, method, {});
            assert.equal(r.status, 200, `${entry} now refuses anonymous callers: delete it from KNOWN_PUBLIC_READS so the test requires the refusal`);
        }
    });

    it('control: the real admin password gets past the gate on the same harness', async () => {
        const r = await call('players.ts', 'GET', { 'x-admin-password': process.env.ADMIN_PASSWORD! });
        assert.ok(!REFUSED.has(r.status) && r.status !== -1, `the admin password was refused (${r.status}); the harness would hide a broken gate`);
    });
});
