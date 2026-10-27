import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reloadSignaledSave } from './forced-save-reload';

function harness(response: () => Promise<Response>, admin = false) {
    let current = true;
    const events: string[] = [];
    const run = () => reloadSignaledSave({
        accountName: 'kaya', admin, isCurrent: () => current,
        protectDraft: () => events.push('protect'), applySnapshot: () => events.push('apply'),
        forgetAccount: () => events.push('forget'), unwindToLogin: () => events.push('logout'),
        request: (async (url, init) => {
            assert.ok(init?.signal instanceof AbortSignal);
            if (String(url).endsWith('?ack=1')) { events.push('ack'); return new Response('{}'); }
            events.push('read'); return response();
        }) as typeof fetch,
    });
    return { run, events, retire: () => { current = false; } };
}
const save = { character: { name: 'Kaya' }, _saveVersion: 4 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('forced reload protects the local draft before installing and acknowledging the server save', async () => {
    const h = harness(async () => json(save));
    await h.run();
    assert.deepEqual(h.events, ['read', 'protect', 'apply', 'ack']);
});

test('only a confirmed 404 forgets the account and returns to login', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
        const h = harness(async () => json({ error: 'Unavailable' }, status));
        await h.run();
        assert.deepEqual(h.events, ['read'], `status ${status} is not a deletion`);
    }
    const h = harness(async () => new Response(null, { status: 404 }));
    await h.run();
    assert.deepEqual(h.events, ['read', 'ack', 'forget', 'logout']);
});

test('malformed or foreign snapshots cannot clear a reset signal or replace local state', async () => {
    for (const body of [null, { _saveVersion: 4 }, { ...save, _saveVersion: '4' }, { ...save, character: { name: 'Other' } }]) {
        const h = harness(async () => json(body));
        await assert.rejects(h.run());
        assert.deepEqual(h.events, ['read']);
    }
});

test('account retirement during the read or JSON parsing suppresses every state change', async () => {
    for (const boundary of ['response', 'json']) {
        const h = harness(async () => {
            if (boundary === 'response') { h.retire(); return json(save); }
            return { ok: true, json: async () => { h.retire(); return save; } } as Response;
        });
        await h.run();
        assert.deepEqual(h.events, ['read']);
    }
});

test('admin reset signals retain acknowledgement-only behavior and retired work never starts', async () => {
    const h = harness(async () => assert.fail('admin must not read'), true);
    await h.run();
    assert.deepEqual(h.events, ['ack']);
    h.retire();
    await h.run();
    assert.deepEqual(h.events, ['ack']);
});
