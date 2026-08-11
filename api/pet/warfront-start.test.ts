import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'warfront-start-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const PLAYER = 'warfrontauthorityprobe';
const PET_IDS = ['war-pet-1', 'war-pet-2', 'war-pet-3', 'war-pet-4'];

let startHandler: Handler;
let resultHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let playerToken = '';

const pet = (id: string, patch: Record<string, unknown> = {}) => ({
    id,
    name: id,
    rarity: 'standard',
    level: 24,
    xp: 0,
    maxLevel: 100,
    hp: 640,
    attack: 76,
    defense: 48,
    speed: 62,
    element: 'Fire',
    jutsus: [],
    unlockedForPve: true,
    ...patch,
});

const character = (patch: Record<string, unknown> = {}) => ({
    name: PLAYER,
    level: 24,
    ryo: 0,
    professionRank: 0,
    patreon: { active: true },
    pets: PET_IDS.map((id) => pet(id)),
    ...patch,
});

function response() {
    const out: Out = { statusCode: 200 };
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
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-player-token': playerToken },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function settle(out: Out): Promise<Out> {
    const result = response();
    await resultHandler(request({
        playerName: PLAYER,
        outcome: 'win',
        reportKey: out.body?.reportKey,
        battleToken: out.body?.token,
    }), result.res);
    return result.out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    playerToken = auth.issuePlayerToken(PLAYER)!;
    startHandler = (await import('./warfront-start.js')).default as unknown as Handler;
    resultHandler = (await import('./battle-result.js')).default as unknown as Handler;
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: character() });
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('Warfront start ignores caller identifiers, seals a redeemable token, and resumes one outstanding receipt', async () => {
    const body = {
        playerName: PLAYER,
        playerPetIds: PET_IDS,
        seed: 0,
        reportKey: 'caller-selected',
        stance: 'siege',
        doctrine: 'vanguard',
        buyPolicy: 'offense',
    };
    const first = response();
    await startHandler(request(body), first.res);
    assert.equal(first.out.statusCode, 200);
    assert.match(String(first.out.body?.token), /^[a-f0-9]{32}$/);
    assert.equal(first.out.body?.reportKey, `pet:${String(first.out.body?.token)}`);
    assert.ok(Number.isSafeInteger(first.out.body?.seed));
    assert.ok(Number(first.out.body?.seed) > 0, 'the caller-supplied zero seed was ignored');
    assert.equal('outcome' in (first.out.body ?? {}), false, 'start does not reveal a seed-shopping oracle');

    const stored = await kv.get<{
        playerName?: string;
        opponentLevel?: number;
        rewardRyo?: number;
        reportKey?: string;
        seed?: number;
        mode?: string;
        playerPetIds?: string[];
        authoritativeOutcome?: string;
    }>(`pet:battle-token:${PLAYER}:${String(first.out.body?.token)}`);
    assert.equal(stored?.playerName, PLAYER);
    assert.equal(stored?.mode, 'warfront');
    assert.equal(stored?.seed, first.out.body?.seed);
    assert.equal(stored?.reportKey, first.out.body?.reportKey);
    assert.deepEqual(stored?.playerPetIds, PET_IDS);
    assert.ok(Number.isSafeInteger(stored?.opponentLevel) && Number(stored?.opponentLevel) >= 1 && Number(stored?.opponentLevel) <= 100);
    assert.ok(Number.isSafeInteger(stored?.rewardRyo) && Number(stored?.rewardRyo) >= 20 && Number(stored?.rewardRyo) <= 250);
    assert.ok(['win', 'loss', 'draw'].includes(String(stored?.authoritativeOutcome)));
    assert.equal(await kv.get(`pet:battle-active:${PLAYER}`), first.out.body?.token);

    const resumed = response();
    await startHandler(request({ ...body, seed: 2_147_483_647, reportKey: 'also-ignored' }), resumed.res);
    assert.equal(resumed.out.statusCode, 200);
    assert.equal(resumed.out.body?.resumed, true);
    assert.equal(resumed.out.body?.token, first.out.body?.token);
    assert.equal(resumed.out.body?.seed, first.out.body?.seed);

    const conflict = response();
    await startHandler(request({ ...body, playerPetIds: [...PET_IDS].reverse() }), conflict.res);
    assert.equal(conflict.out.statusCode, 409);
    assert.equal(conflict.out.body?.error, 'Finish or settle your active pet battle first.');

    const settled = await settle(first.out);
    assert.equal(settled.statusCode, 200);
    assert.equal(await kv.get(`pet:battle-active:${PLAYER}`), null);
    assert.equal(await kv.get(`pet:battle-token:${PLAYER}:${String(first.out.body?.token)}`), null);

    const next = response();
    await startHandler(request(body), next.res);
    assert.equal(next.out.statusCode, 200, 'settling any authoritative outcome releases the start gate');
    assert.notEqual(next.out.body?.token, first.out.body?.token);
    await kv.delIfEqual(`pet:battle-active:${PLAYER}`, String(next.out.body?.token));
    await kv.del(`pet:battle-token:${PLAYER}:${String(next.out.body?.token)}`);
});

test('Warfront rejects breeding, training, and expedition-busy selections before minting a receipt', async () => {
    const cases = [
        {
            label: 'breeding',
            patch: {},
            characterPatch: {
                petBreeding: { state: 'breeding', parentIds: ['war-pet-1', 'war-pet-2'], readyAt: Date.now() + 60_000 },
            },
        },
        { label: 'training', patch: { training: { type: 'strength', endsAt: Date.now() + 60_000 } }, characterPatch: {} },
        { label: 'expedition', patch: { expedition: { type: 'scout', startedAt: 1, endsAt: Date.now() + 60_000, durationMs: 60_000 } }, characterPatch: {} },
    ];

    for (const busy of cases) {
        const pets = PET_IDS.map((id, index) => pet(id, index === 0 ? busy.patch : {}));
        await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: character({ pets, ...busy.characterPatch }) });
        const out = response();
        await startHandler(request({ playerName: PLAYER, playerPetIds: PET_IDS }), out.res);
        assert.equal(out.out.statusCode, 409, busy.label);
        assert.match(String(out.out.body?.error), /breeding, training, or an expedition/i);
        assert.equal(await kv.get(`pet:battle-active:${PLAYER}`), null);
    }
});

test('Warfront claims before its roster snapshot and recovers lease/receipt acknowledgement loss', async () => {
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: character() });
    const activeKey = `pet:battle-active:${PLAYER}`;
    const originalGet = kv.get.bind(kv);
    const originalSet = kv.set.bind(kv);
    let leaseAtSaveRead: unknown = null;
    let loseLeaseAck = true;
    let loseReceiptAck = true;
    kv.get = (async (key: string) => {
        if (key === `save:${PLAYER}`) leaseAtSaveRead = await originalGet(activeKey);
        return originalGet(key);
    }) as typeof kv.get;
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
        await startHandler(request({ playerName: PLAYER, playerPetIds: PET_IDS }), started.res);
    } finally {
        kv.get = originalGet as typeof kv.get;
        kv.set = originalSet as typeof kv.set;
    }
    assert.equal(started.out.statusCode, 200);
    assert.equal(leaseAtSaveRead, started.out.body?.token, 'the Warfront lease precedes the authoritative save read');
    assert.equal(loseLeaseAck, false);
    assert.equal(loseReceiptAck, false);
    const battleToken = String(started.out.body?.token);
    assert.equal(await kv.get(activeKey), battleToken);
    assert.equal((await kv.get<{ reportKey?: string }>(`pet:battle-token:${PLAYER}:${battleToken}`))?.reportKey, started.out.body?.reportKey);
    await kv.delIfEqual(activeKey, battleToken);
    await kv.del(`pet:battle-token:${PLAYER}:${battleToken}`);
});
