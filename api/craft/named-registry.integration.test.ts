import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { rollNamedForge } from './_named.js';
import { NAMED_ARMOR_SLOTS } from '../../shared/named-forge-roll.js';
import { INVENTORY_CAP } from '../_inventory-capacity.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'named-registry-integration-test';

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

async function forge(playerName: string, token: string, ip: string, extra: Record<string, unknown> = {}) {
    const out = response();
    await handler({ method: 'POST', body: { playerName, action: 'forge', token, name: 'Sealed Relic', ...extra }, query: {},
        headers: { 'x-player-token': issuePlayerToken(playerName), 'x-forwarded-for': ip }, socket: { remoteAddress: ip } } as never, out.res);
    return out.out;
}

test('registry write failure leaves the named roll and forge materials unspent for retry', async () => {
    const playerName = 'registryforgeplayer';
    const token = 'registryForgeToken123456';
    const ip = '127.0.1.1';
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        character: { name: playerName, level: 100, fateShards: 200, boneCharms: 500, inventory: [], itemStacks: [{ itemId: 'gather-iron-sand-pristine', count: 20 }] },
        creatorItems: [],
    });
    await kv.set(`named-forge:${playerName}:${token}`, { playerName, roll: rollNamedForge('weapon') });
    const req = {
        method: 'POST',
        body: { playerName, action: 'forge', token, name: 'Registry Blade' },
        query: {},
        headers: { 'x-player-token': issuePlayerToken(playerName), 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never;

    const originalSet = kv.set.bind(kv);
    (kv as any).set = async (key: string, value: unknown, options?: unknown) => {
        if (key.startsWith('forged-item:')) throw new Error('registry temporarily unavailable');
        return originalSet(key, value, options as never);
    };
    try {
        const failed = response();
        await handler(req, failed.res);
        assert.equal(failed.out.statusCode, 503);
        assert.match(String(failed.out.body?.error), /Retry this forge with the same roll/);
        const save = await kv.get<{ character: { fateShards: number; boneCharms: number; inventory: string[] } }>(`save:${playerName}`);
        assert.equal(save?.character.fateShards, 200);
        assert.equal(save?.character.boneCharms, 500);
        assert.deepEqual(save?.character.inventory, []);
        assert.ok(await kv.get(`named-forge:${playerName}:${token}`));
    } finally {
        (kv as any).set = originalSet;
    }

    const retried = response();
    await handler(req, retried.res);
    assert.equal(retried.out.statusCode, 200);
    const item = retried.out.body?.item as { id?: string } | undefined;
    assert.ok(item?.id);
    assert.equal(await kv.get(`forged-item:${item.id}`) !== null, true);
    const save = await kv.get<{ character: { fateShards: number; boneCharms: number; inventory: string[] } }>(`save:${playerName}`);
    assert.equal(save?.character.fateShards, 0);
    assert.equal(save?.character.boneCharms, 500);
    assert.ok(save?.character.inventory.includes(item.id));
});

test('weapon and every armor slot require Fate Shards on roll and forge, preserve other balances, and replay without charging', async () => {
    const cases = [{ kind: 'weapon' as const, slot: 'hand' }, ...NAMED_ARMOR_SLOTS.map(slot => ({ kind: 'armor' as const, slot }))];
    for (const [index, { kind, slot }] of cases.entries()) {
        const playerName = `shardforgeplayer${index}`;
        const token = `shardForgeToken123456${index}`;
        const key = `save:${playerName}`;
        const wallet = { boneCharms: 5000, auraStones: 5000, mythicSeals: 5000, fateShards: 199 };
        const character = { name: playerName, level: 100, ...wallet, inventory: [], itemStacks: [{ itemId: 'gather-iron-sand-pristine', count: 20 }] };
        await kv.set(key, { _saveVersion: 1, character, creatorItems: [] });
        const call = async (body: Record<string, unknown>) => {
            const out = response();
            await handler({ method: 'POST', body: { playerName, ...body }, query: {}, headers: { 'x-player-token': issuePlayerToken(playerName), 'x-forwarded-for': `127.0.2.${index + 1}` }, socket: { remoteAddress: `127.0.2.${index + 1}` } } as never, out.res);
            return out.out;
        };
        const blockedRoll = await call({ action: 'roll', kind, slot });
        assert.equal(blockedRoll.statusCode, 409);
        assert.match(String(blockedRoll.body?.error), /200 Fate Shards/);

        // A pre-change sealed token cannot bypass the new payment rule.
        await kv.set(`named-forge:${playerName}:${token}`, { playerName, roll: rollNamedForge(kind, slot) });
        const blockedForge = await call({ action: 'forge', token, name: 'Shard Relic' });
        assert.equal(blockedForge.statusCode, 409);
        assert.ok(await kv.get(`named-forge:${playerName}:${token}`));
        assert.deepEqual((await kv.get<{ character: unknown }>(key))?.character, character);

        await kv.set(key, { _saveVersion: 1, character: { ...character, fateShards: 200 }, creatorItems: [] });
        const rolled = await call({ action: 'roll', kind, slot });
        assert.equal(rolled.statusCode, 200, JSON.stringify(rolled.body));
        const liveToken = rolled.body?.token;
        const forged = await call({ action: 'forge', token: liveToken, name: 'Shard Relic' });
        assert.equal(forged.statusCode, 200, JSON.stringify(forged.body));
        assert.equal(forged.body?.character.fateShards, 0);
        for (const currency of ['boneCharms', 'auraStones', 'mythicSeals'] as const) assert.equal(forged.body?.character[currency], wallet[currency]);
        assert.equal(forged.body?.item.slot, slot);
        assert.equal(await kv.get(`named-forge:${playerName}:${liveToken}`), null);

        const replayed = await call({ action: 'forge', token: liveToken, name: 'Different Name' });
        assert.equal(replayed.statusCode, 200);
        assert.equal(replayed.body?.replayed, true);
        assert.deepEqual(replayed.body?.item, forged.body?.item);
        assert.equal(replayed.body?.character.fateShards, 0);
        assert.deepEqual(replayed.body?.character.inventory, [forged.body?.item.id]);
    }
});

test('a full inventory preserves shards and the sealed roll, then succeeds after making room', async () => {
    const playerName = 'fullnamedforgeplayer';
    const token = 'fullNamedForgeToken123456';
    const key = `save:${playerName}`;
    const inventory = Array.from({ length: INVENTORY_CAP }, (_, index) => `held-item-${index}`);
    const character = { name: playerName, level: 100, fateShards: 200, boneCharms: 5000, inventory, itemStacks: [{ itemId: 'gather-iron-sand-pristine', count: 20 }] };
    const sealed = { playerName, roll: rollNamedForge('armor', 'body') };
    await kv.set(key, { _saveVersion: 1, character, creatorItems: [] });
    await kv.set(`named-forge:${playerName}:${token}`, sealed);
    const blocked = await forge(playerName, token, '127.0.3.1');
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.body?.error, 'Your inventory is full.');
    assert.deepEqual((await kv.get<{ character: unknown }>(key))?.character, character);
    assert.deepEqual(await kv.get(`named-forge:${playerName}:${token}`), sealed);

    await kv.set(key, { _saveVersion: 2, character: { ...character, inventory: inventory.slice(1) }, creatorItems: [] });
    const retried = await forge(playerName, token, '127.0.3.1');
    assert.equal(retried.statusCode, 200, JSON.stringify(retried.body));
    assert.equal(retried.body?.character.fateShards, 0);
    assert.equal(retried.body?.character.inventory.length, INVENTORY_CAP);
    assert.equal(retried.body?.item.armorQuality, sealed.roll.kind === 'armor' ? sealed.roll.armorQuality : undefined);
    assert.equal(await kv.get(`named-forge:${playerName}:${token}`), null);
});

test('competing forges spend one shard balance once and use only their sealed stats', async () => {
    const playerName = 'concurrentnamedforgeplayer';
    const key = `save:${playerName}`;
    const tokens = ['concurrentNamedToken123456A', 'concurrentNamedToken123456B'];
    const rolls = [rollNamedForge('weapon'), rollNamedForge('armor', 'feet')];
    await kv.set(key, { _saveVersion: 1, character: { name: playerName, level: 100, fateShards: 200,
        boneCharms: 5000, auraStones: 5000, mythicSeals: 5000, inventory: [], itemStacks: [{ itemId: 'gather-iron-sand-pristine', count: 20 }] }, creatorItems: [] });
    for (const [index, token] of tokens.entries()) await kv.set(`named-forge:${playerName}:${token}`, { playerName, roll: rolls[index] });
    const attempts = await Promise.all(tokens.map(token => forge(playerName, token, '127.0.3.2', {
        roll: { ep: 999, offenseVal: 999 }, weaponEp: 999, bonuses: { ninjutsuOffense: 999 }, fateShards: 9999,
    })));
    assert.deepEqual(attempts.map(attempt => attempt.statusCode).sort(), [200, 409]);
    const winner = attempts.findIndex(attempt => attempt.statusCode === 200);
    const loser = 1 - winner;
    const item = attempts[winner].body?.item;
    const roll = rolls[winner];
    assert.equal(item.bonuses.ninjutsuOffense, roll.offenseVal);
    if (roll.kind === 'weapon') assert.equal(item.weaponEp, roll.ep);
    else assert.equal(item.bonuses[roll.special.bonusKey], roll.special.value);
    assert.match(String(attempts[loser].body?.error), /200 Fate Shards/);
    const save = await kv.get<{ character: Record<string, any>; creatorItems: unknown[] }>(key);
    assert.equal(save?.character.fateShards, 0);
    assert.deepEqual([save?.character.boneCharms, save?.character.auraStones, save?.character.mythicSeals], [5000, 5000, 5000]);
    assert.deepEqual(save?.character.inventory, [item.id]);
    assert.equal(save?.creatorItems.length, 1);
    assert.ok(await kv.get(`named-forge:${playerName}:${tokens[loser]}`));
    assert.equal(await kv.get(`named-forge:${playerName}:${tokens[winner]}`), null);
});
