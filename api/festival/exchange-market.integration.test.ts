import { before, beforeEach, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sunscar-market-integration-session-secret';
delete process.env.ADMIN_PASSWORD;

/*
 * The Exchange has always had search, filters, sorting and 12-per-page
 * browsing — on the client, over a snapshot that carried EVERY active listing.
 * The market is now filtered, sorted and paged by the server, so a browse
 * transfers one page instead of the whole market. These tests pin the
 * semantics the visible controls promise, the bounded reads behind them, and
 * the compatibility path for a client that predates server paging.
 */

type Obj = Record<string, any>;
let kv: typeof import('../_storage.js').kv;
let exchange: typeof import('./exchange.js').default;
let token: typeof import('../_auth.js').issuePlayerToken;

const PAGE = 12;
const now = Date.now;
let clock = now();

before(async () => {
    ({ kv } = await import('../_storage.js'));
    exchange = (await import('./exchange.js')).default as unknown as typeof exchange;
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    Date.now = () => clock;
});
beforeEach(async () => {
    clock += 65_000;
    for (const key of await kv.keys('*')) await kv.del(key);
    for (const [name, ryo, fateShards] of [['shopper', 5_000, 100], ['rival', 1_000_000, 1_000_000]] as const) {
        await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: clock, _regenAt: clock, creatorItems: [], character: {
            name, level: 100, ryo, fateShards, stats: {}, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            inventory: [], itemStacks: [], equipment: {}, pets: [], tileCards: [], weaponElements: [],
            boneCharms: 0, auraStones: 0, honorSeals: 0, mythicSeals: 0,
        } });
    }
});
after(() => { Date.now = now; delete process.env.SESSION_SECRET; delete process.env.SHINOBIX_QA_MEMORY_KV; });

async function call(name: string, body: Obj, as?: string) {
    const out: { status: number; body: Obj } = { status: 200, body: {} };
    const res = { setHeader() { return this; }, status(code: number) { out.status = code; return this; }, json(data: Obj) { out.body = data; return this; }, end() { return this; } };
    await exchange({ method: 'POST', query: {}, body: JSON.parse(JSON.stringify({ playerName: name, ...body })),
        headers: { 'x-player-name': as ?? name, 'x-player-token': token(as ?? name)! }, socket: { remoteAddress: '127.0.0.93' } } as never, res as never);
    return out;
}
const defaults = { v: 2, page: 1, category: 'all', rarity: 'all', currency: 'all', sort: 'newest', search: '', affordable: false };
const market = (name: string, over: Obj = {}) => call(name, { action: 'market', market: { ...defaults, ...over } });
const rarities = ['common', 'rare', 'epic', 'legendary'];
const categories = ['weapons', 'armor', 'consumables', 'pets'];

/** Seed `count` active listings straight into storage (the create flow is
 *  exercised elsewhere; this is about how they are read back). */
async function seedListings(count: number, over: (i: number) => Obj = () => ({})) {
    const live: Record<string, number> = {};
    for (let i = 0; i < count; i += 1) {
        const patch = over(i);
        const category = patch.category ?? categories[i % categories.length];
        const kind = category === 'pets' ? 'pet' : 'item';
        const id = (patch.id ?? i.toString(16).padStart(32, '0')) as string;
        const asset = { kind, id: `asset-${i}`, name: patch.name ?? `Lot ${i}`, category, rarity: patch.rarity ?? rarities[i % rarities.length],
            description: patch.description ?? `Sealed lot ${i} of the caravan ledger.`, stats: [], level: 1 };
        const listing = { id, seller: patch.seller ?? `seller${i % 5}`, sellerName: patch.sellerName ?? `Seller ${i % 5}`,
            asset, quantity: 1, price: patch.price ?? (100 + i), currency: patch.currency ?? 'ryo', fee: 5, proceeds: 95,
            createdAt: patch.createdAt ?? (1_790_000_000_000 + i * 1_000), state: patch.state ?? 'active',
            fingerprint: '[]', sealed: { asset, definition: { id: asset.id, name: asset.name, rarity: asset.rarity }, stackable: false } };
        await kv.set(`sunscar-exchange:listing:${id}`, listing);
        live[id] = listing.createdAt;
    }
    if (count) await kv.hset('sunscar-exchange:live', live);
}
const idsOf = (body: Obj) => (body.market.listings as Obj[]).map(l => l.id);

describe('Sunscar Exchange market pages', { concurrency: false }, () => {
    it('answers an empty market with an empty first page', async () => {
        const out = await market('shopper');
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.deepEqual(out.body.market.listings, []);
        assert.equal(out.body.market.total, 0);
        assert.equal(out.body.market.pages, 1);
        assert.equal(out.body.market.page, 1);
    });

    it('pages a multi-page market without overlapping or skipping a listing', async () => {
        await seedListings(29);
        const seen: string[] = [];
        for (const page of [1, 2, 3]) {
            const out = await market('shopper', { page });
            assert.equal(out.status, 200, JSON.stringify(out.body));
            assert.equal(out.body.market.total, 29);
            assert.equal(out.body.market.pages, 3);
            assert.equal(out.body.market.page, page);
            assert.equal(out.body.market.listings.length, page === 3 ? 5 : PAGE);
            seen.push(...idsOf(out.body));
        }
        assert.equal(new Set(seen).size, 29, 'every listing appeared exactly once');
        // Newest first across the whole market.
        const times = seen.map(id => Number.parseInt(id, 16));
        assert.deepEqual(times, [...times].sort((a, b) => b - a));
    });

    it('orders tied listings the same way on every request, so paging is stable', async () => {
        await seedListings(24, () => ({ price: 500, createdAt: 1_790_000_000_000, rarity: 'rare' }));
        for (const sort of ['newest', 'price-low', 'price-high', 'rarity']) {
            const first = idsOf((await market('shopper', { sort, page: 1 })).body);
            const second = idsOf((await market('shopper', { sort, page: 2 })).body);
            const repeat = idsOf((await market('shopper', { sort, page: 1 })).body);
            assert.deepEqual(repeat, first, `${sort} repeats identically`);
            assert.equal(new Set([...first, ...second]).size, 24, `${sort} pages do not overlap`);
        }
    });

    it('groups price sorts by currency and never compares ryo with Fate Shards', async () => {
        await seedListings(6, i => ({ currency: i % 2 ? 'fateShards' : 'ryo', price: i % 2 ? 1 : 10_000 }));
        const low = (await market('shopper', { sort: 'price-low' })).body.market.listings as Obj[];
        assert.deepEqual(low.map(l => l.currency), ['ryo', 'ryo', 'ryo', 'fateShards', 'fateShards', 'fateShards']);
        assert.ok(low[0].price >= 10_000, 'a 1-shard lot never sorts ahead of a ryo lot');
        const high = (await market('shopper', { sort: 'price-high' })).body.market.listings as Obj[];
        assert.deepEqual(high.map(l => l.currency), ['ryo', 'ryo', 'ryo', 'fateShards', 'fateShards', 'fateShards']);
    });

    it('filters by currency, affordability (per currency), category, rarity and search together', async () => {
        await seedListings(4, i => [
            { price: 900, currency: 'ryo', category: 'weapons', rarity: 'rare', name: 'Ember Blade' },
            { price: 9_000, currency: 'ryo', category: 'weapons', rarity: 'rare', name: 'Ember Pike' },
            { price: 40, currency: 'fateShards', category: 'pets', rarity: 'legendary', name: 'Dune Fox' },
            { price: 400, currency: 'fateShards', category: 'pets', rarity: 'legendary', name: 'Dune Wolf' },
        ][i]);
        // shopper holds 5,000 ryo and 100 Fate Shards.
        const affordable = (await market('shopper', { affordable: true })).body.market.listings as Obj[];
        assert.deepEqual(affordable.map(l => l.asset.name).sort(), ['Dune Fox', 'Ember Blade']);
        const byCurrency = (await market('shopper', { currency: 'fateShards' })).body.market;
        assert.equal(byCurrency.total, 2);
        const combined = (await market('shopper', { category: 'pets', rarity: 'legendary', search: 'dune', affordable: true })).body.market;
        assert.equal(combined.total, 1);
        assert.equal((combined.listings[0] as Obj).asset.name, 'Dune Fox');
        // Affordability is per viewer: a richer account sees all four.
        assert.equal((await market('rival', { affordable: true })).body.market.total, 4);
    });

    it('drops a listing that sold or was cancelled between requests, and clamps a page past the end', async () => {
        await seedListings(25);
        const third = await market('shopper', { page: 3 });
        assert.equal(third.body.market.page, 3);
        assert.equal(third.body.market.listings.length, 1);
        const vanishing = idsOf(third.body)[0]!;
        const record = await kv.get<Obj>(`sunscar-exchange:listing:${vanishing}`);
        await kv.set(`sunscar-exchange:listing:${vanishing}`, { ...record, state: 'sold' });
        const again = await market('shopper', { page: 3 });
        assert.equal(again.body.market.total, 24);
        assert.equal(again.body.market.pages, 2);
        assert.equal(again.body.market.page, 2, 'the last page answers a page that no longer exists');
        assert.equal(again.body.market.query.page, 2, 'and says so');
        assert.ok(!idsOf(again.body).includes(vanishing));
    });

    it('drops a listing that changes state between the index read and the page read', async () => {
        await seedListings(3);
        const originalMget = kv.mget.bind(kv);
        let switched = false;
        kv.mget = (async <T extends unknown[]>(...keys: string[]) => {
            if (!switched && keys.length && keys[0]!.startsWith('sunscar-exchange:listing:')) {
                switched = true;
                const record = await kv.get<Obj>(keys[0]!);
                if (record?.state === 'active') await kv.set(keys[0]!, { ...record, state: 'buying', buyer: 'rival' });
            }
            return originalMget<T>(...keys);
        }) as typeof kv.mget;
        let out;
        try { out = await market('shopper'); } finally { kv.mget = originalMget as typeof kv.mget; }
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal(out.body.market.listings.length, 2, 'the reserved listing is not offered');
    });

    it('never exposes sealed records or another player\'s private trade state', async () => {
        await seedListings(1);
        const out = await market('shopper');
        const listing = out.body.market.listings[0] as Obj;
        assert.equal(listing.sealed, undefined);
        assert.equal(listing.fingerprint, undefined);
        assert.equal(listing.recoveryKey, undefined);
        assert.equal(listing.saleNoticePending, undefined);
        assert.equal(out.body.inventory, undefined, 'a market read answers the market only');
        assert.equal(out.body.character, undefined);
    });

    it('refuses a malformed query and another player\'s name', async () => {
        for (const bad of [{ v: 1 }, { ...defaults, sort: 'cheapest' }, { ...defaults, page: 0 }, { ...defaults, rarity: 'shiny' }, { ...defaults, search: 'x'.repeat(200) }]) {
            const out = await call('shopper', { action: 'market', market: bad });
            assert.equal(out.status, 400, JSON.stringify(bad));
        }
        assert.equal((await call('shopper', { action: 'browse', market: { v: 2, page: -1 } })).status, 400);
        assert.equal((await market('shopper', {}) as Obj).status, 200);
        assert.equal((await call('shopper', { action: 'market', market: defaults }, 'rival')).status, 403);
    });

    it('serves a page with the snapshot, and the whole market to a client without paging', async () => {
        await seedListings(20);
        const paged = await call('shopper', { action: 'browse', market: defaults });
        assert.equal(paged.status, 200, JSON.stringify(paged.body));
        assert.equal(paged.body.market.listings.length, PAGE);
        assert.equal(paged.body.market.total, 20);
        assert.equal(paged.body.listings, undefined, 'no second copy of the market');
        assert.ok(Array.isArray(paged.body.inventory) && Array.isArray(paged.body.activity));
        // A client from before server paging asks the same way it always did.
        const legacy = await call('shopper', { action: 'browse' });
        assert.equal(legacy.status, 200, JSON.stringify(legacy.body));
        assert.equal(legacy.body.listings.length, 20, 'and still receives every active listing');
        assert.equal(legacy.body.market, undefined);
    });

    it('keeps browsing bounded: one index read, one projected read, and only the page in full', async () => {
        await seedListings(300);
        const reads: Array<{ op: string; keys: number }> = [];
        const originalMget = kv.mget.bind(kv);
        const originalHgetall = kv.hgetall.bind(kv);
        kv.mget = (async <T extends unknown[]>(...keys: string[]) => {
            if (keys[0]?.startsWith('sunscar-exchange:listing:')) reads.push({ op: 'mget', keys: keys.length });
            return originalMget<T>(...keys);
        }) as typeof kv.mget;
        kv.hgetall = (async <T>(key: string) => {
            if (key === 'sunscar-exchange:live') reads.push({ op: 'hgetall', keys: 1 });
            return originalHgetall<T>(key);
        }) as typeof kv.hgetall;
        let out;
        try { out = await market('shopper', { page: 2 }); } finally {
            kv.mget = originalMget as typeof kv.mget; kv.hgetall = originalHgetall as typeof kv.hgetall;
        }
        assert.equal(out.status, 200);
        assert.equal(reads.filter(r => r.op === 'hgetall').length, 1, 'the live index is read once');
        const full = reads.filter(r => r.op === 'mget');
        // Without database-side projection the in-memory store falls back to
        // mget, so the projected pass shows up here too; what matters is that
        // only ONE read is the page, and the payload is one page.
        assert.equal(full.at(-1)!.keys, PAGE, 'the last read fetches exactly the page');
        assert.equal(out.body.market.listings.length, PAGE);
        assert.ok(Buffer.byteLength(JSON.stringify(out.body)) < 40_000, 'the reply is a page, not a market');
    });

    it('still recovers a stuck trade when the snapshot is paged', async () => {
        await kv.set('save:seller0', { _saveVersion: 1, _saveAt: clock, _regenAt: clock, creatorItems: [], character: {
            name: 'seller0', level: 100, ryo: 10, fateShards: 0, stats: {}, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            inventory: [], itemStacks: [], equipment: {}, pets: [], tileCards: [], weaponElements: [], boneCharms: 0, auraStones: 0, honorSeals: 0, mythicSeals: 0,
        } });
        await seedListings(1, () => ({ price: 250, seller: 'seller0', sellerName: 'seller0' }));
        const [id] = Object.keys(await kv.hgetall<Record<string, number>>('sunscar-exchange:live') ?? {});
        const key = `sunscar-exchange:listing:${id}`;
        const listing = await kv.get<Obj>(key);
        await kv.set(key, { ...listing, state: 'buying', buyer: 'rival', recoveryKey: `${id}:stuck` });
        await kv.hset('sunscar-exchange:pending', { [`${id}:stuck`]: clock });
        await kv.hset('sunscar-exchange:player:rival', { [id!]: listing!.createdAt });
        const out = await call('rival', { action: 'browse', market: defaults });
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal((await kv.get<Obj>(key))?.state, 'sold', 'the stuck purchase settled');
        assert.equal(out.body.market.total, 0, 'and the sold listing left the market');
        assert.ok(out.body.activity.some((l: Obj) => l.id === id && l.state === 'sold'));
    });

    it('a page is not permission to buy: price, currency and state are re-checked', async () => {
        await seedListings(1, () => ({ price: 300, seller: 'seller0', sellerName: 'seller0' }));
        const [id] = Object.keys(await kv.hgetall<Record<string, number>>('sunscar-exchange:live') ?? {});
        const listed = (await market('rival')).body.market.listings[0] as Obj;
        assert.equal(listed.price, 300);
        // The seller re-prices (or the page is stale): the quote must match.
        const record = await kv.get<Obj>(`sunscar-exchange:listing:${id}`);
        await kv.set(`sunscar-exchange:listing:${id}`, { ...record, price: 900 });
        const stale = await call('rival', { action: 'buy', listingId: id, expectedPrice: 300, expectedCurrency: 'ryo' });
        assert.notEqual(stale.status, 200);
        assert.match(String(stale.body.error), /quoted price/i);
        const wrongCurrency = await call('rival', { action: 'buy', listingId: id, expectedPrice: 900, expectedCurrency: 'fateShards' });
        assert.notEqual(wrongCurrency.status, 200);
        assert.match(String(wrongCurrency.body.error), /quoted currency/i);
    });

    it('a listing created through the normal flow appears on the market page', async () => {
        const forgedId = 'named-weapon-123456781234123412341234567890ab';
        const forged = { id: forgedId, name: 'Sunscar Oath', slot: 'hand', rarity: 'legendary', cost: 0, levelReq: 90, weaponEp: 31, bonuses: { bukijutsuOffense: 71 } };
        await kv.set('save:seller0', { _saveVersion: 1, _saveAt: clock, _regenAt: clock, creatorItems: [forged], character: {
            name: 'seller0', level: 100, ryo: 10, fateShards: 0, stats: {}, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            inventory: [forgedId], itemStacks: [], equipment: {}, pets: [], tileCards: [], weaponElements: {},
            boneCharms: 0, auraStones: 0, honorSeals: 0, mythicSeals: 0,
        } });
        const created = await call('seller0', { action: 'list', requestId: randomUUID(), kind: 'item', assetId: forgedId, quantity: 1, price: 120, currency: 'ryo', market: defaults });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        assert.equal(created.body.market.total, 1, 'the seller sees their own listing on the market');
        assert.equal(created.body.market.listings[0].id, created.body.listing.id);
        const buyerView = await market('shopper', { search: 'sunscar oath' });
        assert.equal(buyerView.body.market.total, 1, 'and it is searchable by name');
        assert.equal((await market('shopper', { category: 'weapons', rarity: 'named' })).body.market.total, 1);
    });
});
