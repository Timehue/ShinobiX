import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { rollNamedForge } from './_named.js';

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

test('registry write failure leaves the named roll and forge materials unspent for retry', async () => {
    const playerName = 'registryforgeplayer';
    const token = 'registryForgeToken123456';
    const ip = '127.0.1.1';
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        character: { name: playerName, level: 100, boneCharms: 500, inventory: [], itemStacks: [] },
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
        const save = await kv.get<{ character: { boneCharms: number; inventory: string[] } }>(`save:${playerName}`);
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
    const save = await kv.get<{ character: { boneCharms: number; inventory: string[] } }>(`save:${playerName}`);
    assert.equal(save?.character.boneCharms, 0);
    assert.ok(save?.character.inventory.includes(item.id));
});
