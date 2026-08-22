import { strict as assert } from 'node:assert';
import test from 'node:test';
import { claimBuiltinEventReward } from './event-claim-api';

type FetchArgs = Parameters<typeof globalThis.fetch>;
const realFetch = globalThis.fetch;

function stubFetch(handler: (url: string, init: RequestInit | undefined) => Promise<Response>) {
    const calls: string[] = [];
    globalThis.fetch = (async (...args: FetchArgs) => {
        const [input, init] = args;
        calls.push(String(input));
        return handler(String(input), init as RequestInit | undefined);
    }) as typeof globalThis.fetch;
    return calls;
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/**
 * runSingleFlight defers the work to a microtask (`Promise.resolve().then(work)`),
 * so the stub is NOT invoked synchronously by the call. Spin the event loop until
 * the request has actually been issued before releasing it — resolving too early
 * hits a resolver that has not been assigned yet, and the test hangs forever.
 */
async function untilCalled(calls: string[], count = 1) {
    for (let i = 0; i < 100 && calls.length < count; i++) await new Promise((r) => setTimeout(r, 0));
    assert.ok(calls.length >= count, `expected ${count} request(s), saw ${calls.length}`);
}

test.afterEach(() => { globalThis.fetch = realFetch; });

test('concurrent claims for the same player+event share ONE request', async () => {
    let resolveIt: (r: Response) => void = () => {};
    const calls = stubFetch(() => new Promise<Response>((res) => { resolveIt = res; }));

    // The VN action lock self-heals after 1.5s, so a second click can land while
    // the first claim is still in flight. It must adopt the first result rather
    // than issue a second claim against it.
    const a = claimBuiltinEventReward('Kaito', 'aura-sphere');
    const b = claimBuiltinEventReward('Kaito', 'aura-sphere');
    await untilCalled(calls);
    resolveIt(ok({ character: { name: 'Kaito' }, _saveVersion: 4 }));
    const [first, second] = await Promise.all([a, b]);

    assert.equal(calls.length, 1, 'a second concurrent click must not hit the server again');
    assert.equal(first._saveVersion, 4);
    assert.deepEqual(second, first, 'both callers must observe the same settled result');
});

test('the player name is matched case- and whitespace-insensitively', async () => {
    let resolveIt: (r: Response) => void = () => {};
    const calls = stubFetch(() => new Promise<Response>((res) => { resolveIt = res; }));
    const a = claimBuiltinEventReward('Kaito', 'aura-sphere');
    const b = claimBuiltinEventReward('  kaito ', 'aura-sphere');
    await untilCalled(calls);
    resolveIt(ok({ alreadyClaimed: true }));
    await Promise.all([a, b]);
    assert.equal(calls.length, 1);
});

test('a different event is NOT collapsed into the in-flight one', async () => {
    const calls = stubFetch(async () => ok({ alreadyClaimed: true }));
    await Promise.all([
        claimBuiltinEventReward('Kaito', 'aura-sphere'),
        claimBuiltinEventReward('Kaito', 'some-other-event'),
    ]);
    assert.equal(calls.length, 2);
});

test('a settled claim clears the slot so a later retry reaches the server', async () => {
    const calls = stubFetch(async () => ok({ alreadyClaimed: true }));
    await claimBuiltinEventReward('Kaito', 'aura-sphere');
    await claimBuiltinEventReward('Kaito', 'aura-sphere');
    assert.equal(calls.length, 2, 'sequential claims must not be served from a stale shared promise');
});

test('a FAILED claim clears the slot too — retry must not inherit the failure', async () => {
    // This is the property that makes single-flighting safe: without it, a
    // rejected/errored shared promise could pin every later attempt.
    let attempt = 0;
    const calls = stubFetch(async () => {
        attempt++;
        if (attempt === 1) throw new Error('network down');
        return ok({ character: { name: 'Kaito' }, _saveVersion: 9 });
    });

    const failed = await claimBuiltinEventReward('Kaito', 'aura-sphere');
    assert.ok(failed.error, 'the first attempt should surface an error, not throw');

    const retried = await claimBuiltinEventReward('Kaito', 'aura-sphere');
    assert.equal(retried._saveVersion, 9, 'the retry must reach the server and succeed');
    assert.equal(calls.length, 2);
});

test('a non-ok response reports an error rather than a bare character', async () => {
    stubFetch(async () => new Response(JSON.stringify({ error: 'not eligible' }), { status: 409 }));
    const result = await claimBuiltinEventReward('Kaito', 'aura-sphere');
    assert.equal(result.error, 'not eligible');
    assert.equal(result.character, undefined);
});

test('the request carries a deadline so a hung claim cannot pin every retry', async () => {
    let seenSignal: AbortSignal | undefined;
    stubFetch(async (_url, init) => {
        seenSignal = init?.signal ?? undefined;
        return ok({ alreadyClaimed: true });
    });
    await claimBuiltinEventReward('Kaito', 'aura-sphere');
    assert.ok(seenSignal, 'the claim must pass an AbortSignal');
});
