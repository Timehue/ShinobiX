import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { recoverShowdownSession, forfeitShowdown, type ShowdownStateView } from './pet-showdown-api.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const state = (finished = false, outcome: 'win' | 'loss' | null = null) => ({ sessionId: 'sealed', finished, outcome, format: '3v3' } as ShowdownStateView);

test('recovery distinguishes an expired session from outages and malformed successes', async () => {
    globalThis.fetch = async () => json({}, 404);
    assert.deepEqual(await recoverShowdownSession('Rin', 'sealed'), { expired: true });
    for (const response of [json({}, 503), new Response('<html>Unavailable</html>'), json({ state: state() }, 503), json({ state: { ...state(), sessionId: 'another' } })]) {
        globalThis.fetch = async () => response;
        assert.ok('error' in await recoverShowdownSession('Rin', 'sealed'));
    }
    globalThis.fetch = async () => { throw new Error('Offline'); };
    assert.ok('error' in await recoverShowdownSession('Rin', 'sealed'));
});

test('an active session restores its exact format without advancing a round', async () => {
    const requests: unknown[] = [];
    globalThis.fetch = async (_input, init) => { requests.push(JSON.parse(String(init?.body))); return json({ state: state() }); };
    assert.deepEqual(await recoverShowdownSession('Rin', 'sealed'), { state: state() });
    assert.deepEqual(requests, [{ action: 'state', playerName: 'Rin', sessionId: 'sealed' }]);
});

for (const outcome of ['win', 'loss'] as const) test(`a finished ${outcome} recovers the authoritative terminal receipt`, async () => {
    const requests: { action: string; commands?: unknown[] }[] = [];
    const settlement = { ok: true, state: state(true, outcome), events: [], character: { name: 'Rin', ryo: 1234 }, _saveVersion: 8 };
    globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)); requests.push(body);
        return json(body.action === 'state' ? { state: state(true, outcome) } : settlement);
    };
    assert.deepEqual(await recoverShowdownSession('Rin', 'sealed'), { state: state(true, outcome), settlement });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], { action: 'turn', playerName: 'Rin', sessionId: 'sealed', commands: [] });
});

test('a finished state without a confirmed receipt stays recoverable', async () => {
    globalThis.fetch = async (_input, init) => json(JSON.parse(String(init?.body)).action === 'state' ? { state: state(true, 'win') } : {});
    assert.ok('error' in await recoverShowdownSession('Rin', 'sealed'));
});

test('a concession needs an explicit server acknowledgment', async () => {
    for (const response of [json({}), json({ ok: false }), new Response('<html>Proxy page</html>')]) {
        globalThis.fetch = async () => response;
        assert.equal(await forfeitShowdown('Rin', 'sealed'), false);
    }
    globalThis.fetch = async () => json({ ok: true });
    assert.equal(await forfeitShowdown('Rin', 'sealed'), true);
});
