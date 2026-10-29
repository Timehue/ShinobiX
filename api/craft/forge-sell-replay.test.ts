import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'forge-sell-replay-isolated-test-secret';

/*
 * An idempotent replay of /craft/forge or /shop/sell returns the stored receipt
 * and changes nothing, so it must not rewrite the save or bump _saveVersion: a
 * bump makes the client's next autosave 409 for no reason.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let SUPPLY_CRAFT_RECIPES: typeof import('../../shared/crafting-recipes.js').SUPPLY_CRAFT_RECIPES;
let ITEM_CATALOG: typeof import('../pvp/_item-catalog.js').ITEM_CATALOG;
let sellCatalogItem: typeof import('../shop/_sale.js').sellCatalogItem;
let forge: Handler;
let sell: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ SUPPLY_CRAFT_RECIPES } = await import('../../shared/crafting-recipes.js'));
    ({ ITEM_CATALOG } = await import('../pvp/_item-catalog.js'));
    ({ sellCatalogItem } = await import('../shop/_sale.js'));
    forge = (await import('./forge.js')).default as unknown as Handler;
    sell = (await import('../shop/sell.js')).default as unknown as Handler;
});

async function call(endpoint: Handler, player: string, body: Json) {
    const output = { status: 200, body: {} as Json };
    const res = { setHeader: () => res, status: (status: number) => { output.status = status; return res; },
        json: (value: Json) => { output.body = value; return res; }, end: () => res };
    await endpoint({ method: 'POST', body: { playerName: player, ...body },
        headers: { 'x-player-token': issuePlayerToken(player) }, socket: { remoteAddress: '203.0.113.152' } } as never, res as never);
    return output;
}

const version = async (player: string) => Number((await kv.get<Json>(`save:${player}`))?._saveVersion);

test('five Pet Treats debit 2,000 ryo with selected materials exactly once', async () => {
    const player = 'treatbatchfive';
    const recipe = SUPPLY_CRAFT_RECIPES['pet-treat'];
    const materials = recipe.ingredients.map(row => ({ [row.ids[0]]: row.count * 5 }));
    await kv.set(`save:${player}`, { _saveVersion: 1, character: {
        name: player, level: 100, ryo: 3000, inventory: [], equipment: {},
        itemStacks: recipe.ingredients.map(row => ({ itemId: row.ids[0], count: row.count * 5 })),
    } });
    const body = { requestId: 'pet-treat-batch-0001', kind: 'supply', recipeId: 'pet-treat', quantity: 5, materials };
    const first = await call(forge, player, body);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const paid = first.body.character as Json;
    assert.equal(paid.ryo, 1000);
    assert.equal((paid.itemStacks as Array<{ itemId: string; count: number }>).find(row => row.itemId === 'pet-treat')?.count, 5);
    const saved = await kv.get(`save:${player}`);
    const replay = await call(forge, player, body);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.equal((replay.body.character as Json).ryo, 1000);
    assert.deepEqual(await kv.get(`save:${player}`), saved, 'retry neither pays nor produces twice');
});

test('an unaffordable five-treat batch changes neither materials nor currency', async () => {
    const player = 'treatbatchpoor';
    const recipe = SUPPLY_CRAFT_RECIPES['pet-treat'];
    const saved = { _saveVersion: 1, character: { name: player, level: 100, ryo: 1999, inventory: [],
        itemStacks: recipe.ingredients.map(row => ({ itemId: row.ids[0], count: row.count * 5 })),
    } };
    await kv.set(`save:${player}`, saved);
    const result = await call(forge, player, { requestId: 'pet-treat-batch-0002', kind: 'supply', recipeId: 'pet-treat', quantity: 5,
        materials: recipe.ingredients.map(row => ({ [row.ids[0]]: row.count * 5 })) });
    assert.equal(result.status, 409);
    assert.deepEqual(await kv.get(`save:${player}`), saved);
});

test('a replayed forge request returns the receipt without bumping _saveVersion', async () => {
    const player = 'forgereplay1';
    const dust = SUPPLY_CRAFT_RECIPES['currency:aura-dust'];
    await kv.set(`save:${player}`, { _saveVersion: 1, character: {
        name: player, level: 100, ryo: 10_000, auraDust: 5, inventory: [],
        itemStacks: dust.ingredients.map((row) => ({ itemId: row.ids[0], count: row.count })),
    } });
    const body = {
        requestId: 'forge-replay-0001', kind: 'supply', recipeId: 'currency:aura-dust', quantity: 1,
        materials: dust.ingredients.map((row) => ({ [row.ids[0]]: row.count })),
    };
    const first = await call(forge, player, body);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.replayed, false);
    const afterFirst = await version(player);
    assert.ok(afterFirst > 1, 'the craft itself bumps the version');

    const replay = await call(forge, player, body);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.equal(await version(player), afterFirst, 'a replay must not rewrite the save');
    assert.equal(replay.body._saveVersion, afterFirst);
    assert.equal((replay.body.character as Json).auraDust, 55, 'the replay still shows the crafted result');
});

test('a replayed sell request returns the stored sale without bumping _saveVersion', async () => {
    const player = 'sellreplay1';
    const itemId = Object.keys(ITEM_CATALOG).find((id) => sellCatalogItem(
        { name: 'probe', ryo: 0, inventory: [], itemStacks: [{ itemId: id, count: 1 }], equipment: {} }, id, 1).ok);
    assert.ok(itemId, 'a sellable catalog item exists');
    await kv.set(`save:${player}`, { _saveVersion: 1, character: {
        name: player, ryo: 0, inventory: [], itemStacks: [{ itemId, count: 2 }], equipment: {},
    } });
    const body = { requestId: 'sell-replay-0001', itemId, qty: 1 };
    const first = await call(sell, player, body);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.replayed, false);
    const afterFirst = await version(player);
    assert.ok(afterFirst > 1, 'the sale itself bumps the version');
    const ryoAfterFirst = (first.body.character as Json).ryo;

    const replay = await call(sell, player, body);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.equal(await version(player), afterFirst, 'a replay must not rewrite the save');
    assert.equal(replay.body._saveVersion, afterFirst);
    assert.equal((replay.body.character as Json).ryo, ryoAfterFirst, 'no second payout');
});
