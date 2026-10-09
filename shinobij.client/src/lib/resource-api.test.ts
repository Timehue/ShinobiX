import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { resourceRequest } from './resource-api';
import { pendingEconomyIntent, readPendingEconomyIntent } from './economy-request-intent';

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
beforeEach(() => {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => { entries.set(key, value); },
        removeItem: (key: string) => { entries.delete(key); },
    } });
});
afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
});
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test('status completes a lost admission with the same ID before the next attempt', async () => {
    const start = { action: 'start', playerName: 'reconnect-gatherer', nodeId: 'harbor-iron', mode: 'active' };
    const parts = ['start', start.playerName, start.nodeId, start.mode, undefined, undefined];
    const calls: Record<string, unknown>[] = [];
    globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body)); calls.push(body);
        if (calls.length === 1) return reply(503, { ok: false });
        const active = { id: calls[0].requestId, nodeId: start.nodeId, mode: start.mode };
        return reply(200, { ok: true, character: { resourceGathering: { active } }, ...(body.action === 'start' ? { attempt: active } : {}) });
    };
    assert.equal((await resourceRequest(start)).ok, false);
    assert.equal(readPendingEconomyIntent('resource-gathering', parts)?.requestId, calls[0].requestId);
    const restored = await resourceRequest({ action: 'status', playerName: start.playerName });
    assert.equal(restored.attempt?.id, calls[0].requestId);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].requestId, calls[0].requestId);
    assert.equal(readPendingEconomyIntent('resource-gathering', parts), null);
    await resourceRequest(start);
    assert.notEqual(calls[3].requestId, calls[0].requestId);
});

test('status never replays a different device or previously settled admission', async () => {
    const parts = ['start', 'other-device-gatherer', 'harbor-iron', 'active', undefined, undefined];
    const pending = pendingEconomyIntent('resource-gathering', parts);
    let calls = 0;
    globalThis.fetch = async () => { calls++; return reply(200, { ok: true, character: { resourceGathering: {
        active: { id: crypto.randomUUID(), nodeId: 'harbor-iron', mode: 'active' },
    } } }); };
    assert.equal((await resourceRequest({ action: 'status', playerName: parts[1] })).ok, true);
    assert.equal(calls, 1);
    assert.equal(readPendingEconomyIntent('resource-gathering', parts)?.requestId, pending.requestId);
    pending.complete();
});

test('failed admission reconciliation keeps the restored attempt and retry identity', async () => {
    const parts = ['start', 'offline-gatherer', 'harbor-iron', 'relaxed', undefined, undefined];
    const pending = pendingEconomyIntent('resource-gathering', parts);
    let calls = 0;
    globalThis.fetch = async () => ++calls === 1
        ? reply(200, { ok: true, character: { resourceGathering: { active: { id: pending.requestId, nodeId: parts[2], mode: parts[3] } } } })
        : reply(503, { ok: false, error: 'Retry reconciliation.' });
    const restored = await resourceRequest({ action: 'status', playerName: parts[1] });
    assert.equal(restored.ok, true);
    assert.equal(restored.character?.resourceGathering?.active?.id, pending.requestId);
    assert.equal(calls, 2);
    assert.equal(readPendingEconomyIntent('resource-gathering', parts)?.requestId, pending.requestId);
    pending.complete();
});
