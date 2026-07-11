import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'test';
process.env.SESSION_SECRET = 'player-auth-session-test-secret';
process.env.ADMIN_PASSWORD = 'full-admin-test-password';

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };

const store = new Map<string, unknown>();
const clone = <T>(value: T): T => (
    value === undefined || value === null ? value : JSON.parse(JSON.stringify(value)) as T
);

let handler: Handler;
let verifyPlayerPassword: (name: string, password: string) => Promise<boolean>;
let verifyPlayerToken: (token: string) => Promise<string | null>;
let playerPasswordPolicyError: (password: unknown) => string | null;
let requestNumber = 0;
let failNextAuthWrite = false;

before(async () => {
    const { kv } = await import('./_storage.js');
    kv.get = async <T,>(key: string) => clone(store.get(key)) as T | null;
    kv.set = async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (options?.nx && store.has(key)) return null;
        if (failNextAuthWrite && key.startsWith('auth:') && !options?.nx) {
            failNextAuthWrite = false;
            throw new Error('simulated auth write failure');
        }
        store.set(key, clone(value));
        return 'OK' as const;
    };
    kv.del = async (...keys: string[]) => keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
    kv.incr = async (key: string) => {
        const next = (Number(store.get(key)) || 0) + 1;
        store.set(key, next);
        return next;
    };

    const authModule = await import('./player-auth.js');
    const sessionModule = await import('./_auth.js');
    handler = authModule.default as unknown as Handler;
    verifyPlayerPassword = authModule.verifyPlayerPassword;
    playerPasswordPolicyError = authModule.playerPasswordPolicyError;
    verifyPlayerToken = sessionModule.verifyPlayerToken;
});

beforeEach(() => {
    store.clear();
    failNextAuthWrite = false;
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_PASSWORD;
});

function fakeReq(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    requestNumber += 1;
    const ip = `10.20.${Math.floor(requestNumber / 250)}.${(requestNumber % 250) + 1}`;
    return {
        method: 'POST',
        body,
        headers: {
            'content-type': 'application/json',
            'x-forwarded-for': ip,
            ...headers,
        },
        socket: { remoteAddress: ip },
    } as never;
}

function fakeRes() {
    const out: ResponseOut = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => {
            out.statusCode = statusCode;
            return res;
        },
        json: (body: Record<string, unknown>) => {
            out.body = body;
            return res;
        },
        end: () => res,
    };
    return { res: res as never, out };
}

async function post(body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    await handler(fakeReq(body, headers), res);
    return out;
}

async function register(name: string, password = 'StrongPass1'): Promise<ResponseOut> {
    return post({ action: 'register', name, password });
}

describe('player auth hardening', () => {
    it('enforces the account password policy server-side', async () => {
        assert.match(playerPasswordPolicyError('short1')!, /at least 8/i);
        assert.match(playerPasswordPolicyError('lettersOnly')!, /letter and one number/i);
        assert.match(playerPasswordPolicyError('12345678')!, /letter and one number/i);
        assert.match(playerPasswordPolicyError(`A1${'x'.repeat(127)}`)!, /at most 128/i);
        assert.equal(playerPasswordPolicyError('StrongPass1'), null);

        const weak = await register('weakuser', 'password');
        assert.equal(weak.statusCode, 400);
        assert.equal(store.has('auth:weakuser'), false);

        await register('policyuser', 'Original1');
        const weakChange = await post({
            action: 'change',
            name: 'policyuser',
            oldPassword: 'Original1',
            newPassword: 'lettersOnly',
        });
        assert.equal(weakChange.statusCode, 400);
        assert.equal(store.get('auth-session:policyuser'), undefined);

        const weakAdminReset = await post({
            action: 'adminreset',
            name: 'policyuser',
            newPassword: '12345678',
        }, { 'x-admin-password': process.env.ADMIN_PASSWORD! });
        assert.equal(weakAdminReset.statusCode, 400);

        const reused = await post({
            action: 'change',
            name: 'policyuser',
            oldPassword: 'Original1',
            newPassword: 'Original1',
        });
        assert.equal(reused.statusCode, 400);
        assert.equal(await verifyPlayerPassword('policyuser', 'Original1'), true);
    });

    it('does not let change claim an unused name', async () => {
        const result = await post({
            action: 'change',
            name: 'unused',
            oldPassword: 'Anything1',
            newPassword: 'NewSecure2',
        });
        assert.equal(result.statusCode, 404);
        assert.equal(result.body?.ok, false);
        assert.equal(store.has('auth:unused'), false);
    });

    it('does not let change claim a legacy save without an auth record', async () => {
        store.set('save:legacyhero', { character: { name: 'Legacy Hero' } });
        const result = await post({
            action: 'change',
            name: 'legacyhero',
            oldPassword: 'GuessedOld1',
            newPassword: 'AttackerNew2',
        });
        assert.equal(result.statusCode, 409);
        assert.equal(result.body?.legacyNeedsAdmin, true);
        assert.equal(store.has('auth:legacyhero'), false);
    });

    it('distinguishes an unused name from a real legacy save during verify', async () => {
        const unused = await post({ action: 'verify', name: 'nobody', password: 'AnyPass1' });
        assert.equal(unused.statusCode, 200);
        assert.deepEqual(unused.body, { ok: false, unused: true });

        store.set('save:oldtimer', { character: { name: 'Old Timer' } });
        const legacy = await post({ action: 'verify', name: 'oldtimer', password: 'AnyPass1' });
        assert.equal(legacy.statusCode, 409);
        assert.equal(legacy.body?.ok, false);
        assert.equal(legacy.body?.legacy, true);
        assert.equal(legacy.body?.legacyNeedsAdmin, true);
    });

    it('allows only authenticated admin recovery for a legacy save', async () => {
        store.set('save:oldtimer', { character: { name: 'Old Timer' } });
        const denied = await post({
            action: 'adminreset',
            name: 'oldtimer',
            newPassword: 'Recovered2',
        });
        assert.equal(denied.statusCode, 401);

        const recovered = await post({
            action: 'adminreset',
            name: 'oldtimer',
            newPassword: 'Recovered2',
        }, { 'x-admin-password': process.env.ADMIN_PASSWORD! });
        assert.equal(recovered.statusCode, 200);
        assert.equal(await verifyPlayerPassword('oldtimer', 'Recovered2'), true);
        assert.equal(store.get('auth-session:oldtimer'), 1);
    });

    it('password change immediately invalidates the old token and returns a replacement', async () => {
        const created = await register('alice', 'Original1');
        const oldToken = String(created.body?.token);
        assert.equal(await verifyPlayerToken(oldToken), 'alice');

        const changed = await post({
            action: 'change',
            name: 'alice',
            oldPassword: 'Original1',
            newPassword: 'Replacement2',
        });
        assert.equal(changed.statusCode, 200);
        assert.equal(await verifyPlayerToken(oldToken), null);
        assert.equal(await verifyPlayerToken(String(changed.body?.token)), 'alice');
        assert.equal(await verifyPlayerPassword('alice', 'Original1'), false);
        assert.equal(await verifyPlayerPassword('alice', 'Replacement2'), true);
    });

    it('admin reset immediately invalidates every previously issued token', async () => {
        const created = await register('resetme', 'Original1');
        const oldToken = String(created.body?.token);
        const reset = await post({
            action: 'adminreset',
            name: 'resetme',
            newPassword: 'AdminReset2',
        }, { 'x-admin-password': process.env.ADMIN_PASSWORD! });

        assert.equal(reset.statusCode, 200);
        assert.equal(await verifyPlayerToken(oldToken), null);
        assert.equal(await verifyPlayerPassword('resetme', 'Original1'), false);
        assert.equal(await verifyPlayerPassword('resetme', 'AdminReset2'), true);
    });

    it('account deletion revokes its token and refuses unauthenticated missing-account deletion', async () => {
        const created = await register('deleteme', 'Original1');
        const oldToken = String(created.body?.token);
        const deleted = await post({ action: 'delete', name: 'deleteme', password: 'Original1' });
        assert.equal(deleted.statusCode, 200);
        assert.equal(await verifyPlayerToken(oldToken), null);
        assert.equal(store.has('auth:deleteme'), false);
        assert.equal(store.get('auth-session:deleteme'), 1);

        const missing = await post({ action: 'delete', name: 'ghost', password: 'Whatever1' });
        assert.equal(missing.statusCode, 404);
    });

    it('uses NX so concurrent registrations cannot both claim an account', async () => {
        const [first, second] = await Promise.all([
            register('racer', 'FirstPass1'),
            register('racer', 'SecondPass2'),
        ]);
        assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
        const firstWon = await verifyPlayerPassword('racer', 'FirstPass1');
        const secondWon = await verifyPlayerPassword('racer', 'SecondPass2');
        assert.notEqual(firstWon, secondWon);
    });

    it('serializes concurrent password changes so the same old password succeeds once', async () => {
        await register('changerace', 'Original1');
        const [first, second] = await Promise.all([
            post({ action: 'change', name: 'changerace', oldPassword: 'Original1', newPassword: 'FirstNext1' }),
            post({ action: 'change', name: 'changerace', oldPassword: 'Original1', newPassword: 'SecondNext2' }),
        ]);

        assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 401]);
        const firstWon = await verifyPlayerPassword('changerace', 'FirstNext1');
        const secondWon = await verifyPlayerPassword('changerace', 'SecondNext2');
        assert.notEqual(firstWon, secondWon);
        assert.equal(store.get('auth-session:changerace'), 1);
    });

    it('serializes registration against admin recovery without leaving a stale valid token', async () => {
        const [registration, reset] = await Promise.all([
            register('adminrace', 'Registrant1'),
            post({
                action: 'adminreset',
                name: 'adminrace',
                newPassword: 'AdminWins2',
            }, { 'x-admin-password': process.env.ADMIN_PASSWORD! }),
        ]);

        assert.equal(reset.statusCode, 200);
        assert.ok(registration.statusCode === 200 || registration.statusCode === 409);
        if (registration.statusCode === 200) {
            assert.equal(await verifyPlayerToken(String(registration.body?.token)), null);
        }
        assert.equal(await verifyPlayerPassword('adminrace', 'AdminWins2'), true);
    });

    it('fails safely when epoch rotation succeeds but the password write fails', async () => {
        const created = await register('writefail', 'Original1');
        const oldToken = String(created.body?.token);
        failNextAuthWrite = true;

        const changed = await post({
            action: 'change',
            name: 'writefail',
            oldPassword: 'Original1',
            newPassword: 'Replacement2',
        });
        assert.equal(changed.statusCode, 503);
        assert.equal(await verifyPlayerToken(oldToken), null, 'rotation revokes the old token even on write failure');
        assert.equal(await verifyPlayerPassword('writefail', 'Original1'), true, 'the old hash remains intact');

        const login = await post({ action: 'verify', name: 'writefail', password: 'Original1' });
        assert.equal(login.statusCode, 200);
        assert.equal(login.body?.ok, true);
        assert.equal(login.body?.token, undefined, 'a stale auth row must not mint an unusable token');
    });
});
