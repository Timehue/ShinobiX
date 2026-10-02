import assert from 'node:assert/strict';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ENABLE_LEGACY = '1';
process.env.ADMIN_PASSWORD = 'era-authority-test-admin';
delete process.env.SESSION_SECRET;
let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./legacy.js').default;
before(async () => { ({ kv } = await import('../_storage.js')); handler = (await import('./legacy.js')).default as unknown as typeof handler; });
async function call(body: Record<string, unknown>) {
    const out = { status: 200, body: {} as any };
    const res = { setHeader() {}, status(status: number) { out.status = status; return this; }, json(body: unknown) { out.body = body; return this; }, end() { return this; } };
    await handler({ method: 'POST', body, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return out;
}
for (const body of [
    { action: 'era-set-status', eraId: 'mythic-legacies', status: 'locked' },
    { action: 'era-set-milestone', eraId: 'mythic-legacies', metric: 'missions', required: 1234 },
]) test(`${body.action} reports success only after its world-state write commits`, async t => {
    await kv.set('game:era-state', { overrides: {} });
    const original = kv.set.bind(kv);
    const patch = t.mock.method(kv, 'set', async (key: string, value: unknown, options?: Parameters<typeof kv.set>[2]) =>
        key === 'game:era-state' ? null : original(key, value, options));
    assert.equal((await call(body)).status, 500);
    assert.deepEqual(await kv.get('game:era-state'), { overrides: {} });
    patch.mock.restore();
    assert.equal((await call(body)).status, 200);
    const state = await kv.get<any>('game:era-state');
    if (body.action === 'era-set-status') assert.equal(state.overrides['mythic-legacies'].status, 'locked');
    else assert.equal(state.overrides['mythic-legacies'].milestoneOverrides.missions, 1234);
});
test('admin reads and edits cannot replace unreadable authority with launch defaults', async t => {
    const state = { overrides: { 'mythic-legacies': { status: 'locked' } } };
    await kv.set('game:era-state', state);
    const original = kv.get.bind(kv);
    const patch = t.mock.method(kv, 'get', async (key: string) => {
        if (key === 'game:era-state') throw new Error('injected-admin-era-read-failure');
        return original(key);
    });
    assert.equal((await call({ action: 'era-view' })).status, 500);
    assert.equal((await call({ action: 'era-set-status', eraId: 'mythic-legacies', status: 'unlocked' })).status, 500);
    patch.mock.restore();
    assert.deepEqual(await kv.get('game:era-state'), state);
});
