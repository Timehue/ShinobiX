import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, test } from 'node:test';
import { resourceNode } from '../../shared/resource-nodes.js';
import { readResourceGathering, resourceActionsToday } from '../../shared/resource-gathering.js';
import { countOwned } from '../craft/_forge.js';
import { sectorPoolKey, cleanSectorPoolRow } from './_sector-pool.js';
process.env.NODE_ENV = 'test'; process.env.SHINOBIX_QA_MEMORY_KV = '1'; process.env.SESSION_SECRET = 'resource-integration-secret';
type Json = Record<string, unknown>;
let kv: typeof import('../_storage.js').kv, token: typeof import('../_auth.js').issuePlayerToken;
let online: typeof import('../_realtime/online-store.js').onlineStore;
type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler, purchaseHandler: Handler;
let reconcile: typeof import('./_resource-reconcile.js').reconcileResourceAdmission;
before(async () => {
    ({ kv } = await import('../_storage.js')); ({ issuePlayerToken: token } = await import('../_auth.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    handler = (await import('./resource.js')).default as unknown as Handler;
    purchaseHandler = (await import('../shop/purchase.js')).default as unknown as Handler;
    ({ reconcileResourceAdmission: reconcile } = await import('./_resource-reconcile.js'));
});
async function post(name: string, body: Json, auth = true, target = handler) {
    const out = { status: 200, body: {} as Json };
    const res = { setHeader() { return res; }, status(value: number) { out.status = value; return res; }, json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await target({ method: 'POST', body, headers: auth ? { 'x-player-token': token(name) } : {}, socket: { remoteAddress: '127.4.8.9' } } as never, res as never);
    return out;
}
async function seed(name: string, patch: Json = {}) {
    const node = resourceNode('resource-17')!;
    const character = { name, level: 100, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        inventory: [], itemStacks: [], ryo: 9999, fateShards: 100, village: 'Frostfang', equipment: { pickaxe: 'tool-golden-pickaxe' }, ...patch };
    await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: Date.now(), currentSector: node.sector, character });
    online.upsert({ name, sector: node.sector, tile: node.approach, character: { level: 100 } });
}
for (const activity of ['mining', 'fishing'] as const) {
    for (const interruption of ['heartbeat', 'battle', 'expiry'] as const) {
        test(`${activity} status recovery reports ${interruption} and preserves admission accounting on replay`, async () => {
            const name = `resumestatus${activity}${interruption}`, node = resourceNode(activity === 'mining' ? 'resource-17' : 'resource-1')!;
            await seed(name, { equipment: { pickaxe: 'tool-basic-pickaxe', fishingPole: 'tool-basic-fishing-pole' },
                gatheringToolUses: { 'tool-basic-pickaxe': 0, 'tool-basic-fishing-pole': 0 } });
            if (activity === 'fishing') online.startTravel(name, node.sector, Date.now(), 29, node.approach);
            online.setInBattle(name, true); online.setInBattle(name, false);
            const epoch = online.get(name)!.resourceEpoch!; assert.ok(epoch > 0);
            const id = `recover-status-${activity}-${interruption}`;
            const started = await post(name, { action: 'start', nodeId: node.id, mode: 'relaxed', requestId: id });
            assert.equal(started.status, 200);
            const saved = (await kv.get<Json>(`save:${name}`))!, character = saved.character as Json;
            const state = readResourceGathering(character.resourceGathering), startedAt = Date.now() - 4000;
            const expiresAt = interruption === 'expiry' ? Date.now() - 1 : startedAt + 90_000;
            await kv.set(`save:${name}`, { ...saved, character: { ...character, resourceGathering: { ...state, active: { ...state.active, startedAt, expiresAt } } } });
            const key = `economy-tx:resource-gathering:${createHash('sha256').update(`${name}:${id}`).digest('hex')}`;
            const journal = (await kv.get<{ meta: Json }>(key))!;
            await kv.set(key, { ...journal, meta: { ...journal.meta, seal: { ...(journal.meta.seal as Json), startedAt, expiresAt, successDraw: 0, traceDraw: 1 } } });
            if (interruption === 'battle') { online.setInBattle(name, true); online.setInBattle(name, false); }
            online.upsert({ name, sector: node.sector, tile: node.approach, character: null });
            const status = await post(name, { action: 'status' }); assert.equal(status.status, 200);
            if (interruption === 'heartbeat') {
                assert.equal(online.get(name)!.resourceEpoch, epoch);
                assert.equal(readResourceGathering((status.body.character as Json).resourceGathering).active?.id, id);
                assert.equal(status.body.receipt, undefined);
            } else {
                assert.equal((status.body.receipt as Json).outcome, interruption === 'expiry' ? 'expired' : 'cancelled');
                assert.equal((status.body.receipt as Json).xp, 0); assert.equal(status.body.nodeId, node.id);
                assert.equal(readResourceGathering((status.body.character as Json).resourceGathering).active, undefined);
            }
            const settlement = await post(name, { action: 'resolve', requestId: id }); assert.equal(settlement.status, 200);
            const settled = settlement.body.character as Json, receipt = settlement.body.receipt as Json;
            assert.equal(receipt.xp, interruption === 'heartbeat' ? 10 : 0);
            assert.equal(resourceActionsToday(settled), 1);
            assert.equal(readResourceGathering(settled.resourceGathering).nodes[node.id].attempts, 1);
            assert.equal((settled.gatheringToolUses as Json)[activity === 'mining' ? 'tool-basic-pickaxe' : 'tool-basic-fishing-pole'], 1);
            const replay = await post(name, { action: 'cancel', requestId: id });
            assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
            assert.deepEqual(replay.body.character, settled); assert.deepEqual(replay.body.receipt, receipt);
            const recovered = await post(name, { action: 'status', requestId: id, nodeId: node.id });
            assert.equal(recovered.status, 200); assert.deepEqual(recovered.body.receipt, receipt);
            assert.equal(recovered.body.nodeId, node.id); assert.deepEqual(recovered.body.character, settled);
        });
    }
}
test('authenticated mixed action #100 admits once, shares one pool slot and refuses #101', async () => {
    const name = 'resourcehundred'; await seed(name, { serverExploreDate: new Date().toISOString().slice(0, 10), serverExploresToday: 99 });
    const body = { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: 'resource-shared-hundred-001' };
    assert.equal((await post(name, body, false)).status, 401);
    const attempts = await Promise.all([post(name, body), post(name, body)]);
    assert.ok(attempts.some(result => result.status === 200));
    const replay = await post(name, body); assert.equal(replay.status, 200);
    const char = replay.body.character as Json;
    assert.equal(resourceActionsToday(char), 100); assert.equal(readResourceGathering(char.resourceGathering).nodes['resource-17'].attempts, 1);
    const cancel = await post(name, { action: 'cancel', requestId: body.requestId }); assert.equal(cancel.status, 200);
    assert.equal((await post(name, { ...body, requestId: 'resource-shared-hundred-002' })).status, 409);
    assert.equal((await post(name, { ...body, nodeId: 'resource-18' })).status, 409);
});
test('server-owned outcome ignores forged amounts and replay never credits twice', async () => {
    const name = 'resourcereward'; await seed(name);
    const id = 'resource-reward-attempt-001';
    const start = await post(name, { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: id }); assert.equal(start.status, 200);
    // Trusted fixture advances the admitted timeline and fixes the random draw;
    // the request below still cannot supply or change either sealed value.
    const saved = (await kv.get<Json>(`save:${name}`))!;
    const char = saved.character as Json, state = readResourceGathering(char.resourceGathering);
    for (const publicAttempt of [start.body.attempt, state.active]) {
        for (const privateKey of ['successDraw', 'qualityDraw', 'traceDraw', 'rules', 'authorityEpoch'])
            assert.equal(Object.hasOwn(publicAttempt as Json, privateKey), false, `${privateKey} stays in the server journal`);
    }
    const startedAt = Date.now() - 4000;
    await kv.set(`save:${name}`, { ...saved, character: { ...char, resourceGathering: { ...state, active: { ...state.active, startedAt } } } });
    const journalKey = `economy-tx:resource-gathering:${createHash('sha256').update(`${name}:${id}`).digest('hex')}`;
    const sealedJournal = (await kv.get<{ meta: Json }>(journalKey))!;
    await kv.set(journalKey, { ...sealedJournal, meta: { ...sealedJournal.meta,
        seal: { ...(sealedJournal.meta.seal as Json), startedAt, successDraw: 0, qualityDraw: .999 } } });
    const forged = { action: 'resolve', requestId: id, success: true, grade: 3, amount: 999, itemId: 'tool-golden-pickaxe' };
    const result = await post(name, forged); assert.equal(result.status, 200);
    assert.equal(countOwned(result.body.character as Json, 'gather-iron-sand'), 1);
    assert.equal(countOwned(result.body.character as Json, 'gather-iron-sand-pristine'), 0);
    const replay = await post(name, forged); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
    assert.equal(countOwned(replay.body.character as Json, 'gather-iron-sand'), 1);
    const persisted = (await kv.get<Json>(`save:${name}`))!.character as Json;
    assert.equal(readResourceGathering(persisted.resourceGathering).active, undefined, 'settlement must clear the stored attempt');
    const nextId = 'resource-reward-attempt-002';
    assert.equal((await post(name, { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: nextId })).status, 200);
    assert.equal((await post(name, { action: 'cancel', requestId: nextId })).status, 200);
    assert.equal(readResourceGathering(((await kv.get<Json>(`save:${name}`))!.character as Json).resourceGathering).active, undefined);
    const journals = await kv.keys('economy-tx:resource-gathering:*');
    const journal = (await Promise.all(journals.map(key => kv.get<{ id: string; meta: Json }>(key)))).find(tx => tx?.meta.playerName === name)!;
    assert.equal((await reconcile(journal.id)).ok, true);
});
test('refining uses exact units and cooking/refining request IDs cannot be repurposed', async () => {
    const name = 'resourcerefine'; await seed(name, { itemStacks: [{ itemId: 'gather-rime-crystal-pristine', count: 2 }] });
    const body = { action: 'refine', itemId: 'gather-rime-crystal-pristine', quantity: 1, requestId: 'refine-resource-attempt-001' };
    const first = await post(name, body); assert.equal(first.status, 200);
    assert.equal(countOwned(first.body.character as Json, 'gather-rime-crystal'), 4);
    assert.equal(countOwned(first.body.character as Json, 'gather-rime-crystal-pristine'), 1);
    const replay = await post(name, body); assert.equal(replay.status, 200);
    assert.equal(countOwned(replay.body.character as Json, 'gather-rime-crystal'), 4);
    assert.equal((await post(name, { ...body, quantity: 2 })).status, 409);
});

test('a committed admission with a lost save acknowledgement spends one action and pool slot', async () => {
    const name = 'resourcelostack'; await seed(name);
    const poolKey = sectorPoolKey(29, Date.now()), beforePool = cleanSectorPoolRow(await kv.get(poolKey)).explores;
    const original = kv.compareSet; let lost = false;
    kv.compareSet = async (key, expected, value, options) => {
        const result = await original.call(kv, key, expected, value, options);
        if (key === `save:${name}` && result && !lost) { lost = true; throw new Error('fixture-lost-save-ack'); }
        return result;
    };
    const body = { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: 'resource-lost-ack-attempt-001' };
    try { assert.equal((await post(name, body)).status, 200); } finally { kv.compareSet = original; }
    const replay = await post(name, body); assert.equal(replay.status, 200);
    assert.equal(resourceActionsToday(replay.body.character as Json), 1);
    assert.equal(cleanSectorPoolRow(await kv.get(poolKey)).explores, beforePool + 1);
});

test('a refused save CAS releases its reservation without spending a tool use or daily action', async () => {
    const name = 'resourcefailedcas'; await seed(name, { equipment: { pickaxe: 'tool-basic-pickaxe' }, gatheringToolUses: { 'tool-basic-pickaxe': 49 } });
    const poolKey = sectorPoolKey(29, Date.now()), beforePool = cleanSectorPoolRow(await kv.get(poolKey)).explores;
    const original = kv.compareSet;
    kv.compareSet = async (key, expected, value, options) => key === `save:${name}` ? false : original.call(kv, key, expected, value, options);
    const body = { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: 'resource-failed-cas-attempt-001' };
    try { assert.notEqual((await post(name, body)).status, 200); } finally { kv.compareSet = original; }
    const saved = (await kv.get<Json>(`save:${name}`))!.character as Json;
    assert.equal(resourceActionsToday(saved), 0);
    assert.equal((saved.gatheringToolUses as Json)['tool-basic-pickaxe'], 49);
    assert.equal((saved.equipment as Json).pickaxe, 'tool-basic-pickaxe');
    assert.equal(cleanSectorPoolRow(await kv.get(poolKey)).explores, beforePool);
    assert.equal((await post(name, body)).status, 409, 'a refunded admission ID cannot be reused');
});

test('the final basic pickaxe use stays unequipped after settlement and a fresh save read', async () => {
    const name = 'resourcebrokenpick';
    await seed(name, { equipment: { pickaxe: 'tool-basic-pickaxe' }, gatheringToolUses: { 'tool-basic-pickaxe': 49 } });
    const id = 'resource-final-pickaxe-use-001';
    assert.equal((await post(name, { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: id })).status, 200);
    const cancelled = await post(name, { action: 'cancel', requestId: id });
    assert.equal(cancelled.status, 200);
    const saved = (await kv.get<Json>(`save:${name}`))!.character as Json;
    assert.equal((saved.equipment as Json).pickaxe, undefined);
    assert.equal((saved.gatheringToolUses as Json)['tool-basic-pickaxe'], 50);
    assert.equal(readResourceGathering(saved.resourceGathering).active, undefined);
    assert.equal((await post(name, { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: 'resource-final-pickaxe-use-002' })).status, 409);
});

test('both shop tool kinds persist their price, lifetime and independent equipment slots', async () => {
    const name = 'resourcealltools'; await seed(name, { equipment: {}, ryo: 1000, fateShards: 150 });
    for (const [index, id] of ['tool-basic-pickaxe', 'tool-basic-fishing-pole', 'tool-golden-pickaxe', 'tool-golden-fishing-pole'].entries()) {
        const body = { playerName: name, itemId: id, qty: 99, requestId: `resource-shop-tools-00${index}` };
        const purchase = await post(name, body, true, purchaseHandler); assert.equal(purchase.status, 200);
        const premium = id.includes('golden');
        assert.deepEqual(purchase.body.purchase, { id, qty: 1, currency: premium ? 'fateShards' : 'ryo', unitCost: premium ? 50 : 150, totalCost: premium ? 50 : 150 });
        const replay = await post(name, body, true, purchaseHandler); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
        assert.equal((await post(name, { action: 'equip', itemId: id })).status, 200);
    }
    const saved = (await kv.get<Json>(`save:${name}`))!.character as Json;
    assert.equal(saved.ryo, 700); assert.equal(saved.fateShards, 50);
    assert.deepEqual(saved.equipment, { pickaxe: 'tool-golden-pickaxe', fishingPole: 'tool-golden-fishing-pole' });
    assert.equal((saved.gatheringToolUses as Json)['tool-basic-pickaxe'], 0);
    assert.equal((saved.gatheringToolUses as Json)['tool-basic-fishing-pole'], 0);
});

test('a retry after an uncommitted admission expires does not charge a daily action or tool use', async () => {
    const name = 'resourceexpiredstart'; await seed(name, { equipment: { pickaxe: 'tool-basic-pickaxe' }, gatheringToolUses: { 'tool-basic-pickaxe': 49 } });
    const id = 'resource-expired-admission-001', node = resourceNode('resource-17')!;
    const { mintResourceSeal } = await import('./_resource-gathering.js');
    const { reserveEconomyTx, economyTxKey } = await import('../_economy-tx.js');
    const character = (await kv.get<Json>(`save:${name}`))!.character as Json;
    const seal = mintResourceSeal(character, node, id, 'relaxed', online.get(name)!, Date.now() - 120_000);
    const txId = `resource-gathering:${createHash('sha256').update(`${name}:${id}`).digest('hex')}`;
    await reserveEconomyTx({ id: txId, kind: 'resource-gathering', debitKey: sectorPoolKey(node.sector, seal.startedAt),
        creditKey: `save:${name}`, resource: 'explores', amount: 1,
        meta: { fingerprint: `${node.id}:relaxed`, nodeId: node.id, playerName: name, poolEnabled: true, seal } });
    const body = { action: 'start', nodeId: node.id, mode: 'relaxed', requestId: id };
    const result = await post(name, body); assert.equal(result.status, 409);
    assert.match(String(result.body.error), /Nothing was spent/);
    assert.equal((await post(name, body)).status, 409);
    const saved = (await kv.get<Json>(`save:${name}`))!.character as Json;
    assert.equal(resourceActionsToday(saved), 0);
    assert.equal((saved.gatheringToolUses as Json)['tool-basic-pickaxe'], 49);
    assert.equal((saved.equipment as Json).pickaxe, 'tool-basic-pickaxe');
    assert.equal((await kv.get<{ state: string }>(economyTxKey(txId)))!.state, 'refunded');
});
