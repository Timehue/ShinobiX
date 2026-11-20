import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelCreationFixture } from './_creation-config.fixture.js';

// A player may close the window after pressing Check portrait (owner, 2026-11-20): the model loop finishes
// the check and starts the model, using the read token as the idempotency key the page would have used.
test('the model loop finishes a waiting portrait check and starts the model once', async t => {
    Object.assign(process.env, modelCreationFixture, { NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1',
        SESSION_SECRET: 'local-auto-start-test-session-secret' });
    const start = Date.UTC(2026, 10, 20, 21, 0);
    t.mock.timers.enable({ apis: ['Date'], now: start });
    const { kv } = await import('../_storage.js');
    const { READ_PATIENCE_MS } = await import('./read.js');
    const { awaitPortraitCheck, advancePortraitCheck, portraitCheckStatus, tickPortraitChecks, checkResultKey } =
        await import('./_auto-start.js');
    type Check = Awaited<ReturnType<typeof import('./read.js').checkPlayerPortrait>>;
    type Admit = Awaited<ReturnType<typeof import('./_admission.js').admitModelJob>>;
    const token = 'f0d4ad57-c199-4a75-bf80-1cd8ace412f0';
    let next: Check = { state: 'pending' };
    let admitted: Admit = { jobId: 'job-1' };
    const checks: string[] = [], admissions: string[][] = [];
    const ports = {
        check: async (owner: string) => { checks.push(owner); return next; },
        admit: async (owner: string, readToken: string, key: string) => { admissions.push([owner, readToken, key]); return admitted; },
    } as never;
    const waiting = async () => (await kv.get<{ owner: string; since: number }[]>('avatar-model:checks')) ?? [];

    // Enrolling twice keeps one entry, and a new check clears the last one's result.
    await kv.set(checkResultKey('nero'), 'failed');
    await awaitPortraitCheck('nero');
    await awaitPortraitCheck('nero', start + 5000);
    assert.deepEqual(await waiting(), [{ owner: 'nero', since: start }]);
    assert.equal(await portraitCheckStatus('nero'), 'checking');
    assert.equal(await kv.get(checkResultKey('nero')), null);

    // Still queued at Modal: it waits.
    await tickPortraitChecks(ports);
    assert.deepEqual(checks, ['nero']);
    assert.equal(await portraitCheckStatus('nero'), 'checking');

    // Accepted: the loop starts the model with the read token as the idempotency key, then drops the player.
    next = { state: 'ready', path: 'A', summary: 'Two-legged character', readToken: token };
    await tickPortraitChecks(ports);
    assert.deepEqual(admissions, [['nero', token, token]]);
    assert.deepEqual(await waiting(), []);
    assert.equal(await portraitCheckStatus('nero'), null);

    // The page already started it: the check reports quota and the loop simply lets go.
    await awaitPortraitCheck('dopey');
    next = { error: 'quota' };
    await tickPortraitChecks(ports);
    assert.equal(await portraitCheckStatus('dopey'), null);

    // A declined portrait is remembered for the panel.
    await awaitPortraitCheck('rill');
    next = { state: 'declined' };
    await tickPortraitChecks(ports);
    assert.equal(await portraitCheckStatus('rill'), 'declined');

    // A failed check is remembered; a switched-off service only waits.
    await awaitPortraitCheck('kai');
    next = { error: 'disabled' };
    await tickPortraitChecks(ports);
    assert.equal(await portraitCheckStatus('kai'), 'checking');
    next = { error: 'unavailable' };
    await tickPortraitChecks(ports);
    assert.equal(await portraitCheckStatus('kai'), 'failed');

    // The page holding the check this minute (or a provider blip) only waits for the next pass.
    await awaitPortraitCheck('mira');
    const blip = { check: async () => { throw new Error('contended'); }, admit: ports } as never;
    await advancePortraitCheck({ owner: 'mira', since: Date.now() }, blip);
    assert.equal(await portraitCheckStatus('mira'), 'checking');

    // A busy admission retries; an expired one fails.
    next = { state: 'ready', path: 'A', summary: 'Two-legged character', readToken: token };
    admitted = { error: 'busy' };
    await tickPortraitChecks(ports);
    assert.equal(await portraitCheckStatus('mira'), 'checking');
    admitted = { error: 'read-expired' };
    await tickPortraitChecks(ports);
    assert.equal(await portraitCheckStatus('mira'), 'failed');

    // It gives up a minute before the check's own patience, without starting a second check.
    await awaitPortraitCheck('late');
    next = { state: 'pending' };
    checks.length = 0;
    t.mock.timers.setTime(start + READ_PATIENCE_MS - 60_000);
    await tickPortraitChecks(ports);
    assert.deepEqual(checks, []);
    assert.equal(await portraitCheckStatus('late'), 'failed');
    assert.deepEqual(await waiting(), []);
});
