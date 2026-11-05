import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'permanent-ban-release-admin';

/*
 * What a permanent ban releases (owner ruling 2026-11-04): Kage, Elder and ANBU
 * seats, a founded clan, and Exchange listings. A timed ban releases nothing.
 * Driven through the real moderation handler on the in-memory store.
 */

type Obj = Record<string, any>;
let kv: typeof import('../_storage.js').kv;
let moderation: (req: never, res: never) => Promise<unknown>;
let exchange: typeof import('../festival/_exchange.js');
let kageKey: (village: string) => string;
let elderVillageKey: (village: unknown) => string;
let WAR_VILLAGES: readonly string[];
let itemId: string;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    moderation = (await import('./moderation.js')).default as unknown as typeof moderation;
    exchange = await import('../festival/_exchange.js');
    ({ kageKey } = await import('../village/_kage-settle.js'));
    ({ elderVillageKey } = await import('../village/_elders.js'));
    ({ WAR_VILLAGES } = await import('../_war-map-sectors.js'));
    const items = (await (await import('../shop/_catalog.js')).loadSettlementCatalogs()).items;
    itemId = [...items.values()].find(item => item.slot === 'hand' && !item.serviceItem && !item.stackable)!.id;
});

function save(name: string, extra: Obj = {}): Obj {
    return { _saveVersion: 1, character: { name, level: 100, ryo: 10_000, examsPassed: ['jonin'], inventory: [], itemStacks: [], pets: [], tileCards: [], equipment: {}, fateShards: 100, ...extra }, creatorItems: [] };
}

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    const [home] = WAR_VILLAGES;
    await kv.set('save:wanderer', save('Wanderer', { clan: 'Storm Petals', inventory: [itemId] }));
    await kv.set('save:kaze', save('Kaze', { clan: 'Storm Petals' }));
    await kv.set('save:rival', save('Rival', { inventory: [itemId] }));
    await kv.set(kageKey(home), { kageSystemUnlocked: true, seatedKage: 'Wanderer', seatedAt: 5, history: [{ kage: 'Wanderer', startedAt: 5 }] });
    await kv.set(elderVillageKey(home), { elderAppointees: ['Wanderer', 'Rival'], anbuAppointees: ['wanderer'] });
    await kv.set('save:clan-stormpetals', {
        name: 'Storm Petals', founderName: 'Wanderer',
        members: [{ name: 'Wanderer', joinedAt: 1 }, { name: 'Kaze', joinedAt: 2 }], roleOverrides: {},
    });
});

async function ban(target: string, days: number | 'permanent') {
    const out = { status: 200, body: {} as Obj };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: Obj) { out.body = value; return res; }, end() { return res; } };
    await moderation({ method: 'POST', body: { kind: 'ban', target, days, reason: 'test', actor: 'mod' },
        headers: { 'x-admin-password': 'permanent-ban-release-admin' }, query: {}, socket: { remoteAddress: '127.0.0.94' } } as never, res as never);
    assert.equal(out.status, 200, JSON.stringify(out.body));
    return out.body;
}

describe('banning a player', () => {
    it('permanently releases their seats, their clan and their listings', async () => {
        const [home] = WAR_VILLAGES;
        const listing = await exchange.createExchangeListing('wanderer', { requestId: randomUUID(), kind: 'item', assetId: itemId, quantity: 1, price: 500 });
        const theirs = await exchange.createExchangeListing('rival', { requestId: randomUUID(), kind: 'item', assetId: itemId, quantity: 1, price: 300, listingType: 'auction', durationHours: 24 });
        await exchange.actOnExchangeListing('wanderer', theirs.id, 'bid', 400, 'ryo');
        assert.deepEqual((await kv.get<Obj>('save:wanderer'))!.character.inventory, [], 'the item sits in escrow');

        const body = await ban('Wanderer', 'permanent');
        assert.deepEqual(body.releaseFailures, []);

        assert.equal((await kv.get<Obj>(kageKey(home)))?.seatedKage, undefined, 'the Kage seat opens');
        const elders = await kv.get<Obj>(elderVillageKey(home));
        assert.deepEqual(elders?.elderAppointees, ['', 'Rival']);
        assert.deepEqual(elders?.anbuAppointees, ['']);

        const clan = await kv.get<Obj>('save:clan-stormpetals');
        assert.equal(clan?.founderName, 'Kaze', 'the clan goes to the next in line');
        assert.equal(clan?.members.length, 2, 'the banned player stays on the roster, so an appeal needs no rejoin');

        assert.equal((await kv.get<Obj>(exchange.exchangeListingKey(listing.id)))?.state, 'cancelled');
        assert.deepEqual((await kv.get<Obj>('save:wanderer'))!.character.inventory, [itemId], 'the escrow comes back to the banned save');
        const auction = await kv.get<Obj>(exchange.exchangeListingKey(theirs.id));
        assert.equal(auction?.state, 'active', "another seller's auction stays open");
        assert.equal(auction?.highestBid, undefined, 'the banned high bid is withdrawn');
        assert.ok(body.released.includes(`kage-seat:${home}`));

        const again = await ban('Wanderer', 'permanent');
        assert.deepEqual(again.releaseFailures, [], 'a second ban is a no-op');
        assert.deepEqual(again.released, []);
    });

    it('for a few days releases nothing', async () => {
        const [home] = WAR_VILLAGES;
        const listing = await exchange.createExchangeListing('wanderer', { requestId: randomUUID(), kind: 'item', assetId: itemId, quantity: 1, price: 500 });
        const body = await ban('Wanderer', 3);
        assert.equal(body.released, undefined);
        assert.equal((await kv.get<Obj>(kageKey(home)))?.seatedKage, 'Wanderer');
        assert.deepEqual((await kv.get<Obj>(elderVillageKey(home)))?.anbuAppointees, ['wanderer']);
        assert.equal((await kv.get<Obj>('save:clan-stormpetals'))?.founderName, 'Wanderer');
        assert.equal((await kv.get<Obj>(exchange.exchangeListingKey(listing.id)))?.state, 'active');
    });
});
