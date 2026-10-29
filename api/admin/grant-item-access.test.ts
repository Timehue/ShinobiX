import assert from 'node:assert/strict';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'grant-item-test-full';
process.env.ADMIN_CONTENT_PASSWORD = 'grant-item-test-content';
process.env.SESSION_SECRET = 'grant-item-test-session-secret-at-least-32-chars';

let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./grant-item.js').default;
let itemId: string;

async function request(body: Record<string, unknown>, password: string) {
    const out = { status: 200, body: {} as Record<string, unknown> };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: Record<string, unknown>) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body, headers: { 'x-admin-password': password }, query: {}, socket: { remoteAddress: '127.0.0.94' } } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./grant-item.js')).default as unknown as typeof handler;
    itemId = Object.keys((await import('../pvp/_item-catalog.js')).ITEM_CATALOG)[0];
});

test('only a full admin can put an item in a player inventory (owner ruling 2026-10-29)', async () => {
    await kv.set('save:granted', { _saveVersion: 1, character: { name: 'granted', inventory: [] } });
    const body = { playerName: 'granted', itemId, requestId: 'grant-item-access-0001' };

    const content = await request(body, 'grant-item-test-content');
    assert.equal(content.status, 403, JSON.stringify(content.body));
    assert.deepEqual((await kv.get<{ character: { inventory: string[] } }>('save:granted'))!.character.inventory, []);

    const full = await request(body, 'grant-item-test-full');
    assert.equal(full.status, 200, JSON.stringify(full.body));
    assert.deepEqual((await kv.get<{ character: { inventory: string[] } }>('save:granted'))!.character.inventory, [itemId]);
});
