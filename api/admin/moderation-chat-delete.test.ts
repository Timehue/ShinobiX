import assert from 'node:assert/strict';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'mod-chat-delete-full';

let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./moderation.js').default;
let chatKeyMod: typeof import('../village/_chat-key.js');

const full = { 'x-admin-password': 'mod-chat-delete-full' };
const HOUR_MS = 60 * 60 * 1000;

async function request(body: Record<string, unknown>) {
    const out = { status: 200, body: {} as any };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: unknown) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body, headers: full, query: {}, socket: { remoteAddress: '127.0.0.93' } } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./moderation.js')).default as unknown as typeof handler;
    chatKeyMod = await import('../village/_chat-key.js');
});

test('deleting one chat line keeps the transcript on the normal chat TTL, not a 4-hour one', async (context) => {
    context.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 11, 12) });
    const key = chatKeyMod.villageChatKey('Frostfang Village');
    const t0 = Date.now();
    const lines = [
        { author: 'aiko', text: 'first', ts: t0 - 3_000 },
        { author: 'griefer', text: 'remove me', ts: t0 - 2_000 },
        { author: 'ren', text: 'third', ts: t0 - 1_000 },
    ];
    // Seeded the way api/village/chat.ts writes it.
    await kv.set(key, lines, { ex: chatKeyMod.VILLAGE_CHAT_TTL_SECONDS });

    const deleted = await request({ kind: 'delete-chat-message', village: 'Frostfang Village', author: 'griefer', ts: t0 - 2_000, actor: 'mod-a' });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { ok: true });
    const expected = [lines[0], lines[2]];
    assert.deepEqual(await kv.get(key), expected);

    // The delete is still audited exactly as before.
    const audit = (await kv.get<Array<Record<string, unknown>>>('mod:audit')) ?? [];
    assert.equal(audit[0]?.action, 'delete-chat-message');
    assert.equal(audit[0]?.actor, 'mod-a');
    assert.equal(audit[0]?.target, 'griefer');
    assert.equal(audit[0]?.detail, 'village=Frostfang Village');

    // The old 4-hour expiry would have dropped the whole transcript here.
    context.mock.timers.tick(4 * HOUR_MS + 60_000);
    assert.deepEqual(await kv.get(key), expected);

    // It lives until the full chat TTL from the delete, and not past it.
    const ttlMs = chatKeyMod.VILLAGE_CHAT_TTL_SECONDS * 1000;
    context.mock.timers.tick(ttlMs - (4 * HOUR_MS + 60_000) - 60_000);
    assert.deepEqual(await kv.get(key), expected);
    context.mock.timers.tick(2 * 60_000);
    assert.equal(await kv.get(key), null);
});
