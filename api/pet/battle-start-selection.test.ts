import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-selection-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let token = '';
const PLAYER = 'petselectionprobe';

function response() {
    const out: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function request(body: Record<string, unknown>) {
    return {
        method: 'POST', body,
        headers: { 'content-type': 'application/json', 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

const ownedPet = (patch: Record<string, unknown> = {}) => ({
    id: 'owned-pet', name: 'Owned Pet', rarity: 'standard', level: 20, xp: 0, maxLevel: 100,
    hp: 300, attack: 60, defense: 40, speed: 35, unlockedForPve: true,
    jutsus: [{ name: 'Strike', power: 50, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
    ...patch,
});

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    token = auth.issuePlayerToken(PLAYER)!;
    handler = (await import('./battle-start.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('casual battle start rejects duplicate roster slots before minting a receipt', async () => {
    await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, pets: [ownedPet()] } });
    const duplicate = response();
    await handler(request({
        playerName: PLAYER,
        mode: '2v2',
        playerPetIds: ['owned-pet', 'owned-pet'],
        opponentPetIds: ['generic-ai-pet-sparrow'],
    }), duplicate.res);
    assert.equal(duplicate.out.statusCode, 400);
    assert.match(String(duplicate.out.body?.error), /one battle slot/i);
    assert.equal(await kv.get(`pet:battle-active:${PLAYER}`), null);
});

test('casual battle start rejects an expedition-busy carried pet', async () => {
    await kv.set(`save:${PLAYER}`, {
        character: {
            name: PLAYER,
            pets: [ownedPet({ expedition: { type: 'scout', startedAt: 1, endsAt: Date.now() + 60_000, durationMs: 60_000 } })],
        },
    });
    const busy = response();
    await handler(request({
        playerName: PLAYER,
        mode: '1v1',
        playerPetIds: ['owned-pet'],
        opponentPetIds: ['generic-ai-pet-sparrow'],
    }), busy.res);
    assert.equal(busy.out.statusCode, 409);
    assert.match(String(busy.out.body?.error), /expedition/i);
    assert.equal(await kv.get(`pet:battle-active:${PLAYER}`), null);
});

test('casual battle start rejects a training-busy carried pet', async () => {
    await kv.set(`save:${PLAYER}`, {
        character: {
            name: PLAYER,
            pets: [ownedPet({ training: { type: 'strength', endsAt: Date.now() + 60_000 } })],
        },
    });
    const busy = response();
    await handler(request({
        playerName: PLAYER,
        mode: '1v1',
        playerPetIds: ['owned-pet'],
        opponentPetIds: ['generic-ai-pet-sparrow'],
    }), busy.res);
    assert.equal(busy.out.statusCode, 409);
    assert.match(String(busy.out.body?.error), /training/i);
    assert.equal(await kv.get(`pet:battle-active:${PLAYER}`), null);
});

test('casual battle owns the lifecycle lease before its save snapshot and resumes only the exact opponent identity', async () => {
    await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, pets: [ownedPet()] } });
    const activeKey = `pet:battle-active:${PLAYER}`;
    const originalGet = kv.get.bind(kv);
    let leaseAtSaveRead: unknown = null;
    kv.get = (async (key: string) => {
        if (key === `save:${PLAYER}`) leaseAtSaveRead = await originalGet(activeKey);
        return originalGet(key);
    }) as typeof kv.get;
    const first = response();
    try {
        await handler(request({
            playerName: PLAYER,
            opponentName: 'opponent-b',
            mode: '1v1',
            playerPetIds: ['owned-pet'],
            opponentPetIds: ['generic-ai-pet-sparrow'],
        }), first.res);
    } finally {
        kv.get = originalGet as typeof kv.get;
    }
    assert.equal(first.out.statusCode, 200);
    assert.equal(leaseAtSaveRead, first.out.body?.token, 'the active lease precedes the authoritative save read');

    const differentOpponent = response();
    await handler(request({
        playerName: PLAYER,
        opponentName: 'opponent-c',
        mode: '1v1',
        playerPetIds: ['owned-pet'],
        opponentPetIds: ['generic-ai-pet-sparrow'],
    }), differentOpponent.res);
    assert.equal(differentOpponent.out.statusCode, 409, 'same pet IDs cannot resume a different opponent seal');

    const battleToken = String(first.out.body?.token);
    await kv.delIfEqual(activeKey, battleToken);
    await kv.del(`pet:battle-token:${PLAYER}:${battleToken}`);
});

test('casual battle recovers lost acknowledgements for both the lease and sealed receipt', async () => {
    await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, pets: [ownedPet()] } });
    const activeKey = `pet:battle-active:${PLAYER}`;
    const originalSet = kv.set.bind(kv);
    let loseLeaseAck = true;
    let loseReceiptAck = true;
    kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        const result = await originalSet(key, value, options);
        if (key === activeKey && loseLeaseAck) {
            loseLeaseAck = false;
            throw new Error('simulated lease acknowledgement loss');
        }
        if (key.startsWith(`pet:battle-token:${PLAYER}:`) && loseReceiptAck) {
            loseReceiptAck = false;
            throw new Error('simulated receipt acknowledgement loss');
        }
        return result;
    }) as typeof kv.set;
    const started = response();
    try {
        await handler(request({
            playerName: PLAYER,
            mode: '1v1',
            playerPetIds: ['owned-pet'],
            opponentPetIds: ['generic-ai-pet-sparrow'],
        }), started.res);
    } finally {
        kv.set = originalSet as typeof kv.set;
    }
    assert.equal(started.out.statusCode, 200);
    assert.equal(loseLeaseAck, false);
    assert.equal(loseReceiptAck, false);
    const battleToken = String(started.out.body?.token);
    assert.equal(await kv.get(activeKey), battleToken);
    assert.equal((await kv.get<{ reportKey?: string }>(`pet:battle-token:${PLAYER}:${battleToken}`))?.reportKey, started.out.body?.reportKey);
    await kv.delIfEqual(activeKey, battleToken);
    await kv.del(`pet:battle-token:${PLAYER}:${battleToken}`);
});
