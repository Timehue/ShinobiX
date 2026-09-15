import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, beforeEach, test, type TestContext } from 'node:test';
import type { HollowGateRunToken } from './_run-token.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
delete process.env.VERCEL;
delete process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;

type Character = Record<string, unknown>;
type Save = { _saveVersion: number; character: Character };
type Handler = (req: never, res: never) => Promise<unknown>;
type Response = { status: number; body?: Record<string, unknown> };
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let consumable: Handler;
let event: Handler;
let step: Handler;
let settle: Handler;

before(async () => {
    const storage = await import('../_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa');
    kv = storage.kv;
    ({ issuePlayerToken } = await import('../_auth.js'));
    consumable = (await import('./use-consumable.js')).default as unknown as Handler;
    event = (await import('./event.js')).default as unknown as Handler;
    step = (await import('./step.js')).default as unknown as Handler;
    settle = (await import('./settle.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

async function call(handler: Handler, name: string, body: Record<string, unknown>): Promise<Response> {
    const session = issuePlayerToken(name);
    assert.ok(session);
    const result: Response = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { result.status = status; return res; },
        json: (response: Record<string, unknown>) => { result.body = response; return res; },
        end: () => res,
    };
    await handler({ method: 'POST', headers: { 'x-player-name': name, 'x-player-token': session },
        socket: { remoteAddress: '127.0.0.1' }, body: { ...body, playerName: name },
    } as never, res as never);
    return result;
}

async function prepare(label: string, position: { x: number; y: number }) {
    const name = `hgpending${label}`;
    const token = `pending-${label}`;
    const saveKey = `save:${name}`;
    const runKey = `hg-run:${name}:${token}`;
    const { validateHollowGateFloorManifest } = await import('./_floor-manifest.js');
    const { recordHollowGateExternalCredits } = await import('./_external-credits.js');
    const tiles = Array.from({ length: 165 }, () => ({ kind: 'empty', terrain: 'room_floor' }));
    let index = 20;
    for (const [kind, count] of [
        ['battle', 5], ['elite', 1], ['trap', 1], ['chest', 3], ['shard_vein', 1],
        ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1],
    ] as const) for (let n = 0; n < count; n++) tiles[index++].kind = kind;
    tiles[136].kind = 'exit';
    tiles[148].kind = 'descend';
    const floor = validateHollowGateFloorManifest({ floor: 1, finalFloor: false, width: 15, height: 11, playerX: 1, playerY: 1, tiles });
    assert.equal(floor.ok, true);
    const run: HollowGateRunToken = {
        playerName: name, mintedAt: Date.now() - 240_000, floorDepth: 5, currentFloor: 1,
        seed: label, entryCurrencies: { ryo: 1000, hollowShards: 100 }, entryItems: {},
        offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
        rewardLedger: { currencies: { ryo: 200 }, items: {}, sourceIds: ['prepared-earned-ryo'] },
        position, floorManifests: { '1': floor.manifest }, keys: 1, torch: 4, threat: 5, wardSteps: 0,
    };
    const before: Character = { name, level: 20, hp: 500, maxHp: 500,
        ryo: 1200, hollowShards: 100, inventory: [], itemStacks: [],
        hollowGateRun: { runToken: token, currentFloor: 1, playerX: position.x, playerY: position.y },
    };
    const character = recordHollowGateExternalCredits(before, { ...before, ryo: 1290 });
    await kv.set(runKey, run);
    await kv.set(saveKey, { _saveVersion: 1, character });
    return { name, token, saveKey, runKey, run };
}

/** Commit the actual wallet CAS, then lose its ACK and one confirmation read. */
async function loseCommitAcknowledgement(t: TestContext, saveKey: string, action: () => Promise<Response>) {
    const originalCompare = kv.compareSet.bind(kv);
    const originalGet = kv.get.bind(kv);
    let committed = false;
    let readLost = false;
    let pendingReadFailure = false;
    const errorLog = t.mock.method(console, 'error', () => undefined);
    kv.compareSet = async (...args: Parameters<typeof kv.compareSet>) => {
        const result = await originalCompare(...args);
        if (args[0] === saveKey && result && !committed) {
            committed = true;
            pendingReadFailure = true;
            throw new Error('fixture lost committed wallet acknowledgement');
        }
        return result;
    };
    kv.get = async <T>(key: string): Promise<T | null> => {
        if (key === saveKey && pendingReadFailure) {
            pendingReadFailure = false;
            readLost = true;
            throw new Error('fixture lost first wallet confirmation read');
        }
        return originalGet<T>(key);
    };
    try {
        const response = await action();
        assert.equal(response.status, 500, 'ambiguous acknowledgement is surfaced, not reported as rolled back');
        assert.equal(committed, true);
        assert.equal(readLost, true);
    } finally {
        kv.compareSet = originalCompare;
        kv.get = originalGet;
        errorLog.mock.restore();
    }
}

test('different extract route recovers a committed Sanctify checkpoint after ACK and read loss', async t => {
    const f = await prepare('checkpoint', { x: 1, y: 9 });
    await loseCommitAcknowledgement(t, f.saveKey, () => call(consumable, f.name, {
        token: f.token, action: 'sanctify', requestId: 'pending-sanctify-operation',
    }));
    const committed = (await kv.get<Save>(f.saveKey))!;
    assert.equal(committed._saveVersion, 2);
    assert.equal(committed.character.hollowShards, 86);
    assert.equal(committed.character.ryo, 1290);
    assert.ok(committed.character.hollowGatePendingOperation);
    const lagging = (await kv.get<HollowGateRunToken>(f.runKey))!;
    assert.equal(lagging.entryCurrencies.ryo, 1000, 'fault leaves the run pending until a later action repairs it');
    assert.equal(lagging.rewardLedger?.currencies.ryo, 200);

    // The caller does not retry Sanctify; it immediately leaves via another route.
    const extracted = await call(settle, f.name, { token: f.token, action: 'extract' });
    assert.equal(extracted.status, 200, String(extracted.body?.error));
    const after = (await kv.get<Save>(f.saveKey))!;
    assert.equal(after.character.ryo, 1290, 'the recovered checkpoint contains the earlier legitimate external credit');
    assert.equal(after.character.hollowShards, 86, 'Sanctify was charged exactly once');
    assert.equal(after.character.hollowGateRun, null);
    assert.equal(await kv.get(f.runKey), null);
    const retry = await call(settle, f.name, { token: f.token, action: 'extract' });
    assert.equal(retry.status, 200);
    assert.deepEqual(await kv.get(f.saveKey), after, 'terminal retry cannot charge or settle a second time');
});

test('movement and a different chest recover a committed event without rewinding later run progress', async t => {
    const f = await prepare('event', { x: 12, y: 1 });
    const firstNode = 'floor:1:tile:27';
    const secondNode = 'floor:1:tile:28';
    const firstSource = `event:1:chest:${firstNode}`;
    const secondSource = `event:1:chest:${secondNode}`;
    // Sealed server roll fixtures remove RNG but leave event validation and writes real.
    await kv.set(`hg-event-roll:${f.name}:${f.token}:${firstSource}`, {
        action: 'chest', credit: { currencies: { ryo: 70 } }, keyDelta: 1, torchDelta: 2,
    });
    await kv.set(`hg-event-roll:${f.name}:${f.token}:${secondSource}`, {
        action: 'chest', credit: { currencies: { ryo: 30 } },
    });
    await loseCommitAcknowledgement(t, f.saveKey, () => call(event, f.name, {
        token: f.token, action: 'chest', nodeId: firstNode,
    }));
    assert.equal((await kv.get<Save>(f.saveKey))!.character.ryo, 1360);
    assert.equal((await kv.get<HollowGateRunToken>(f.runKey))!.rewardLedger?.currencies.ryo, 200);

    const moved = await call(step, f.name, { token: f.token, requestId: 'pending-event-next-step',
        fromX: 12, fromY: 1, toX: 13, toY: 1,
    });
    assert.equal(moved.status, 200, String(moved.body?.error));
    const afterMove = (await kv.get<HollowGateRunToken>(f.runKey))!;
    assert.deepEqual(afterMove.position, { x: 13, y: 1 });
    assert.equal(afterMove.keys, 2, 'movement observes the recovered chest key');
    assert.equal(afterMove.rewardLedger?.currencies.ryo, 270);
    assert.equal(afterMove.threat, 9);
    assert.ok(Number(afterMove.torch) >= 5 && Number(afterMove.torch) <= 6);

    const firstRetry = await call(event, f.name, { token: f.token, action: 'chest', nodeId: firstNode });
    assert.equal(firstRetry.status, 200);
    assert.equal(firstRetry.body?.alreadyReported, true);
    assert.deepEqual(await kv.get(f.runKey), afterMove, 'old proof replay cannot reset position, torch or threat');
    assert.equal((await kv.get<Save>(f.saveKey))!.character.ryo, 1360);

    const second = await call(event, f.name, { token: f.token, action: 'chest', nodeId: secondNode });
    assert.equal(second.status, 200, String(second.body?.error));
    const finalRun = (await kv.get<HollowGateRunToken>(f.runKey))!;
    assert.equal(finalRun.rewardLedger?.currencies.ryo, 300);
    assert.deepEqual(finalRun.resolvedEventIds, [firstSource, secondSource]);
    assert.equal((await kv.get<Save>(f.saveKey))!.character.ryo, 1390);
    assert.deepEqual(finalRun.position, afterMove.position);

    const ended = await call(settle, f.name, { token: f.token, action: 'abandon' });
    assert.equal(ended.status, 200, String(ended.body?.error));
    assert.equal((await kv.get<Save>(f.saveKey))!.character.ryo, 1240,
        'settlement retains external 90 plus half of all 300 recorded run income');
});
