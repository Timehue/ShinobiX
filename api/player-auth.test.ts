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

        // The regression this whole change exists for. `change` spreads the
        // record when it sets a first password, so `guest: true` survives
        // alongside the new hash — and the old `if (!record.guest)` selector
        // therefore let the library computer someone played a guest on go on
        // minting fresh 24h tokens for an account that now has an owner, with
        // the TTL re-stamped on every use. The password never locked it out.
        it('stops resuming once the account is claimed with a PASSWORD, not just Google', async () => {
            const guest = await post({ action: 'guest', name: 'Wanderer' });
            const resume = String(guest.body?.guestResume);
            const guestToken = String(guest.body?.token);

            const claimed = await post(
                { action: 'change', name: 'Wanderer', newPassword: 'ClaimedIt1' },
                { 'x-player-token': guestToken },
            );
            assert.equal(claimed.statusCode, 200);

            const record = store.get('auth:wanderer') as { guest?: true; hash?: string };
            assert.equal(record.guest, true, 'the flag really does survive — this is why the flag alone is not the test');
            assert.ok(record.hash, 'and the account really does have a password now');

            const stale = await post({ action: 'guest-resume', name: 'Wanderer', guestResume: resume });
            assert.equal(stale.statusCode, 409);
            assert.equal(stale.body?.token, undefined, 'no fresh token for the pre-claim browser');
            assert.equal(
                store.has(`guest-resume:${resume}`),
                false,
                'and the resume key is revoked, not merely refused this once',
            );
            // The old message hardcoded Google, which is wrong for the far more
            // common password claim.
            assert.match(String(stale.body?.error), /password/i);
            assert.ok(!/google/i.test(String(stale.body?.error)), 'must not claim Google for a password-only account');
        });

        it('still resumes a guest that has a session token but no password', async () => {
            // The other side of the predicate: tightening it must not break the
            // ordinary guest, whose resume key is their only way back.
            const guest = await post({ action: 'guest', name: 'Wanderer' });
            const resume = String(guest.body?.guestResume);
            const resumed = await post({ action: 'guest-resume', name: 'Wanderer', guestResume: resume });
            assert.equal(resumed.statusCode, 200);
            assert.equal(await verifyPlayerToken(String(resumed.body?.token)), 'wanderer');
            assert.ok(store.has(`guest-resume:${resume}`), 'an unclaimed guest keeps their key');
        });

        it('names both doors when a claimed account has a password AND Google', async () => {
            const guest = await post({ action: 'guest', name: 'Wanderer' });
            const resume = String(guest.body?.guestResume);
            const guestToken = String(guest.body?.token);
            await post(
                { action: 'change', name: 'Wanderer', newPassword: 'ClaimedIt1' },
                { 'x-player-token': guestToken },
            );
            const record = store.get('auth:wanderer') as Record<string, unknown>;
            record.google = { sub: 'g-2', email: '', linkedAt: 1 };
            store.set('auth:wanderer', record);

            const stale = await post({ action: 'guest-resume', name: 'Wanderer', guestResume: resume });
            assert.equal(stale.statusCode, 409);
            assert.match(String(stale.body?.error), /password/i);
            assert.match(String(stale.body?.error), /Google/i);
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

    // ─── Self-serve recovery ──────────────────────────────────────────────────
    describe('recovery codes', () => {
        async function issueFor(name: string, password: string): Promise<string> {
            const created = await register(name, password);
            const issued = await post(
                { action: 'recovery-issue', name },
                { 'x-player-token': String(created.body?.token) },
            );
            assert.equal(issued.statusCode, 200);
            const code = String(issued.body?.recoveryCode);
            assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
            return code;
        }

        it('mints a code for a player who proves they are already inside', async () => {
            const code = await issueFor('lockedout', 'Original1');
            const stored = store.get('auth-recovery:lockedout') as Record<string, unknown>;
            assert.ok(stored, 'the code is stored server-side');
            assert.equal(JSON.stringify(stored).includes(code.replace(/-/g, '')), false, 'hashed, never the code itself');
        });

        it('accepts the current password when no session token is available', async () => {
            // The SESSION_SECRET-unset fallback path: a player with only a
            // password must still be able to obtain a code.
            await register('nopath', 'Original1');
            const issued = await post({ action: 'recovery-issue', name: 'nopath', password: 'Original1' });
            assert.equal(issued.statusCode, 200);
            assert.ok(issued.body?.recoveryCode);
        });

        it('refuses to mint a code for somebody else', async () => {
            await register('victim', 'Original1');
            const other = await register('attacker', 'Original1');

            for (const attempt of [
                await post({ action: 'recovery-issue', name: 'victim' }),
                await post({ action: 'recovery-issue', name: 'victim', password: 'WrongGuess1' }),
                await post({ action: 'recovery-issue', name: 'victim' }, { 'x-player-token': String(other.body?.token) }),
            ]) {
                assert.equal(attempt.statusCode, 401);
                assert.equal(attempt.body?.recoveryCode, undefined);
            }
            assert.equal(store.has('auth-recovery:victim'), false);
        });

        it('does not leak whether an account exists', async () => {
            // A name nobody has registered must answer exactly as a wrong
            // password does — the leaderboard is a public list of names worth
            // trying, so a distinguishable answer here is an enumeration oracle.
            await register('realname', 'Original1');
            const real = await post({ action: 'recovery-issue', name: 'realname', password: 'WrongGuess1' });
            const fake = await post({ action: 'recovery-issue', name: 'ghostname', password: 'WrongGuess1' });
            assert.equal(real.statusCode, fake.statusCode);
            assert.deepEqual(real.body, fake.body);
        });

        it('replaces the previous code rather than accumulating them', async () => {
            const first = await issueFor('rotator', 'Original1');
            const second = await post({ action: 'recovery-issue', name: 'rotator', password: 'Original1' });
            const secondCode = String(second.body?.recoveryCode);
            assert.notEqual(first, secondCode);

            const stale = await post({
                action: 'recover', name: 'rotator', recoveryCode: first, newPassword: 'Replacement2',
            });
            assert.equal(stale.body?.ok, false, 'the superseded code is dead');
            assert.equal(await verifyPlayerPassword('rotator', 'Original1'), true);

            const good = await post({
                action: 'recover', name: 'rotator', recoveryCode: secondCode, newPassword: 'Replacement2',
            });
            assert.equal(good.body?.ok, true);
        });

        it('redeems a code for a new password, and revokes every prior session', async () => {
            const created = await register('forgetful', 'Original1');
            const oldToken = String(created.body?.token);
            const issued = await post({ action: 'recovery-issue', name: 'forgetful', password: 'Original1' });
            const code = String(issued.body?.recoveryCode);

            const recovered = await post({
                action: 'recover', name: 'forgetful', recoveryCode: code, newPassword: 'Replacement2',
            });
            assert.equal(recovered.statusCode, 200);
            assert.equal(recovered.body?.ok, true);
            assert.equal(await verifyPlayerPassword('forgetful', 'Replacement2'), true);
            assert.equal(await verifyPlayerPassword('forgetful', 'Original1'), false);
            assert.equal(await verifyPlayerToken(oldToken), null, 'recovery rotates the session epoch');
            assert.equal(await verifyPlayerToken(String(recovered.body?.token)), 'forgetful');
        });

        it('is single use, and hands back a replacement in the same breath', async () => {
            const code = await issueFor('oneshot', 'Original1');
            const first = await post({
                action: 'recover', name: 'oneshot', recoveryCode: code, newPassword: 'Replacement2',
            });
            assert.equal(first.body?.ok, true);
            const replacement = String(first.body?.recoveryCode);
            assert.notEqual(replacement, code);

            const replay = await post({
                action: 'recover', name: 'oneshot', recoveryCode: code, newPassword: 'ThirdOne3',
            });
            assert.equal(replay.body?.ok, false, 'a spent code cannot be replayed');
            assert.equal(await verifyPlayerPassword('oneshot', 'Replacement2'), true);

            // And the replacement really works, so nobody is left mid-recovery
            // holding nothing.
            const again = await post({
                action: 'recover', name: 'oneshot', recoveryCode: replacement, newPassword: 'ThirdOne3',
            });
            assert.equal(again.body?.ok, true);
        });

        it('answers identically for a wrong code, a codeless account and no account at all', async () => {
            await issueFor('hascode', 'Original1');
            await register('nocode', 'Original1');
            const wrongCode = 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ';

            const answers = [
                await post({ action: 'recover', name: 'hascode', recoveryCode: wrongCode, newPassword: 'Replacement2' }),
                await post({ action: 'recover', name: 'nocode', recoveryCode: wrongCode, newPassword: 'Replacement2' }),
                await post({ action: 'recover', name: 'ghost', recoveryCode: wrongCode, newPassword: 'Replacement2' }),
                await post({ action: 'recover', name: 'ghost', recoveryCode: 'not-a-code', newPassword: 'Replacement2' }),
            ];
            for (const answer of answers) {
                assert.equal(answer.statusCode, 200);
                assert.deepEqual(answer.body, answers[0].body);
                assert.equal(answer.body?.token, undefined);
            }
            assert.equal(await verifyPlayerPassword('hascode', 'Original1'), true, 'nothing was changed by a failure');
        });

        it('enforces the password policy before touching any stored state', async () => {
            const code = await issueFor('policy', 'Original1');
            const weak = await post({ action: 'recover', name: 'policy', recoveryCode: code, newPassword: 'short' });
            assert.equal(weak.statusCode, 400);
            assert.ok(store.has('auth-recovery:policy'), 'a rejected attempt does not spend the code');
            assert.equal(await verifyPlayerPassword('policy', 'Original1'), true);
        });

        it('refuses to recover a banned account', async () => {
            const code = await issueFor('banned', 'Original1');
            store.set('mod:ban:banned', { until: 0, reason: 'cheating', permanent: true });

            const attempt = await post({
                action: 'recover', name: 'banned', recoveryCode: code, newPassword: 'Replacement2',
            });
            assert.equal(attempt.statusCode, 403);
            assert.equal(attempt.body?.token, undefined);
        });

        it('hands a guest claiming their character the way back, as the resume key dies', async () => {
            // The two halves of this change meeting: claiming with a password
            // revokes the browser's resume credential, so it must be the same
            // response that supplies the replacement credential.
            const guest = await post({ action: 'guest', name: 'Wanderer' });
            const claimed = await post(
                { action: 'change', name: 'Wanderer', newPassword: 'ClaimedIt1' },
                { 'x-player-token': String(guest.body?.token) },
            );
            assert.equal(claimed.statusCode, 200);
            const code = String(claimed.body?.recoveryCode);
            assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);

            const recovered = await post({
                action: 'recover', name: 'Wanderer', recoveryCode: code, newPassword: 'Replacement2',
            });
            assert.equal(recovered.body?.ok, true);
            assert.equal(await verifyPlayerPassword('wanderer', 'Replacement2'), true);
        });

        it('does not invalidate the code a player already wrote down on a routine change', async () => {
            const code = await issueFor('router', 'Original1');
            const changed = await post({
                action: 'change', name: 'router', oldPassword: 'Original1', newPassword: 'Replacement2',
            });
            assert.equal(changed.statusCode, 200);
            assert.equal(changed.body?.recoveryCode, undefined, 'no surprise reissue');

            const recovered = await post({
                action: 'recover', name: 'router', recoveryCode: code, newPassword: 'ThirdOne3',
            });
            assert.equal(recovered.body?.ok, true, 'the code they kept still works');
        });

        it('backfills a code for an account that predates the feature', async () => {
            await register('legacyish', 'Original1');
            store.delete('auth-recovery:legacyish');
            const changed = await post({
                action: 'change', name: 'legacyish', oldPassword: 'Original1', newPassword: 'Replacement2',
            });
            assert.ok(changed.body?.recoveryCode, 'a password change is the moment to close the gap');
        });

        it('drops the code on admin reset and on account deletion', async () => {
            await issueFor('resetme', 'Original1');
            const reset = await post(
                { action: 'adminreset', name: 'resetme', newPassword: 'AdminSet1' },
                { 'x-admin-password': process.env.ADMIN_PASSWORD! },
            );
            assert.equal(reset.statusCode, 200);
            assert.equal(reset.body?.recoveryCode, undefined, 'never handed to the admin');
            assert.equal(store.has('auth-recovery:resetme'), false, 'the outstanding spare key is invalidated');

            await issueFor('deleteme', 'Original1');
            const deleted = await post({ action: 'delete', name: 'deleteme', password: 'Original1' });
            assert.equal(deleted.statusCode, 200);
            assert.equal(store.has('auth-recovery:deleteme'), false);
        });

        it('lets an admin hand the player a code instead of learning their password', async () => {
            // The point of the whole action: the operator relays a code, the
            // player picks a password, and nothing the admin ever saw works as
            // a credential afterwards.
            const created = await register('helpme', 'Forgotten1');
            const oldToken = String(created.body?.token);

            const issued = await post(
                { action: 'admin-recovery', name: 'helpme' },
                { 'x-admin-password': process.env.ADMIN_PASSWORD! },
            );
            assert.equal(issued.statusCode, 200);
            const code = String(issued.body?.recoveryCode);
            assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
            assert.equal(issued.body?.name, 'helpme');

            // Somebody else minting a credential onto the account signs out every
            // session that existed before it — unlike the player's own
            // `recovery-issue`, which deliberately leaves their devices alone.
            assert.equal(await verifyPlayerToken(oldToken), null);

            const recovered = await post({
                action: 'recover', name: 'helpme', recoveryCode: code, newPassword: 'MyOwnChoice2',
            });
            assert.equal(recovered.body?.ok, true);
            assert.equal(await verifyPlayerPassword('helpme', 'MyOwnChoice2'), true);
        });

        it('leaves the password alone, so a lost hand-off does not strand the player', async () => {
            await register('stillmine', 'Forgotten1');
            const issued = await post(
                { action: 'admin-recovery', name: 'stillmine' },
                { 'x-admin-password': process.env.ADMIN_PASSWORD! },
            );
            assert.equal(issued.statusCode, 200);
            // If the code never reaches them, the account is exactly as it was.
            assert.equal(await verifyPlayerPassword('stillmine', 'Forgotten1'), true);
        });

        it('does not re-open the guest doors when it touches a claimed guest', async () => {
            // Clearing the password here would make the record credential-less
            // again, which would revive BOTH the resume key and the 14-day
            // sweep. Assert the record still reads as owned afterwards.
            const guest = await post({ action: 'guest', name: 'Wanderer' });
            const resume = String(guest.body?.guestResume);
            await post(
                { action: 'change', name: 'Wanderer', newPassword: 'ClaimedIt1' },
                { 'x-player-token': String(guest.body?.token) },
            );
            await post(
                { action: 'admin-recovery', name: 'Wanderer' },
                { 'x-admin-password': process.env.ADMIN_PASSWORD! },
            );

            const record = store.get('auth:wanderer') as { hash?: string; salt?: string };
            assert.ok(record.hash && record.salt, 'the account must still count as owned');
            const stale = await post({ action: 'guest-resume', name: 'Wanderer', guestResume: resume });
            assert.equal(stale.statusCode, 409, 'the resume key stays revoked');
        });

        it('refuses admin recovery without admin authority, or for a missing account', async () => {
            await register('guarded', 'Forgotten1');
            const unauthenticated = await post({ action: 'admin-recovery', name: 'guarded' });
            assert.equal(unauthenticated.statusCode, 401);
            assert.equal(unauthenticated.body?.recoveryCode, undefined);
            assert.equal(store.has('auth-recovery:guarded'), false);

            const wrongAdmin = await post(
                { action: 'admin-recovery', name: 'guarded' },
                { 'x-admin-password': 'not-the-admin-password' },
            );
            assert.equal(wrongAdmin.statusCode, 401);

            const missing = await post(
                { action: 'admin-recovery', name: 'nobodyhere' },
                { 'x-admin-password': process.env.ADMIN_PASSWORD! },
            );
            assert.equal(missing.statusCode, 404);
        });

        it('never lets a freed slug inherit the previous holder code', async () => {
            // Slugs are reusable. A recovery row outliving its account would be
            // a working credential to whoever registers the name next.
            await register('recycled', 'Original1');
            store.set('auth-recovery:recycled', { hash: 'stale', salt: 'stale', issuedAt: 1 });
            await post({ action: 'delete', name: 'recycled', password: 'Original1' });

            const reclaimed = await register('recycled', 'BrandNew1');
            assert.equal(reclaimed.statusCode, 200);
            assert.equal(store.has('auth-recovery:recycled'), false, 'the stale row must not survive re-registration');
        });
    });
});
