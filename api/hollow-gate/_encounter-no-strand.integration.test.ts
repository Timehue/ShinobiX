import { randomBytes } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { hollowGateCombatBindingKey, hollowGateCombatReward, type HollowGateCombatBinding } from './_combat-session.js';
import { validateHollowGateFloorManifest } from './_floor-manifest.js';
import { hollowGatePetResultKey } from './_pet-authority.js';
import { hollowGateRunKey, rewardMultiplierForToken, type HollowGateRunToken } from './_run-token.js';

// Two ways a live Hollow Gate encounter used to seal a player in place with
// Emergency Forfeit as the only exit, both reachable inside a rift:
//  1. Leaving a Hound tile fight alive (a verified escape, or a Second Wind
//     revive) kept the encounter unresolved, and step.ts refused every step off
//     an unresolved combat tile.
//  2. "Send pet" opened a pet duel whose Showdown admission was refused for
//     every Hollow Gate encounter, and combat-start refused any other fight
//     for that node while the pet binding stayed active. The duel now opens
//     (_pet-showdown-duel.integration.test.ts), and whenever it cannot, the
//     same node can still be fought as a shinobi.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: () => void;
const handlers: Record<string, Handler> = {};

const PLAYER = 'gatewalker';
const TOKEN = 'gatewalkertoken01';
const WIDTH = 15;
const HEIGHT = 11;
const runKey = hollowGateRunKey(PLAYER, TOKEN);
const saveKey = `save:${PLAYER}`;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    for (const [name, path] of [
        ['step', './step.js'], ['combatStart', './combat-start.js'], ['combatSettle', './combat-settle.js'],
    ] as const) {
        handlers[name] = (await import(path)).default as unknown as Handler;
    }
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    // Every case here is the same player, and combat-start allows 20 a minute.
    resetRateLimits();
});

async function call(name: string, body: Record<string, unknown>): Promise<Reply> {
    const reply: Reply = { status: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (status: number) => { reply.status = status; return res; },
        json: (data: Record<string, unknown>) => { reply.body = data; return res; },
        end: () => res,
    };
    await handlers[name]({
        method: 'POST', body: { ...body, playerName: PLAYER, token: TOKEN }, query: {},
        headers: { 'x-player-name': PLAYER, 'x-player-token': issuePlayerToken(PLAYER)! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return reply;
}

/** Floor 1 of 5. The Hound tile under test sits at (5,1); (4,1) is open floor. */
const HOUND = { x: 5, y: 1, node: `floor:1:tile:${1 * WIDTH + 5}` };
function board() {
    const tiles = Array.from({ length: WIDTH * HEIGHT }, () => ({ kind: 'empty', terrain: 'room_floor' }));
    let index = 20;
    for (const [kind, count] of [
        ['battle', 5], ['elite', 1], ['trap', 1], ['chest', 3], ['shard_vein', 1],
        ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1],
    ] as const) {
        for (let placed = 0; placed < count; placed += 1) tiles[index++].kind = kind;
    }
    tiles[WIDTH * 9 + 1].kind = 'exit';
    tiles[WIDTH * 9 + 13].kind = 'descend';
    const validated = validateHollowGateFloorManifest({ floor: 1, finalFloor: false, width: WIDTH, height: HEIGHT, playerX: 1, playerY: 1, tiles });
    if (!validated.ok) throw new Error(validated.reason);
    assert.equal(validated.manifest.nodes[String(1 * WIDTH + 5)], 'battle');
    return validated.manifest;
}

async function seed(overrides: Partial<HollowGateRunToken> = {}) {
    const run: HollowGateRunToken = {
        playerName: PLAYER, mintedAt: Date.now(), floorDepth: 5, currentFloor: 1,
        seed: 'gatewalker-seed', entryCurrencies: { ryo: 400 }, entryItems: {},
        offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
        floorManifests: { '1': board() }, position: { x: HOUND.x, y: HOUND.y },
        torch: 8, threat: 12, stepVersion: 3, recentStepIds: [],
        ...overrides,
    };
    await kv.set(runKey, run);
    await kv.set(saveKey, { _saveVersion: 1, character: {
        name: PLAYER, level: 20, hp: 500, maxHp: 500, ryo: 400,
        pets: [{ id: 'pet-kuro', name: 'Kuro', level: 50, unlockedForPve: true }], activePetId: 'pet-kuro',
        itemStacks: [], hollowGateRun: { runToken: TOKEN, serverSeed: run.seed, floor: 1 },
    } });
    return run;
}

async function finishFight(runId: string, outcome: 'win' | 'loss' | 'fled') {
    const { readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js');
    const session = (await readSoloPveSession(runId))!;
    assert.ok(session, 'combat-start sealed a server session');
    const winner = outcome === 'win' ? 'player' : outcome === 'loss' ? 'enemy' : null;
    Object.assign(session, { status: 'done', outcome, winner, settlementState: 'pending' });
    session.terminalEvidence = {
        finishedAt: Date.now(), finalMoveToken: `terminal-${runId}`, finalVersion: session.version,
        finalEventSeq: 0, winner, outcome, itemsUsed: {}, settlementState: 'pending',
    } as never;
    await writeSoloPveSession(session);
}

let steps = 0;
const step = (from: [number, number], to: [number, number]) => call('step', {
    requestId: `no-strand-step-${++steps}`, fromX: from[0], fromY: from[1], toX: to[0], toY: to[1],
});

for (const exit of ['escape', 'second-wind'] as const) {
    test(`leaving a Hound tile alive (${exit}) no longer pins the player; the Hound waits and pays once`, async () => {
        await seed(exit === 'second-wind' ? { secondWindArmed: true } : {});
        const started = await call('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pve' });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        await finishFight(String(started.body.runId), exit === 'escape' ? 'fled' : 'loss');
        const left = await call('combatSettle', { runId: started.body.runId });
        assert.equal(left.status, 200, JSON.stringify(left.body));
        assert.equal(left.body.won, false);
        assert.equal(left.body[exit === 'escape' ? 'escaped' : 'revived'], true);
        const run = (await kv.get<HollowGateRunToken>(runKey))!;
        assert.equal(run.activeEncounter, null);
        assert.equal((run.resolvedEncounterIds ?? []).includes(`1:battle:${HOUND.node}`), false, 'the Hound is not cleared');
        const ryoAfterLeaving = (await kv.get<{ character: { ryo: number } }>(saveKey))!.character.ryo;
        assert.equal(ryoAfterLeaving, 400, 'leaving pays nothing');

        const off = await step([HOUND.x, HOUND.y], [HOUND.x - 1, HOUND.y]);
        assert.equal(off.status, 200, `the player can step off the tile: ${JSON.stringify(off.body)}`);

        // Stepping back on raises the same Hound again. Beating it clears the
        // node and pays exactly one encounter reward.
        assert.equal((await step([HOUND.x - 1, HOUND.y], [HOUND.x, HOUND.y])).status, 200);
        const again = await call('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pve' });
        assert.equal(again.status, 200, JSON.stringify(again.body));
        assert.notEqual(again.body.runId, started.body.runId);
        await finishFight(String(again.body.runId), 'win');
        const won = await call('combatSettle', { runId: again.body.runId });
        assert.equal(won.status, 200, JSON.stringify(won.body));
        assert.equal(won.body.won, true);
        const reward = Math.floor(hollowGateCombatReward(1, 'battle').ryo * rewardMultiplierForToken(run));
        assert.equal((await kv.get<{ character: { ryo: number } }>(saveKey))!.character.ryo, 400 + reward);
        assert.equal((await call('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pve' })).status, 409,
            'a cleared Hound cannot be farmed');
    });
}

test('an unresolved Hound the player never fought still holds the tile, and names itself so it can reopen', async () => {
    // e.g. the fight's start request dropped after the step onto the tile
    // committed. The tile will not fire again until it is stepped onto, so the
    // refusal must tell the browser which encounter to open.
    await seed();
    const refused = await step([HOUND.x, HOUND.y], [HOUND.x - 1, HOUND.y]);
    assert.equal(refused.status, 409);
    assert.match(String(refused.body.error), /Resolve the sealed combat node/);
    assert.deepEqual(refused.body.sealedCombat, { nodeId: HOUND.node, kind: 'battle' });
    assert.deepEqual(refused.body.position, { x: HOUND.x, y: HOUND.y });
    const reopened = await call('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pve' });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
});

test('a pet duel that never began is fought as a shinobi instead, for the same encounter', async () => {
    await seed();
    const pet = await call('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pet' });
    assert.equal(pet.status, 200, JSON.stringify(pet.body));
    assert.equal(pet.body.combatMode, 'pet');
    const petRunId = String(pet.body.runId);
    assert.ok(await kv.get(hollowGateCombatBindingKey(petRunId)));

    const shinobi = await call('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pve' });
    assert.equal(shinobi.status, 200, JSON.stringify(shinobi.body));
    assert.equal(shinobi.body.combatMode, 'solo-pve');
    assert.ok(shinobi.body.session, 'the replacement fight is sealed on the server');
    assert.notEqual(shinobi.body.runId, petRunId);
    assert.equal(await kv.get(hollowGateCombatBindingKey(petRunId)), null, 'the untouched pet duel is retired');
    const run = (await kv.get<HollowGateRunToken>(runKey))!;
    assert.equal(run.activeEncounter?.runId, shinobi.body.runId);

    // The retired pet duel can never settle or pay afterwards.
    assert.equal((await call('combatSettle', { runId: petRunId, petReceipt: 'anyreceipt01' })).status, 404);
    await finishFight(String(shinobi.body.runId), 'win');
    const won = await call('combatSettle', { runId: shinobi.body.runId });
    assert.equal(won.status, 200, JSON.stringify(won.body));
    const reward = Math.floor(hollowGateCombatReward(1, 'battle').ryo * rewardMultiplierForToken(run));
    assert.equal((await kv.get<{ character: { ryo: number } }>(saveKey))!.character.ryo, 400 + reward);
    assert.equal((await step([HOUND.x, HOUND.y], [HOUND.x - 1, HOUND.y])).status, 200);
});

test('a threat-ambush pet duel falls back the same way', async () => {
    const nodeId = 'floor:1:ambush:threat-v4';
    await seed({ position: { x: 1, y: 1 }, pendingAmbush: { nodeId, kind: 'ambush' } });
    const pet = await call('combatStart', { floor: 1, kind: 'ambush', nodeId, mode: 'pet' });
    assert.equal(pet.status, 200, JSON.stringify(pet.body));
    assert.equal((await kv.get<HollowGateRunToken>(runKey))!.pendingAmbush, null, 'the pet duel consumed the sealed ambush');
    const shinobi = await call('combatStart', { floor: 1, kind: 'ambush', nodeId, mode: 'pve' });
    assert.equal(shinobi.status, 200, JSON.stringify(shinobi.body));
    assert.equal(shinobi.body.combatMode, 'solo-pve');
    // A different ambush identity still needs its own sealed threat.
    assert.equal((await call('combatStart', { floor: 1, kind: 'ambush', nodeId: 'floor:1:ambush:threat-v9', mode: 'pve' })).status, 409);
});

// A binding sealed before the Showdown cutover carries a cinematic proof, whose
// child evidence is a cinematic lease rather than a Showdown session.
for (const [engine, evidence] of [['showdown', 'session'], ['showdown', 'receipt'], ['cinematic', 'lease'], ['cinematic', 'receipt']] as const) {
    test(`a ${engine} pet duel with a ${evidence} is never swapped for a shinobi fight`, async () => {
        await seed();
        const pet = await call('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pet' });
        assert.equal(pet.status, 200, JSON.stringify(pet.body));
        const bindingKey = hollowGateCombatBindingKey(String(pet.body.runId));
        const issued = (await kv.get<HollowGateCombatBinding>(bindingKey))!;
        assert.equal(issued.petAuthority?.engine, 'showdown', 'a new pet encounter is mounted on Showdown');
        const binding: HollowGateCombatBinding = { ...issued, petAuthority: { ...issued.petAuthority!, engine } };
        await kv.set(bindingKey, binding);
        const proofId = binding.petAuthority!.proofId;
        if (evidence === 'session') await kv.set(`pet:showdown:${PLAYER}:${proofId}`, { sessionId: proofId, playerName: PLAYER, finished: false });
        else if (evidence === 'lease') await kv.set(`pet:battle-token:${PLAYER}:${proofId}`, { playerName: PLAYER, hollowGate: { runId: binding.runId } });
        else await kv.set(hollowGatePetResultKey(PLAYER, proofId), { outcome: 'loss' });

        const refused = await call('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pve' });
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.deepEqual(await kv.get(bindingKey), binding, 'the begun pet duel stays the only authority');
        assert.equal((await kv.get<HollowGateRunToken>(runKey))!.activeEncounter?.runId, binding.runId);
    });
}

test('an untouched pet duel sealed before the Showdown cutover still falls back to a shinobi fight', async () => {
    await seed();
    const pet = await call('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pet' });
    const bindingKey = hollowGateCombatBindingKey(String(pet.body.runId));
    const issued = (await kv.get<HollowGateCombatBinding>(bindingKey))!;
    await kv.set(bindingKey, { ...issued, petAuthority: { ...issued.petAuthority!, engine: 'cinematic' } });
    const shinobi = await call('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pve' });
    assert.equal(shinobi.status, 200, JSON.stringify(shinobi.body));
    assert.equal(shinobi.body.combatMode, 'solo-pve');
    assert.equal(await kv.get(bindingKey), null);
});
