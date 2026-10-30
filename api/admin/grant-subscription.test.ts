import assert from 'node:assert/strict';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'grant-sub-test-full';
process.env.ADMIN_CONTENT_PASSWORD = 'grant-sub-test-content';
process.env.SESSION_SECRET = 'grant-sub-test-session-secret-at-least-32-chars';

let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./grant-subscription.js').default;
let readAudit: typeof import('../_audit.js').readAudit;

async function request(body: Record<string, unknown>, password: string) {
    const out = { status: 200, body: {} as Record<string, unknown> };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: Record<string, unknown>) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body, headers: { 'x-admin-password': password }, query: {}, socket: { remoteAddress: '127.0.0.93' } } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./grant-subscription.js')).default as unknown as typeof handler;
    ({ readAudit } = await import('../_audit.js'));
});

test('a comped subscription leaves an audit row, and a content admin cannot comp one', async () => {
    await kv.set('save:compedplayer', { _saveVersion: 1, character: { name: 'compedplayer', level: 20 } });
    assert.equal((await request({ playerName: 'compedplayer' }, 'grant-sub-test-content')).status, 403);
    assert.equal((await readAudit('reward')).filter((e) => e.entityId === 'compedplayer').length, 0);

    const granted = await request({ playerName: 'compedplayer', days: 7 }, 'grant-sub-test-full');
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    const rows = (await readAudit('reward')).filter((e) => e.entityId === 'compedplayer');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'subscription.grant');
});
