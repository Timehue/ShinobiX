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
    assert.equal(output.out.body?._saveVersion, 2);
    const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    assert.equal(save?.currentSector, 2);
    assert.equal(save?.pendingTravel, null);
    assert.equal(save?._saveVersion, 2);
    assert.equal(await getTravelLease(playerName), null);
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
