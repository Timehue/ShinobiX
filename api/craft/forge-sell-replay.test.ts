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
