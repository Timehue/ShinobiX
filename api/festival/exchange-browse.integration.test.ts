import { before, beforeEach, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sunscar-browse-integration-session-secret';
delete process.env.ADMIN_PASSWORD;

/*
 * Browsing the Sunscar Exchange is a read. It used to route through
 * mutatePlayerSave with a creatorItems patch and no write:false, so every visit
 * rewrote the player's save and minted a fresh _saveVersion — load on the save
 * row and a moving target for the client's own autosave. These tests pin that
 * an unchanged browse writes nothing, while the real work a browse can do
 * (recovering a forged definition, settling a stuck trade) is still persisted
 * exactly once, and that the response is always built from one record.
 */

type Obj = Record<string, any>;
let kv: typeof import('../_storage.js').kv;
let exchange: typeof import('./exchange.js').default;
let save: typeof import('../save/[name].js').default;
let token: typeof import('../_auth.js').issuePlayerToken;
let forgedItemKey: typeof import('../_forged-item-registry.js').forgedItemKey;
let exchangeInventory: typeof import('./_exchange-assets.js').exchangeInventory;
let loadSettlementCatalogs: typeof import('../shop/_catalog.js').loadSettlementCatalogs;

const namedId = 'named-weapon-123456781234123412341234567890ab';
const lostId = 'named-armor-abcdefabcdefabcdefabcdefabcdefab';
const named = { id: namedId, name: 'Sunscar Oath', slot: 'hand', rarity: 'legendary', cost: 0, levelReq: 90, weaponEp: 31, bonuses: { bukijutsuOffense: 71 } };
const lost = { id: lostId, name: 'Lost Mantle', slot: 'body', rarity: 'epic', cost: 0, levelReq: 40, bonuses: { defense: 30 } };
const now = Date.now;
let clock = now();

before(async () => {
    ({ kv } = await import('../_storage.js'));
    exchange = (await import('./exchange.js')).default as unknown as typeof exchange;
    save = (await import('../save/[name].js')).default as unknown as typeof save;
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    ({ forgedItemKey } = await import('../_forged-item-registry.js'));
    ({ exchangeInventory } = await import('./_exchange-assets.js'));
    ({ loadSettlementCatalogs } = await import('../shop/_catalog.js'));
    Date.now = () => clock;
});
beforeEach(async () => {
    clock += 65_000;
    for (const key of await kv.keys('*')) await kv.del(key);
    for (const name of ['browser', 'rival']) {
        await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: clock, _regenAt: clock, creatorItems: name === 'browser' ? [named] : [], character: {
            name, level: 100, ryo: 10_000, stats: {}, hp: 40, maxHp: 100, chakra: 40, maxChakra: 100, stamina: 40, maxStamina: 100,
            inventory: name === 'browser' ? [namedId] : [], itemStacks: [], equipment: {}, pets: [], tileCards: [],
            weaponElements: {}, fateShards: 10, boneCharms: 10, auraStones: 10, honorSeals: 10, mythicSeals: 10,
        } });
    }
});
after(() => { Date.now = now; delete process.env.SESSION_SECRET; delete process.env.SHINOBIX_QA_MEMORY_KV; });

async function call(handler: typeof exchange, name: string, body: Obj, options: { as?: string; query?: Obj } = {}) {
    const out: { status: number; body: Obj } = { status: 200, body: {} };
    const res = { setHeader() { return this; }, status(code: number) { out.status = code; return this; }, json(data: Obj) { out.body = data; return this; }, end() { return this; } };
    await handler({ method: 'POST', query: options.query ?? {}, body: JSON.parse(JSON.stringify(body)), headers: { 'x-player-name': options.as ?? name, 'x-player-token': token(options.as ?? name)! }, socket: { remoteAddress: '127.0.0.91' } } as never, res as never);
    return out;
}
const browse = (name: string, extra: Obj = {}, as?: string) => call(exchange, name, { playerName: name, action: 'browse', ...extra }, { as });
const stored = async (name: string) => (await kv.get<Obj>(`save:${name}`))!;

/** Count every write that lands on a player's save row. */
function countSaveWrites() {
    const counts = new Map<string, number>();
    const originalSet = kv.set.bind(kv);
    const originalCompareSet = kv.compareSet.bind(kv);
    kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (key.startsWith('save:')) counts.set(key, (counts.get(key) ?? 0) + 1);
        return originalSet(key, value, options);
    }) as typeof kv.set;
    kv.compareSet = (async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
        const ok = await originalCompareSet(key, expected, value, options);
        if (ok && key.startsWith('save:')) counts.set(key, (counts.get(key) ?? 0) + 1);
        return ok;
    }) as typeof kv.compareSet;
    return { counts, restore() { kv.set = originalSet as typeof kv.set; kv.compareSet = originalCompareSet as typeof kv.compareSet; } };
}

describe('Sunscar Exchange browsing does not rewrite the save', { concurrency: false }, () => {
    it('repeated unchanged browsing writes nothing and never mints a new version', async () => {
        const before = await stored('browser');
        const writes = countSaveWrites();
        try {
            for (let i = 0; i < 5; i += 1) {
                clock += 30_000; // idle regen accrues between visits; it is not persisted by a browse
                const out = await browse('browser');
                assert.equal(out.status, 200, JSON.stringify(out.body));
                assert.equal(out.body._saveVersion, 1, 'the stored version, unchanged');
            }
        } finally { writes.restore(); }
        assert.equal(writes.counts.get('save:browser') ?? 0, 0, 'zero save writes');
        assert.deepEqual(await stored('browser'), before, 'the stored save is byte-for-byte untouched');
    });

    it('answers from ONE record: character, inventory, definitions and version all agree', async () => {
        clock += 90_000;
        const out = await browse('browser');
        const record = await stored('browser');
        assert.equal(out.body._saveVersion, record._saveVersion);
        assert.deepEqual(out.body.character, record.character, 'the character is the stored one at that version, not an unpersisted projection');
        assert.deepEqual(out.body.creatorItems, record.creatorItems);
        const inventory = exchangeInventory(record, await loadSettlementCatalogs());
        assert.deepEqual(out.body.inventory.map((a: Obj) => [a.kind, a.id, a.quantity]), inventory.map((a) => [a.kind, a.id, a.quantity]));
    });

    it('persists a recovered forged definition exactly once, then goes quiet', async () => {
        const record = await stored('browser');
        record.character.inventory = [namedId, lostId];
        await kv.set('save:browser', record); // the definition is missing from creatorItems…
        await kv.set(forgedItemKey(lostId), lost); // …but the forge registry still has it
        const writes = countSaveWrites();
        try {
            const first = await browse('browser');
            assert.equal(first.status, 200, JSON.stringify(first.body));
            assert.equal(first.body._saveVersion, 2, 'the repair is a real, versioned write');
            assert.ok(first.body.creatorItems.some((item: Obj) => item.id === lostId));
            assert.ok(first.body.inventory.some((asset: Obj) => asset.id === lostId), 'and the recovered item is listable');
            assert.ok((await stored('browser')).creatorItems.some((item: Obj) => item.id === lostId), 'persisted');
            const second = await browse('browser');
            assert.equal(second.body._saveVersion, 2, 'the next browse does not write again');
        } finally { writes.restore(); }
        assert.equal(writes.counts.get('save:browser'), 1);
    });

    it('an interrupted repair recovers on the next browse, and never clobbers a concurrent write', async () => {
        const record = await stored('browser');
        record.character.inventory = [namedId, lostId];
        await kv.set('save:browser', record);
        await kv.set(forgedItemKey(lostId), lost);
        // Another server path commits v2 to this save the instant before the
        // browse's repair write lands.
        const originalCompareSet = kv.compareSet.bind(kv);
        let raced = false;
        kv.compareSet = (async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
            if (!raced && key === 'save:browser') {
                raced = true;
                const concurrent = await stored('browser');
                concurrent._saveVersion = 2;
                concurrent.character = { ...concurrent.character, ryo: 12_345 };
                await kv.set('save:browser', concurrent);
            }
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        let interrupted;
        try { interrupted = await browse('browser'); } finally { kv.compareSet = originalCompareSet as typeof kv.compareSet; }
        assert.notEqual(interrupted.status, 200, 'the repair refuses rather than overwrite');
        assert.equal((await stored('browser')).character.ryo, 12_345, 'the concurrent write survives');
        const retried = await browse('browser');
        assert.equal(retried.status, 200, JSON.stringify(retried.body));
        const after = await stored('browser');
        assert.equal(after.character.ryo, 12_345);
        assert.ok(after.creatorItems.some((item: Obj) => item.id === lostId), 'the repair lands on top of it');
        assert.equal(retried.body._saveVersion, after._saveVersion);
    });

    it('a browse does not make the client\'s next autosave conflict', async () => {
        const out = await browse('browser');
        const record = await stored('browser');
        clock += 4_000;
        const autosave = await call(save as typeof exchange, 'browser', {
            ...record, character: { ...out.body.character, hp: 41 }, creatorItems: record.creatorItems, _baseSaveVersion: out.body._saveVersion,
        }, { query: { name: 'browser' } });
        assert.equal(autosave.status, 200, JSON.stringify(autosave.body));
    });

    it('still settles a stuck purchase for either trader, then answers from the settled save', async () => {
        const created = await call(exchange, 'browser', { playerName: 'browser', action: 'list', requestId: randomUUID(), kind: 'item', assetId: namedId, quantity: 1, price: 250, currency: 'ryo' });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        const id = created.body.listing.id;
        const key = `sunscar-exchange:listing:${id}`;
        const listing = await kv.get<Obj>(key);
        // A purchase that reserved the listing but crashed before any save leg.
        await kv.set(key, { ...listing, state: 'buying', buyer: 'rival', recoveryKey: `${id}:stuck` });
        await kv.hset('sunscar-exchange:pending', { [`${id}:stuck`]: clock });
        await kv.hset('sunscar-exchange:player:rival', { [id]: listing!.createdAt });
        const out = await browse('rival');
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal((await kv.get<Obj>(key))?.state, 'sold');
        const rival = await stored('rival');
        assert.equal(rival.character.ryo, 10_000 - 250, 'paid exactly once');
        assert.ok(rival.character.inventory.includes(namedId), 'and delivered');
        assert.equal(out.body._saveVersion, rival._saveVersion);
        assert.deepEqual(out.body.character, rival.character);
        assert.ok(out.body.activity.some((l: Obj) => l.id === id && l.state === 'sold'));
        const again = await browse('rival');
        assert.equal(again.body._saveVersion, rival._saveVersion, 'settled once; the next browse is a pure read');
        assert.equal((await stored('rival')).character.ryo, 10_000 - 250);
    });

    it('refuses to browse as someone else', async () => {
        const out = await browse('browser', {}, 'rival');
        assert.equal(out.status, 403);
    });
});
