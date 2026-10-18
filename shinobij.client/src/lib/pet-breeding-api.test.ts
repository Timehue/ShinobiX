import assert from 'node:assert/strict';
import test from 'node:test';
import { advancePetIncubation, fetchBreedingStatus, hatchPetBreeding, startPetBreeding } from './pet-breeding-api';

test('a stalled incubation request times out and a retry can progress again', async context => {
    const timeout = new AbortController();
    context.mock.method(AbortSignal, 'timeout', (ms: number) => {
        assert.equal(ms, 12_000); return timeout.signal;
    });
    context.mock.method(globalThis, 'fetch', async (_url, options) => new Promise<Response>((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
    }));
    const activity = { id: 'foreground-session-0001', active: true, elapsedMs: 15_000 };
    const stalled = advancePetIncubation('Player', activity);
    timeout.abort(new DOMException('Timed out', 'TimeoutError'));
    await assert.rejects(stalled, { name: 'TimeoutError' });
    context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ok: true, session: null, _saveVersion: 2 })));
    assert.equal((await advancePetIncubation('Player', activity))._saveVersion, 2);
});

test('reads respect unmount cancellation and every breeding mutation has a deadline', async context => {
    const timeout = new AbortController(), unmounted = new AbortController();
    context.mock.method(AbortSignal, 'timeout', () => timeout.signal);
    const signals: AbortSignal[] = [];
    const bodies: Record<string, unknown>[] = [];
    context.mock.method(globalThis, 'fetch', async (_url, options) => {
        signals.push(options!.signal!);
        if (options?.body) bodies.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify({ ok: true }));
    });
    await fetchBreedingStatus('Player', unmounted.signal);
    unmounted.abort();
    assert.equal(signals[0].aborted, true);
    await startPetBreeding({ playerName: 'Player', parent1Id: 'one', parent2Id: 'two', requestId: 'retry-keeps-this-receipt' });
    await hatchPetBreeding({ playerName: 'Player', sessionId: `breed-${'a'.repeat(32)}`, acknowledgeReveal: true });
    timeout.abort();
    assert.ok(signals.every(signal => signal.aborted));
    assert.equal(bodies[0].requestId, 'retry-keeps-this-receipt');
    assert.equal(bodies[1].acknowledgeReveal, true);
});
