import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { hasPendingHollowGateUnlock, postHollowGateUnlock } from './player-api';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalFetch = globalThis.fetch;
let sequence = 0;

beforeEach(() => {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => { entries.set(key, value); },
        removeItem: (key: string) => { entries.delete(key); },
    } });
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
});

for (const broken of ['{', 'null', '{}', '{"character":{}}', '{"hollowGateUnlockedUntil":123}',
    '{"character":true,"hollowGateUnlockedUntil":123}', '{"character":[],"hollowGateUnlockedUntil":123}']) {
    test(`an unreadable or incomplete 200 keeps the purchase id: ${broken}`, async () => {
        const player = `gatebody${++sequence}`;
        const village = 'Frostfang Village';
        const requests: string[] = [];
        globalThis.fetch = async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)).requestId);
            return requests.length === 1 ? new Response(broken, { status: 200 })
                : Response.json({ character: { name: player }, hollowGateUnlockedUntil: Date.now() + 86_400_000 });
        };
        await postHollowGateUnlock(player, village);
        assert.equal(hasPendingHollowGateUnlock(player, village), true, 'the charge has not been confirmed');
        const retry = await postHollowGateUnlock(player, village);
        assert.equal(retry.ok, true);
        assert.equal(requests[1], requests[0], 'retry recovers the existing charge instead of buying another window');
        assert.equal(hasPendingHollowGateUnlock(player, village), false);
        await postHollowGateUnlock(player, village);
        assert.notEqual(requests[2], requests[0], 'a later intentional extension gets a new purchase id');
    });
}

test('a retryable failure retains the id, while an authoritative refusal releases it', async () => {
    const player = `gaterefusal${++sequence}`;
    const village = 'Frostfang Village';
    const requests: string[] = [];
    globalThis.fetch = async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)).requestId);
        return Response.json({ error: 'retry' }, { status: requests.length === 1 ? 503 : 409 });
    };
    await postHollowGateUnlock(player, village);
    assert.equal(hasPendingHollowGateUnlock(player, village), true);
    await postHollowGateUnlock(player, village);
    assert.equal(requests[1], requests[0]);
    assert.equal(hasPendingHollowGateUnlock(player, village), false);
});
