import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { settleInventorySale, settleShopCardPack, settleShopItemPurchase } from './shop-settlement';
import { AMBIGUOUS_ACTION_MESSAGE } from './ambiguous-action';

function mockSessionStorage(t: TestContext) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => { values.set(key, value); },
            removeItem: (key: string) => { values.delete(key); },
        },
    });
    t.after(() => {
        if (prior) Object.defineProperty(globalThis, 'sessionStorage', prior);
        else Reflect.deleteProperty(globalThis, 'sessionStorage');
    });
    return values;
}

const receipt = {
    ok: true,
    character: { name: 'Rill', ryo: 1234 },
    settlement: { kind: 'inventory-sale', itemId: 'rustfang-kunai', quantity: 2, ryo: 224 },
    _saveVersion: 17,
};

for (const scenario of [
    { name: 'confirmed rejection', status: 400, body: { error: 'This item is no longer in your backpack.' }, retained: false, message: 'This item is no longer in your backpack.' },
    { name: 'confirmed rejection without reason', status: 409, body: {}, retained: false, message: 'Could not sell the item. Nothing was changed; please retry.' },
    { name: 'timed out response', status: 408, body: { error: 'Request timeout.' }, retained: false, message: AMBIGUOUS_ACTION_MESSAGE },
    { name: 'server interruption', status: 503, body: { error: 'Please retry.' }, retained: true, message: AMBIGUOUS_ACTION_MESSAGE },
    { name: 'missing success payload', status: 200, body: {}, retained: false, message: AMBIGUOUS_ACTION_MESSAGE },
    { name: 'missing settlement receipt', status: 200, body: { ok: true, character: receipt.character }, retained: false, message: AMBIGUOUS_ACTION_MESSAGE },
    { name: 'missing character snapshot', status: 200, body: { ok: true, settlement: receipt.settlement }, retained: false, message: AMBIGUOUS_ACTION_MESSAGE },
    { name: 'unreadable success response', status: 200, body: 'invalid JSON', retained: false, message: AMBIGUOUS_ACTION_MESSAGE },
    { name: 'disconnected response', status: 0, body: {}, retained: true, message: AMBIGUOUS_ACTION_MESSAGE },
]) {
    test(`inventory sale describes ${scenario.name} and preserves request ID policy`, async (t) => {
        const storedIds = mockSessionStorage(t);
        const requests: Record<string, unknown>[] = [];
        const playerName = `Rill-${scenario.name}`;
        t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
            assert.equal(url, '/api/inventory/sell');
            assert.equal(init?.method, 'POST');
            assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
            requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            if (requests.length > 1) return new Response(JSON.stringify(receipt));
            if (scenario.status === 0) throw new TypeError('Failed to fetch');
            return new Response(typeof scenario.body === 'string' ? scenario.body : JSON.stringify(scenario.body), { status: scenario.status });
        });
        const first = await settleInventorySale(playerName, 'rustfang-kunai', 'backpack', 2);
        assert.deepEqual(first, { ok: false, error: scenario.message });
        assert.equal(storedIds.size, scenario.retained ? 1 : 0);
        assert.match(String(requests[0].requestId), /^[a-f0-9]{32}$/);
        assert.deepEqual(requests[0], { playerName, itemId: 'rustfang-kunai', source: 'backpack', quantity: 2, requestId: requests[0].requestId });

        assert.deepEqual(await settleInventorySale(playerName, 'rustfang-kunai', 'backpack', 2), receipt);
        assert.equal(requests[1].requestId === requests[0].requestId, scenario.retained);
        assert.equal(storedIds.size, 0, 'an accepted result clears the stored intent');
        await settleInventorySale(playerName, 'rustfang-kunai', 'backpack', 2);
        assert.notEqual(requests[2].requestId, requests[1].requestId, 'a new sale after success gets a new request ID');
    });
}

test('equipped sale sends its physical slot and returns the server receipt unchanged', async (t) => {
    mockSessionStorage(t);
    const equippedReceipt = { ...receipt, settlement: { ...receipt.settlement, quantity: 1, ryo: 112 } };
    t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body, { playerName: 'Rill-equipped', itemId: 'rustfang-kunai', source: 'equipped', quantity: 1, equipmentSlot: 'hand', requestId: body.requestId });
        return new Response(JSON.stringify(equippedReceipt));
    });
    assert.deepEqual(await settleInventorySale('Rill-equipped', 'rustfang-kunai', 'equipped', 1, 'hand'), equippedReceipt);
});

test('a lost sale response reuses its in-memory ID when session storage is unavailable', async (t) => {
    mockSessionStorage(t);
    t.mock.method(globalThis.sessionStorage, 'getItem', () => { throw new Error('Storage unavailable'); });
    t.mock.method(globalThis.sessionStorage, 'setItem', () => { throw new Error('Storage unavailable'); });
    t.mock.method(globalThis.sessionStorage, 'removeItem', () => { throw new Error('Storage unavailable'); });
    const ids: string[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
        ids.push(JSON.parse(String(init?.body)).requestId);
        if (ids.length === 1) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify(receipt));
    });
    assert.deepEqual(await settleInventorySale('Rill-no-storage', 'rustfang-kunai', 'backpack', 2), { ok: false, error: AMBIGUOUS_ACTION_MESSAGE });
    assert.deepEqual(await settleInventorySale('Rill-no-storage', 'rustfang-kunai', 'backpack', 2), receipt);
    assert.equal(ids[1], ids[0]);
    await settleInventorySale('Rill-no-storage', 'rustfang-kunai', 'backpack', 2);
    assert.notEqual(ids[2], ids[1]);
});

for (const scenario of [
    { name: 'shop purchase', action: { type: 'purchase-item', itemId: 'rustfang-kunai', quantity: 3 }, call: () => settleShopItemPurchase('Rill-purchase', 'rustfang-kunai', 3), settlement: { kind: 'item-purchase', itemId: 'rustfang-kunai', quantity: 3, totalCost: 675 } },
    { name: 'card pack', action: { type: 'open-card-pack', packId: 'epic' }, call: () => settleShopCardPack('Rill-pack', 'epic'), settlement: { kind: 'card-pack', packId: 'epic', drawn: ['card-a'], totalCost: 900 } },
]) {
    test(`${scenario.name} preserves payload, replay ID, and authoritative receipt`, async (t) => {
        mockSessionStorage(t);
        const ids: string[] = [];
        const result = { ...receipt, settlement: scenario.settlement };
        t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
            assert.equal(url, '/api/shop/settle');
            const body = JSON.parse(String(init?.body));
            assert.deepEqual(body.action, scenario.action);
            ids.push(body.requestId);
            return ids.length === 1
                ? new Response(JSON.stringify({ error: 'Interrupted' }), { status: 503 })
                : new Response(JSON.stringify(result));
        });
        assert.deepEqual(await scenario.call(), { ok: false, error: AMBIGUOUS_ACTION_MESSAGE });
        assert.deepEqual(await scenario.call(), result);
        assert.equal(ids[1], ids[0]);
    });
}
