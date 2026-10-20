import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { startGauntletRun } from './pet-gauntlet.js';
import { pendingGauntlet, rememberGauntlet, reportGauntlet, startGauntlet, type PendingGauntlet } from './pet-gauntlet-api.js';

const fetchBefore = globalThis.fetch;
const storageBefore = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
    globalThis.fetch = fetchBefore;
    if (storageBefore) Object.defineProperty(globalThis, 'localStorage', storageBefore);
    else Reflect.deleteProperty(globalThis, 'localStorage');
});
test('pending terminal reports retain the exact account, token and transcript until confirmed', () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
    const pending: PendingGauntlet = { player: 'Rin', run: { ...startGauntletRun(42), status: 'lost' },
        meta: { token: 'sealed-run', weekKey: 'week', rewardEligible: true }, transcript: [{ k: 'reroll' }] };
    rememberGauntlet(pending);
    assert.deepEqual(pendingGauntlet('Rin'), pending);
    assert.equal(pendingGauntlet('Another player'), null);
    rememberGauntlet(null);
    assert.equal(pendingGauntlet('Rin'), null);
});
test('Gauntlet payout confirmation requires a real versioned character, including recovered zero payouts', async () => {
    for (const body of [{}, { ryo: 500, fateShards: 0, boneCharms: 0 }]) {
        globalThis.fetch = async () => new Response(JSON.stringify(body));
        assert.equal(await reportGauntlet('sealed-run', []), null);
    }
    const receipt = { ryo: 0, fateShards: 0, boneCharms: 0, character: { name: 'Rin' }, _saveVersion: 7, score: null, rank: null };
    globalThis.fetch = async () => new Response(JSON.stringify(receipt));
    assert.deepEqual(await reportGauntlet('sealed-run', []), receipt);
    globalThis.fetch = async () => new Response('{}', { status: 409 });
    assert.equal(await reportGauntlet('sealed-run', []), null, 'an unconfirmed conflict keeps the report');
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'SAVE_VERSION_CONFLICT' }), { status: 409 });
    assert.equal(await reportGauntlet('sealed-run', []), null, 'a save conflict is retryable, not expiry');
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'GAUNTLET_REPORT_EXPIRED' }), { status: 409 });
    assert.deepEqual(await reportGauntlet('sealed-run', []), { expired: true });
});

test('a lost entry reply retries the same admission; an accepted new run gets a fresh request', async () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
    const requests: string[] = [];
    globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body)); requests.push(body.requestId);
        if (requests.length === 1) throw new Error('Entry reply lost');
        return new Response(JSON.stringify({ runToken: body.requestId, seed: 42 }));
    };
    assert.equal(await startGauntlet('EntryRin'), null);
    assert.ok(values.has('pet.gauntlet.entry.v1'));
    assert.ok(await startGauntlet('EntryRin'));
    assert.equal(requests[0], requests[1]);
    assert.equal(values.has('pet.gauntlet.entry.v1'), false);
    assert.ok(await startGauntlet('EntryRin'));
    assert.notEqual(requests[1], requests[2]);
});
