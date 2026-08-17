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
    kv.delIfEqual = async (key: string, expected: string) => {
        if (store.get(key) !== expected) return false;
        store.delete(key);
        return true;
    };
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
    delete process.env.DISABLE_NEW_REGISTRATIONS;
    delete process.env.MAINTENANCE_MODE;
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
    it('honors the emergency new-registration switch without blocking login', async () => {
        process.env.DISABLE_NEW_REGISTRATIONS = '1';
        const blocked = await register('closedbeta', 'StrongPass1');
        assert.equal(blocked.statusCode, 503);
        assert.equal(blocked.body?.code, 'registrations_disabled');
        assert.equal(store.has('auth:closedbeta'), false);

        delete process.env.DISABLE_NEW_REGISTRATIONS;
        assert.equal((await register('existingbeta', 'StrongPass1')).statusCode, 200);
        process.env.DISABLE_NEW_REGISTRATIONS = '1';
        const login = await post({ action: 'verify', name: 'existingbeta', password: 'StrongPass1' });
        assert.equal(login.statusCode, 200);
        assert.equal(login.body?.ok, true);
    });

    it('enforces the account password policy server-side', async () => {
        assert.match(playerPasswordPolicyError('short1')!, /at least 8/i);
        assert.match(playerPasswordPolicyError('lettersOnly')!, /letter and one number/i);
        assert.match(playerPasswordPolicyError('12345678')!, /letter and one number/i);
        assert.match(playerPasswordPolicyError(`A1${'x'.repeat(127)}`)!, /at most 128/i);
        assert.equal(playerPasswordPolicyError('StrongPass1'), null);

        const weak = await register('weakuser', 'password');
        assert.equal(weak.statusCode, 400);
        assert.equal(store.has('auth:weakuser'), false);

        const oversized = `A1${'x'.repeat(127)}`;
        assert.equal((await post({ action: 'verify', name: 'weakuser', password: oversized })).statusCode, 400);
        assert.equal((await post({ action: 'change', name: 'weakuser', oldPassword: oversized, newPassword: 'AnotherPass2' })).statusCode, 400);
        assert.equal((await post({ action: 'delete', name: 'weakuser', password: oversized })).statusCode, 400);

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

    // A Google or guest account stores no hash/salt at all. Every password
    // comparison must read that as "authentication failed", never as a match,
    // and never as a thrown 500 — a 500 here would be an oracle telling an
    // attacker which names are passwordless, which is exactly what the
    // DUMMY_AUTH_RECORD enumeration guard exists to prevent.
    describe('passwordless accounts', () => {
        const passwordless = { google: { sub: 'g-12345', email: 'a@b.test', linkedAt: 1 }, sessionEpoch: 0 };

        it('never authenticates a passwordless record with any password', async () => {
            store.set('auth:googleonly', { ...passwordless });

            for (const attempt of ['StrongPass1', 'x', 'undefined', 'null', '0']) {
                assert.equal(
                    await verifyPlayerPassword('googleonly', attempt),
                    false,
                    `"${attempt}" must not authenticate a passwordless account`,
                );
            }
            assert.equal(await verifyPlayerPassword('googleonly', ''), false);
        });

        it('answers the password form with a 200 that names the right door', async () => {
            store.set('auth:googleonly', { ...passwordless });
            const attempt = await post({ action: 'verify', name: 'googleonly', password: 'StrongPass1' });
            assert.equal(attempt.statusCode, 200, 'must not throw — a 500 would leak the account type');
            assert.equal(attempt.body?.ok, false);
            assert.equal(attempt.body?.passwordless, true);
            assert.equal(attempt.body?.google, true);
            assert.equal(attempt.body?.token, undefined);
        });

        it('refuses to set a password without a session token for that account', async () => {
            store.set('auth:googleonly', { ...passwordless });
            const noProof = await post({ action: 'change', name: 'googleonly', newPassword: 'BrandNew1' });
            assert.equal(noProof.statusCode, 401);
            assert.equal(await verifyPlayerPassword('googleonly', 'BrandNew1'), false, 'no password may be written');

            // A token for a DIFFERENT account must not grant it either.
            const other = await register('someoneelse', 'StrongPass1');
            const wrongOwner = await post(
                { action: 'change', name: 'googleonly', newPassword: 'BrandNew1' },
                { 'x-player-token': String(other.body?.token) },
            );
            assert.equal(wrongOwner.statusCode, 401);
            assert.equal(await verifyPlayerPassword('googleonly', 'BrandNew1'), false);
        });

        it('lets the account owner set a first password without losing the Google link', async () => {
            store.set('auth:googleonly', { ...passwordless });
            const { issuePlayerToken } = await import('./_auth.js');
            const token = issuePlayerToken('googleonly', undefined, 0)!;

            const set = await post(
                { action: 'change', name: 'googleonly', newPassword: 'BrandNew1' },
                { 'x-player-token': token },
            );
            assert.equal(set.statusCode, 200);
            assert.equal(await verifyPlayerPassword('googleonly', 'BrandNew1'), true);

            const record = store.get('auth:googleonly') as { google?: { sub: string } };
            assert.equal(record.google?.sub, 'g-12345', 'setting a password must not unlink Google');
            assert.equal(await verifyPlayerToken(token), null, 'the epoch rotates, revoking the pre-change token');
        });

        it('lets the owner delete the account by token and releases the Google link', async () => {
            store.set('auth:googleonly', { ...passwordless });
            store.set('auth-google:g-12345', { name: 'googleonly' });
            const { issuePlayerToken } = await import('./_auth.js');
            const token = issuePlayerToken('googleonly', undefined, 0)!;

            const removed = await post({ action: 'delete', name: 'googleonly' }, { 'x-player-token': token });
            assert.equal(removed.statusCode, 200);
            assert.equal(store.has('auth:googleonly'), false);
            assert.equal(store.has('auth-google:g-12345'), false, 'the sub must be released or it can never sign in again');
        });

        it('still refuses a delete with no proof at all', async () => {
            store.set('auth:googleonly', { ...passwordless });
            const denied = await post({ action: 'delete', name: 'googleonly' });
            assert.equal(denied.statusCode, 401);
            assert.equal(store.has('auth:googleonly'), true);
        });
    });

    // Guest play is a real account with a real save and no owner yet. Its whole
    // premise is that the player can come back tomorrow, so the resume
    // credential — not the 24h token — is what has to survive.
    describe('guest play', () => {
        it('creates a passwordless account and hands back a resume credential', async () => {
            const guest = await post({ action: 'guest', name: 'Wanderer' });
            assert.equal(guest.statusCode, 200);
            assert.equal(guest.body?.name, 'wanderer');
            assert.equal(await verifyPlayerToken(String(guest.body?.token)), 'wanderer');

            const record = store.get('auth:wanderer') as { guest?: true; hash?: string; createdAt?: number };
            assert.equal(record.guest, true);
            assert.equal(record.hash, undefined, 'a guest stores no password');
            assert.ok(record.createdAt, 'the sweep needs a floor for a guest who never saves');

            const resume = String(guest.body?.guestResume);
            assert.ok(resume.length > 16, 'the resume credential must be unguessable');
            assert.deepEqual(store.get(`guest-resume:${resume}`), { name: 'wanderer' });
        });

        it('lets a returning guest trade the resume credential for a fresh token', async () => {
            const guest = await post({ action: 'guest', name: 'Wanderer' });
            const resume = String(guest.body?.guestResume);

            const resumed = await post({ action: 'guest-resume', name: 'Wanderer', guestResume: resume });
            assert.equal(resumed.statusCode, 200);
            assert.equal(await verifyPlayerToken(String(resumed.body?.token)), 'wanderer');

            // Deliberately reusable: it is the guest's only way back in, so a
            // dropped response must not lock them out.
            const again = await post({ action: 'guest-resume', name: 'Wanderer', guestResume: resume });
            assert.equal(again.statusCode, 200);
        });

        it('will not resume a name the credential does not belong to', async () => {
            const guest = await post({ action: 'guest', name: 'Wanderer' });
            const resume = String(guest.body?.guestResume);
            await register('someoneelse', 'StrongPass1');

            const probe = await post({ action: 'guest-resume', name: 'someoneelse', guestResume: resume });
            assert.equal(probe.statusCode, 410);
            assert.equal(probe.body?.token, undefined);
        });

        it('stops resuming once the account has a real owner', async () => {
            const guest = await post({ action: 'guest', name: 'Wanderer' });
            const resume = String(guest.body?.guestResume);

            // Standing in for the Google link, which clears the guest flag.
            const record = store.get('auth:wanderer') as Record<string, unknown>;
            delete record.guest;
            record.google = { sub: 'g-1', email: '', linkedAt: Date.now() };
            store.set('auth:wanderer', record);

            const stale = await post({ action: 'guest-resume', name: 'Wanderer', guestResume: resume });
            assert.equal(stale.statusCode, 409);
            assert.equal(stale.body?.token, undefined);
            assert.equal(
                store.has(`guest-resume:${resume}`),
                false,
                'the pre-claim browser must not keep a credential to an owned account',
            );
        });

        it('applies the same name gates and the emergency switch as a password signup', async () => {
            assert.equal((await post({ action: 'guest', name: 'admin' })).statusCode, 403);
            assert.equal((await post({ action: 'guest', name: 'clan-cheat' })).statusCode, 403);

            process.env.DISABLE_NEW_REGISTRATIONS = '1';
            const blocked = await post({ action: 'guest', name: 'Wanderer' });
            assert.equal(blocked.statusCode, 503);
            assert.equal(blocked.body?.code, 'registrations_disabled');
            assert.equal(store.has('auth:wanderer'), false);
        });

        it('refuses guest play with no SESSION_SECRET rather than stranding the account', async () => {
            const secret = process.env.SESSION_SECRET;
            delete process.env.SESSION_SECRET;
            try {
                const out = await post({ action: 'guest', name: 'Wanderer' });
                assert.equal(out.statusCode, 503);
                assert.equal(store.has('auth:wanderer'), false, 'an account nobody can enter must never exist');
            } finally {
                process.env.SESSION_SECRET = secret;
            }
        });

        it('cannot be taken over with a password, and no password can be guessed onto it', async () => {
            await post({ action: 'guest', name: 'Wanderer' });
            assert.equal(await verifyPlayerPassword('wanderer', 'StrongPass1'), false);

            const hijack = await register('Wanderer', 'StrongPass1');
            assert.equal(hijack.statusCode, 409, 'the slug is taken — register must not overwrite it');
            const record = store.get('auth:wanderer') as { guest?: true; hash?: string };
            assert.equal(record.guest, true);
            assert.equal(record.hash, undefined);
        });
    });

    it('rejects blocked usernames server-side, including a leetspeak variant', async () => {
        const blocked = await register('n1gger-ninja', 'StrongPass1');
        assert.equal(blocked.statusCode, 400);
        assert.match(String(blocked.body?.error), /not allowed/i);
        assert.equal(store.has('auth:n1gger-ninja'), false);
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

    it('does not reveal whether an ordinary account name is unused during verify', async () => {
        const unused = await post({ action: 'verify', name: 'nobody', password: 'AnyPass1' });
        assert.equal(unused.statusCode, 200);
        assert.deepEqual(unused.body, { ok: false });

        // Legacy recovery remains an explicit, admin-mediated state rather than
        // a claimable login path.
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
