import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'exchange-test-admin';
delete process.env.SESSION_SECRET;

type Obj = Record<string, any>;
let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let catalog: typeof import('../shop/_catalog.js');
let itemId: string;
const namedId = 'named-weapon-123456781234123412341234567890ab';
const namedDef = { id: namedId, name: 'Ash of the First Sun', slot: 'hand', rarity: 'legendary', cost: 0, levelReq: 90, weaponEp: 173, weaponTags: [{ name: 'Bleed', percent: 24 }], bonuses: { bukijutsuOffense: 71 }, description: 'Forged beneath the red sun.' };

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./exchange.js')).default as unknown as typeof handler;
    catalog = await import('../shop/_catalog.js');
    const items = (await catalog.loadSettlementCatalogs()).items;
    itemId = [...items.values()].find(item => item.slot === 'hand' && !item.serviceItem && !item.stackable)!.id;
});
beforeEach(async () => {
    for (const key of await kv.keys('sunscar-exchange:*')) await kv.del(key);
    for (const key of await kv.keys('offline-notices:*')) await kv.del(key);
    for (const player of ['seller', 'buyer', 'rival']) {
        await kv.del(`petladder:coliseum:def:${player}`);
        await kv.del(`battle-lock:${player}`);
        await kv.set(`save:${player}`, { _saveVersion: 1, character: { name: player, level: 100, ryo: 10_000, inventory: player === 'seller' ? [itemId, itemId, namedId] : [], itemStacks: [], pets: [], tileCards: [], equipment: {}, fateShards: 100, honorSeals: 100, mythicSeals: 100, boneCharms: 100, auraStones: 100 }, creatorItems: player === 'seller' ? [namedDef] : [] });
    }
});
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; delete process.env.ADMIN_PASSWORD; });

async function post(body: Obj, authenticated = true) {
    const out: { status: number; body: Obj } = { status: 200, body: {} };
    const response = { setHeader() {}, status(code: number) { out.status = code; return this; }, json(data: Obj) { out.body = data; return this; }, end() {} };
    await handler({ method: 'POST', body, headers: authenticated ? { 'x-admin-password': process.env.ADMIN_PASSWORD } : {}, socket: { remoteAddress: '127.0.0.1' } } as never, response as never);
    return out;
}
async function record(player: string): Promise<Obj> { return (await kv.get<Obj>(`save:${player}`))!; }
async function patch(player: string, patch: Obj) { const rec = await record(player); await kv.set(`save:${player}`, { ...rec, character: { ...rec.character, ...patch } }); }
async function list(overrides: Obj = {}) { return post({ action: 'list', playerName: 'seller', requestId: randomUUID(), kind: 'item', assetId: itemId, quantity: 1, price: 1000, ...overrides }); }
async function buy(id: string, player = 'buyer', price = 1000, expectedCurrency?: string) { return post({ action: 'buy', playerName: player, listingId: id, expectedPrice: price, expectedCurrency }); }

for (const currency of ['ryo', 'fateShards']) it(`queues one exact seller receipt only after a completed ${currency} sale`, async () => {
    const created = await list({ currency, price: 41, quantity: 2 });
    const id = created.body.listing.id;
    assert.equal(await kv.get('offline-notices:seller'), null);
    const { setRealtimeEmitter } = await import('../_realtime/notify.js');
    const kicks: unknown[] = [];
    setRealtimeEmitter((room, event, payload) => { kicks.push([room, event, payload]); });
    let result;
    try { result = await buy(id, 'buyer', 41, currency); } finally { setRealtimeEmitter(null); }
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(kicks, [['user:seller', 'presence:kick', { reason: 'exchange-sale' }]]);
    assert.equal('saleNoticePending' in result.body.listing, false);
    const inbox = (await kv.get<Obj[]>('offline-notices:seller'))!;
    assert.equal(inbox.length, 1);
    assert.deepEqual(inbox[0].sale, { listingId: id, seller: 'seller', assetName: created.body.listing.asset.name,
        quantity: 2, currency, price: 41, fee: 2, proceeds: 39 });
    assert.equal((await record('seller')).character[currency], (currency === 'ryo' ? 10000 : 100) + 39);
    assert.equal(await kv.get('offline-notices:buyer'), null);
    assert.equal((await buy(id, 'buyer', 41, currency)).status, 200);
    assert.equal((await kv.get<Obj[]>('offline-notices:seller'))!.length, 1);
});

it('does not announce a cancelled or unpaid sale', async () => {
    const id = (await list({ currency: 'fateShards', price: 101 })).body.listing.id;
    assert.equal((await buy(id, 'buyer', 101, 'fateShards')).status, 409);
    assert.equal(await kv.get('offline-notices:seller'), null);
    assert.equal((await post({ action: 'cancel', playerName: 'seller', listingId: id })).status, 200);
    assert.equal(await kv.get('offline-notices:seller'), null);
});

for (const afterWrite of [false, true]) it(`retries a failed seller inbox write without repeating payment or the receipt (after write: ${afterWrite})`, async () => {
    const id = (await list({ currency: 'fateShards', price: 41 })).body.listing.id;
    const original = kv.set;
    kv.set = async (key, value, options) => {
        if (key === 'offline-notices:seller') {
            if (afterWrite) await original.call(kv, key, value, options);
            throw new Error('inbox temporarily unavailable');
        }
        return original.call(kv, key, value, options);
    };
    try { assert.equal((await buy(id, 'buyer', 41, 'fateShards')).status, 200); } finally { kv.set = original; }
    const stored = (await kv.get<Obj>(`sunscar-exchange:listing:${id}`))!;
    assert.equal(stored.state, 'sold');
    assert.equal(stored.saleNoticePending, !afterWrite);
    assert.equal((await record('seller')).character.fateShards, 139);
    const { recoverPendingExchangeListings } = await import('./_exchange.js');
    assert.deepEqual((await recoverPendingExchangeListings()).failures, []);
    const inbox = (await kv.get<Obj[]>('offline-notices:seller'))!;
    assert.equal(inbox.length, 1); assert.equal(inbox[0].sale.listingId, id);
    assert.equal((await record('seller')).character.fateShards, 139);
    assert.equal((await record('buyer')).character.fateShards, 59);
    assert.equal((await kv.get<Obj>(`sunscar-exchange:listing:${id}`))!.saleNoticePending, false);
});

it('settles Fate Shards with the same rounded-down 5% fee and no ryo charge', async () => {
    await patch('buyer', { fateShards: 1000 });
    const created = await list({ currency: 'fateShards', price: 201 });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const { id, currency, fee, proceeds } = created.body.listing;
    assert.deepEqual({ currency, fee, proceeds }, { currency: 'fateShards', fee: 10, proceeds: 191 });
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await buy(id, 'buyer', 201, 'fateShards')).status, 200);
    const buyer = (await record('buyer')).character, seller = (await record('seller')).character;
    assert.equal(buyer.fateShards, 799); assert.equal(seller.fateShards, 291);
    assert.equal(buyer.ryo, 10000); assert.equal(seller.ryo, 10000);
    assert.equal(buyer.inventory.length, 1);
    const txns = (await kv.get<Obj[]>('econ:txns'))!;
    assert.deepEqual(txns.filter(t => t.txnId === `exchange:${id}:buy`).map(t => [t.currency, t.delta]), [['fateShards', -201]]);
    assert.deepEqual(txns.filter(t => t.txnId === `exchange:${id}:sell`).map(t => [t.currency, t.delta]), [['fateShards', 191]]);
});

it('rejects missing or mismatched currency quotes and currency changes under a reused request ID', async () => {
    const requestId = randomUUID();
    const created = await list({ requestId, currency: 'fateShards', price: 50 });
    const id = created.body.listing.id;
    for (const currency of [undefined, 'ryo']) assert.equal((await buy(id, 'buyer', 50, currency)).status, 409);
    assert.equal((await buy(id, 'buyer', 50, 'gold')).status, 400);
    assert.equal((await list({ requestId, price: 50, currency: 'ryo' })).status, 409);
    assert.equal((await list({ requestId, price: 50, currency: 'fateShards' })).body.listing.id, id);
    for (const currency of ['gold', '', null, 1, {}, '__proto__']) assert.equal((await list({ currency })).status, 400);
    assert.equal((await record('buyer')).character.fateShards, 100);
    assert.equal((await record('buyer')).character.inventory.length, 0);
});

it('keeps legacy ryo listings and creation requests replayable after the currency rollout', async () => {
    const requestId = randomUUID();
    const created = await list({ requestId });
    const id = created.body.listing.id, key = `sunscar-exchange:listing:${id}`;
    const legacy = (await kv.get<Obj>(key))!; delete legacy.currency;
    await kv.set(key, legacy);
    assert.equal((await list({ requestId, currency: 'ryo' })).body.listing.currency, 'ryo');
    assert.equal((await buy(id, 'buyer', 1000, 'fateShards')).status, 409);
    assert.equal((await buy(id)).status, 200);
    assert.equal((await record('buyer')).character.ryo, 9000);
    assert.equal((await record('buyer')).character.fateShards, 100);
});

it('requires sufficient Fate Shards independently of ryo and treats an absent shard wallet as zero', async () => {
    const id = (await list({ currency: 'fateShards', price: 101 })).body.listing.id;
    for (const fateShards of [100, undefined]) {
        await patch('buyer', { fateShards });
        const result = await buy(id, 'buyer', 101, 'fateShards');
        assert.equal(result.status, 409); assert.match(result.body.error, /enough Fate Shards/);
        assert.equal((await record('buyer')).character.inventory.length, 0);
        assert.equal((await record('buyer')).character.ryo, 10000);
        assert.equal((await kv.get<Obj>(`sunscar-exchange:listing:${id}`))!.state, 'active');
    }
});

it('cancels a shard listing without a fee and allows a fresh listing in another currency', async () => {
    const id = (await list({ currency: 'fateShards', price: 21 })).body.listing.id;
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await post({ action: 'cancel', playerName: 'seller', listingId: id })).status, 200);
    const seller = (await record('seller')).character;
    assert.equal(seller.fateShards, 100); assert.equal(seller.ryo, 10000);
    assert.equal(seller.inventory.filter((id: string) => id === itemId).length, 2);
    assert.equal((await list({ currency: 'ryo' })).body.listing.currency, 'ryo');
});

for (const failureAfterCommit of [false, true]) it(`recovers interrupted shard seller payment exactly once (after commit: ${failureAfterCommit})`, async () => {
    const id = (await list({ currency: 'fateShards', price: 41 })).body.listing.id;
    const original = kv.compareSet;
    kv.compareSet = async (key, expected, value, options) => {
        if (key === 'save:seller' && (value as Obj).character.sunscarExchangeReceipts?.includes(`${id}:payment`)) {
            if (failureAfterCommit) await original.call(kv, key, expected, value, options);
            throw new Error('simulated shard payment outage');
        }
        return original.call(kv, key, expected, value, options);
    };
    try { assert.equal((await buy(id, 'buyer', 41, 'fateShards')).status, failureAfterCommit ? 200 : 503); } finally { kv.compareSet = original; }
    assert.equal((await record('buyer')).character.fateShards, 59);
    const { recoverPendingExchangeListings } = await import('./_exchange.js');
    assert.deepEqual((await recoverPendingExchangeListings()).failures, []);
    assert.equal((await buy(id, 'buyer', 41, 'fateShards')).status, 200);
    assert.equal((await record('seller')).character.fateShards, 139);
    assert.equal((await record('buyer')).character.fateShards, 59);
    assert.equal((await record('buyer')).character.inventory.length, 1);
});

it('preserves delivered Fate Shards when a resource lot is priced in Fate Shards', async () => {
    const id = (await list({ kind: 'resource', assetId: 'fateShards', quantity: 30, currency: 'fateShards', price: 21 })).body.listing.id;
    await patch('buyer', { fateShards: 20 });
    assert.equal((await buy(id, 'buyer', 21, 'fateShards')).status, 409, 'Delivered units cannot finance their own purchase.');
    await patch('buyer', { fateShards: 100 });
    assert.equal((await buy(id, 'buyer', 21, 'fateShards')).status, 200);
    assert.equal((await record('buyer')).character.fateShards, 109);
    assert.equal((await record('seller')).character.fateShards, 90);
    assert.equal((await record('buyer')).character.ryo, 10000);
});

it('authenticates before reading inventories or trading', async () => {
    assert.equal((await post({ action: 'browse', playerName: 'seller' }, false)).status, 401);
    assert.equal((await post({ action: 'list', playerName: 'seller' }, false)).status, 401);
});

it('escrows a lot, settles the exact price and fee, and replays without duplication', async () => {
    const requestId = randomUUID();
    const created = await list({ requestId, quantity: 2 });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const id = created.body.listing.id;
    assert.equal((await record('seller')).character.inventory.filter((id: string) => id === itemId).length, 0);
    assert.equal((await list({ requestId, quantity: 2 })).body.listing.id, id);
    const purchased = await buy(id);
    assert.equal(purchased.status, 200, JSON.stringify(purchased.body));
    assert.equal((await record('buyer')).character.ryo, 9000);
    assert.equal((await record('seller')).character.ryo, 10950);
    assert.equal(purchased.body.character.inventory.filter((id: string) => id === itemId).length, 2);
    assert.equal((await buy(id)).status, 200);
    assert.equal((await record('buyer')).character.ryo, 9000);
    assert.equal((await record('seller')).character.ryo, 10950);
    assert.equal(purchased.body.listings.length, 0);
    assert.equal('sealed' in purchased.body.activity[0], false);
});

it('rejects changed nonce payloads, forged price quotes, self-buy and foreign cancellation', async () => {
    const requestId = randomUUID(); const created = await list({ requestId }); const id = created.body.listing.id;
    assert.equal((await list({ requestId, price: 1 })).status, 409);
    assert.equal((await buy(id, 'buyer', 1)).status, 409);
    assert.equal((await buy(id, 'seller')).status, 400);
    assert.equal((await post({ action: 'cancel', playerName: 'buyer', listingId: id })).status, 403);
    assert.equal((await record('buyer')).character.ryo, 10000);
});

it('returns a cancelled listing exactly once without charging either party', async () => {
    const id = (await list()).body.listing.id;
    const request = { action: 'cancel', playerName: 'seller', listingId: id };
    assert.equal((await post(request)).status, 200);
    assert.equal((await post(request)).status, 200);
    assert.equal((await record('seller')).character.inventory.filter((id: string) => id === itemId).length, 2);
    assert.equal((await record('seller')).character.ryo, 10000);
    assert.equal((await buy(id)).status, 409);
});

it('only one of two concurrent buyers receives the item', async () => {
    const id = (await list()).body.listing.id;
    const results = await Promise.all([buy(id, 'buyer'), buy(id, 'rival')]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const buyers = [(await record('buyer')).character, (await record('rival')).character];
    assert.equal(buyers.reduce((n, c) => n + c.inventory.length, 0), 1);
    assert.equal(buyers.reduce((n, c) => n + c.ryo, 0), 19000);
    assert.equal((await record('seller')).character.ryo, 10950);
});

it('preserves named weapon definition, forged stats and elemental attunement', async () => {
    await patch('seller', { weaponElements: { [namedId]: 'Fire' } });
    const created = await list({ assetId: namedId });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const bought = await buy(created.body.listing.id);
    assert.equal(bought.status, 200, JSON.stringify(bought.body));
    const def = (await record('buyer')).creatorItems.find((i: Obj) => i.id === namedId);
    assert.equal(def.weaponEp, namedDef.weaponEp);
    assert.deepEqual(def.weaponTags, namedDef.weaponTags);
    assert.equal(def.description, namedDef.description);
    assert.equal((await record('buyer')).character.weaponElements[namedId], 'Fire');
    assert.ok(bought.body.creatorItems.some((i: Obj) => i.id === namedId));
});

it('refuses insufficient ryo, low-level gear and full inventories before a debit', async () => {
    const id = (await list({ assetId: namedId })).body.listing.id;
    await patch('buyer', { ryo: 5 });
    assert.equal((await buy(id)).status, 409);
    await patch('buyer', { ryo: 10000, level: 1 });
    assert.equal((await buy(id)).status, 409);
    await patch('buyer', { ryo: 10000, level: 100, inventory: Array(500).fill(itemId) });
    assert.equal((await buy(id)).status, 409);
    assert.equal((await record('buyer')).character.ryo, 10000);
    assert.equal((await record('seller')).character.ryo, 10000);
});

it('trades zero-shop-value materials, bulk resources and mixed legacy stacks', async () => {
    await patch('seller', { inventory: ['hunt-torn-hide', 'hunt-torn-hide'], itemStacks: [{ itemId: 'hunt-torn-hide', count: 4 }] });
    let created = await list({ assetId: 'hunt-torn-hide', quantity: 5 });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal((await buy(created.body.listing.id)).status, 200);
    assert.equal((await record('buyer')).character.itemStacks.find((s: Obj) => s.itemId === 'hunt-torn-hide').count, 5);
    created = await list({ kind: 'resource', assetId: 'mythicSeals', quantity: 20 });
    assert.equal((await buy(created.body.listing.id)).status, 200);
    assert.equal((await record('seller')).character.mythicSeals, 80);
    assert.equal((await record('buyer')).character.mythicSeals, 120);
});

it('preserves companion identity, lineage, growth and remaining breeding uses', async () => {
    const { createOwnedPet } = await import('../pet/_owned-pet.js');
    const { PET_CATALOG } = await import('../pet/_catalog.js');
    const templateId = Object.keys(PET_CATALOG).find(id => !id.startsWith('starter-'))!;
    const pet = createOwnedPet(templateId, { origin: 'bred', generation: 3, parentInstanceIds: ['parent-a', 'parent-b'] });
    pet.breedingUsesRemaining = 2; pet.nickname = 'Sunrunner';
    await patch('seller', { pets: [pet] });
    const created = await list({ kind: 'pet', assetId: pet.id });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const bought = await buy(created.body.listing.id);
    assert.equal(bought.status, 200, JSON.stringify(bought.body));
    const received = (await record('buyer')).character.pets[0];
    for (const field of ['id', 'templateId', 'generation', 'parentInstanceIds', 'growthAllocation', 'breedingUsesRemaining', 'nickname']) assert.deepEqual(received[field], pet[field], field);
    assert.equal((await record('seller')).character.pets.length, 0);
});

it('blocks active, training and ladder-defense pets from being escrowed', async () => {
    const { createOwnedPet } = await import('../pet/_owned-pet.js');
    const { PET_CATALOG } = await import('../pet/_catalog.js');
    const pet = createOwnedPet(Object.keys(PET_CATALOG)[0], { origin: 'wild' });
    await patch('seller', { pets: [pet], activePetId: pet.id });
    assert.equal((await list({ kind: 'pet', assetId: pet.id })).status, 409);
    await patch('seller', { activePetId: null, pets: [{ ...pet, training: { endsAt: Date.now() + 100000 } }] });
    assert.equal((await list({ kind: 'pet', assetId: pet.id })).status, 409);
    await patch('seller', { pets: [pet] });
    await kv.set('petladder:coliseum:def:seller', { pets: [pet] });
    assert.equal((await list({ kind: 'pet', assetId: pet.id })).status, 409);
});

it('recovers a crash after escrow but before the listing becomes active', async () => {
    const original = kv.compareSet;
    kv.compareSet = async (key, expected, value, options) => {
        if (key.startsWith('sunscar-exchange:listing:') && (value as Obj).state === 'active') throw new Error('simulated listing commit outage');
        return original.call(kv, key, expected, value, options);
    };
    try { assert.equal((await list()).status, 503); } finally { kv.compareSet = original; }
    assert.equal((await record('seller')).character.inventory.filter((id: string) => id === itemId).length, 1);
    const recovered = await post({ action: 'browse', playerName: 'seller' });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal(recovered.body.listings.length, 1);
    assert.equal((await record('seller')).character.inventory.filter((id: string) => id === itemId).length, 1);
});

it('recovers an interrupted seller credit without charging or delivering twice', async () => {
    const id = (await list()).body.listing.id;
    const original = kv.compareSet;
    kv.compareSet = async (key, expected, value, options) => {
        if (key === 'save:seller' && (value as Obj).character.sunscarExchangeReceipts?.includes(`${id}:payment`)) throw new Error('simulated seller write outage');
        return original.call(kv, key, expected, value, options);
    };
    try { assert.equal((await buy(id)).status, 503); } finally { kv.compareSet = original; }
    assert.equal((await record('buyer')).character.ryo, 9000);
    const recovered = await post({ action: 'browse', playerName: 'buyer' });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal((await record('buyer')).character.ryo, 9000);
    assert.equal((await record('buyer')).character.inventory.length, 1);
    assert.equal((await record('seller')).character.ryo, 10950);
    assert.equal((await buy(id)).status, 200);
});

it('rejects invalid numeric inputs and protects starter and progression card grants', async () => {
    for (const price of [0, -1, 1.5, 1_000_000_001, '100']) assert.equal((await list({ price })).status, 400);
    for (const quantity of [0, -1, 1.5, 10000, '1']) assert.equal((await list({ quantity })).status, 400);
    assert.equal((await list({ quantity: 3 })).status, 409);
    const { CHRONICLE_STARTER_GRANT_IDS } = await import('../../shared/chronicle-duel.js');
    const { CHRONICLE_PROGRESSION_CARD_IDS } = await import('../card-clash/_progression-cards.js');
    await patch('seller', { tileCards: [...CHRONICLE_STARTER_GRANT_IDS, CHRONICLE_PROGRESSION_CARD_IDS[0]] });
    assert.equal((await list({ kind: 'card', assetId: CHRONICLE_STARTER_GRANT_IDS[0] })).status, 409);
    assert.equal((await list({ kind: 'card', assetId: CHRONICLE_PROGRESSION_CARD_IDS[0] })).status, 409);
});

it('trades extra Chronicle cards while preserving the starter floor and collection cap', async () => {
    const { CHRONICLE_STARTER_GRANT_IDS, CHRONICLE_CARD_CATALOG } = await import('../../shared/chronicle-duel.js');
    const starter = CHRONICLE_STARTER_GRANT_IDS[0];
    await patch('seller', { tileCards: [...CHRONICLE_STARTER_GRANT_IDS, starter, starter] });
    let created = await list({ kind: 'card', assetId: starter, quantity: 2 });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal((await buy(created.body.listing.id)).status, 200);
    assert.deepEqual((await record('seller')).character.tileCards.toSorted(), [...CHRONICLE_STARTER_GRANT_IDS].sort());
    const ordinary = CHRONICLE_CARD_CATALOG.find(c => c.id.startsWith('tc-') && !CHRONICLE_STARTER_GRANT_IDS.includes(c.id))!.id;
    await patch('seller', { tileCards: [ordinary] });
    await patch('buyer', { tileCards: Array(1200).fill(ordinary) });
    created = await list({ kind: 'card', assetId: ordinary });
    assert.equal((await buy(created.body.listing.id)).status, 409);
    assert.equal((await record('buyer')).character.ryo, 9000);
});

it('recovers offline trades through the scheduled pending index', async () => {
    const id = (await list()).body.listing.id;
    const original = kv.compareSet;
    kv.compareSet = async (key, expected, value, options) => {
        if (key === 'save:seller' && (value as Obj).character.sunscarExchangeReceipts?.includes(`${id}:payment`)) throw new Error('offline payment interruption');
        return original.call(kv, key, expected, value, options);
    };
    try { assert.equal((await buy(id)).status, 503); } finally { kv.compareSet = original; }
    const { recoverPendingExchangeListings } = await import('./_exchange.js');
    const recovered = await recoverPendingExchangeListings();
    assert.equal(recovered.recovered, 1);
    assert.deepEqual(recovered.failures, []);
    assert.equal((await record('seller')).character.ryo, 10950);
    assert.equal((await record('buyer')).character.inventory.length, 1);
    assert.deepEqual(await kv.hgetall('sunscar-exchange:pending') ?? {}, {});
});

it('preserves named armor and refuses a full pet roster without taking ryo', async () => {
    const armorId = namedId.replace('weapon', 'armor');
    const armor = { ...namedDef, id: armorId, name: 'Desert Mantle', slot: 'body', weaponEp: undefined, armorQuality: 'Masterwork', bonuses: { shield: 35 } };
    const rec = await record('seller');
    await kv.set('save:seller', { ...rec, creatorItems: [...rec.creatorItems, armor], character: { ...rec.character, inventory: [...rec.character.inventory, armorId] } });
    const created = await list({ assetId: armorId });
    assert.equal((await buy(created.body.listing.id)).status, 200);
    assert.deepEqual((await record('buyer')).creatorItems.find((i: Obj) => i.id === armorId).bonuses, { shield: 35 });
    const { createOwnedPet } = await import('../pet/_owned-pet.js');
    const { PET_CATALOG } = await import('../pet/_catalog.js');
    const template = Object.keys(PET_CATALOG)[0];
    const pet = createOwnedPet(template, { origin: 'wild' });
    await patch('seller', { pets: [pet] });
    await patch('buyer', { pets: Array.from({ length: 5 }, () => createOwnedPet(template, { origin: 'wild' })) });
    const petListing = await list({ kind: 'pet', assetId: pet.id });
    assert.equal((await buy(petListing.body.listing.id)).status, 409);
    assert.equal((await record('buyer')).character.ryo, 9000);
});

it('does not charge a buyer when the seller account has disappeared', async () => {
    const id = (await list()).body.listing.id;
    await kv.del('save:seller');
    assert.equal((await buy(id)).status, 409);
    assert.equal((await record('buyer')).character.ryo, 10000);
    assert.equal((await record('buyer')).character.inventory.length, 0);
});

it('confirms a cancellation retry after the return committed but its status write failed', async () => {
    const id = (await list()).body.listing.id;
    const original = kv.compareSet;
    kv.compareSet = async (key, expected, value, options) => {
        if (key.startsWith('sunscar-exchange:listing:') && (value as Obj).state === 'cancelled') throw new Error('return status outage');
        return original.call(kv, key, expected, value, options);
    };
    const request = { action: 'cancel', playerName: 'seller', listingId: id };
    try { assert.equal((await post(request)).status, 503); } finally { kv.compareSet = original; }
    const retried = await post(request);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.listing.state, 'cancelled');
    assert.equal((await record('seller')).character.inventory.filter((v: string) => v === itemId).length, 2);
});

it('keeps a capacity-blocked return recoverable and completes it after room is made', async () => {
    await patch('seller', { inventory: [], itemStacks: [{ itemId: 'hunt-torn-hide', count: 5 }] });
    const id = (await list({ assetId: 'hunt-torn-hide', quantity: 5 })).body.listing.id;
    await patch('seller', { itemStacks: [{ itemId: 'hunt-torn-hide', count: 9999 }] });
    const request = { action: 'cancel', playerName: 'seller', listingId: id };
    const blocked = await post(request);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.pending, true);
    assert.match(blocked.body.error, /goods remain safely held/);
    assert.equal((await record('seller')).character.itemStacks[0].count, 9999);
    await patch('seller', { itemStacks: [{ itemId: 'hunt-torn-hide', count: 9994 }] });
    assert.equal((await post(request)).status, 200);
    assert.equal((await record('seller')).character.itemStacks[0].count, 9999);
});

it('removes refused buyers from private activity even after another player purchases', async () => {
    const id = (await list()).body.listing.id;
    await patch('buyer', { ryo: 0 });
    assert.equal((await buy(id)).status, 409);
    assert.deepEqual(await kv.hgetall('sunscar-exchange:player:buyer') ?? {}, {});
    assert.equal((await buy(id, 'rival')).status, 200);
    // Also protects activity from stale indexes left by an older server.
    await kv.hset('sunscar-exchange:player:buyer', { [id]: Date.now() });
    const snapshot = await post({ action: 'browse', playerName: 'buyer' });
    assert.deepEqual(snapshot.body.activity, []);
});

it('restores an owned named definition from the durable registry for browsing and trading', async () => {
    const { forgedItemKey } = await import('../_forged-item-registry.js');
    const rec = await record('seller');
    await kv.set('save:seller', { ...rec, creatorItems: [] });
    await kv.set(forgedItemKey(namedId), namedDef);
    try {
        const snapshot = await post({ action: 'browse', playerName: 'seller' });
        assert.ok(snapshot.body.inventory.some((asset: Obj) => asset.id === namedId));
        assert.equal((await record('seller')).creatorItems[0].weaponEp, 173);
        const id = (await list({ assetId: namedId })).body.listing.id;
        assert.equal((await buy(id)).status, 200);
        assert.equal((await record('buyer')).creatorItems[0].weaponEp, 173);
    } finally { await kv.del(forgedItemKey(namedId)); }
});

it('shows the ladder-defense restriction in sell inventory before a player submits', async () => {
    const { createOwnedPet } = await import('../pet/_owned-pet.js');
    const { PET_CATALOG } = await import('../pet/_catalog.js');
    const pet = createOwnedPet(Object.keys(PET_CATALOG)[0], { origin: 'wild' });
    await patch('seller', { pets: [pet] });
    await kv.set('petladder:coliseum:def:seller', { pets: [pet] });
    const snapshot = await post({ action: 'browse', playerName: 'seller' });
    assert.match(snapshot.body.inventory.find((asset: Obj) => asset.id === pet.id).unavailable, /ladder defense/);
});

it('uses distinct recovery pointers for later trade phases after an expired listing lease', async () => {
    const original = kv.compareSet;
    let id = '';
    let interleaved = false;
    kv.compareSet = async (key, expected, value, options) => {
        if (!interleaved && key === 'save:seller' && (expected as Obj)?.character.sunscarExchangeReceipts?.some((s: string) => s.endsWith(':escrow')) && !(value as Obj).character.sunscarExchangeReceipts?.length) {
            interleaved = true;
            id = (expected as Obj).character.sunscarExchangeReceipts[0].split(':')[0];
            // Expire the outer lease while its active-listing cleanup is waiting.
            await kv.del(`lock:sunscar-exchange:listing:${id}`);
            const result = await buy(id);
            assert.equal(result.status, 503); // seller save lock is still held
            assert.equal((await record('buyer')).character.ryo, 9000);
        }
        return original.call(kv, key, expected, value, options);
    };
    try {
        const { createExchangeListing } = await import('./_exchange.js');
        await createExchangeListing('seller', { requestId: randomUUID(), kind: 'item', assetId: itemId, quantity: 1, price: 1000 });
    } finally { kv.compareSet = original; }
    assert.ok(interleaved);
    assert.ok(Object.keys(await kv.hgetall('sunscar-exchange:pending') ?? {}).some(ref => ref.startsWith(`${id}:`)));
    const { recoverPendingExchangeListings } = await import('./_exchange.js');
    assert.deepEqual((await recoverPendingExchangeListings()).failures, []);
    assert.equal((await record('buyer')).character.ryo, 9000);
    assert.equal((await record('buyer')).character.inventory.length, 1);
    assert.equal((await record('seller')).character.ryo, 10950);
});

it('lets later pending trades recover while an older return is capacity-blocked', async () => {
    await patch('seller', { itemStacks: [{ itemId: 'hunt-torn-hide', count: 1 }] });
    const blocked = (await list({ assetId: 'hunt-torn-hide' })).body.listing.id;
    await patch('seller', { itemStacks: [{ itemId: 'hunt-torn-hide', count: 9999 }] });
    await post({ action: 'cancel', playerName: 'seller', listingId: blocked });
    const nextId = (await list()).body.listing.id;
    const original = kv.compareSet;
    kv.compareSet = async (key, expected, value, options) => {
        if (key === 'save:seller' && (value as Obj).character.sunscarExchangeReceipts?.includes(`${nextId}:payment`)) throw new Error('temporary credit outage');
        return original.call(kv, key, expected, value, options);
    };
    try { assert.equal((await buy(nextId)).status, 503); } finally { kv.compareSet = original; }
    const refs = await kv.hgetall<Record<string, number>>('sunscar-exchange:pending');
    const blockedRef = Object.keys(refs!).find(ref => ref.startsWith(blocked))!;
    const nextRef = Object.keys(refs!).find(ref => ref.startsWith(nextId))!;
    await kv.hset('sunscar-exchange:pending', { [blockedRef]: 1, [nextRef]: 2 });
    const { recoverPendingExchangeListings } = await import('./_exchange.js');
    assert.equal((await recoverPendingExchangeListings(1)).failures.length, 1);
    assert.equal((await recoverPendingExchangeListings(1)).recovered, 1);
    assert.equal((await record('seller')).character.ryo, 10950);
});
