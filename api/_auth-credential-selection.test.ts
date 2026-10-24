import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let auth: typeof import('./_auth.js');
let resetLimits: () => void;
const priorSecret = process.env.SESSION_SECRET;
const NAME = 'credentialproof';
const PASSWORD = 'Credential-Proof-Password1!';

before(async () => {
    ({ kv } = await import('./_storage.js'));
    auth = await import('./_auth.js');
    ({ __resetRateLimitsForTest: resetLimits } = await import('./_ratelimit.js'));
    const { authKey, hashPw } = await import('./player-auth.js');
    const salt = 'credential-selection-test-salt';
    await kv.set(authKey(NAME), { salt, hash: hashPw(PASSWORD, salt) });
});

beforeEach(() => {
    process.env.SESSION_SECRET = 'credential-selection-secret-at-least-32-bytes';
    resetLimits();
});

after(() => {
    if (priorSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = priorSecret;
});

function request(headers: Record<string, string> = {}) {
    return { headers, socket: { remoteAddress: '10.79.0.1' } };
}

// A caller chooses which credential to send, but that never chooses whether
// proof is required. Both branches of the reported token-presence conditional
// must establish an identity before returning it.
for (const token of [undefined, '', 'not-a-token']) {
    test(`token presence ${JSON.stringify(token)} cannot authenticate by itself`, async () => {
        const headers: Record<string, string> = { 'x-player-name': NAME };
        if (token !== undefined) headers['x-player-token'] = token;
        assert.equal(await auth.authedPlayer(request(headers)), null);
    });
}

test('a changed signature cannot select a trusted token identity', async () => {
    const token = auth.issuePlayerToken(NAME)!;
    const changed = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    assert.equal(await auth.authedPlayer(request({ 'x-player-name': NAME, 'x-player-token': changed })), null);
});

test('a valid token cannot authenticate a different claimed player', async () => {
    const token = auth.issuePlayerToken(NAME)!;
    assert.equal(await auth.authedPlayer(request({ 'x-player-name': 'another-player', 'x-player-token': token })), null);
});

test('a token without a claimed name returns only its verified subject', async () => {
    const token = auth.issuePlayerToken(NAME)!;
    assert.equal(await auth.authedPlayer(request({ 'x-player-token': token })), NAME);
});

test('the password branch still verifies credentials when no token is sent', async () => {
    assert.equal(await auth.authedPlayer(request({ 'x-player-name': NAME, 'x-player-password': 'wrong' })), null);
    assert.equal(await auth.authedPlayer(request({ 'x-player-name': NAME, 'x-player-password': PASSWORD })), NAME);
});

test('an invalid token falls back only to a separately valid password', async () => {
    const headers = { 'x-player-name': NAME, 'x-player-token': 'invalid-but-present' };
    assert.equal(await auth.authedPlayer(request({ ...headers, 'x-player-password': 'wrong' })), null);
    assert.equal(await auth.authedPlayer(request({ ...headers, 'x-player-password': PASSWORD })), NAME);
});

test('a verified player identity cannot become another bank account through the name header', async () => {
    const handler = (await import('./bank/transfer.js')).default as unknown as typeof import('./bank/transfer.js').default;
    const result: { statusCode: number; body?: unknown } = { statusCode: 200 };
    const response = {
        setHeader() { return response; },
        status(code: number) { result.statusCode = code; return response; },
        json(body: unknown) { result.body = body; return response; },
        end() { return response; },
    };
    await handler({
        method: 'POST', query: {},
        body: { playerName: 'another-player', action: 'withdraw', amount: 100 },
        ...request({ 'x-player-name': NAME, 'x-player-token': auth.issuePlayerToken(NAME)! }),
    } as never, response as never);
    assert.equal(result.statusCode, 403, JSON.stringify(result.body));
});
