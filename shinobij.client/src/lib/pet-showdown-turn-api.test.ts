import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { submitShowdownTurn } from './pet-showdown-api.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
});

test('a 503 retry retains the displayed round, including initial round zero', async () => {
    const calls: unknown[] = [];
    const commands = [{ kind: 'guard' as const, petId: 'owned-pet' }];
    const expected = { ok: true, events: [], state: { sessionId: 'sealed', round: 1 } };
    globalThis.fetch = async (_input, init) => {
        calls.push(JSON.parse(String(init?.body)));
        return calls.length === 1 ? json({ error: 'busy' }, 503) : json(expected);
    };
    assert.deepEqual(await submitShowdownTurn('Rin', 'sealed', commands, 0), expected);
    assert.deepEqual(calls, Array.from({ length: 2 }, () => ({ action: 'turn', playerName: 'Rin', sessionId: 'sealed', commands, expectedRound: 0 })));
});

test('a stale-round recovery returns the latest state without fabricating combat events', async () => {
    const expected = { ok: true, events: [], state: { sessionId: 'sealed', round: 4 } };
    globalThis.fetch = async (_input, init) => {
        assert.equal(JSON.parse(String(init?.body)).expectedRound, 3);
        return json(expected);
    };
    assert.deepEqual(await submitShowdownTurn('Rin', 'sealed', [], 3), expected);
});

test('terminal settlement recovery can omit the round and session expiry remains explicit', async () => {
    globalThis.fetch = async (_input, init) => {
        assert.equal(Object.hasOwn(JSON.parse(String(init?.body)), 'expectedRound'), false);
        return json({ error: 'No active showdown.' }, 404);
    };
    assert.deepEqual(await submitShowdownTurn('Rin', 'sealed', []), { expired: true });
});
