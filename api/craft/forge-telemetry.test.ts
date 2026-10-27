import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'craft-forge-telemetry-isolated-test-secret';

/*
 * I-19 (2026-10 economy rebalance, PCG-8): the Crafter records the ryo fee it
 * burns and the Aura Dust / Bone Charms a currency recipe makes, once, after the
 * commit, from the committed character. A replayed requestId and a refused craft
 * record nothing. The profession mastery respec records its 50,000-ryo fee.
 */

type Json = Record<string, unknown>;
type LoggedTxn = { txnId: string; player: string; currency: string; delta: number; source: string };
type Handler = (req: never, res: never) => Promise<unknown>;
type Ingredient = { ids: readonly string[]; count: number };
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let drainBackgroundWork: typeof import('../_background-work.js').drainBackgroundWork;
let gearCraftIngredients: typeof import('../../shared/crafting-recipes.js').gearCraftIngredients;
let SUPPLY_CRAFT_RECIPES: typeof import('../../shared/crafting-recipes.js').SUPPLY_CRAFT_RECIPES;
let ITEM_CATALOG: typeof import('../pvp/_item-catalog.js').ITEM_CATALOG;
let forge: Handler;
let mastery: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ drainBackgroundWork } = await import('../_background-work.js'));
    ({ gearCraftIngredients, SUPPLY_CRAFT_RECIPES } = await import('../../shared/crafting-recipes.js'));
    ({ ITEM_CATALOG } = await import('../pvp/_item-catalog.js'));
    forge = (await import('./forge.js')).default as unknown as Handler;
    mastery = (await import('../profession/mastery.js')).default as unknown as Handler;
});

async function call(endpoint: Handler, player: string, body: Json) {
    const output = { status: 200, body: {} as Json };
    const res = { setHeader: () => res, status: (status: number) => { output.status = status; return res; },
        json: (value: Json) => { output.body = value; return res; }, end: () => res };
    await endpoint({ method: 'POST', body: { playerName: player, ...body },
        headers: { 'x-player-token': issuePlayerToken(player) }, socket: { remoteAddress: '203.0.113.151' } } as never, res as never);
    return output;
}

/** A save holding exactly the cheapest accepted id of each row, and the matching selection. */
async function seedFor(player: string, ingredients: readonly Ingredient[], character: Json) {
    const itemStacks = ingredients.map((row) => ({ itemId: row.ids[0], count: row.count }));
    const materials = ingredients.map((row) => ({ [row.ids[0]]: row.count }));
    await kv.set(`save:${player}`, { _saveVersion: 1, character: { name: player, level: 100, inventory: [], itemStacks, ...character } });
    return materials;
}

async function txns(player: string) {
    await drainBackgroundWork();
    return ((await kv.get<LoggedTxn[]>('econ:txns')) ?? [])
        .filter((txn) => txn.player === player)
        .map(({ txnId, currency, delta, source }) => ({ txnId, currency, delta, source }));
}

test('a gear craft logs its ryo fee as a sink once; the replay logs nothing', async () => {
    const player = 'crafttelemetry1';
    const weapon = Object.values(ITEM_CATALOG).find((item) => item.slot === 'hand' && item.rarity === 'rare'
        && item.weaponEp != null && !item.id.startsWith('named-') && gearCraftIngredients(item).length > 0)!;
    assert.ok(weapon, 'a craftable rare weapon exists');
    const materials = await seedFor(player, gearCraftIngredients(weapon), { ryo: 1000 });
    const body = { requestId: 'craft-telemetry-0001', kind: 'weapon', recipeId: weapon.id, quantity: 1, materials };
    const first = await call(forge, player, body);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal((first.body.character as Json).ryo, 400, 'the rare craft fee is 600');
    const replay = await call(forge, player, body);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(await txns(player), [
        { txnId: `craft:${player}:craft-telemetry-0001:ryo`, currency: 'ryo', delta: -600, source: 'craft.fee' },
    ]);
});

test('a currency recipe logs the Aura Dust or Bone Charms it makes, with no fee', async () => {
    const player = 'crafttelemetry2';
    const dust = SUPPLY_CRAFT_RECIPES['currency:aura-dust'];
    const materials = await seedFor(player, dust.ingredients, { ryo: 0, auraDust: 5 });
    const made = await call(forge, player, { requestId: 'craft-telemetry-0002', kind: 'supply', recipeId: 'currency:aura-dust', quantity: 1, materials });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.equal((made.body.character as Json).auraDust, 55);

    const charm = SUPPLY_CRAFT_RECIPES['currency:bone-charm'];
    const charmMaterials = charm.ingredients.map((row) => ({ [row.ids[0]]: row.count }));
    const record = (await kv.get<Json>(`save:${player}`))!;
    const character = record.character as Json;
    await kv.set(`save:${player}`, { ...record, character: { ...character, itemStacks: charm.ingredients.map((row) => ({ itemId: row.ids[0], count: row.count })) } });
    const charmed = await call(forge, player, { requestId: 'craft-telemetry-0003', kind: 'supply', recipeId: 'currency:bone-charm', quantity: 1, materials: charmMaterials });
    assert.equal(charmed.status, 200, JSON.stringify(charmed.body));
    const byId = (a: { txnId: string }, b: { txnId: string }) => a.txnId.localeCompare(b.txnId);
    assert.deepEqual((await txns(player)).sort(byId), [
        { txnId: `craft:${player}:craft-telemetry-0002:auraDust`, currency: 'auraDust', delta: 50, source: 'craft.currency' },
        { txnId: `craft:${player}:craft-telemetry-0003:boneCharms`, currency: 'boneCharms', delta: 1, source: 'craft.currency' },
    ]);
});

test('a refused craft logs nothing', async () => {
    const player = 'crafttelemetry3';
    await kv.set(`save:${player}`, { _saveVersion: 1, character: { name: player, level: 100, ryo: 0, inventory: [], itemStacks: [] } });
    const refused = await call(forge, player, { requestId: 'craft-telemetry-0004', kind: 'supply', recipeId: 'currency:aura-dust', quantity: 1, materials: [] });
    assert.equal(refused.status, 409);
    assert.deepEqual(await txns(player), []);
});

test('a mastery respec logs its 50,000-ryo fee as a sink', async () => {
    const player = 'respectelemetry1';
    await kv.set(`save:${player}`, { _saveVersion: 1, character: { name: player, level: 50, ryo: 60_000, profession: 'vanguard', professionXp: 40_000, masterySpec: { sealDailyCapFlat: 1 } } });
    const out = await call(mastery, player, { action: 'respec' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal((out.body.character as Json).ryo, 10_000);
    const refused = await call(mastery, player, { action: 'respec' });
    assert.equal(refused.status, 409, 'a second respec is refused: nothing left to respec and no ryo for the fee');
    assert.deepEqual(await txns(player), [
        { txnId: `profession-respec:${player}:${out.body._saveVersion}`, currency: 'ryo', delta: -50_000, source: 'profession.respec' },
    ]);
});
