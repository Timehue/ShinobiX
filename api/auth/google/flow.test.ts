import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'test';
process.env.SESSION_SECRET = 'google-auth-test-session-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'https://shinobijourney.com/api/auth/google/callback';

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined; headers: Record<string, string> };

const store = new Map<string, unknown>();
const clone = <T>(value: T): T => (
    value === undefined || value === null ? value : JSON.parse(JSON.stringify(value)) as T
);

let startHandler: Handler;
let callbackHandler: Handler;
let claimHandler: Handler;
let playerAuthHandler: Handler;
let signState: typeof import('../../_google-auth.js').signState;
let verifyState: typeof import('../../_google-auth.js').verifyState;
let parseIdToken: typeof import("../../_google-auth.js").parseIdToken;
let googleRedirectUriProblem: typeof import("../../_google-auth.js").googleRedirectUriProblem;
let issuePlayerToken: typeof import('../../_auth.js').issuePlayerToken;
let verifyPlayerToken: typeof import('../../_auth.js').verifyPlayerToken;

let requestNumber = 0;
/** The id_token the stubbed Google token endpoint will hand back next. */
let nextIdToken: string | null = null;

const NONCE = 'browser-generated-nonce-0001';

function jwt(claims: Record<string, unknown>): string {
    const encode = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
    return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature-not-checked`;
}

function googleClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        iss: 'https://accounts.google.com',
        aud: process.env.GOOGLE_CLIENT_ID,
        sub: '110000000000000000001',
        exp: Math.floor(Date.now() / 1000) + 600,
        email: 'shinobi@example.test',
        email_verified: true,
        given_name: 'Kaze',
        nonce: NONCE,
        ...over,
    };
}

before(async () => {
    const { kv } = await import('../../_storage.js');
    kv.get = async <T,>(key: string) => clone(store.get(key)) as T | null;
    kv.set = async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (options?.nx && store.has(key)) return null;
        store.set(key, clone(value));
        return 'OK' as const;
    };
    kv.del = async (...keys: string[]) => keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
    kv.incr = async (key: string) => {
        const next = (Number(store.get(key)) || 0) + 1;
        store.set(key, next);
        return next;
    };

    // Stand in for Google's token endpoint. Everything the flow trusts is
    // derived from what this returns, so the tests drive it directly.
    globalThis.fetch = (async () => ({
        ok: nextIdToken !== null,
        status: nextIdToken !== null ? 200 : 400,
        json: async () => ({ id_token: nextIdToken }),
    })) as unknown as typeof fetch;

    startHandler = (await import('./start.js')).default as unknown as Handler;
    callbackHandler = (await import('./callback.js')).default as unknown as Handler;
    claimHandler = (await import('./claim.js')).default as unknown as Handler;
    playerAuthHandler = (await import('../../player-auth.js')).default as unknown as Handler;

    const google = await import('../../_google-auth.js');
    signState = google.signState;
    verifyState = google.verifyState;
    parseIdToken = google.parseIdToken;
    googleRedirectUriProblem = google.googleRedirectUriProblem;

    const auth = await import('../../_auth.js');
    issuePlayerToken = auth.issuePlayerToken;
    verifyPlayerToken = auth.verifyPlayerToken;
});

beforeEach(() => {
    store.clear();
    nextIdToken = jwt(googleClaims());
    delete process.env.DISABLE_GOOGLE_AUTH;
    delete process.env.DISABLE_NEW_REGISTRATIONS;
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
});

function fakeReq(
    method: string,
    { body, query, headers }: { body?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {},
) {
    requestNumber += 1;
    const ip = `10.30.${Math.floor(requestNumber / 250)}.${(requestNumber % 250) + 1}`;
    return {
        method,
        body,
        query: query ?? {},
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
        socket: { remoteAddress: ip },
    } as never;
}

function fakeRes() {
    const out: ResponseOut = { statusCode: 200, body: undefined, headers: {} };
    const res = {
        setHeader: (name: string, value: string) => { out.headers[name.toLowerCase()] = value; return res; },
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function call(handler: Handler, method: string, opts?: Parameters<typeof fakeReq>[1]): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    await handler(fakeReq(method, opts), res);
    return out;
}

/** Read the outcome + ticket the callback put on its 302 Location. */
function bounceParams(out: ResponseOut): { gauth: string; gticket: string } {
    const location = out.headers.location ?? '';
    const query = new URLSearchParams(location.slice(location.indexOf('?') + 1));
    return { gauth: query.get('gauth') ?? '', gticket: query.get('gticket') ?? '' };
}

/** Drive a whole login-mode round trip and return the callback's bounce. */
async function runLoginFlow(nonce = NONCE): Promise<ResponseOut> {
    const state = signState({ mode: 'login', nonce });
    return call(callbackHandler, 'GET', { query: { code: 'auth-code', state } });
}

describe('google sign-in', () => {
    describe('signed state', () => {
        it('round-trips and rejects tampering, expiry, and truncation', () => {
            const state = signState({ mode: 'login', nonce: NONCE });
            assert.equal(verifyState(state)?.mode, 'login');
            assert.equal(verifyState(state)?.nonce, NONCE);

            const [payload, sig] = state.split('.');
            assert.equal(verifyState(`${payload}x.${sig}`), null, 'a tampered payload must not verify');
            assert.equal(verifyState(`${payload}.${sig}x`), null, 'a tampered signature must not verify');
            assert.equal(verifyState(payload), null, 'an unsigned state must not verify');
            assert.equal(verifyState(''), null);

            assert.equal(verifyState(signState({ mode: 'login', nonce: NONCE }, -1)), null, 'expired state');
            assert.equal(verifyState(signState({ mode: 'login', nonce: 'short' })), null, 'a weak nonce is refused');
            // Link mode without a target account is meaningless and must not verify.
            assert.equal(verifyState(signState({ mode: 'link', nonce: NONCE })), null);
            assert.equal(verifyState(signState({ mode: 'link', name: 'kaze', epoch: 0, nonce: NONCE }))?.name, 'kaze');
        });
    });

    // Google matches redirect_uri as an exact string, so every near-miss fails
    // on GOOGLE's page in front of the player and never reaches our logs. These
    // catch the shapes that would do that.
    describe('redirect uri', () => {
        const cases: [string, string | null][] = [
            ['https://shinobijourney.com/api/auth/google/callback', null],
            ['http://localhost:3000/api/auth/google/callback', null],
            ['', 'not set'],
            ['not-a-url', 'not a valid URL'],
            ['http://shinobijourney.com/api/auth/google/callback', 'must use https'],
            ['https://shinobijourney.com/api/auth/google/callback/', 'must end in'],
            ['https://shinobijourney.com/auth/google/callback', 'must end in'],
            ['https://shinobijourney.com/api/auth/google/callback?x=1', 'query string'],
            ['https://www.shinobijourney.com/api/auth/google/callback', 'apex host'],
        ];

        it('accepts the apex callback and localhost, and names every near-miss', () => {
            for (const [value, expected] of cases) {
                const problem = googleRedirectUriProblem({ GOOGLE_REDIRECT_URI: value } as NodeJS.ProcessEnv);
                if (expected === null) {
                    assert.equal(problem, null, `"${value}" should be accepted`);
                } else {
                    assert.match(String(problem), new RegExp(expected, 'i'), `"${value}" should be refused`);
                }
            }
        });

        it('treats a broken redirect URI as unconfigured, so no dead button is shown', async () => {
            const good = process.env.GOOGLE_REDIRECT_URI;
            process.env.GOOGLE_REDIRECT_URI = 'http://www.shinobijourney.com/nope';
            try {
                const out = await call(startHandler, 'POST', { body: { nonce: NONCE } });
                assert.equal(out.statusCode, 503);
            } finally {
                process.env.GOOGLE_REDIRECT_URI = good;
            }
        });
    });

    describe('id token claims', () => {
        it('accepts a well-formed token and refuses every bad claim', () => {
            assert.equal(parseIdToken(jwt(googleClaims()), NONCE)?.sub, '110000000000000000001');

            const rejected: [string, Record<string, unknown>][] = [
                ['a token minted for another client', { aud: 'someone-elses-client-id' }],
                ['a token from another issuer', { iss: 'https://accounts.evil.test' }],
                ['an expired token', { exp: Math.floor(Date.now() / 1000) - 10 }],
                ['a token for a different sign-in attempt', { nonce: 'a-different-nonce-entirely' }],
                ['an unverified email address', { email_verified: false }],
                ['a token with no subject', { sub: '' }],
            ];
            for (const [why, over] of rejected) {
                assert.equal(parseIdToken(jwt(googleClaims(over)), NONCE), null, `must reject ${why}`);
            }
            assert.equal(parseIdToken('not-a-jwt', NONCE), null);
        });
    });

    describe('start', () => {
        it('refuses GET, so the signed state never rides a readable cross-origin response', async () => {
            assert.equal((await call(startHandler, 'GET')).statusCode, 405);
        });

        it('hands back an authorize URL carrying the redirect URI and nonce', async () => {
            const out = await call(startHandler, 'POST', { body: { nonce: NONCE } });
            assert.equal(out.statusCode, 200);
            const url = new URL(String(out.body?.url));
            assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
            assert.equal(url.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID);
            assert.equal(url.searchParams.get('redirect_uri'), process.env.GOOGLE_REDIRECT_URI);
            assert.equal(url.searchParams.get('nonce'), NONCE);
            assert.equal(verifyState(url.searchParams.get('state')!)?.mode, 'login');
        });

        it('rejects a missing or too-short nonce', async () => {
            assert.equal((await call(startHandler, 'POST', { body: {} })).statusCode, 400);
            assert.equal((await call(startHandler, 'POST', { body: { nonce: 'tiny' } })).statusCode, 400);
        });

        it('refuses link mode without proof of the account', async () => {
            const out = await call(startHandler, 'POST', { body: { nonce: NONCE, mode: 'link' } });
            assert.equal(out.statusCode, 401);
        });

        it('is unavailable while the kill switch is on', async () => {
            process.env.DISABLE_GOOGLE_AUTH = '1';
            assert.equal((await call(startHandler, 'POST', { body: { nonce: NONCE } })).statusCode, 503);
        });

        it('is unavailable without SESSION_SECRET, rather than minting an unusable account', async () => {
            const secret = process.env.SESSION_SECRET;
            delete process.env.SESSION_SECRET;
            try {
                assert.equal((await call(startHandler, 'POST', { body: { nonce: NONCE } })).statusCode, 503);
            } finally {
                process.env.SESSION_SECRET = secret;
            }
        });
    });

    describe('callback', () => {
        it('sends an unknown Google account to signup', async () => {
            const { gauth, gticket } = bounceParams(await runLoginFlow());
            assert.equal(gauth, 'signup');
            assert.ok(gticket, 'a ticket must be issued');
            assert.equal(store.has('auth-google:110000000000000000001'), false, 'no identity is claimed until signup completes');
        });

        it('resolves a Google account that already owns a shinobi', async () => {
            store.set('auth:kaze', { google: { sub: '110000000000000000001', email: 'x@y.test', linkedAt: 1 }, sessionEpoch: 0 });
            store.set('auth-google:110000000000000000001', { name: 'kaze' });

            const { gauth, gticket } = bounceParams(await runLoginFlow());
            assert.equal(gauth, 'ok');

            const claimed = await call(claimHandler, 'POST', { body: { ticket: gticket, nonce: NONCE } });
            assert.equal(claimed.statusCode, 200);
            assert.equal(claimed.body?.name, 'kaze');
            assert.equal(await verifyPlayerToken(String(claimed.body?.token)), 'kaze');
            assert.equal(claimed.body?.email, undefined, 'the email must never be echoed to the ticket holder');
        });

        it('sends a stale index row to signup instead of a token for a deleted player', async () => {
            // The account is gone (server reset, or a delete that raced the flow)
            // but the reverse index still points at it.
            store.set('auth-google:110000000000000000001', { name: 'ghost' });
            const { gauth } = bounceParams(await runLoginFlow());
            assert.equal(gauth, 'signup');
            assert.equal(store.has('auth-google:110000000000000000001'), false, 'the dangling row is cleaned up');
        });

        it('bounces to error when Google refuses the code exchange', async () => {
            nextIdToken = null;
            assert.equal(bounceParams(await runLoginFlow()).gauth, 'error');
        });

        it('bounces to error on a forged or absent state', async () => {
            const forged = await call(callbackHandler, 'GET', { query: { code: 'c', state: 'forged.state' } });
            assert.equal(bounceParams(forged).gauth, 'error');
            const none = await call(callbackHandler, 'GET', { query: { code: 'c' } });
            assert.equal(bounceParams(none).gauth, 'error');
        });

        it('refuses an id_token whose nonce is not the one this flow sent', async () => {
            // A token replayed from a different sign-in attempt must not pass.
            nextIdToken = jwt(googleClaims({ nonce: 'nonce-from-another-attempt' }));
            assert.equal(bounceParams(await runLoginFlow()).gauth, 'error');
        });
    });

    describe('linking an existing account', () => {
        async function linkFlow(name: string, epoch: number) {
            const state = signState({ mode: 'link', name, epoch, nonce: NONCE });
            return call(callbackHandler, 'GET', { query: { code: 'auth-code', state } });
        }

        it('attaches the identity and indexes it both ways', async () => {
            store.set('auth:kaze', { hash: 'scrypt:x', salt: 's', sessionEpoch: 0 });
            assert.equal(bounceParams(await linkFlow('kaze', 0)).gauth, 'linked');

            const record = store.get('auth:kaze') as { google?: { sub: string }; hash?: string };
            assert.equal(record.google?.sub, '110000000000000000001');
            assert.equal(record.hash, 'scrypt:x', 'linking must not disturb the existing password');
            assert.deepEqual(store.get('auth-google:110000000000000000001'), { name: 'kaze' });
        });

        it('refuses a link authorised by a session that has since ended', async () => {
            store.set('auth:kaze', { hash: 'scrypt:x', salt: 's', sessionEpoch: 3 });
            store.set('auth-session:kaze', 3);
            // The state was signed while the epoch was 0 — a logout or password
            // change has moved it since, so this link must not complete.
            assert.equal(bounceParams(await linkFlow('kaze', 0)).gauth, 'expired');
            assert.equal((store.get('auth:kaze') as { google?: unknown }).google, undefined);
        });

        it('refuses a Google account that already belongs to someone else', async () => {
            store.set('auth:kaze', { hash: 'scrypt:x', salt: 's', sessionEpoch: 0 });
            store.set('auth:rival', { google: { sub: '110000000000000000001', email: '', linkedAt: 1 } });
            store.set('auth-google:110000000000000000001', { name: 'rival' });

            assert.equal(bounceParams(await linkFlow('kaze', 0)).gauth, 'taken');
            assert.equal((store.get('auth:kaze') as { google?: unknown }).google, undefined);
            assert.deepEqual(store.get('auth-google:110000000000000000001'), { name: 'rival' });
        });

        it('converts a guest in place and revokes its pre-claim credential', async () => {
            store.set('auth:wanderer', { guest: true, sessionEpoch: 0, createdAt: 1 });
            store.set('auth-session:wanderer', 0);
            const guestToken = issuePlayerToken('wanderer', undefined, 0)!;
            assert.equal(await verifyPlayerToken(guestToken), 'wanderer');

            assert.equal(bounceParams(await linkFlow('wanderer', 0)).gauth, 'linked');

            const record = store.get('auth:wanderer') as { guest?: true; google?: { sub: string } };
            assert.equal(record.guest, undefined, 'the account is no longer disposable');
            assert.equal(record.google?.sub, '110000000000000000001');
            assert.equal(
                await verifyPlayerToken(guestToken),
                null,
                'the anonymous browser must not keep a credential to an account that now has an owner',
            );
        });
    });

    describe('claim', () => {
        it('is single-use, so a replayed ticket buys nothing', async () => {
            store.set('auth:kaze', { google: { sub: '110000000000000000001', email: '', linkedAt: 1 }, sessionEpoch: 0 });
            store.set('auth-google:110000000000000000001', { name: 'kaze' });
            const { gticket } = bounceParams(await runLoginFlow());

            assert.equal((await call(claimHandler, 'POST', { body: { ticket: gticket, nonce: NONCE } })).statusCode, 200);
            const replay = await call(claimHandler, 'POST', { body: { ticket: gticket, nonce: NONCE } });
            assert.equal(replay.statusCode, 410);
            assert.equal(replay.body?.token, undefined);
        });

        it('is useless without the nonce the starting browser generated', async () => {
            store.set('auth:kaze', { google: { sub: '110000000000000000001', email: '', linkedAt: 1 }, sessionEpoch: 0 });
            store.set('auth-google:110000000000000000001', { name: 'kaze' });
            const { gticket } = bounceParams(await runLoginFlow());

            const stolen = await call(claimHandler, 'POST', { body: { ticket: gticket, nonce: 'attacker-guessed-nonce' } });
            assert.equal(stolen.statusCode, 410);
            assert.equal(stolen.body?.token, undefined);
        });

        it('refuses a banned account, so Google is not a way around the ban', async () => {
            store.set('auth:kaze', { google: { sub: '110000000000000000001', email: '', linkedAt: 1 }, sessionEpoch: 0 });
            store.set('auth-google:110000000000000000001', { name: 'kaze' });
            store.set('mod:ban:kaze', { until: Date.now() + 86_400_000, reason: 'cheating', permanent: false });

            const { gticket } = bounceParams(await runLoginFlow());
            const claimed = await call(claimHandler, 'POST', { body: { ticket: gticket, nonce: NONCE } });
            assert.equal(claimed.statusCode, 403);
            assert.equal(claimed.body?.token, undefined);
        });
    });

    describe('signup', () => {
        async function signupTicketFor(): Promise<string> {
            const { gticket } = bounceParams(await runLoginFlow());
            const claimed = await call(claimHandler, 'POST', { body: { ticket: gticket, nonce: NONCE } });
            assert.equal(claimed.body?.needsSignup, true);
            return String(claimed.body?.signupTicket);
        }

        it('creates a passwordless account owned by the Google subject', async () => {
            const ticket = await signupTicketFor();
            const created = await call(playerAuthHandler, 'POST', {
                body: { action: 'register-google', name: 'Kaze', signupTicket: ticket, nonce: NONCE },
            });
            assert.equal(created.statusCode, 200);
            assert.equal(await verifyPlayerToken(String(created.body?.token)), 'kaze');

            const record = store.get('auth:kaze') as { hash?: string; google?: { sub: string } };
            assert.equal(record.hash, undefined, 'a Google account stores no password');
            assert.equal(record.google?.sub, '110000000000000000001');
            assert.deepEqual(store.get('auth-google:110000000000000000001'), { name: 'kaze' });
        });

        it('consumes the signup ticket, so it cannot mint a second account', async () => {
            const ticket = await signupTicketFor();
            assert.equal((await call(playerAuthHandler, 'POST', {
                body: { action: 'register-google', name: 'Kaze', signupTicket: ticket, nonce: NONCE },
            })).statusCode, 200);

            const second = await call(playerAuthHandler, 'POST', {
                body: { action: 'register-google', name: 'Kaze2', signupTicket: ticket, nonce: NONCE },
            });
            assert.equal(second.statusCode, 410);
            assert.equal(store.has('auth:kaze2'), false);
        });

        it('releases the identity and the ticket when the chosen name is taken', async () => {
            store.set('auth:kaze', { hash: 'scrypt:x', salt: 's' });
            const ticket = await signupTicketFor();
            const clash = await call(playerAuthHandler, 'POST', {
                body: { action: 'register-google', name: 'Kaze', signupTicket: ticket, nonce: NONCE },
            });
            assert.equal(clash.statusCode, 409);
            assert.equal(
                store.has('auth-google:110000000000000000001'),
                false,
                'a failed signup must not strand the identity — the player has to be able to retry',
            );

            // "That name is taken" is a routine answer, not a dead end: the same
            // ticket must still work for a second choice of name.
            const retry = await call(playerAuthHandler, 'POST', {
                body: { action: 'register-google', name: 'KazeTwo', signupTicket: ticket, nonce: NONCE },
            });
            assert.equal(retry.statusCode, 200, 'the ticket survives a name collision');
            assert.equal(await verifyPlayerToken(String(retry.body?.token)), 'kazetwo');
        });

        it('applies the same reserved and blocked name gates as a password signup', async () => {
            for (const name of ['admin', 'clan-cheat', 'rill']) {
                const ticket = await signupTicketFor();
                const out = await call(playerAuthHandler, 'POST', {
                    body: { action: 'register-google', name, signupTicket: ticket, nonce: NONCE },
                });
                assert.equal(out.statusCode, 403, `"${name}" must be refused`);
            }
        });

        it('honours the emergency registration switch', async () => {
            const ticket = await signupTicketFor();
            process.env.DISABLE_NEW_REGISTRATIONS = '1';
            const out = await call(playerAuthHandler, 'POST', {
                body: { action: 'register-google', name: 'Kaze', signupTicket: ticket, nonce: NONCE },
            });
            assert.equal(out.statusCode, 503);
            assert.equal(out.body?.code, 'registrations_disabled');
        });
    });
});
