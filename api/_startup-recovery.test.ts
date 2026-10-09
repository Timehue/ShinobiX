import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createStartupRecovery, startupFailureKind } from './_startup-recovery.js';
import { withLockCore, LockContendedError } from './_lock.js';
import { makeGuardedRestKv } from './_storage-lock-rest.js';
import { _makeMemoryKv } from './_storage.js';
import { withKvLeaseContext } from './_kv-lock-context.js';
import { drainBackgroundWork, stopBackgroundWork } from './_background-work.js';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

export function recoveryClock() {
    let sequence = 0;
    const timers = new Map<number, { fn: () => void; ms: number }>();
    const delays: number[] = [];
    let unref = 0;
    const options = {
        random: () => 0,
        report: () => undefined,
        schedule(fn: () => void, ms: number) {
            const id = ++sequence;
            timers.set(id, { fn, ms });
            delays.push(ms);
            return { id, unref() { unref++; } } as unknown as ReturnType<typeof setTimeout>;
        },
        cancel(timer: ReturnType<typeof setTimeout>) { timers.delete((timer as unknown as { id: number }).id); },
    };
    async function tick(advance?: (ms: number) => void) {
        await flush();
        const first = timers.entries().next().value;
        assert.ok(first, 'a retry must be pending');
        timers.delete(first[0]);
        advance?.(first[1].ms);
        first[1].fn();
        await flush();
    }
    return { options, tick, delays, timers, get unref() { return unref; } };
}

it('recovers connection exhaustion, bounds delay, and never overlaps a named job', async () => {
    const clock = recoveryClock();
    const recovery = createStartupRecovery(clock.options);
    let calls = 0, active = 0, maximum = 0;
    const run = async () => {
        active++;
        maximum = Math.max(maximum, active);
        try {
            await flush();
            if (++calls <= 5) throw Object.assign(new Error('sensitive connection detail'), { code: '53300' });
            return true;
        } finally { active--; }
    };
    const outcome = recovery.start('boss', run);
    assert.equal(recovery.start('boss', run), outcome);
    for (let i = 0; i < 5; i++) { await flush(); await clock.tick(); }
    assert.equal(await outcome, 'complete');
    assert.equal(calls, 6);
    assert.equal(maximum, 1);
    assert.deepEqual(clock.delays, [2500, 5000, 10000, 20000, 30000]);
    assert.equal(clock.unref, 5);
    assert.equal(recovery.start('boss', run), outcome, 'completed boot work is not admitted again');
});

it('incomplete work exhausts after sixteen attempts without an endless timer', async () => {
    const clock = recoveryClock();
    const recovery = createStartupRecovery(clock.options);
    let calls = 0;
    const outcome = recovery.start('territory', async () => { calls++; return false; });
    for (let i = 0; i < 15; i++) await clock.tick();
    assert.equal(await outcome, 'exhausted');
    assert.equal(calls, 16);
    assert.equal(clock.timers.size, 0);
    assert.ok(clock.delays.every(ms => ms >= 2500 && ms <= 60000));
});

it('unknown and authentication errors terminate and logs omit raw messages', async () => {
    for (const error of [new Error('bug postgres://user:secret@host'), Object.assign(new Error('secret'), { code: '28P01' })]) {
        const clock = recoveryClock();
        const reports: string[] = [];
        const recovery = createStartupRecovery({ ...clock.options, report: (_name, _attempt, status) => reports.push(status) });
        assert.equal(await recovery.start('boss', async () => { throw error; }), 'permanent-error');
        assert.equal(clock.timers.size, 0);
        assert.deepEqual(reports, ['permanent-or-unclassified-failure']);
    }
});

it('recognizes direct and guarded REST errors, and discloses lost lock-acquisition causes', async () => {
    const errors = [
        [Object.assign(new Error('outage'), { code: 'ECONNREFUSED' }), 'transient'],
        [new Error('Max clients reached in session mode'), 'transient'],
        [new Error('timeout exceeded when trying to connect'), 'transient'],
        [new Error('Connection terminated due to connection timeout', { cause: new Error('Connection terminated unexpectedly') }), 'transient'],
        [new Error('transport failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }), 'transient'],
        [new Error('transport failed', { cause: Object.assign(new Error('auth'), { code: '28P01' }) }), 'permanent'],
        [new Error('Connection terminated due to connection timeout', { cause: Object.assign(new Error('auth'), { code: '28P01' }) }), 'permanent'],
        [new Error('Guarded storage operation failed (53300).'), 'transient'],
        [new Error('Guarded storage operation failed (PGRST003).'), 'transient'],
        [new Error('kv.set NX(startup): Timed out acquiring connection from connection pool'), 'transient'],
        [Object.assign(new Error('database unavailable'), { code: 'PGRST002' }), 'transient'],
        [new Error('transport failed PGRST003', { cause: Object.assign(new Error('auth'), { code: 'PGRST301' }) }), 'permanent'],
        [new Error('Guarded storage operation failed (28P01).'), 'permanent'],
        [new Error('Guarded storage operation failed (42P01).'), 'permanent'],
        [new Error('Guarded storage operation failed (PGRST202).'), 'permanent'],
    ] as const;
    for (const [error, expected] of errors) assert.equal(startupFailureKind(error), expected);
    await assert.rejects(() => withLockCore('fixture', async () => true, {
        tryAcquire: async () => { throw Object.assign(new Error('permanent auth'), { code: '28P01' }); },
        release: async () => undefined,
    }, { maxAttempts: 1, failClosed: true }), error => {
        assert.ok(error instanceof LockContendedError);
        assert.equal(startupFailureKind(error), 'transient', 'the baseline wrapper erased the cause; retry is bounded and ambiguous');
        return true;
    });
    // Exercise the real guarded wrapper, not just a string constructed by the test.
    for (const [code, expected] of [['08006', 'transient'], ['40001', 'transient'], ['40P01', 'transient'], ['53300', 'transient'], ['PGRST000', 'transient'], ['PGRST001', 'transient'], ['PGRST002', 'transient'], ['PGRST003', 'transient'], ['PGRST301', 'permanent'], ['PGRST202', 'permanent'], ['28P01', 'permanent']] as const) {
        const guarded = makeGuardedRestKv(_makeMemoryKv(), async () => ({ data: null, error: { code } }), pattern => pattern);
        await assert.rejects(() => withKvLeaseContext('lease:fixture', 'owner', () => guarded.get('key')), error => {
            assert.equal(startupFailureKind(error), expected);
            return true;
        });
    }
});

it('stop cancels waits; active work stays in background drain until it settles', async () => {
    const clock = recoveryClock();
    const recovery = createStartupRecovery(clock.options);
    const waiting = recovery.start('waiting', async () => false);
    await flush();
    let release!: () => void;
    const active = recovery.start('active', async () => { await new Promise<void>(resolve => { release = resolve; }); return true; });
    await flush();
    stopBackgroundWork();
    recovery.stop();
    assert.equal(clock.timers.size, 0);
    assert.equal(await waiting, 'stopped');
    let drained = false;
    const drain = drainBackgroundWork().then(() => { drained = true; });
    await flush();
    assert.equal(drained, false);
    release();
    assert.equal(await active, 'stopped');
    await drain;
    let admitted = false;
    assert.equal(await recovery.start('after-stop', async () => { admitted = true; return true; }), 'stopped');
    assert.equal(admitted, false);
});
