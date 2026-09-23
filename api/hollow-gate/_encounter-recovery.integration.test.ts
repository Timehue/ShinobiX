import { randomBytes } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHollowGateCombatBinding, hollowGateCombatBindingKey } from './_combat-session.js';
import { validateHollowGateFloorManifest } from './_floor-manifest.js';
import type { HollowGateRunToken } from './_run-token.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
type Handler = (req: VercelRequest, res: VercelResponse) => Promise<unknown>;
let stepHandler: Handler;
let floorSealHandler: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    stepHandler = (await import('./step.js')).default as unknown as Handler;
    floorSealHandler = (await import('./floor-seal.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

async function call(handler: Handler, body: Record<string, unknown>) {
    const name = 'riftplayer';
    const auth = issuePlayerToken(name);
    const result: { status: number; body?: Record<string, unknown> } = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { result.status = status; return res; },
        json: (response: Record<string, unknown>) => { result.body = response; return res; },
        end: () => res,
    };
    await handler({ method: 'POST', body: { ...body, playerName: name }, query: { name },
        headers: { 'x-player-name': name, 'x-player-token': auth },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return result;
}

function floor() {
    const width = 15;
    const height = 11;
    const tiles = Array.from({ length: width * height }, () => ({ kind: 'empty', terrain: 'room_floor' }));
    let index = 20;
    for (const [kind, count] of [
        ['battle', 5], ['elite', 1], ['trap', 1], ['chest', 3], ['shard_vein', 1],
        ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1],
    ] as const) {
        for (let placed = 0; placed < count; placed += 1) tiles[index++].kind = kind;
    }
    tiles[15 * 9 + 1].kind = 'exit';
    tiles[15 * 9 + 13].kind = 'descend';
    const validated = validateHollowGateFloorManifest({ floor: 1, finalFloor: false, width, height,
        playerX: 1, playerY: 1, tiles });
    if (!validated.ok) throw new Error(validated.reason);
    return { width, height, tiles, manifest: validated.manifest };
}

function run(manifest: ReturnType<typeof floor>['manifest']): HollowGateRunToken {
    return {
        playerName: 'riftplayer', mintedAt: Date.now(), floorDepth: 5, currentFloor: 1,
        seed: 'seed', entryCurrencies: {}, offeredAugmentIds: ['keen-edge'],
        chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
        floorManifests: { '1': manifest }, position: { x: 1, y: 1 },
    };
}

test('pending ambush is returned by both blocked movement and floor reseal', async () => {
    const board = floor();
    const pendingAmbush = { nodeId: 'floor:1:ambush:threat-v25', kind: 'ambush' as const };
    await kv.set('hg-run:riftplayer:token', { ...run(board.manifest), pendingAmbush });
    const step = await call(stepHandler, { token: 'token', requestId: 'step-test-1',
        fromX: 1, fromY: 1, toX: 2, toY: 1 });
    assert.equal(step.status, 409);
    assert.deepEqual(step.body?.pendingAmbush, pendingAmbush);
    assert.deepEqual(step.body?.position, { x: 1, y: 1 });

    const reseal = await call(floorSealHandler, { token: 'token', floor: 1,
        width: board.width, height: board.height, playerX: 1, playerY: 1, tiles: board.tiles });
    assert.equal(reseal.status, 200);
    assert.deepEqual(reseal.body?.pendingAmbush, pendingAmbush);
    assert.deepEqual(reseal.body?.position, { x: 1, y: 1 });
});

test('a rift card ambush survives refresh through the same floor reseal', async () => {
    const board = floor();
    const pendingAmbush = { nodeId: 'floor:1:ambush:threat-v30', kind: 'card' as const };
    await kv.set('hg-run:riftplayer:token', { ...run(board.manifest), variantId: 'rift-legacy-echo', pendingAmbush });
    const reseal = await call(floorSealHandler, { token: 'token', floor: 1,
        width: board.width, height: board.height, playerX: 1, playerY: 1, tiles: board.tiles });
    assert.equal(reseal.status, 200);
    assert.deepEqual(reseal.body?.pendingAmbush, pendingAmbush);
    const step = await call(stepHandler, { token: 'token', requestId: 'card-step-1',
        fromX: 1, fromY: 1, toX: 2, toY: 1 });
    assert.equal(step.status, 409);
    assert.deepEqual(step.body?.pendingAmbush, pendingAmbush);
});

test('floor reseal returns the exact live combat pointer for recovery', async () => {
    const board = floor();
    const binding = createHollowGateCombatBinding({
        playerName: 'riftplayer', token: 'token', floor: 1,
        nodeId: 'floor:1:tile:20', kind: 'battle', combatMode: 'solo-pve',
    });
    const activeEncounter = { runId: binding.runId, nodeId: binding.nodeId, floor: binding.floor,
        kind: binding.kind, enemyProfileId: binding.enemyProfileId, createdAt: binding.createdAt };
    await kv.set('hg-run:riftplayer:token', { ...run(board.manifest), activeEncounter });
    await kv.set(hollowGateCombatBindingKey(binding.runId), binding);
    const reseal = await call(floorSealHandler, { token: 'token', floor: 1,
        width: board.width, height: board.height, playerX: 1, playerY: 1, tiles: board.tiles });
    assert.equal(reseal.status, 409);
    assert.deepEqual(reseal.body?.activeCombat, {
        runId: binding.runId, nodeId: binding.nodeId, floor: binding.floor,
        kind: binding.kind, mode: 'pve',
    });
});
