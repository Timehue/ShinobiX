import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { KvCasOp, KvLike } from '../_storage.js';
import type { OnlinePlayer } from '../_realtime/types.js';
import type { BuildingAction } from '../../shared/sector-building-types.js';
import { sectorBuilding } from '../../shared/sector-buildings.js';

process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.NODE_ENV = 'test';
let kv: typeof import('../_storage.js').kv;
let settle: typeof import('./_building-settlement.js').settleBuildingAction;
let withLock: typeof import('../_lock.js').withKvLock;
let countOwned: typeof import('../craft/_forge.js').countOwned;
const NOW = Date.now();
const keeper = sectorBuilding('stronghold-28')!;
const action: BuildingAction = {
    action: 'craft', buildingId: keeper.id, recipeId: 'pet-treat', requestId: 'keeper-craft-request-0001',
    materials: [{ 'gather-river-fish': 6 }, { 'gather-field-herb': 2 }],
};
type Store = Pick<KvLike, 'get' | 'compareSet'> & Partial<Pick<KvLike, 'compareSetMany'>>;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ settleBuildingAction: settle } = await import('./_building-settlement.js'));
    ({ withKvLock: withLock } = await import('../_lock.js'));
    ({ countOwned } = await import('../craft/_forge.js'));
});
beforeEach(async () => {
    for (const pattern of ['save:*', 'world:building:*', 'ledger:currency:*'])
        for (const key of await kv.keys(pattern)) await kv.del(key);
});
const stocked = (patch: Record<string, unknown> = {}) => ({ _saveVersion: 1, character: {
    name: 'workshopper', level: 85, ryo: 320, boneCharms: 0, fateShards: 0, inventory: [],
    itemStacks: [{ itemId: 'gather-river-fish', count: 9 }, { itemId: 'gather-field-herb', count: 17 },
        { itemId: 'gather-river-fish-pristine', count: 2 }], ...patch,
} });
const presence: OnlinePlayer = { name: 'workshopper', displayName: 'Workshopper', sector: keeper.sector,
    tile: keeper.approach, lastSeenAt: NOW, connectedAt: NOW, pendingAttacker: null, character: null };
const run = (store: Store = kv, request: BuildingAction = action) => withLock(`world:building:${keeper.id}`,
    () => withLock('save:workshopper', () => settle(store, 'workshopper', request,
        { now: NOW, orderId: 'keeper-craft-receipt-0001', presence }), { failClosed: true }), { failClosed: true });

test('keeper craft commits the 320-ryo fee, exact materials, output and replay receipt with the ledger once', async () => {
    await kv.set('save:workshopper', stocked());
    const transactions: (readonly KvCasOp[])[] = [];
    const store: Store = { get: kv.get.bind(kv), compareSet: async () => { throw Error('craft must commit atomically'); },
        compareSetMany: async ops => { transactions.push(ops); return kv.compareSetMany!(ops); } };
    const results = await Promise.all([run(store), run(store)]);
    assert.ok(results.every(result => result.ok));
    assert.equal(results.filter(result => result.ok && result.replayed).length, 1);
    assert.equal(transactions.length, 1);
    assert.deepEqual(transactions[0].map(op => op.key).sort(), ['ledger:currency:workshopper', 'save:workshopper']);
    const saved = await kv.get<{ _saveVersion: number; character: Record<string, unknown> }>('save:workshopper');
    assert.equal(saved!._saveVersion, 2); assert.equal(saved!.character.ryo, 0);
    assert.equal(countOwned(saved!.character, 'pet-treat'), 1);
    assert.equal(countOwned(saved!.character, 'gather-river-fish'), 3);
    assert.equal(countOwned(saved!.character, 'gather-field-herb'), 15);
    assert.equal(countOwned(saved!.character, 'gather-river-fish-pristine'), 2);
    const ledger = await kv.get<{ saveVersion: number; balances: { ryo: number } }>('ledger:currency:workshopper');
    assert.equal(ledger!.balances.ryo, 0); assert.equal(ledger!.saveVersion, saved!._saveVersion);
    // Reconnection can recover the receipt even after presence expires.
    const replay = await settle(store, 'workshopper', action, { now: NOW + 60_000, orderId: 'retry-receipt', presence: null });
    assert.ok(replay.ok && replay.replayed); assert.equal(transactions.length, 1);
    assert.deepEqual(await kv.get('save:workshopper'), saved);
});

test('short ryo, invalid materials, low level and capped output refuse with the entire save and ledger unchanged', async () => {
    const cases = [
        { patch: { ryo: 319 }, request: action, error: /fee for this craft is 320 ryo, and you carry 319.*Nothing was spent/ },
        { patch: {}, request: { ...action, materials: [] }, error: /Nothing was spent/ },
        { patch: { level: 0 }, request: action, error: /Nothing was spent/ },
        { patch: { itemStacks: [...stocked().character.itemStacks, { itemId: 'pet-treat', count: 9999 }] }, request: action, error: /Nothing was spent/ },
    ];
    for (const { patch, request, error } of cases) {
        const original = stocked(patch); await kv.set('save:workshopper', original);
        let writes = 0;
        const store: Store = { get: kv.get.bind(kv), compareSet: async () => { writes++; return false; },
            compareSetMany: async () => { writes++; return false; } };
        const result = await run(store, request);
        assert.equal(result.ok, false); if (!result.ok) { assert.equal(result.status, 409); assert.match(result.error, error); }
        assert.equal(writes, 0); assert.deepEqual(await kv.get('save:workshopper'), original);
        assert.equal(await kv.get('ledger:currency:workshopper'), null);
        assert.equal(await kv.get(`world:building:${keeper.id}`), null);
    }
});

test('a rejected keeper craft transaction spends no currency or materials and creates no receipt or output', async () => {
    const original = stocked(); await kv.set('save:workshopper', original);
    const store: Store = { get: kv.get.bind(kv), compareSet: kv.compareSet.bind(kv), compareSetMany: async () => false };
    await assert.rejects(() => run(store), /player-save-version-conflict/);
    assert.deepEqual(await kv.get('save:workshopper'), original);
    assert.equal(await kv.get('ledger:currency:workshopper'), null);
});

test('a committed keeper craft with a lost acknowledgement recovers and never spends twice', async () => {
    await kv.set('save:workshopper', stocked()); let transactions = 0;
    const store: Store = { get: kv.get.bind(kv), compareSet: kv.compareSet.bind(kv), compareSetMany: async ops => {
        transactions++; const committed = await kv.compareSetMany!(ops);
        if (committed) throw Error('lost keeper transaction acknowledgement');
        return committed;
    } };
    assert.ok((await run(store)).ok);
    const after = await kv.get('save:workshopper');
    const replay = await run(store); assert.ok(replay.ok && replay.replayed);
    assert.equal(transactions, 1); assert.deepEqual(await kv.get('save:workshopper'), after);
    if (replay.ok) { assert.equal(replay.character.ryo, 0); assert.equal(countOwned(replay.character, 'pet-treat'), 1); }
});

test('two different keeper requests cannot both spend the same last 320 ryo', async () => {
    await kv.set('save:workshopper', stocked());
    const results = await Promise.all([run(), run(kv, { ...action, requestId: 'keeper-craft-request-0002' })]);
    assert.equal(results.filter(result => result.ok).length, 1);
    const saved = await kv.get<{ character: Record<string, unknown> }>('save:workshopper');
    assert.equal(saved!.character.ryo, 0); assert.equal(countOwned(saved!.character, 'pet-treat'), 1);
    assert.equal(countOwned(saved!.character, 'gather-river-fish'), 3);
});
