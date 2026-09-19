import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

// `{ local: true }` keeps enforceRateLimitKv's aligned fixed window in process
// memory. It must decide exactly what the database-backed window decides, with
// no database write — only the storage of the count differs.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let rl: typeof import('./_ratelimit.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    rl = await import('./_ratelimit.js');
});
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

function fakeReq(ip: string) {
    return { headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } };
}
function fakeRes() {
    const out = { status: 200 };
    const res = { status(code: number) { out.status = code; return { json: () => undefined }; } };
    return { res, out };
}

test('the local window refuses exactly where the database window refuses, without a database write', async (t) => {
    const incr = t.mock.method(kv, 'incr');
    const name = `local-${Math.random().toString(36).slice(2)}`;
    const window = 2_000;
    // Start just after an aligned boundary so both runs share one window.
    await new Promise<void>((resolve) => setTimeout(resolve, window - (Date.now() % window) + 5));
    const decisions: boolean[] = [];
    for (let i = 0; i < 5; i++) {
        const { res } = fakeRes();
        decisions.push(await rl.enforceRateLimitKv(fakeReq('10.94.0.1'), res, 'local-test', 3, window, name, { local: true }));
    }
    const kvName = `${name}-kv`;
    const kvDecisions: boolean[] = [];
    for (let i = 0; i < 5; i++) {
        const { res } = fakeRes();
        kvDecisions.push(await rl.enforceRateLimitKv(fakeReq('10.94.0.2'), res, 'local-test', 3, window, kvName));
    }
    assert.deepEqual(decisions, kvDecisions);
    assert.deepEqual(decisions.slice(0, 3), [true, true, true]);
    const localIncrs = incr.mock.calls.filter((call) => String(call.arguments[0]).includes(`${name}:`) && !String(call.arguments[0]).includes('-kv'));
    assert.equal(localIncrs.length, 0, 'the local path never increments a database counter');
});

test('a local window refuses with a retry hint and opens again in the next aligned window', async () => {
    const name = `local-reset-${Math.random().toString(36).slice(2)}`;
    const window = 200;
    // Start just after a window boundary so the two hits share one window.
    await new Promise<void>((resolve) => setTimeout(resolve, window - (Date.now() % window) + 5));
    const first = fakeRes();
    assert.equal(await rl.enforceRateLimitKv(fakeReq('10.94.0.3'), first.res, 'local-reset', 1, window, name, { local: true }), true);
    const second = fakeRes();
    assert.equal(await rl.enforceRateLimitKv(fakeReq('10.94.0.3'), second.res, 'local-reset', 1, window, name, { local: true }), false);
    assert.equal(second.out.status, 429);
    await new Promise<void>((resolve) => setTimeout(resolve, window - (Date.now() % window) + 5));
    const third = fakeRes();
    assert.equal(await rl.enforceRateLimitKv(fakeReq('10.94.0.3'), third.res, 'local-reset', 1, window, name, { local: true }), true);
});
