import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { rollNamedForge } from './_named.js';
import { countOwned } from './_forge.js';
import { NAMED_ARMOR_SLOTS } from '../../shared/named-forge-roll.js';
import { namedForgeIngredients } from '../../shared/named-forge-materials.js';
import { INVENTORY_CAP } from '../_inventory-capacity.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'named-registry-integration-test';

/*
 * Owner ruling 2026-10-15: a named roll is PAID (Fate Shards plus the
 * materials in shared/named-forge-materials.ts) and KEPT in one server write.
 * There is no free roll, no discard and no re-roll.
 */

let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./named.js').default;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./named.js')).default as unknown as typeof handler;
});

function response() {
    const out: { statusCode: number; body?: Record<string, any> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

/** Exactly one roll's materials for `kind`, as item stacks. */
function rollMaterials(kind: 'weapon' | 'armor') {
    return namedForgeIngredients(kind).map((ingredient) => ({ itemId: ingredient.ids[0], count: ingredient.count }));
}

async function post(playerName: string, ip: string, body: Record<string, unknown>) {
    const out = response();
    await handler({ method: 'POST', body: { playerName, ...body }, query: {},
        headers: { 'x-player-token': issuePlayerToken(playerName), 'x-forwarded-for': ip }, socket: { remoteAddress: ip } } as never, out.res);
    return out.out;
}

const roll = (playerName: string, ip: string, kind: 'weapon' | 'armor', requestId: string, extra: Record<string, unknown> = {}) =>
    post(playerName, ip, { action: 'roll', kind, requestId, name: 'Sealed Relic', ...extra });

test('a registry failure charges nothing, and the retry charges exactly once', async () => {
    const playerName = 'registryforgeplayer';
    const ip = '127.0.1.1';
    const key = `save:${playerName}`;
    await kv.set(key, { _saveVersion: 1, creatorItems: [],
        character: { name: playerName, level: 100, fateShards: 200, boneCharms: 500, inventory: [], itemStacks: rollMaterials('weapon') } });

    const originalSet = kv.set.bind(kv);
    (kv as any).set = async (k: string, value: unknown, options?: unknown) => {
        if (k.startsWith('forged-item:')) throw new Error('registry temporarily unavailable');
        return originalSet(k, value, options as never);
    };
    try {
        const failed = await roll(playerName, ip, 'weapon', 'registryRollRequest01');
        assert.equal(failed.statusCode, 503);
        const save = await kv.get<{ character: Record<string, any> }>(key);
        assert.equal(save?.character.fateShards, 200);
        assert.deepEqual(save?.character.inventory, []);
        for (const ingredient of namedForgeIngredients('weapon')) assert.equal(countOwned(save!.character, ingredient.ids[0]), ingredient.count);
    } finally {
        (kv as any).set = originalSet;
    }

    const retried = await roll(playerName, ip, 'weapon', 'registryRollRequest01');
    assert.equal(retried.statusCode, 200, JSON.stringify(retried.body));
    const item = retried.body?.item as { id?: string } | undefined;
    assert.ok(item?.id);
    assert.equal(await kv.get(`forged-item:${item.id}`) !== null, true);
    const save = await kv.get<{ character: Record<string, any> }>(key);
    assert.equal(save?.character.fateShards, 0);
    assert.equal(save?.character.boneCharms, 500);
    assert.ok(save?.character.inventory.includes(item.id));
});

test('weapon and every armor slot charge the full price on the roll, keep the piece, and replay without charging', async () => {
    const cases = [{ kind: 'weapon' as const, slot: 'hand' }, ...NAMED_ARMOR_SLOTS.map(slot => ({ kind: 'armor' as const, slot }))];
    for (const [index, { kind, slot }] of cases.entries()) {
        const playerName = `shardforgeplayer${index}`;
        const ip = `127.0.2.${index + 1}`;
        const key = `save:${playerName}`;
        const wallet = { boneCharms: 5000, auraStones: 5000, mythicSeals: 5000 };
        const character = { name: playerName, level: 100, ...wallet, fateShards: 199, inventory: [], itemStacks: rollMaterials(kind) };
        await kv.set(key, { _saveVersion: 1, character, creatorItems: [] });

        const shortShards = await roll(playerName, ip, kind, `shortShards${index}xxxxxxx`, { slot });
        assert.equal(shortShards.statusCode, 409);
        assert.match(String(shortShards.body?.error), /200 Fate Shards/);
        assert.deepEqual((await kv.get<{ character: unknown }>(key))?.character, character, 'a refused roll spends nothing');

        // Every material is required, not just the ore.
        const lastRow = namedForgeIngredients(kind).at(-1)!;
        const missingOne = { ...character, fateShards: 200, itemStacks: rollMaterials(kind).filter((stack) => stack.itemId !== lastRow.ids[0]) };
        await kv.set(key, { _saveVersion: 1, character: missingOne, creatorItems: [] });
        const shortMaterial = await roll(playerName, ip, kind, `shortMaterial${index}xxxxx`, { slot });
        assert.equal(shortMaterial.statusCode, 409);
        assert.match(String(shortMaterial.body?.error), new RegExp(lastRow.label.split(' ')[0]));

        await kv.set(key, { _saveVersion: 1, character: { ...character, fateShards: 200 }, creatorItems: [] });
        const paid = await roll(playerName, ip, kind, `paidRoll${index}xxxxxxxxxx`, { slot });
        assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
        assert.equal(paid.body?.character.fateShards, 0);
        for (const currency of ['boneCharms', 'auraStones', 'mythicSeals'] as const) assert.equal(paid.body?.character[currency], wallet[currency]);
        for (const ingredient of namedForgeIngredients(kind)) assert.equal(countOwned(paid.body!.character, ingredient.ids[0]), 0, ingredient.label);
        assert.equal(paid.body?.item.slot, slot);
        assert.deepEqual(paid.body?.character.inventory, [paid.body?.item.id], 'the rolled piece is kept');
        assert.ok(paid.body?.roll, 'the response carries the roll for the reveal');

        const replayed = await roll(playerName, ip, kind, `paidRoll${index}xxxxxxxxxx`, { slot, name: 'Different Name' });
        assert.equal(replayed.statusCode, 200);
        assert.equal(replayed.body?.replayed, true);
        assert.deepEqual(replayed.body?.item, paid.body?.item);
        assert.equal(replayed.body?.character.fateShards, 0);
        assert.deepEqual(replayed.body?.character.inventory, [paid.body?.item.id]);

        // No free re-roll: a new request needs a new full price.
        const reroll = await roll(playerName, ip, kind, `reroll${index}xxxxxxxxxxxx`, { slot });
        assert.equal(reroll.statusCode, 409);
    }
});

test('a full inventory refuses the roll without charging, then succeeds after making room', async () => {
    const playerName = 'fullnamedforgeplayer';
    const ip = '127.0.3.1';
    const key = `save:${playerName}`;
    const inventory = Array.from({ length: INVENTORY_CAP }, (_, index) => `held-item-${index}`);
    const character = { name: playerName, level: 100, fateShards: 200, boneCharms: 5000, inventory, itemStacks: rollMaterials('armor') };
    await kv.set(key, { _saveVersion: 1, character, creatorItems: [] });
    const blocked = await roll(playerName, ip, 'armor', 'fullInventoryRoll01', { slot: 'body' });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.body?.error, 'Your inventory is full.');
    assert.deepEqual((await kv.get<{ character: unknown }>(key))?.character, character);

    await kv.set(key, { _saveVersion: 2, character: { ...character, inventory: inventory.slice(1) }, creatorItems: [] });
    const retried = await roll(playerName, ip, 'armor', 'fullInventoryRoll01', { slot: 'body' });
    assert.equal(retried.statusCode, 200, JSON.stringify(retried.body));
    assert.equal(retried.body?.character.fateShards, 0);
    assert.equal(retried.body?.character.inventory.length, INVENTORY_CAP);
});

test('competing rolls spend one price once and ignore client-sent stats', async () => {
    const playerName = 'concurrentnamedforgeplayer';
    const key = `save:${playerName}`;
    await kv.set(key, { _saveVersion: 1, creatorItems: [], character: { name: playerName, level: 100, fateShards: 200,
        boneCharms: 5000, auraStones: 5000, mythicSeals: 5000, inventory: [], itemStacks: rollMaterials('weapon') } });
    const forged = { roll: { ep: 999, offenseVal: 999 }, weaponEp: 999, bonuses: { ninjutsuOffense: 999 }, fateShards: 9999 };
    const attempts = await Promise.all(['concurrentRollRequestA', 'concurrentRollRequestB']
        .map((requestId) => roll(playerName, '127.0.3.2', 'weapon', requestId, forged)));
    assert.deepEqual(attempts.map(attempt => attempt.statusCode).sort(), [200, 409]);
    const item = attempts.find(attempt => attempt.statusCode === 200)!.body?.item;
    assert.ok(item.weaponEp <= 27 && item.bonuses.ninjutsuOffense < 999, 'stats come from the server roll only');
    const save = await kv.get<{ character: Record<string, any>; creatorItems: unknown[] }>(key);
    assert.equal(save?.character.fateShards, 0);
    assert.deepEqual([save?.character.boneCharms, save?.character.auraStones, save?.character.mythicSeals], [5000, 5000, 5000]);
    assert.deepEqual(save?.character.inventory, [item.id]);
    assert.equal(save?.creatorItems.length, 1);
});

test('a roll token sealed before paid rolls still pays the full price to forge', async () => {
    const playerName = 'legacytokenplayer';
    const ip = '127.0.3.3';
    const key = `save:${playerName}`;
    const token = 'legacySealedToken123456';
    const character = { name: playerName, level: 100, fateShards: 200, inventory: [], itemStacks: [{ itemId: 'gather-iron-sand-pristine', count: 20 }] };
    await kv.set(key, { _saveVersion: 1, character, creatorItems: [] });
    await kv.set(`named-forge:${playerName}:${token}`, { playerName, roll: rollNamedForge('weapon') });
    const oreOnly = await post(playerName, ip, { action: 'forge', token, name: 'Old Roll' });
    assert.equal(oreOnly.statusCode, 409, 'ore and shards alone no longer pay for a named piece');
    assert.deepEqual((await kv.get<{ character: unknown }>(key))?.character, character);

    await kv.set(key, { _saveVersion: 2, character: { ...character, itemStacks: rollMaterials('weapon') }, creatorItems: [] });
    const paid = await post(playerName, ip, { action: 'forge', token, name: 'Old Roll' });
    assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
    assert.equal(paid.body?.character.fateShards, 0);
});
