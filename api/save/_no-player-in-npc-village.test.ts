import assert from 'node:assert/strict';
import { before, test } from 'node:test';

// Cinderhold is the server's village (owner ruling 2026-11-10): no human player
// may ever be in it. A stored village is kept on every generic save, so the
// door this pins is the save that sets a village for the first time.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'no-player-in-npc-village-secret-32b';
process.env.ENABLE_LEGACY = '0';

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let issue: (name: string) => string | null;
let ip = 0;

function character(name: string, village: string): Record<string, unknown> {
    return {
        name, level: 1, xp: 0, experience: 0, ryo: 0,
        rank: 'Academy Student', rankTitle: 'Academy Student', village,
        stats: {}, inventory: [], itemStacks: [], pets: [], equipment: {},
        earnedTitles: [], serverTitles: [],
    };
}

async function post(name: string, body: Record<string, unknown>) {
    const out = { status: 200, body: undefined as Record<string, unknown> | undefined };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.status = code; return res; },
        json: (value: Record<string, unknown>) => { out.body = value; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST', query: { name }, body,
        headers: { 'x-player-name': name, 'x-player-token': issue(name) ?? '', 'content-type': 'application/json' },
        socket: { remoteAddress: `203.0.113.${++ip}` },
    } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./[name].js')).default as unknown as Handler;
    issue = (await import('../_auth.js')).issuePlayerToken;
});

test('a new character can never be created in Cinderhold, in any spelling', async () => {
    for (const [i, village] of ['Cinderhold Village', 'cinderhold village', 'Cinderhold', ' cinderhold '].entries()) {
        const name = `ashrecruit${i}`;
        await kv.set(`auth:${name}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
        const created = await post(name, { character: character(name, village), _baseSaveVersion: 0 });
        assert.equal(created.status, 403, `${village}: ${JSON.stringify(created.body)}`);
        assert.equal(await kv.get(`save:${name}`), null, `${village}: nothing was stored`);
    }
});

test('a starting village is one of the four great villages and nothing else', async () => {
    const great = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'];
    for (const [i, village] of great.entries()) {
        const name = `greatstart${i}`;
        await kv.set(`auth:${name}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
        const created = await post(name, { character: character(name, village), _baseSaveVersion: 0 });
        assert.equal(created.status, 200, `${village}: ${JSON.stringify(created.body)}`);
        assert.equal((await kv.get<Record<string, any>>(`save:${name}`))!.character.village, village);
    }
    for (const [i, village] of ['Ember', 'Hidden Mist Village', 'stormveil village', 'Admin Village'].entries()) {
        const name = `oddstart${i}`;
        await kv.set(`auth:${name}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
        const created = await post(name, { character: character(name, village), _baseSaveVersion: 0 });
        assert.equal(created.status, 403, `${village}: ${JSON.stringify(created.body)}`);
        assert.equal(await kv.get(`save:${name}`), null, `${village}: nothing was stored`);
    }
});

test('a player with no village yet cannot pick Cinderhold later; a great village still works', async () => {
    const name = 'villagelessrookie';
    await kv.set(`auth:${name}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
    const created = await post(name, { character: character(name, ''), _baseSaveVersion: 0 });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const version = Number(created.body?._saveVersion);
    await new Promise((r) => setTimeout(r, 3000)); // past the save burst limit
    const refused = await post(name, { character: character(name, 'Cinderhold Village'), _baseSaveVersion: version });
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal((await kv.get<Record<string, any>>(`save:${name}`))!.character.village, '');
    await new Promise((r) => setTimeout(r, 3000));
    const chosen = await post(name, { character: character(name, 'Frostfang Village'), _baseSaveVersion: version });
    assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
    assert.equal((await kv.get<Record<string, any>>(`save:${name}`))!.character.village, 'Frostfang Village');
});

test('a player already in a great village cannot move to Cinderhold by a save', async () => {
    const name = 'stormveilloyal';
    await kv.set(`auth:${name}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
    const created = await post(name, { character: character(name, 'Stormveil Village'), _baseSaveVersion: 0 });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    await new Promise((r) => setTimeout(r, 3000)); // past the save burst limit
    const moved = await post(name, { character: character(name, 'Cinderhold Village'), _baseSaveVersion: Number(created.body?._saveVersion) });
    // The stored village is kept on every generic save, so the write lands as Stormveil.
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal((await kv.get<Record<string, any>>(`save:${name}`))!.character.village, 'Stormveil Village');
});

test('Cinderhold is never a village a player can transfer to', async () => {
    const { TRANSFER_VILLAGES, isTransferVillage } = await import('../../shared/village-transfer.js');
    assert.ok(!TRANSFER_VILLAGES.some((v) => /cinderhold/i.test(v)));
    assert.equal(isTransferVillage('Cinderhold Village'), false);
});
