/*
 * A wild fight is fought under the sector's sky.
 *
 * The sector plate names a sky and its combat terms ("Water damage +5%. Fire
 * damage -2%."), and missions, PvP and wild-pet encounters seal them. World
 * encounters, exploration and raid fights used to seal no weather at all, so
 * the plate promised modifiers those fights never applied while the board still
 * drew the rain. These cases drive the real start route and read the SEALED
 * session, which is what the engine resolves damage from.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolveSectorWeather, sectorWeatherElements } from '../../shared/sector-weather.js';
import { sectorBiomeOf } from '../../shared/sector-geo.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'ai-fight-sector-weather-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };
type SealedEnvironment = { biome?: string; weatherPositiveElement?: string; weatherNegativeElement?: string };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let startHandler: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    startHandler = (await import('./ai-fight-start.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function character(name: string, extra: Record<string, unknown> = {}) {
    return {
        name,
        level: 20,
        rankTitle: 'Genin',
        specialty: 'Ninjutsu',
        hp: 600, maxHp: 600, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300,
        // A wanderer ambush only finds a shinobi with a robbery streak behind them.
        robberStreak: 5,
        inventory: [],
        itemStacks: [],
        stats: {
            strength: 100, speed: 100, intelligence: 140, willpower: 120,
            ninjutsuOffense: 300, ninjutsuDefense: 250, taijutsuOffense: 100, taijutsuDefense: 100,
            bukijutsuOffense: 100, bukijutsuDefense: 100, genjutsuOffense: 100, genjutsuDefense: 100,
        },
        equippedJutsuIds: ['starter-universal-flicker'],
        ...extra,
    };
}

async function seedSave(name: string, sector: number, extra: Record<string, unknown> = {}) {
    await kv.set(`save:${name}`, {
        _saveVersion: 1,
        currentSector: sector,
        acceptedMissionIds: [],
        missionProgress: {},
        savedBloodlines: [],
        creatorJutsus: [],
        character: character(name, extra),
    });
}

/** A clan holding the sector with a stamped sky — deterministic, unlike the schedule. */
async function stampSky(sector: number, weather: string) {
    await kv.set(`world:territory:${sector}`, { ownerClan: 'Weather Test Clan', ownerVillage: 'Stormveil Village', weather });
}

async function start(name: string, body: Record<string, unknown>, address: string) {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await startHandler({
        method: 'POST',
        body: { playerName: name, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(name) ?? '' },
        socket: { remoteAddress: address },
    } as never, res as never);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    return ((out.body?.session as Record<string, unknown>)?.environment ?? {}) as SealedEnvironment;
}

test('a world encounter seals the sector sky a holding clan has stamped', async () => {
    const name = 'wildweatherstamp';
    await seedSave(name, 2);
    await stampSky(2, 'ashfall');
    const env = await start(name, { worldEncounter: { kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 2, stage: 0 } }, '127.6.0.1');
    assert.equal(env.weatherPositiveElement, 'Fire');
    assert.equal(env.weatherNegativeElement, 'Water');
    assert.equal(env.biome, sectorBiomeOf(2), 'the board stays on the sector\'s own ground');
});

test('a world encounter on an unheld sector seals the scheduled sky of the moment it starts', async () => {
    const name = 'wildweathersched';
    const sector = 9;
    await seedSave(name, sector);
    const skyAt = (ms: number) => sectorWeatherElements(resolveSectorWeather(sectorBiomeOf(sector), sector, ms));
    const before = skyAt(Date.now());
    const env = await start(name, { worldEncounter: { kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector, stage: 0 } }, '127.6.0.2');
    const afterwards = skyAt(Date.now());
    // A weather window may turn between the two reads; the seal must be one of them.
    assert.ok(
        [before, afterwards].some((sky) => sky.positiveElement === env.weatherPositiveElement && sky.negativeElement === env.weatherNegativeElement),
        `sealed ${JSON.stringify(env)} is not the sector's scheduled sky ${JSON.stringify([before, afterwards])}`,
    );
});

test('an exploration fight seals the sky of the sector its receipt proved', async () => {
    const name = 'wildweatherexplore';
    const sector = 61;
    await seedSave(name, sector, {
        redeemedSectorExplorations: [{ id: 'weatherexplore01', sector, at: Date.now(), outcome: { kind: 'battle' } }],
    });
    await stampSky(sector, 'thunderstorm');
    const env = await start(name, { battleKind: 'explore', sector, worldExploreRequestId: 'weatherexplore01' }, '127.6.0.3');
    assert.equal(env.weatherPositiveElement, 'Lightning');
    assert.equal(env.weatherNegativeElement, 'Wind');
    assert.equal(env.biome, 'central', 'an exploration fight keeps its central board; only the sky is added');
});

test('a practice bout stays weatherless even while the player stands under a stamped sky', async () => {
    const name = 'wildweatherspar';
    await seedSave(name, 14);
    await stampSky(14, 'rain');
    const env = await start(name, { battleKind: 'practice', opponentId: 'builtin-ai-exam-proctor', opponentLevel: 25 }, '127.6.0.4');
    assert.equal(env.weatherPositiveElement, undefined);
    assert.equal(env.weatherNegativeElement, undefined);
    assert.equal(env.biome, 'central');
});
