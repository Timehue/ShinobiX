import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'ai-fight-travel-arrival-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let setTravelLease: typeof import('../_realtime/travel-lease.js').setTravelLease;
let getTravelLease: typeof import('../_realtime/travel-lease.js').getTravelLease;
let startHandler: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ setTravelLease, getTravelLease } = await import('../_realtime/travel-lease.js'));
    startHandler = (await import('./ai-fight-start.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
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

test('World fight start accepts the destination when its travel lease matured before the save heartbeat', async () => {
    const playerName = 'travelfightarrival';
    const arrivalAt = Date.now() - 100;
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: 1,
        pendingTravel: { destinationSector: 2, arrivalAt },
        acceptedMissionIds: [],
        missionProgress: {},
        savedBloodlines: [],
        creatorJutsus: [],
        character: {
            name: playerName,
            level: 20,
            rankTitle: 'Genin',
            specialty: 'Ninjutsu',
            hp: 600,
            maxHp: 600,
            chakra: 300,
            maxChakra: 300,
            stamina: 300,
            maxStamina: 300,
            robberStreak: 5,
            inventory: [],
            itemStacks: [],
            stats: {
                strength: 100,
                speed: 100,
                intelligence: 140,
                willpower: 120,
                ninjutsuOffense: 300,
                ninjutsuDefense: 250,
                taijutsuOffense: 100,
                taijutsuDefense: 100,
                bukijutsuOffense: 100,
                bukijutsuDefense: 100,
                genjutsuOffense: 100,
                genjutsuDefense: 100,
            },
            equippedJutsuIds: ['starter-universal-flicker'],
        },
    });
    await setTravelLease(playerName, { originSector: 1, destinationSector: 2, arrivalAt, arrivalTile: 55 });

    const output = response();
    await startHandler({
        method: 'POST',
        body: {
            playerName,
            worldEncounter: { kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 2, stage: 0 },
        },
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(playerName) ?? '',
        },
        socket: { remoteAddress: '127.5.0.1' },
    } as never, output.res);

    assert.equal(output.out.statusCode, 200, JSON.stringify(output.out.body));
    assert.equal((output.out.body?.worldContext as Record<string, unknown>)?.sector, 2);
    // Arrival commits v2; combat admission commits settled vitals/cursor as v3.
    assert.equal(output.out.body?._saveVersion, 3);
    const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    assert.equal(save?.currentSector, 2);
    assert.equal(save?.pendingTravel, null);
    assert.equal(save?._saveVersion, 3);
    assert.equal((output.out.body?.session as { player: { hp: number } }).player.hp, 600);
    assert.ok(Number(save?._regenAt) > arrivalAt, 'arrival recovery is committed before combat is sealed');
    assert.ok(Number(save?._regenAt) <= Number(save?._saveAt));
    assert.equal(await getTravelLease(playerName), null);

    // A stale handoff must never replace or mutate an already sealed fight.
    const stale = completedHandoff();
    await kv.set(`save:${playerName}`, { ...save, character: { ...(save?.character as object), ...stale } });
    const resumed = await probe(playerName, '127.5.0.3');
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.body?.sessionId, output.out.body?.sessionId);
    const stillActive = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    assert.deepEqual((stillActive?.character as Record<string, unknown>).worldAiPendingChain, stale.worldAiPendingChain);
    assert.equal(stillActive?._saveVersion, save?._saveVersion);
});

function completedHandoff() {
    const request = { kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 60, chainId: 'finished_chain', stage: 3 };
    return {
        robberStreak: 0,
        worldAiPendingChain: { request, displayName: 'Road Bandit', createdAt: 1 },
        worldAiChainWins: Array.from({ length: 4 }, (_, stage) => ({ ...request, stage, proofId: `finished_proof_${stage}` })),
        worldAiPendingOutcome: { kind: 'wanderer-ambush-reward', claimId: 'ambush:finished_chain:60', chainId: request.chainId, sourceId: request.sourceId, sector: 60, createdAt: 2 },
    };
}

async function probe(playerName: string, address: string) {
    const output = response();
    await startHandler({ method: 'POST', body: { playerName, resumeWorldFight: true, recoveryProbeVersion: 2 },
        headers: { 'x-player-token': issuePlayerToken(playerName) ?? '' }, socket: { remoteAddress: address },
    } as never, output.res);
    return output.out;
}

test('resume repairs a completed stale chain and exposes its unpaid claim without paying or dropping it', async () => {
    const playerName = 'completedchainrecovery';
    const held = completedHandoff();
    await kv.set(`save:${playerName}`, { _saveVersion: 1, currentSector: 61,
        character: { name: playerName, level: 20, hp: 100, maxHp: 100, ryo: 123, ...held } });
    const output = await probe(playerName, '127.5.0.4');
    assert.equal(output.statusCode, 200, JSON.stringify(output.body));
    assert.equal(output.body?.pendingWorldChain, undefined);
    assert.deepEqual(output.body?.pendingWorldOutcome, { ...held.worldAiPendingOutcome, action: 'claim', endpoint: '/api/sector/wanderer-ambush' });
    const saved = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    const character = saved?.character as Record<string, unknown>;
    assert.equal(character.worldAiPendingChain, null);
    assert.deepEqual(character.worldAiPendingOutcome, held.worldAiPendingOutcome);
    assert.deepEqual(character.worldAiChainWins, held.worldAiChainWins);
    assert.equal(character.ryo, 123);
    assert.equal(saved?._saveVersion, 2);
    await probe(playerName, '127.5.0.5');
    assert.equal((await kv.get<Record<string, unknown>>(`save:${playerName}`))?._saveVersion, 2);
});

test('resume retains an unfinished chain despite ineligibility and a different current sector', async () => {
    const playerName = 'unfinishedchainrecovery';
    const held = completedHandoff();
    const character = { name: playerName, ...held, worldAiPendingOutcome: null, worldAiChainWins: held.worldAiChainWins.slice(0, 3) };
    await kv.set(`save:${playerName}`, { _saveVersion: 1, currentSector: 61, character });
    const output = await probe(playerName, '127.5.0.6');
    assert.equal(output.statusCode, 200);
    assert.deepEqual(output.body?.pendingWorldChain, held.worldAiPendingChain);
    assert.deepEqual((await kv.get<Record<string, unknown>>(`save:${playerName}`))?.character, character);
});

test('locked recovery preserves a new unfinished chain that replaces the initial stale snapshot', async () => {
    const playerName = 'replacedchainrecovery';
    const completed = completedHandoff();
    const initial = { _saveVersion: 1, currentSector: 60, character: { name: playerName, ...completed } };
    const replacement = { ...initial, _saveVersion: 2, character: { ...initial.character,
        worldAiPendingChain: { ...completed.worldAiPendingChain,
            request: { ...completed.worldAiPendingChain.request, chainId: 'replacement_chain', stage: 1 } },
    } };
    const saveKey = `save:${playerName}`;
    await kv.set(saveKey, initial);
    const originalGet = kv.get.bind(kv);
    let replaced = false;
    kv.get = (async <T>(key: string) => {
        const snapshot = await originalGet<T>(key);
        if (key === saveKey && !replaced) {
            replaced = true;
            await kv.set(saveKey, replacement);
        }
        return snapshot;
    }) as typeof kv.get;
    try {
        const output = await probe(playerName, '127.5.0.7');
        assert.equal(replaced, true);
        assert.equal(output.statusCode, 200);
        assert.deepEqual(output.body?.pendingWorldChain, replacement.character.worldAiPendingChain);
        const saved = await originalGet<Record<string, unknown>>(saveKey);
        assert.equal(saved?._saveVersion, 2, 'stale observation must not cause a write');
        assert.deepEqual(saved?.character, replacement.character);
    } finally { kv.get = originalGet; }
});

test('a recovery-only probe does not settle travel without returning a save version', async () => {
    const playerName = 'travelrecoveryprobe';
    const arrivalAt = Date.now() - 100;
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: 1,
        pendingTravel: { destinationSector: 2, arrivalAt },
        character: { name: playerName },
    });
    await setTravelLease(playerName, { originSector: 1, destinationSector: 2, arrivalAt });

    const output = response();
    await startHandler({
        method: 'POST',
        body: { playerName, resumeWorldFight: true, recoveryProbeVersion: 2 },
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(playerName) ?? '',
        },
        socket: { remoteAddress: '127.5.0.2' },
    } as never, output.res);

    assert.equal(output.out.statusCode, 204);
    const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    assert.equal(save?.currentSector, 1);
    assert.equal(save?._saveVersion, 1);
    assert.ok(await getTravelLease(playerName));
});
