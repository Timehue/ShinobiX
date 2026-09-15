import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, beforeEach, test, type TestContext } from 'node:test';
import type { HollowGateRunToken } from './_run-token.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
delete process.env.ADMIN_PASSWORD;
delete process.env.ENABLE_LEGACY;
delete process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;

type Character = Record<string, unknown>;
type Save = { _saveVersion: number; character: Character };
type Handler = (req: never, res: never) => Promise<unknown>;
type Response = { status: number; body?: Record<string, unknown> };
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let credits: typeof import('./_external-credits.js');

before(async () => {
    const storage = await import('../_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa');
    kv = storage.kv;
    ({ issuePlayerToken } = await import('../_auth.js'));
    credits = await import('./_external-credits.js');
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

async function call(handler: Handler, name: string, body: Record<string, unknown>): Promise<Response> {
    const token = issuePlayerToken(name);
    assert.ok(token);
    const result: Response = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { result.status = status; return res; },
        json: (response: Record<string, unknown>) => { result.body = response; return res; },
        end: () => res,
    };
    await handler({ method: 'POST', body: { ...body, playerName: name }, query: { name },
        headers: { 'x-player-name': name, 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return result;
}

async function preparedRun(label: string) {
    const name = `hgintegration${label}`;
    const token = `integration-token-${label}`;
    const runKey = `hg-run:${name}:${token}`;
    const saveKey = `save:${name}`;
    const { HG_CLAWBACK_KEYS } = await import('./_run-token.js');
    const wallets = (n: number) => Object.fromEntries(HG_CLAWBACK_KEYS.map(key => [key, n]));
    const run: HollowGateRunToken = {
        playerName: name, mintedAt: Date.now() - 240_000, floorDepth: 5, currentFloor: 1,
        seed: label, entryCurrencies: wallets(1000), entryItems: {},
        offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
        rewardLedger: { currencies: wallets(200), items: {}, sourceIds: ['prepared-server-reward'] },
        resolvedEventIds: [], recentConsumableIds: [],
    };
    const initial: Character = {
        name, level: 20, hp: 500, maxHp: 500, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        ...wallets(1200), inventory: [], itemStacks: [{ itemId: 'hollow-gate-key', count: 2 }],
        hollowGateRun: { runToken: token, currentFloor: 1 },
        lastHollowGateStart: { requestId: `original-start-${label}`, token, at: Date.now() - 240_000 },
    };
    const character = credits.recordHollowGateExternalCredits(initial, { ...initial, ...wallets(1290) });
    const save: Save = { _saveVersion: 10, character };
    await kv.set(saveKey, save);
    await kv.set(runKey, run);
    return { name, token, runKey, saveKey, run, save, keys: HG_CLAWBACK_KEYS };
}

/** Fault the ACK only after the production memory CAS committed, then make
 * that writer's first readback unavailable. Later reads work normally. */
function loseCommitAndFirstReadback(t: TestContext, saveKey: string) {
    const compare = kv.compareSet.bind(kv);
    const get = kv.get.bind(kv);
    let committed = false;
    let readbackPending = false;
    let readbackFailed = false;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        const result = await compare(...args);
        if (args[0] === saveKey && result && !committed) {
            committed = true;
            readbackPending = true;
            throw new Error('injected committed save acknowledgement loss');
        }
        return result;
    });
    t.mock.method(kv, 'get', (async <T>(key: string): Promise<T | null> => {
        if (key === saveKey && readbackPending) {
            readbackPending = false;
            readbackFailed = true;
            throw new Error('injected immediate save readback failure');
        }
        return get<T>(key);
    }) as typeof kv.get);
    return () => {
        assert.equal(committed, true, 'the wallet CAS really committed');
        assert.equal(readbackFailed, true, 'the immediate recovery read really failed');
    };
}

function rejectBeforeCommit(t: TestContext, saveKey: string) {
    const compare = kv.compareSet.bind(kv);
    let refused = false;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        if (args[0] === saveKey && !refused) { refused = true; return false; }
        return compare(...args);
    });
    return () => assert.equal(refused, true, 'the save CAS was refused before commitment');
}

async function prepareTrap(label: string, secondWind: boolean) {
    const f = await preparedRun(label);
    f.save.character.hp = 1;
    await kv.set(f.saveKey, f.save);
    const run: HollowGateRunToken = { ...f.run, secondWindArmed: secondWind,
        position: { x: 11, y: 1 }, floorManifests: { '1': {
            floor: 1, width: 15, height: 11, spawn: { x: 1, y: 1 }, walkable: '1'.repeat(165), nodes: { '26': 'trap' },
        } } };
    await kv.set(f.runKey, run);
    await kv.set(`hg-event-roll:${f.name}:${f.token}:event:1:trap:floor:1:tile:26`, { action: 'trap', credit: {} });
    return { ...f, run };
}

for (const secondWind of [false, true]) for (const commit of [false, true]) {
    test(`trap ${secondWind ? 'revival' : 'death'}: ${commit ? 'uncertain committed' : 'refused'} save recovers exactly once`, async t => {
        const f = await prepareTrap(`trap${secondWind}${commit}`, secondWind);
        const event = (await import('./event.js')).default as unknown as Handler;
        const assertFault = commit ? loseCommitAndFirstReadback(t, f.saveKey) : rejectBeforeCommit(t, f.saveKey);
        const request = { token: f.token, action: 'trap', nodeId: 'floor:1:tile:26' };
        assert.equal((await call(event, f.name, request)).status, 500);
        assertFault();
        if (!commit) {
            assert.deepEqual(await kv.get(f.saveKey), f.save, 'refused save leaves vitals, wallet and proof unchanged');
            assert.deepEqual(await kv.get(f.runKey), f.run, 'refused save cannot consume trap or Second Wind');
        }
        const retry = await call(event, f.name, request);
        assert.equal(retry.status, 200, String(retry.body?.error));
        const after = (await kv.get<Save>(f.saveKey))!;
        assert.equal(after._saveVersion, f.save._saveVersion + 1);
        assert.equal(after.character.hp, secondWind ? 250 : 0);
        for (const key of f.keys) assert.equal(after.character[key], secondWind ? 1290 : 1190, key);
        assert.equal(retry.body?.revived, secondWind);
        assert.equal(retry.body?.ended, !secondWind);
        const third = await call(event, f.name, request);
        assert.equal(third.status, 200, String(third.body?.error));
        assert.deepEqual(await kv.get(f.saveKey), after, 'repeated retry does not apply damage, revive or settlement twice');
        if (secondWind) assert.equal((await kv.get<HollowGateRunToken>(f.runKey))!.secondWindArmed, false);
        else assert.equal(await kv.get(f.runKey), null);
    });
}

test('refused Sanctify save leaves its cost, checkpoint, and run ledger untouched until one successful retry', async t => {
    const f = await preparedRun('refusedsanctify');
    const consumable = (await import('./use-consumable.js')).default as unknown as Handler;
    const assertFault = rejectBeforeCommit(t, f.saveKey);
    const request = { token: f.token, action: 'sanctify', requestId: 'refused-sanctify-request' };
    assert.equal((await call(consumable, f.name, request)).status, 500);
    assertFault();
    assert.deepEqual(await kv.get(f.saveKey), f.save);
    assert.deepEqual(await kv.get(f.runKey), f.run, 'no free checkpoint or lost run rewards');
    assert.equal((await call(consumable, f.name, request)).status, 200);
    const committed = (await kv.get<Save>(f.saveKey))!;
    assert.equal(committed.character.hollowShards, 1276);
    assert.deepEqual(credits.hollowGateCreditBasis(committed.character), { runToken: f.token, checkpointVersion: 1 });
    assert.equal((await call(consumable, f.name, request)).status, 200);
    assert.deepEqual(await kv.get(f.saveKey), committed);
});

for (const won of [false, true]) for (const commit of [false, true]) {
    test(`pet ${won ? 'win' : 'defeat'}: ${commit ? 'uncertain committed' : 'refused'} save settles once`, async t => {
        const f = await preparedRun(`pet${won}${commit}`);
        const { createHollowGateCombatBinding, hollowGateCombatBindingKey } = await import('./_combat-session.js');
        const { hollowGatePetResultKey } = await import('./_pet-authority.js');
        const binding = createHollowGateCombatBinding({ playerName: f.name, token: f.token, floor: 1,
            nodeId: 'floor:1:tile:20', kind: 'battle', combatMode: 'pet', runId: `pet-proof-${won}-${commit}` });
        const proofId = binding.petAuthority!.proofId;
        const run = { ...f.run, activeEncounter: binding };
        await kv.set(f.runKey, run);
        await kv.set(hollowGateCombatBindingKey(binding.runId), binding);
        await kv.set(hollowGatePetResultKey(f.name, proofId), { version: 1, engine: 'cinematic', proofId,
            playerName: f.name, runId: binding.runId, outcome: won ? 'win' : 'loss', playerPetIds: [], settledAt: Date.now() });
        const combat = (await import('./combat-settle.js')).default as unknown as Handler;
        const assertFault = commit ? loseCommitAndFirstReadback(t, f.saveKey) : rejectBeforeCommit(t, f.saveKey);
        const request = { token: f.token, runId: binding.runId, petReceipt: proofId };
        assert.equal((await call(combat, f.name, request)).status, 500);
        assertFault();
        if (!commit) {
            assert.deepEqual(await kv.get(f.saveKey), f.save);
            assert.deepEqual(await kv.get(f.runKey), run, 'a refused pet result cannot clear the encounter');
        }
        const retry = await call(combat, f.name, request);
        assert.equal(retry.status, 200, String(retry.body?.error));
        assert.equal(retry.body?.petDefeat, !won);
        const after = (await kv.get<Save>(f.saveKey))!;
        assert.equal(after._saveVersion, f.save._saveVersion + 1);
        assert.ok(after.character.hollowGateRun, 'pet defeat never kills the player run');
        assert.equal((await kv.get<HollowGateRunToken>(f.runKey))!.activeEncounter, null);
        assert.equal(after.character.hp, won ? 500 : 400);
        assert.deepEqual(after.character.hollowGateExternalCredits, f.save.character.hollowGateExternalCredits);
        assert.equal((await call(combat, f.name, request)).status, 200);
        assert.deepEqual(await kv.get(f.saveKey), after);
    });
}

test('chest retry after committed CAS and unavailable readback pays the sealed reward once', async t => {
    const f = await preparedRun('chest');
    const { validateHollowGateFloorManifest } = await import('./_floor-manifest.js');
    const tiles = Array.from({ length: 165 }, () => ({ kind: 'empty', terrain: 'room_floor' }));
    let index = 20;
    for (const [kind, count] of [['battle', 5], ['elite', 1], ['trap', 1], ['chest', 3], ['shard_vein', 1],
        ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1]] as const) {
        for (let n = 0; n < count; n++) tiles[index++].kind = kind;
    }
    tiles[136].kind = 'exit';
    tiles[148].kind = 'descend';
    const floor = validateHollowGateFloorManifest({ floor: 1, finalFloor: false, width: 15, height: 11,
        playerX: 1, playerY: 1, tiles });
    assert.equal(floor.ok, true);
    await kv.set(f.runKey, { ...f.run, floorManifests: { '1': floor.manifest }, position: { x: 12, y: 1 } });
    const sourceId = 'event:1:chest:floor:1:tile:27';
    await kv.set(`hg-event-roll:${f.name}:${f.token}:${sourceId}`, { action: 'chest', credit: { currencies: { ryo: 100 } } });
    const event = (await import('./event.js')).default as unknown as Handler;
    const assertFault = loseCommitAndFirstReadback(t, f.saveKey);
    const request = { token: f.token, action: 'chest', nodeId: 'floor:1:tile:27' };
    const first = await call(event, f.name, request);
    assertFault();
    assert.ok(first.status === 200 || first.status === 500 || first.status === 503);
    const committed = (await kv.get<Save>(f.saveKey))!;
    assert.equal(committed.character.ryo, 1390);
    const retry = await call(event, f.name, request);
    assert.equal(retry.status, 200, String(retry.body?.error));
    const after = (await kv.get<Save>(f.saveKey))!;
    t.diagnostic(JSON.stringify({ case: 'chest', firstStatus: first.status, retryStatus: retry.status,
        committedRyo: committed.character.ryo, retryRyo: after.character.ryo,
        committedVersion: committed._saveVersion, retryVersion: after._saveVersion }));
    assert.equal(after.character.ryo, committed.character.ryo, 'a committed chest must not pay again');
    assert.equal(after._saveVersion, committed._saveVersion);
    assert.deepEqual(after.character.hollowGateExternalCredits, f.save.character.hollowGateExternalCredits);
    assert.equal((await kv.get<HollowGateRunToken>(f.runKey))!.rewardLedger!.currencies.ryo, 300);
});

test('Sanctify retry after committed CAS and unavailable readback charges and advances its checkpoint once', async t => {
    const f = await preparedRun('sanctify');
    const consumable = (await import('./use-consumable.js')).default as unknown as Handler;
    const assertFault = loseCommitAndFirstReadback(t, f.saveKey);
    const request = { token: f.token, action: 'sanctify', requestId: 'integration-sanctify-request' };
    const first = await call(consumable, f.name, request);
    assertFault();
    assert.ok(first.status === 200 || first.status === 500 || first.status === 503);
    const committed = (await kv.get<Save>(f.saveKey))!;
    assert.equal(committed.character.hollowShards, 1276);
    assert.deepEqual(credits.hollowGateCreditBasis(committed.character), { runToken: f.token, checkpointVersion: 1 });
    const retry = await call(consumable, f.name, request);
    assert.equal(retry.status, 200, String(retry.body?.error));
    const after = (await kv.get<Save>(f.saveKey))!;
    t.diagnostic(JSON.stringify({ case: 'sanctify', firstStatus: first.status, retryStatus: retry.status,
        committedShards: committed.character.hollowShards, retryShards: after.character.hollowShards,
        committedCheckpoint: credits.hollowGateCreditBasis(committed.character)?.checkpointVersion,
        retryCheckpoint: credits.hollowGateCreditBasis(after.character)?.checkpointVersion }));
    assert.equal(after.character.hollowShards, committed.character.hollowShards, 'a committed Sanctify must not charge twice');
    assert.equal(after._saveVersion, committed._saveVersion);
    assert.deepEqual(credits.hollowGateCreditBasis(after.character), { runToken: f.token, checkpointVersion: 1 });
    assert.deepEqual(credits.hollowGateExternalCredits(after.character, f.token), {});
    assert.equal((await kv.get<HollowGateRunToken>(f.runKey))!.entryCurrencies.hollowShards, 1276);
});

for (const outcome of ['win', 'death', 'revived'] as const) test(`verified Solo PvE ${outcome} retry after committed CAS and unavailable readback settles once`, async t => {
    const f = await preparedRun(`combat${outcome}`);
    const { createHollowGateCombatBinding, hollowGateCombatBindingKey } = await import('./_combat-session.js');
    const { createSoloPveSession } = await import('../solo-pve/_session.js');
    const { soloPveSessionKey } = await import('../solo-pve/_store.js');
    const binding = createHollowGateCombatBinding({ playerName: f.name, token: f.token, floor: 1,
        nodeId: 'floor:1:tile:20', kind: 'battle', runId: `integration-solo-pve-${outcome}`, secondWindArmed: outcome === 'revived' });
    const fighter = (name: string, hp: number) => ({ name, hp, maxHp: 500, chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100, shield: 0, statuses: [],
        character: { name, level: 20, stats: {}, jutsu: [], jutsuMastery: [] }, pos: 0 });
    const session = createSoloPveSession({ sessionId: binding.runId, ownerSlug: f.name,
        encounter: { kind: 'hollow-gate', id: 'gate', bindingId: binding.runId, sourceId: binding.enemyProfileId,
            metadata: { floor: 1, nodeId: binding.nodeId, combatKind: binding.kind } },
        player: fighter(f.name, outcome === 'win' ? 400 : 0), enemy: fighter('hound', outcome === 'win' ? 0 : 500), now: Date.now(),
    });
    session.status = 'done'; session.outcome = outcome === 'win' ? 'win' : 'loss'; session.winner = outcome === 'win' ? 'player' : 'enemy'; session.settlementState = 'pending';
    session.terminalEvidence = { finishedAt: Date.now(), finalMoveToken: 'prepared-terminal-move',
        finalVersion: session.version, finalEventSeq: 0, winner: session.winner, outcome: session.outcome, itemsUsed: {}, settlementState: 'pending' };
    await kv.set(f.runKey, { ...f.run, activeEncounter: binding });
    await kv.set(hollowGateCombatBindingKey(binding.runId), binding);
    await kv.set(soloPveSessionKey(binding.runId), session);
    const combat = (await import('./combat-settle.js')).default as unknown as Handler;
    const assertFault = loseCommitAndFirstReadback(t, f.saveKey);
    const request = { token: f.token, runId: binding.runId };
    const first = await call(combat, f.name, request);
    assertFault();
    assert.ok(first.status === 200 || first.status === 500 || first.status === 503);
    const committed = (await kv.get<Save>(f.saveKey))!;
    if (outcome === 'win') assert.ok(Number(committed.character.ryo) > Number(f.save.character.ryo));
    else assert.equal(committed.character.ryo, outcome === 'death' ? 1190 : 1290);
    const retry = await call(combat, f.name, request);
    assert.equal(retry.status, 200, String(retry.body?.error));
    const after = (await kv.get<Save>(f.saveKey))!;
    t.diagnostic(JSON.stringify({ case: 'combat', firstStatus: first.status, retryStatus: retry.status,
        committedRyo: committed.character.ryo, retryRyo: after.character.ryo,
        committedVersion: committed._saveVersion, retryVersion: after._saveVersion }));
    for (const key of f.keys) assert.equal(after.character[key], committed.character[key], `a committed combat reward must not pay ${key} again`);
    assert.equal(after._saveVersion, committed._saveVersion);
    assert.deepEqual(after.character.hollowGateExternalCredits, outcome === 'death' ? null : f.save.character.hollowGateExternalCredits);
    assert.equal((await kv.get<{ settlementState: string }>(soloPveSessionKey(binding.runId)))!.settlementState, 'settled');
    assert.equal((await call(combat, f.name, request)).status, 200);
    assert.deepEqual(await kv.get(f.saveKey), after);
});

test('a paid old combat receipt cannot be paired with a newer run token to delete that dive', async () => {
    const f = await preparedRun('wrongcombatbinding');
    const { createHollowGateCombatBinding, hollowGateCombatBindingKey, hollowGateCombatReward } = await import('./_combat-session.js');
    const oldToken = 'old-combat-token';
    const binding = createHollowGateCombatBinding({ playerName: f.name, token: oldToken, floor: 1,
        nodeId: 'floor:1:tile:20', kind: 'battle', runId: 'old-paid-combat' });
    binding.status = 'lost'; binding.settledAt = Date.now();
    const run = { ...f.run, secondWindArmed: true, resolvedEncounterIds: ['1:battle:floor:1:tile:20'] };
    f.save.character.settledHollowGateCombatIds = [binding.runId];
    await kv.set(f.saveKey, f.save);
    await kv.set(f.runKey, run);
    await kv.set(hollowGateCombatBindingKey(binding.runId), binding);
    await kv.set(`hg-combat-paid:${binding.runId}`, { version: 2, won: false,
        reward: hollowGateCombatReward(1, 'battle', undefined), elementalShards: 0, settledAt: binding.settledAt });
    const combat = (await import('./combat-settle.js')).default as unknown as Handler;
    assert.equal((await call(combat, f.name, { token: f.token, runId: binding.runId })).status, 409);
    assert.deepEqual(await kv.get(f.runKey), run);
    assert.deepEqual(await kv.get(f.saveKey), f.save);
    assert.equal((await call(combat, f.name, { token: oldToken, runId: binding.runId })).status, 200, 'the exact old-token replay remains readable');
    assert.deepEqual(await kv.get(f.runKey), run);
    assert.deepEqual(await kv.get(f.saveKey), f.save);
});
