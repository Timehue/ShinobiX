import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { hasPendingCardPackRequest, openCardPack } from './card-pack';

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
let storage: Map<string, string>;
let counter = 0;
const owner = () => `packclient${++counter}`;
const success = (name: string) => new Response(JSON.stringify({
    ok: true, cards: ['tc-01'], currency: 'chroniclePoints', cost: 100,
    character: { name, chroniclePoints: 900, tileCards: ['tc-01'] }, _saveVersion: 2,
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
    storage = new Map();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); },
        removeItem: (key: string) => { storage.delete(key); },
    } });
});
afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
});

function captureBodies(handler: (name: string, count: number) => Response | Promise<Response>) {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        return handler(String(body.playerName), bodies.length);
    }) as typeof fetch;
    return bodies;
}

test('an unconfirmed pack keeps its operation ID; confirmed next purchase uses another ID', async () => {
    const player = owner();
    const bodies = captureBodies((name, count) => {
        if (count === 1) throw new Error('response lost after the server committed');
        return success(name);
    });
    assert.equal(hasPendingCardPackRequest(player, 'standard'), false);
    const unconfirmed = await openCardPack(player, 'standard');
    assert.equal(unconfirmed.ok, false);
    assert.match(String(unconfirmed.error), /Refresh before retrying to recover the same purchase\./);
    assert.equal(hasPendingCardPackRequest(player, 'standard'), true);
    assert.equal((await openCardPack(player, 'standard')).ok, true);
    assert.equal(hasPendingCardPackRequest(player, 'standard'), false);
    assert.equal((await openCardPack(player, 'standard')).ok, true);
    assert.match(String(bodies[0].requestId), /^[A-Za-z0-9_-]{16,80}$/);
    assert.equal(bodies[1].requestId, bodies[0].requestId);
    assert.notEqual(bodies[2].requestId, bodies[0].requestId);
    assert.equal(storage.size, 0);
});

test('only a valid pending ID for this account and pack permits recovery without creating an intent', () => {
    const player = owner();
    const key = `shinobix.card-pack:${JSON.stringify({ playerName: player, packType: 'standard' })}`;
    assert.equal(hasPendingCardPackRequest(player, 'standard'), false);
    assert.equal(storage.size, 0, 'checking recovery must not create a purchase ID');
    for (const invalid of ['', 'short', 'invalid-id-with-spaces ', 'x'.repeat(81)]) {
        storage.set(key, invalid);
        assert.equal(hasPendingCardPackRequest(player, 'standard'), false, invalid);
    }
    storage.set(key, 'pending_valid_id_123456');
    assert.equal(hasPendingCardPackRequest(player, 'standard'), true);
    assert.equal(hasPendingCardPackRequest(player, 'epic'), false);
    assert.equal(hasPendingCardPackRequest(`${player}other`, 'standard'), false);
    storage.delete(key);
    assert.equal(hasPendingCardPackRequest(player, 'standard'), false, 'read-only check must not retain a deleted persisted ID');
});

test('ambiguous 503 and malformed successful responses retain the original ID', async () => {
    const player = owner();
    const bodies = captureBodies((name, count) => count === 1
        ? new Response(JSON.stringify({ error: 'Storage is unavailable.' }), { status: 503 })
        : count === 2 ? new Response('{', { status: 200 }) : success(name));
    assert.equal((await openCardPack(player, 'epic')).ok, false);
    assert.equal((await openCardPack(player, 'epic')).ok, false);
    assert.equal((await openCardPack(player, 'epic')).ok, true);
    assert.match(String(bodies[0].requestId), /^[A-Za-z0-9_-]{16,80}$/);
    assert.equal(bodies[0].requestId, bodies[1].requestId);
    assert.equal(bodies[0].requestId, bodies[2].requestId);
});

test('account and pack type isolate pending purchases; a definite rejection clears the ID', async () => {
    const first = owner(), second = owner();
    const bodies = captureBodies((_name, count) => {
        if (count < 4) throw new Error('offline');
        return new Response(JSON.stringify({ error: 'Not enough currency.' }), { status: 409 });
    });
    await openCardPack(first, 'standard');
    await openCardPack(first, 'epic');
    await openCardPack(second, 'standard');
    assert.equal(new Set(bodies.map((body) => body.requestId)).size, 3);
    await openCardPack(first, 'standard');
    await openCardPack(first, 'standard');
    assert.equal(bodies[3].requestId, bodies[0].requestId);
    assert.notEqual(bodies[4].requestId, bodies[0].requestId);
});

test('a pending ID in session storage survives a page-module restart', async () => {
    const player = owner();
    const bodies = captureBodies((name, count) => {
        if (count === 1) throw new Error('lost reply');
        return success(name);
    });
    await openCardPack(player, 'standard');
    assert.equal(storage.size, 1, 'pending intent is recorded before sending');
    const reloaded = await import(`./card-pack.ts?pack-reload=${counter}`) as typeof import('./card-pack');
    assert.equal((await reloaded.openCardPack(player, 'standard')).ok, true);
    assert.equal(bodies[0].requestId, bodies[1].requestId);
    assert.equal(storage.size, 0);
});

test('unavailable session storage still retries the same operation in memory', async () => {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('storage blocked'); } });
    const player = owner();
    const bodies = captureBodies((name, count) => {
        if (count === 1) throw new Error('lost reply');
        return success(name);
    });
    await openCardPack(player, 'legendary');
    assert.equal((await openCardPack(player, 'legendary')).ok, true);
    assert.match(String(bodies[0].requestId), /^[A-Za-z0-9_-]{16,80}$/);
    assert.equal(bodies[0].requestId, bodies[1].requestId);
});

test('throttling and expired authentication cannot retire a pending purchase', async () => {
    const player = owner();
    const bodies = captureBodies((name, count) => count === 1
        ? new Response(JSON.stringify({ error: 'Slow down.' }), { status: 429 })
        : count === 2 ? new Response(JSON.stringify({ error: 'Sign in again.' }), { status: 401 }) : success(name));
    for (let i = 0; i < 2; i++) assert.equal((await openCardPack(player, 'standard')).ok, false);
    assert.equal((await openCardPack(player, 'standard')).ok, true);
    assert.match(String(bodies[0].requestId), /^[A-Za-z0-9_-]{16,80}$/);
    assert.equal(new Set(bodies.map((body) => body.requestId)).size, 1);
});

test('a legacy unversioned success keeps the existing caller adoption contract', async () => {
    const player = owner();
    const bodies = captureBodies((name) => new Response(JSON.stringify({
        ok: true, character: { name, tileCards: ['tc-01'] }, cards: ['tc-01'],
    }), { status: 200 }));
    const legacy = await openCardPack(player, 'standard');
    assert.equal(legacy.ok, true);
    assert.equal(legacy._saveVersion, undefined);
    assert.deepEqual(legacy.cards, ['tc-01']);
    assert.equal((await openCardPack(player, 'standard')).ok, true);
    assert.notEqual(bodies[0].requestId, bodies[1].requestId, 'confirmed legacy replies do not collapse the next intended purchase');
});

test('a late duplicate success does not erase a newer pending purchase', async () => {
    const player = owner();
    let releaseOldReply: (() => void) | undefined;
    const bodies = captureBodies((name, count) => count === 2
        ? new Promise<Response>((resolve) => { releaseOldReply = () => resolve(success(name)); })
        : count === 3 ? Promise.reject(new Error('new purchase reply lost')) : success(name));
    const first = openCardPack(player, 'standard');
    const duplicate = openCardPack(player, 'standard');
    assert.equal((await first).ok, true);
    assert.equal((await openCardPack(player, 'standard')).ok, false);
    assert.ok(releaseOldReply);
    releaseOldReply();
    assert.equal((await duplicate).ok, true);
    assert.equal((await openCardPack(player, 'standard')).ok, true);
    assert.equal(bodies[0].requestId, bodies[1].requestId);
    assert.notEqual(bodies[0].requestId, bodies[2].requestId);
    assert.equal(bodies[2].requestId, bodies[3].requestId);
});
