import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sunscar-local-integration-session-secret';
delete process.env.ADMIN_PASSWORD;

type Obj = Record<string, any>;
let kv: typeof import('../_storage.js').kv;
let exchange: typeof import('./exchange.js').default;
let save: typeof import('../save/[name].js').default;
let token: typeof import('../_auth.js').issuePlayerToken;
const namedId = 'named-weapon-123456781234123412341234567890ab';
const armorId = namedId.replace('weapon', 'armor');
const named = { id: namedId, name: 'Sunscar Oath', slot: 'hand', rarity: 'legendary', cost: 0, levelReq: 90, weaponEp: 31, weaponTags: [{ name: 'Bleed', percent: 24 }], bonuses: { bukijutsuOffense: 71 } };
const armor = { id: armorId, name: 'Sunscar Mantle', slot: 'body', rarity: 'legendary', cost: 0, levelReq: 90, bonuses: { defense: 71 } };
const now = Date.now;
let clock = now();

before(async () => {
    ({ kv } = await import('../_storage.js'));
    exchange = (await import('./exchange.js')).default as unknown as typeof exchange;
    save = (await import('../save/[name].js')).default as unknown as typeof save;
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    Date.now = () => clock;
});
beforeEach(async () => {
    clock += 65_000;
    for (const key of await kv.keys('sunscar-exchange:*')) await kv.del(key);
    for (const name of ['tradeseller', 'tradebuyer', 'tradeguest']) {
        await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: clock, _regenAt: clock, creatorItems: name === 'tradeseller' ? [named, armor] : [], character: {
            name, level: 100, ryo: 10_000, stats: {}, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            inventory: name === 'tradeseller' ? [namedId, armorId] : [], itemStacks: [], equipment: {}, pets: [], tileCards: [],
            weaponElements: name === 'tradeseller' ? { [namedId]: 'Fire' } : {}, fateShards: 10, boneCharms: 10, auraStones: 10, honorSeals: 10, mythicSeals: 10,
        } });
    }
});
after(() => { Date.now = now; delete process.env.SESSION_SECRET; delete process.env.SHINOBIX_QA_MEMORY_KV; delete process.env.STRICT_RAW_SAVE_LEDGER; });

async function call(handler: typeof exchange, name: string, body: Obj, options: { as?: string; method?: string; query?: Obj } = {}) {
    const out: { status: number; body: Obj } = { status: 200, body: {} };
    const res = { setHeader() { return this; }, status(code: number) { out.status = code; return this; }, json(data: Obj) { out.body = data; return this; }, end() { return this; } };
    await handler({ method: options.method ?? 'POST', query: options.query ?? {}, body: JSON.parse(JSON.stringify(body)), headers: { 'x-player-name': options.as ?? name, 'x-player-token': token(options.as ?? name)! }, socket: { remoteAddress: '127.0.0.89' } } as never, res as never);
    return out;
}
const trade = (name: string, action: Obj, as?: string) => call(exchange, name, { playerName: name, ...action }, { as });
const stored = async (name: string) => (await kv.get<Obj>(`save:${name}`))!;
async function list(kind: string, assetId: string, quantity = 1) {
    const result = await trade('tradeseller', { action: 'list', requestId: randomUUID(), kind, assetId, quantity, price: 100 });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.listing.id;
}
async function autosave(name: string, record: Obj, character = record.character, creatorItems = record.creatorItems) {
    clock += 4_000;
    return call(save as typeof exchange, name, { ...record, character, creatorItems, _baseSaveVersion: record._saveVersion }, { query: { name } });
}

it('accepts a signed player session, rejects account impersonation and explains guest eligibility', async () => {
    assert.equal((await trade('tradeseller', { action: 'browse' })).status, 200);
    assert.equal((await trade('tradeseller', { action: 'browse' }, 'tradebuyer')).status, 403);
    const { authKey } = await import('../player-auth.js');
    await kv.set(authKey('tradeguest'), { guest: true });
    try {
        const guest = await trade('tradeguest', { action: 'browse' });
        assert.equal(guest.status, 403);
        assert.match(guest.body.error, /set a password to trade/);
    } finally { await kv.del(authKey('tradeguest')); }
});

for (const strict of ['0', '1']) it(`persists named gear, companions, cards and currencies through normal save and reload (strict ledger ${strict})`, async () => {
    process.env.STRICT_RAW_SAVE_LEDGER = strict;
    const { createOwnedPet } = await import('../pet/_owned-pet.js');
    const { PET_CATALOG } = await import('../pet/_catalog.js');
    const { CHRONICLE_CARD_CATALOG, CHRONICLE_STARTER_GRANT_IDS } = await import('../../shared/chronicle-duel.js');
    const pet = createOwnedPet(Object.keys(PET_CATALOG).find(id => !id.startsWith('starter-'))!, {
        origin: 'bred', generation: 3, parentInstanceIds: ['parent-a', 'parent-b'],
        hatchedAt: clock - 1000, breedingSessionId: `breed-${'a'.repeat(32)}`, paletteVariantId: 'chromatic-v1',
    });
    pet.nickname = 'Sunrunner'; pet.breedingUsesRemaining = 2;
    const card = CHRONICLE_CARD_CATALOG.find(c => c.id.startsWith('tc-') && !CHRONICLE_STARTER_GRANT_IDS.includes(c.id))!.id;
    const seller = await stored('tradeseller');
    seller.character.pets = [pet]; seller.character.tileCards = [card]; seller.character.itemStacks = [{ itemId: 'hunt-torn-hide', count: 20 }];
    await kv.set('save:tradeseller', seller);
    const staleSeller = structuredClone(seller);
    const staleBuyer = structuredClone(await stored('tradebuyer'));
    for (const [kind, id, quantity] of [['item', namedId, 1], ['item', armorId, 1], ['pet', pet.id, 1], ['card', card, 1], ['item', 'hunt-torn-hide', 15], ...['fateShards', 'boneCharms', 'auraStones', 'honorSeals', 'mythicSeals'].map(id => ['resource', id, 5])] as [string, string, number][]) {
        const listingId = await list(kind, id, quantity);
        const result = await trade('tradebuyer', { action: 'buy', listingId, expectedPrice: 100 });
        assert.equal(result.status, 200, JSON.stringify(result.body));
    }
    // An in-flight autosave from before the sale must not resurrect ownership.
    assert.equal((await autosave('tradeseller', staleSeller)).status, 409);
    assert.equal((await autosave('tradebuyer', staleBuyer)).status, 409);
    const acquired = await stored('tradebuyer');
    assert.equal(acquired.character.ryo, 9000);
    assert.equal((await stored('tradeseller')).character.ryo, 10950);
    const equip = { ...acquired.character, inventory: acquired.character.inventory.filter((id: string) => id !== namedId && id !== armorId), equipment: { hand: namedId, body: armorId }, activePetId: pet.id };
    // A client that has not hydrated creatorItems yet must retain server definitions.
    const saved = await autosave('tradebuyer', acquired, equip, []);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const loaded = await call(save as typeof exchange, 'tradebuyer', {}, { method: 'GET', query: { name: 'tradebuyer' } });
    assert.equal(loaded.status, 200, JSON.stringify(loaded.body));
    const reloaded = await stored('tradebuyer');
    assert.equal(reloaded.character.equipment.hand, namedId);
    assert.equal(reloaded.character.equipment.body, armorId);
    assert.equal(reloaded.creatorItems.find((i: Obj) => i.id === namedId).weaponEp, 31);
    assert.deepEqual(reloaded.creatorItems.find((i: Obj) => i.id === namedId).weaponTags, named.weaponTags);
    assert.equal(reloaded.character.weaponElements[namedId], 'Fire');
    const { hydrateCharacterFromSave } = await import('../pvp/session.js');
    const fighter = hydrateCharacterFromSave(reloaded.character, {}, reloaded, null);
    const combatItems = fighter.pvpItems as Obj[];
    assert.equal(combatItems.find(item => item.id === namedId)?.weaponEp, 31);
    assert.ok(combatItems.some(item => item.id === armorId), 'Purchased named armor resolves in the shared combat builder.');
    assert.equal(reloaded.character.activePetId, pet.id);
    const received = reloaded.character.pets.find((p: Obj) => p.id === pet.id);
    for (const key of ['id', 'templateId', 'origin', 'generation', 'parentInstanceIds', 'hatchedAt', 'breedingSessionId', 'paletteVariantId', 'growthAllocation', 'breedingUsesRemaining', 'nickname']) assert.deepEqual(received[key], pet[key as keyof typeof pet], key);
    assert.ok(reloaded.character.tileCards.includes(card));
    assert.equal(reloaded.character.itemStacks.find((s: Obj) => s.itemId === 'hunt-torn-hide').count, 15);
    for (const resource of ['fateShards', 'boneCharms', 'auraStones', 'honorSeals', 'mythicSeals']) assert.equal(reloaded.character[resource], 15, resource);
    const sellerAfter = await stored('tradeseller');
    assert.equal((await autosave('tradeseller', sellerAfter)).status, 200);
    assert.ok(!(await stored('tradeseller')).character.inventory.includes(namedId));
    assert.equal((await stored('tradeseller')).character.pets.length, 0);
});
