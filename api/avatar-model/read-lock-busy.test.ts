import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelCreationFixture } from './_creation-config.fixture.js';

// The model loop (_auto-start.ts) advances an open check under the same per-player lock once a minute. A page
// poll that lands during that pass used to get a 503, and the page told the player the check had failed while
// the loop went on to pass it and build the model (2026-11-25).
test('a poll that meets the model loop holding the check lock is told to keep waiting', async () => {
    Object.assign(process.env, modelCreationFixture, { NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1',
        SESSION_SECRET: 'local-portrait-lock-busy-test-session-secret' });
    const { kv } = await import('../_storage.js');
    const { issuePlayerToken } = await import('../_auth.js');
    const handler = (await import('./read.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    await kv.set('lock:avatar-model:screen-owner:busy', 'model-loop', { ex: 60 });
    let status = 0, body: unknown;
    const res = { setHeader() {}, status(code: number) { status = code; return res; }, json(value: unknown) { body = value; } };
    await handler({ method: 'POST', body: {}, headers: { 'x-player-token': issuePlayerToken('busy') } } as never, res as never);
    assert.deepEqual({ status, body }, { status: 202, body: { state: 'pending' } });
    assert.equal(await kv.get('lock:avatar-model:screen-owner:busy'), 'model-loop', 'the loop keeps its lock');
});
