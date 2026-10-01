import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let auth: typeof import('./_auth.js');
const PRIOR_SECRET = process.env.SESSION_SECRET;
const NAME = 'budgetuser';
const PASSWORD = 'Budget-Password1!';

before(async () => {
    ({ kv } = await import('./_storage.js'));
    auth = await import('./_auth.js');
    const { authKey, hashPw } = await import('./player-auth.js');
    const salt = 'budget-test-salt';
    await kv.set(authKey(NAME), { salt, hash: hashPw(PASSWORD, salt) });
});

after(() => {
    if (PRIOR_SECRET === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = PRIOR_SECRET;
});

const passwordReq = (ip: string) => ({
    headers: { 'x-player-name': NAME, 'x-player-password': PASSWORD },
    socket: { remoteAddress: ip },
});

test('with session tokens enabled, correct-password verifies are capped per IP', async () => {
    process.env.SESSION_SECRET = 'password-budget-test-secret';
    const ip = '10.77.0.1';
    for (let i = 0; i < auth.PASSWORD_ATTEMPT_LIMIT; i++) {
        assert.equal(await auth.authedPlayer(passwordReq(ip)), NAME, `attempt ${i + 1} is within budget`);
    }
    assert.equal(await auth.authedPlayer(passwordReq(ip)), null, 'one account cannot keep paying for scrypt with its own password');
    assert.equal(await auth.authedPlayer(passwordReq('10.77.0.2')), NAME, 'the budget is per IP');

    const token = auth.issuePlayerToken(NAME);
    assert.ok(token);
    assert.equal(await auth.authedPlayer({ headers: { 'x-player-token': token! }, socket: { remoteAddress: ip } }), NAME,
        'the token path is never charged, so honest clients on that IP keep playing');
});

test('without SESSION_SECRET the password path carries all traffic and is not capped on success', async () => {
    delete process.env.SESSION_SECRET;
    const ip = '10.77.1.1';
    for (let i = 0; i < auth.PASSWORD_ATTEMPT_LIMIT + 5; i++) {
        assert.equal(await auth.authedPlayer(passwordReq(ip)), NAME, `token-less fallback request ${i + 1} must authenticate`);
    }
});
