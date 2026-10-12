import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';
import { hollowGateWanderersForRun } from './_wanderers.js';
import { hollowGateCombatReward } from './_combat-session.js';
import { assertEmptyDisposablePg, configureDisposablePgTest, finishDisposablePgTest } from '../_disposable-pg-test-support.js';
const realPostgres = configureDisposablePgTest('hollow');
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let reset: () => void;
type Handler = (req: never, res: never) => Promise<unknown>;
const handlers: Record<string, Handler> = {};
const PLAYER = 'cavernscout', TOKEN = 'wanderertoken01', KEY = hollowGateRunKey(PLAYER, TOKEN);
before(async () => {
    if (realPostgres) await assertEmptyDisposablePg();
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: reset } = await import('../_ratelimit.js'));
    for (const name of ['floor-seal', 'step', 'event', 'combat-start', 'combat-settle', 'resume']) handlers[name] = (await import(`./${name}.js`)).default as Handler;
});
after(async () => { if (realPostgres) await finishDisposablePgTest(); });
beforeEach(async () => { const keys = await kv.keys('*'); if (keys.length) await kv.del(...keys); reset(); });
async function call(name: string, body: Record<string, unknown> = {}) {
    const reply = { status: 200, body: {} as Record<string, unknown> };
    const res = { setHeader: () => res, status: (status: number) => { reply.status = status; return res; }, json: (data: Record<string, unknown>) => { reply.body = data; return res; }, end: () => res };
    await handlers[name]({ method: 'POST', query: {}, body: { playerName: PLAYER, token: TOKEN, ...body }, headers: { 'x-player-name': PLAYER, 'x-player-token': issuePlayerToken(PLAYER) }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return reply;
}
async function seed(variantId?: string, features = false) {
    // Runtime import keeps the browser's bundler-resolved source outside the
    // API compiler's NodeNext program while testing the actual generator.
    const generatorPath = '../../shinobij.client/src/lib/hollow-gate-generate.js';
    const { generateHollowGateFloor } = await import(generatorPath) as { generateHollowGateFloor: (floor: number, final: boolean, dims: { width: number; height: number } | undefined, rng: () => number) => { width: number; height: number; playerX: number; playerY: number; tiles: Array<{ kind: string; terrain?: string; roomId?: number | null }> } };
    let state = 94825; const rng = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const board = generateHollowGateFloor(1, false, variantId ? { width: 19, height: 15 } : undefined, rng);
    const run: HollowGateRunToken = { playerName: PLAYER, mintedAt: Date.now(), seed: 'wanderer-seed', floorDepth: 5, currentFloor: 1, entryCurrencies: { ryo: 400 }, entryItems: {}, offeredAugmentIds: ['warded-step'], chosenAugmentId: 'warded-step', dailyRunOrdinal: 1, torch: 10, threat: 0, keys: 0, wardSteps: 40, ...(variantId ? { variantId, riftDistortionId: 'echoed-threat' } : {}) };
    await kv.set(KEY, run);
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, village: 'Moonshadow Village', level: 20, hp: 100, maxHp: 500, ryo: 400, chakra: 100, stamina: 100, itemStacks: [], hollowGateRun: { runToken: TOKEN, serverSeed: run.seed, floor: 1 } } });
    const request = { floor: 1, width: board.width, height: board.height, playerX: board.playerX, playerY: board.playerY, tiles: board.tiles.map(t => ({ kind: t.kind, terrain: t.terrain, roomId: t.roomId })), wanderersVersion: 1, ...(features ? { floorFeaturesVersion: 1 } : {}) };
    const sealed = await call('floor-seal', request); assert.equal(sealed.status, 200, JSON.stringify(sealed.body));
    return { run: (await kv.get<HollowGateRunToken>(KEY))!, request };
}
async function stand(run: HollowGateRunToken, tile: number) {
    const manifest = run.floorManifests!['1']; run.position = { x: tile % manifest.width, y: Math.floor(tile / manifest.width) }; await kv.set(KEY, run);
}
test('floor seals a bounded roster, rival identity, immutable origins and Rift signal; reseal/resume preserve it', async () => {
    for (const variant of [undefined, 'rift-test']) {
        const { run, request } = await seed(variant);
        const npcs = hollowGateWanderersForRun(run)!;
        assert.deepEqual(npcs.map(n => n.role), ['medic', 'wayfarer', 'bandit', 'night-ninja', 'patrol']);
        assert.notEqual(npcs[4].village, 'Moonshadow Village');
        for (const hunter of npcs.slice(2)) {
            assert.equal(run.floorManifests!['1'].nodes[String(hunter.origin)], 'battle');
            assert.notEqual(hunter.origin, run.floorManifests!['1'].riftSignal?.tileIndex);
        }
        const again = await call('floor-seal', request); assert.equal(again.status, 200); assert.deepEqual(again.body.wanderers, npcs);
        const resume = await call('resume'); assert.deepEqual((resume.body.run as { wanderers: unknown }).wanderers, npcs);
    }
});
test('traveler gifts reject remote, wrong-role, forged nodes and pending hunters; healing pays once', async () => {
    const { run } = await seed(); const medic = run.wanderers!['1'][0], wayfarer = run.wanderers!['1'][1];
    assert.equal((await call('event', { nodeId: medic.nodeId, action: 'traveler-heal' })).status, 409);
    await stand(run, medic.tile);
    assert.equal((await call('event', { nodeId: medic.nodeId, action: 'traveler-key' })).status, 409);
    assert.equal((await call('event', { nodeId: 'floor:1:tile:0', action: 'traveler-heal' })).status, 409);
    run.pendingAmbush = { nodeId: run.wanderers!['1'][2].nodeId, kind: 'battle' }; await kv.set(KEY, run);
    assert.equal((await call('event', { nodeId: medic.nodeId, action: 'traveler-heal' })).status, 409);
    run.pendingAmbush = null; await kv.set(KEY, run);
    const healed = await call('event', { nodeId: medic.nodeId, action: 'traveler-heal' }); assert.equal(healed.status, 200, JSON.stringify(healed.body));
    assert.equal((healed.body.character as { hp: number }).hp, 265);
    const replay = await call('event', { nodeId: medic.nodeId, action: 'traveler-heal' }); assert.equal((replay.body.character as { hp: number }).hp, 265);
    const after = (await kv.get<HollowGateRunToken>(KEY))!; await stand(after, wayfarer.tile);
    const key = await call('event', { nodeId: wayfarer.nodeId, action: 'traveler-key' }); assert.equal(key.status, 200); assert.equal((key.body.runState as { keys: number }).keys, 1);
    assert.equal((await call('event', { nodeId: wayfarer.nodeId, action: 'traveler-torch' })).status, 409, 'one choice per traveler');
    assert.equal(hollowGateWanderersForRun((await kv.get<HollowGateRunToken>(KEY))!)![0].spent, true);
});
test('Treasure Sense also seals roaming medic healing; wayfarer torch remains available', async () => {
    const { run } = await seed(); run.chosenAugmentId = 'treasure-sense'; run.torch = 1;
    await stand(run, run.wanderers!['1'][0].tile);
    assert.equal((await call('event', { nodeId: run.wanderers!['1'][0].nodeId, action: 'traveler-heal' })).status, 409);
    await stand(run, run.wanderers!['1'][1].tile);
    const result = await call('event', { nodeId: run.wanderers!['1'][1].nodeId, action: 'traveler-torch' }); assert.equal(result.status, 200); assert.equal((result.body.runState as { torch: number }).torch, 10);
});
test('hunter combat validates moving proximity, human profile and normal battle reward exactly once', async () => {
    const { run } = await seed(); const hunter = run.wanderers!['1'][2], medic = run.wanderers!['1'][0];
    const start = (nodeId = hunter.nodeId, mode = 'pve') => call('combat-start', { floor: 1, kind: 'battle', nodeId, mode });
    assert.equal((await start()).status, 409); assert.equal((await start(medic.nodeId)).status, 409);
    await stand(run, hunter.tile); assert.equal((await start(hunter.nodeId, 'pet')).status, 409);
    run.pendingAmbush = { nodeId: 'floor:1:ambush:threat-v25', kind: 'card' }; await kv.set(KEY, run);
    assert.equal((await start()).status, 409, 'a nearby hunter cannot replace a sealed Chronicle encounter');
    run.pendingAmbush = null; await kv.set(KEY, run);
    const started = await start(); assert.equal(started.status, 200, JSON.stringify(started.body));
    const { readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js');
    const session = (await readSoloPveSession(String(started.body.runId)))!;
    assert.equal(session.enemy.name, 'Cavern Bandit'); assert.equal(session.enemy.character.avatarImage, '/underground/wanderer-bandit-v1.webp'); assert.notEqual(session.enemy.character.visual, 'hollow-hound');
    session.status = 'done'; session.outcome = 'win'; session.winner = 'player';
    session.terminalEvidence = { finishedAt: Date.now(), finalMoveToken: 'hunter-win', finalVersion: session.version, finalEventSeq: session.eventSeq, winner: 'player', outcome: 'win', itemsUsed: {}, settlementState: 'pending' };
    await writeSoloPveSession(session);
    const result = await call('combat-settle', { runId: started.body.runId }); assert.equal(result.status, 200); assert.equal(result.body.won, true);
    const ryo = (result.body.character as { ryo: number }).ryo; assert.equal(ryo, 400 + Math.floor(hollowGateCombatReward(1, 'battle').ryo * 1.2));
    assert.equal((await start()).status, 409);
    const replay = await call('combat-settle', { runId: started.body.runId }); assert.equal((replay.body.character as { ryo: number }).ryo, ryo);
    assert.equal(hollowGateWanderersForRun((await kv.get<HollowGateRunToken>(KEY))!)![2].spent, true);
});
test('step seals hunter contact, retries without moving twice and resumes the exact pending fight', async () => {
    const { run } = await seed(); const manifest = run.floorManifests!['1'];
    const from = [...manifest.walkable].findIndex((v, i) => v === '1' && !manifest.nodes[String(i)] && i % manifest.width < manifest.width - 2 && manifest.walkable[i + 1] === '1' && !manifest.nodes[String(i + 1)] && manifest.walkable[i + 2] === '1' && !manifest.nodes[String(i + 2)]);
    assert(from >= 0); run.wanderers!['1'] = [ { ...run.wanderers!['1'][2], tile: from + 2 } ]; await stand(run, from);
    const req = { requestId: 'hunter-contact-step01', fromX: from % manifest.width, fromY: Math.floor(from / manifest.width), toX: (from + 1) % manifest.width, toY: Math.floor(from / manifest.width) };
    assert.equal((await call('step', { ...req, floor: 2 })).status, 409, 'a delayed request from another floor cannot move this run');
    assert.equal((await kv.get<HollowGateRunToken>(KEY))!.position!.x, req.fromX);
    const contact = await call('step', req); assert.equal(contact.status, 200); assert.deepEqual(contact.body.ambush, { nodeId: run.wanderers!['1'][0].nodeId, kind: 'battle' });
    const retry = await call('step', req); assert.equal(retry.status, 200); assert.deepEqual(retry.body.wanderers, contact.body.wanderers); assert.equal(retry.body.stepVersion, contact.body.stepVersion); assert.deepEqual(retry.body.ambush, contact.body.ambush);
    const resume = await call('resume'); assert.deepEqual((resume.body.run as { pendingAmbush: unknown }).pendingAmbush, contact.body.ambush);
    const blocked = await call('step', { ...req, requestId: 'hunter-blocked-step01', fromX: req.toX, toX: req.fromX }); assert.equal(blocked.status, 409); assert.deepEqual(blocked.body.pendingAmbush, contact.body.ambush);
});

test('floor architecture is sealed, collision is server-owned, and resume retains the same footprints', async () => {
    const { run, request } = await seed(undefined, true), manifest = run.floorManifests!['1'];
    const features = run.floorFeatures!['1']; assert(features.length > 0);
    const blocked = new Set(features.flatMap(f => f.cells));
    assert(run.wanderers!['1'].every(n => !blocked.has(n.tile)), 'travelers spawn off structural footprints');
    const target = [...blocked].find(index => [index - manifest.width, index + 1, index + manifest.width, index - 1].some(n => manifest.walkable[n] === '1' && !blocked.has(n) && Math.abs(n % manifest.width - index % manifest.width) + Math.abs(Math.floor(n / manifest.width) - Math.floor(index / manifest.width)) === 1))!;
    const from = [target - manifest.width, target + 1, target + manifest.width, target - 1].find(n => manifest.walkable[n] === '1' && !blocked.has(n) && Math.abs(n % manifest.width - target % manifest.width) + Math.abs(Math.floor(n / manifest.width) - Math.floor(target / manifest.width)) === 1)!;
    assert(from != null); await stand(run, from);
    const before = await kv.get<HollowGateRunToken>(KEY);
    const result = await call('step', { floor: 1, floorFeaturesVersion: 1, requestId: 'solid-footprint-attempt', fromX: from % manifest.width, fromY: Math.floor(from / manifest.width), toX: target % manifest.width, toY: Math.floor(target / manifest.width), floorFeatures: [] });
    assert.equal(result.status, 409); assert.deepEqual(await kv.get(KEY), before, 'blocked movement spends no torch, threat, ward or resources');
    const oldClient = await call('step', { requestId: 'old-architecture-client', fromX: from % manifest.width, fromY: Math.floor(from / manifest.width), toX: target % manifest.width, toY: Math.floor(target / manifest.width) });
    assert.match(String(oldClient.body.error), /Reload/);
    const replay = await call('floor-seal', { ...request, floorFeatures: [] }); assert.equal(replay.status, 200); assert.deepEqual(replay.body.floorFeatures, features);
    const recovered = await call('resume'); assert.deepEqual((recovered.body.run as { floorFeatures: unknown }).floorFeatures, features);
});

test('upgrading a legacy floor never puts architecture under the player or a current traveler', async () => {
    const { run, request } = await seed(); const manifest = run.floorManifests!['1'];
    const { deriveHollowGateFloorFeatures } = await import('./_floor-features.js');
    const possible = deriveHollowGateFloorFeatures(manifest, request.tiles);
    assert(possible.length > 0); const standing = possible[0].cells[0]; await stand(run, standing);
    const sealed = await call('floor-seal', { ...request, floorFeaturesVersion: 1 }); assert.equal(sealed.status, 200);
    const features = sealed.body.floorFeatures as import('../../shared/underground-floor-features.js').UndergroundFloorFeature[];
    const blocked = new Set(features.flatMap(f => f.cells)); assert(!blocked.has(standing));
    assert(run.wanderers!['1'].every(n => !blocked.has(n.tile)));
    assert.deepEqual((await kv.get<HollowGateRunToken>(KEY))!.position, run.position);
});
