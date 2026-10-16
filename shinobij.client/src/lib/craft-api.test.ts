import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { forgeServer, hasPendingNamedForgeRoll, rollNamedForgeServer } from './craft-api';
import { canPayNamedForge } from '../../../shared/named-forge-economy';
import { namedForgeShortfall } from '../../../shared/named-forge-materials';

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

test('exact-material crafts reuse their request identity after lost or malformed replies and release it after success', async () => {
    const original = globalThis.fetch;
    const sent: Array<{ requestId: string; materials: unknown; quantity: number }> = [];
    const materials = [{ 'gather-iron-sand': 2 }, { 'gather-heartwood-bark': 1 }, { 'gather-binding-fiber': 1 }];
    globalThis.fetch = async (_input, init) => {
        sent.push(JSON.parse(String(init?.body)));
        if (sent.length === 1) throw new TypeError('Response lost after settlement');
        if (sent.length === 2) return new Response('invalid json', { status: 200 });
        return new Response(JSON.stringify({ character: { name: 'exactretry' }, _saveVersion: 2 }), { status: 200 });
    };
    try {
        for (let attempt = 0; attempt < 4; attempt++) await forgeServer('exactretry', 'supply', 'thrown-shuriken', 1, materials);
        assert.equal(sent[0].requestId, sent[1].requestId);
        assert.equal(sent[1].requestId, sent[2].requestId);
        assert.notEqual(sent[2].requestId, sent[3].requestId, 'a later deliberate craft gets a fresh receipt');
        for (const body of sent) { assert.deepEqual(body.materials, materials); assert.equal(body.quantity, 1); }
    } finally { globalThis.fetch = original; }
});

test('an unconfirmed named roll can replay with depleted shards and materials and keeps the same request ID', async () => {
    const player = 'named-retry-wallet';
    const options = { name: 'Kept Blade', flavorText: 'The original roll.' };
    const sent: Array<{ requestId: string; kind: string; slot?: string }> = [];
    const depleted = { fateShards: 0 };
    assert.equal(canPayNamedForge(depleted), false);
    assert.ok(namedForgeShortfall('weapon', () => 0));
    assert.equal(hasPendingNamedForgeRoll(player, 'weapon'), false, 'inspection must not create a fresh intent');
    assert.equal(hasPendingNamedForgeRoll(player, 'weapon'), false);
    globalThis.fetch = async (_input, init) => {
        sent.push(JSON.parse(String(init?.body)));
        if (sent.length === 1) throw new TypeError('Paid roll response was lost');
        if (sent.length === 2) return new Response(JSON.stringify({ error: 'Retry this forge with the same roll.' }), { status: 503 });
        if (sent.length === 3) return new Response('malformed success', { status: 200 });
        return new Response(JSON.stringify({ character: { name: player, ...depleted }, _saveVersion: 2, replayed: true, item: null }), { status: 200 });
    };
    for (let attempt = 0; attempt < 3; attempt++) {
        await rollNamedForgeServer(player, 'weapon', options);
        assert.equal(hasPendingNamedForgeRoll(player, 'weapon'), true, 'retry must reach the existing receipt despite the refreshed wallet');
        assert.equal(hasPendingNamedForgeRoll(player, 'armor', 'body'), false);
        assert.equal(hasPendingNamedForgeRoll('another-player', 'weapon'), false);
    }
    const replay = await rollNamedForgeServer(player, 'weapon', options);
    assert.equal(replay.replayed, true);
    assert.equal(new Set(sent.map((body) => body.requestId)).size, 1);
    assert.match(sent[0].requestId, /^[a-f0-9]{32}$/i);
    assert.equal(hasPendingNamedForgeRoll(player, 'weapon'), false, 'confirmed payment releases the retry exemption');
    await rollNamedForgeServer(player, 'weapon', options);
    assert.notEqual(sent[4].requestId, sent[0].requestId, 'a subsequent intentional roll gets a new ID');
});

test('a retained named-roll intent is restricted to its armor slot and survives a tab reload', async () => {
    const player = 'named-reload-slot';
    const requestId = '12345678-1234-4234-8234-123456789abc';
    // A previous tab attempt persisted this ID; no new roll has been sent here.
    sessionStorage.setItem(`shinobix.economy-intent:named-roll:${JSON.stringify([player, 'armor', 'body'])}`, requestId);
    assert.equal(hasPendingNamedForgeRoll(player, 'armor', 'body'), true);
    assert.equal(hasPendingNamedForgeRoll(player, 'armor', 'hand'), false);
    assert.equal(hasPendingNamedForgeRoll(player, 'armor'), false);
    assert.equal(hasPendingNamedForgeRoll(player, 'weapon'), false);
    let sent: { requestId: string; slot: string } | undefined;
    globalThis.fetch = async (_input, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ character: { name: player, fateShards: 0 }, _saveVersion: 3, replayed: true }), { status: 200 });
    };
    await rollNamedForgeServer(player, 'armor', { slot: 'body', name: 'Kept Vestige', flavorText: '' });
    assert.deepEqual(sent && { requestId: sent.requestId, slot: sent.slot }, { requestId: requestId.replace(/-/g, ''), slot: 'body' });
    assert.equal(hasPendingNamedForgeRoll(player, 'armor', 'body'), false);
});

test('terminal named-roll refusals remove the exemption while authentication and malformed successes retain it', async () => {
    const player = 'named-refusal';
    const replies = [new Response('{}', { status: 401 }), new Response('{}', { status: 200 }),
        new Response(JSON.stringify({ error: 'Not enough Fate Shards.' }), { status: 409 })];
    const sent: string[] = [];
    globalThis.fetch = async (_input, init) => {
        sent.push(JSON.parse(String(init?.body)).requestId);
        return replies.shift()!;
    };
    for (let attempt = 0; attempt < 3; attempt++) {
        await rollNamedForgeServer(player, 'armor', { slot: 'feet', name: 'Original', flavorText: '' });
        assert.equal(hasPendingNamedForgeRoll(player, 'armor', 'feet'), attempt < 2);
    }
    assert.equal(new Set(sent).size, 1);
});

test('both named forge buttons and handlers share a scoped retry gate before fresh affordability checks', () => {
    const source = readFileSync('shinobij.client/src/screens/CentralHub.tsx', 'utf8');
    const start = source.indexOf('function namedRollBlocker(');
    const gate = source.slice(start, source.indexOf('\n    }', start));
    assert.ok(gate.indexOf('if (namedForgeLocked)') < gate.indexOf('hasPendingNamedForgeRoll('), 'the level gate still applies to a retry');
    assert.match(gate, /hasPendingNamedForgeRoll\(character\.name, kind, kind === "armor" \? namedArmorSlot : undefined\)/);
    assert.ok(gate.indexOf('hasPendingNamedForgeRoll(') < gate.indexOf('if (!namedForgePaymentReady)'), 'only a retained request bypasses the fresh shard gate');
    assert.ok(gate.indexOf('hasPendingNamedForgeRoll(') < gate.indexOf('namedForgeShortfall('), 'retained requests bypass the fresh material gate too');
    for (const kind of ['weapon', 'armor']) {
        assert.ok(source.includes(`const blocker = namedRollBlocker("${kind}")`));
        assert.ok(source.includes(`disabled={!!namedRollBlocker("${kind}") || namedForgeBusy || namedForgeAnimation !== null}`));
    }
});
