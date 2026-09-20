import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_COLLECTION_CAP } from '../card-clash/_collection-cap.js';
import { INVENTORY_CAP } from '../_inventory-capacity.js';
import { PET_CAP_BASE, PET_CAP_SUB } from '../_entitlements.js';
import type { ExchangeAsset } from '../../shared/sunscar-exchange.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'exchange-readiness-test-secret';

type Obj = Record<string, any>;
let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./exchange.js').default;
let token: typeof import('../_auth.js').issuePlayerToken;

const listingId = 'a'.repeat(32);
const now = Date.now;
let clock = 1_790_000_000_000;

const pet = (id: string) => ({ id, name: id, nickname: id, level: 10, attack: 10, defense: 10, hp: 10, speed: 10 });
const baseCharacter = (name: string): Obj => ({ name, level: 100, ryo: 10_000, fateShards: 100, inventory: [], itemStacks: [], pets: [], tileCards: [], equipment: {} });
const asset = (kind: ExchangeAsset['kind'], id: string, over: Partial<ExchangeAsset> = {}): ExchangeAsset => ({ kind, id, name: id, category: kind === 'pet' ? 'pets' : kind === 'card' ? 'cards' : kind === 'resource' ? 'resources' : 'consumables', rarity: 'rare', description: 'test', stats: [], ...over });

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./exchange.js')).default as unknown as typeof handler;
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    Date.now = () => clock;
});
beforeEach(async () => {
    clock += 65_000;
    mock.restoreAll();
    for (const key of await kv.keys('*')) await kv.del(key);
    for (const name of ['buyer', 'seller', 'rival']) await kv.set(`save:${name}`, { _saveVersion: 1, character: baseCharacter(name), creatorItems: [] });
});
after(() => { Date.now = now; mock.restoreAll(); delete process.env.SESSION_SECRET; delete process.env.SHINOBIX_QA_MEMORY_KV; });

async function seed(kind: ExchangeAsset['kind'], id: string, quantity = 1, options: { price?: number; currency?: 'ryo' | 'fateShards'; stackable?: boolean; level?: number } = {}) {
    const listedAsset = asset(kind, id, { level: options.level });
    const listing = { id: listingId, seller: 'seller', sellerName: 'Seller', asset: listedAsset, quantity,
        price: options.price ?? 100, currency: options.currency ?? 'ryo', fee: 5, proceeds: (options.price ?? 100) - 5,
        createdAt: clock, state: 'active', fingerprint: '[]', sealed: { asset: listedAsset, definition: kind === 'pet' ? pet(id) : { id, name: id }, stackable: options.stackable ?? false } };
    await kv.set(`sunscar-exchange:listing:${listingId}`, listing);
    await kv.hset('sunscar-exchange:live', { [listingId]: clock });
    return listing;
}

async function call(player: string, body: Obj, as = player) {
    const out: { status: number; body: Obj } = { status: 200, body: {} };
    const res = { setHeader() { return this; }, status(code: number) { out.status = code; return this; }, json(value: Obj) { out.body = value; return this; }, end() { return this; } };
    await handler({ method: 'POST', query: {}, body: { playerName: player, ...body }, headers: { 'x-player-name': as, 'x-player-token': token(as)! }, socket: { remoteAddress: '127.0.0.77' } } as never, res as never);
    return out;
}
const readiness = (player = 'buyer') => call(player, { action: 'readiness', listingId });
async function setBuyer(patch: Obj) {
    const record = await kv.get<Obj>('save:buyer');
    await kv.set('save:buyer', { ...record, character: { ...record!.character, ...patch } });
}

describe('Sunscar Exchange purchase readiness', { concurrency: false }, () => {
    it('uses exact companion capacity and duplicate rules for subscriber and non-subscriber buyers', async () => {
        await seed('pet', 'pet-offer');
        for (const [cap, patreon] of [[PET_CAP_BASE, undefined], [PET_CAP_SUB, { active: true }]] as const) {
            await setBuyer({ pets: Array.from({ length: cap }, (_, i) => pet(`owned-${i}`)), patreon });
            assert.equal((await readiness()).body.readiness.reasonCode, 'companion-capacity');
            await setBuyer({ pets: Array.from({ length: cap - 1 }, (_, i) => pet(`owned-${i}`)), patreon });
            assert.equal((await readiness()).body.readiness.status, 'ready');
        }
        await setBuyer({ pets: [pet('pet-offer')] });
        assert.equal((await readiness()).body.readiness.reasonCode, 'duplicate-companion');
    });

    it('checks whole-lot card, inventory, and stack boundaries', async () => {
        await seed('card', 'card-offer', 2);
        await setBuyer({ tileCards: Array(CARD_COLLECTION_CAP - 2).fill('ordinary-card') });
        assert.equal((await readiness()).body.readiness.status, 'ready');
        await setBuyer({ tileCards: Array(CARD_COLLECTION_CAP - 1).fill('ordinary-card') });
        assert.equal((await readiness()).body.readiness.reasonCode, 'card-capacity');

        await seed('item', 'item-offer', 2);
        await setBuyer({ tileCards: [], inventory: Array(INVENTORY_CAP - 2).fill('old') });
        assert.equal((await readiness()).body.readiness.status, 'ready');
        await setBuyer({ inventory: Array(INVENTORY_CAP - 1).fill('old') });
        assert.equal((await readiness()).body.readiness.reasonCode, 'inventory-capacity');

        await seed('item', 'stack-offer', 2, { stackable: true });
        await setBuyer({ inventory: [], itemStacks: [{ itemId: 'stack-offer', count: 9997 }] });
        assert.equal((await readiness()).body.readiness.status, 'ready');
        await setBuyer({ itemStacks: [{ itemId: 'stack-offer', count: 9998 }] });
        assert.equal((await readiness()).body.readiness.reasonCode, 'stack-quantity');
        await setBuyer({ itemStacks: Array.from({ length: 200 }, (_, i) => ({ itemId: `stack-${i}`, count: 1 })) });
        assert.equal((await readiness()).body.readiness.reasonCode, 'stack-capacity');
    });

    it('checks currencies, level, ownership and current listing state with bounded reason codes', async () => {
        await seed('item', 'high-level', 1, { price: 50, currency: 'fateShards', level: 80 });
        await setBuyer({ level: 79, fateShards: 100 });
        assert.equal((await readiness()).body.readiness.reasonCode, 'level-required');
        await setBuyer({ level: 100, fateShards: 49 });
        assert.equal((await readiness()).body.readiness.reasonCode, 'insufficient-funds');
        assert.equal((await readiness('seller')).body.readiness.reasonCode, 'own-listing');
        const stored = await kv.get<Obj>(`sunscar-exchange:listing:${listingId}`);
        await kv.set(`sunscar-exchange:listing:${listingId}`, { ...stored, state: 'sold', buyer: 'rival' });
        assert.equal((await readiness()).body.readiness.reasonCode, 'listing-unavailable');
        assert.equal((await call('buyer', { action: 'readiness', listingId: 'b'.repeat(32) })).body.readiness.reasonCode, 'listing-missing');
    });

    it('is read-only and refuses cross-account inspection', async () => {
        await seed('item', 'item-offer');
        const beforeBuyer = structuredClone(await kv.get('save:buyer'));
        const beforeListing = structuredClone(await kv.get(`sunscar-exchange:listing:${listingId}`));
        const writes: string[] = [];
        const originalSet = kv.set.bind(kv), originalCompareSet = kv.compareSet.bind(kv);
        mock.method(kv, 'set', async (key: string, value: unknown, options?: Obj) => { if (key.startsWith('save:') || key.includes('sunscar-exchange:listing:')) writes.push(key); return originalSet(key, value, options); });
        mock.method(kv, 'compareSet', async (key: string, expected: unknown, value: unknown, options?: Obj) => { if (key.startsWith('save:') || key.includes('sunscar-exchange:listing:')) writes.push(key); return originalCompareSet(key, expected, value, options); });
        const out = await readiness();
        assert.equal(out.body.readiness.status, 'ready');
        assert.deepEqual(writes, []);
        assert.deepEqual(await kv.get('save:buyer'), beforeBuyer);
        assert.deepEqual(await kv.get(`sunscar-exchange:listing:${listingId}`), beforeListing);
        assert.equal((await call('buyer', { action: 'readiness', listingId }, 'rival')).status, 403);
    });

    it('revalidates after preview and refuses a capacity change without consuming the listing', async () => {
        await seed('item', 'item-offer');
        assert.equal((await readiness()).body.readiness.status, 'ready');
        await setBuyer({ inventory: Array(INVENTORY_CAP).fill('old') });
        const buy = await call('buyer', { action: 'buy', listingId, expectedPrice: 100, expectedCurrency: 'ryo' });
        assert.notEqual(buy.status, 200);
        assert.match(String(buy.body.error), /inventory is full/i);
        assert.equal((await kv.get<Obj>(`sunscar-exchange:listing:${listingId}`))?.state, 'active');
    });
});
