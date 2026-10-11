import assert from 'node:assert/strict';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

// Every writer of `chat:village:<slug>` rewrites the whole transcript, so each
// one resets its expiry. The player POST and the moderator delete use
// VILLAGE_CHAT_TTL_SECONDS directly; the World Herald paths in _announce.ts
// carry their own literal, so this file holds them to the same value by
// behaviour: the row survives to just short of the TTL and is gone just past it.

let kv: typeof import('../_storage.js').kv;
let announceMod: typeof import('../_announce.js');
let chatKeyMod: typeof import('./_chat-key.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    announceMod = await import('../_announce.js');
    chatKeyMod = await import('./_chat-key.js');
});

test('the shared chat TTL is 30 days and the key format is unchanged', () => {
    assert.equal(chatKeyMod.VILLAGE_CHAT_TTL_SECONDS, 30 * 24 * 60 * 60);
    assert.equal(chatKeyMod.villageChatKey('Ashen Leaf Village'), 'chat:village:ashen-leaf-village');
});

async function assertLivesExactlyTheChatTtl(context: { mock: { timers: { tick(ms: number): void } } }, key: string) {
    assert.ok(Array.isArray(await kv.get(key)), `${key} was written`);
    const ttlMs = chatKeyMod.VILLAGE_CHAT_TTL_SECONDS * 1000;
    context.mock.timers.tick(ttlMs - 60_000);
    assert.ok(Array.isArray(await kv.get(key)), `${key} is still there a minute before the chat TTL`);
    context.mock.timers.tick(2 * 60_000);
    assert.equal(await kv.get(key), null, `${key} is gone a minute after the chat TTL`);
}

test('a village herald line keeps the transcript on the shared chat TTL', async (context) => {
    context.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 11, 12) });
    assert.equal(await announceMod.postVillageHerald('Moonshadow Village', 'Ttl', 'parity'), true);
    await assertLivesExactlyTheChatTtl(context, chatKeyMod.villageChatKey('Moonshadow Village'));
});

test('a high announcement broadcast keeps every transcript on the shared chat TTL', async (context) => {
    context.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 11, 12) });
    const posted = await announceMod.announce({ type: 'ttl_parity', importance: 'high', title: 'Ttl', message: 'parity' });
    assert.ok(posted, 'the announcement landed');
    const key = chatKeyMod.villageChatKey('Stormveil Village');
    await assertLivesExactlyTheChatTtl(context, key);
});
