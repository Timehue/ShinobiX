/*
 * An ANBU vault infiltration is fought on a war sector, under that sector's sky.
 *
 * The defender's Kage-set terrain is the board (unchanged); the weather above
 * it is the sector's own, sealed at start by the same shared helper every other
 * wild-sector fight uses (api/_sector-weather-seal.ts). These cases drive the
 * real start route and read the SEALED session the engine resolves damage from.
 *
 * They start as admin on purpose: admin skips the stronghold walk to the vault,
 * the level gate and the daily attempt, none of which this file is about.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { resolveSectorWeather, sectorWeatherElements } from '../../shared/sector-weather.js';
import { sectorBiomeOf } from '../../shared/sector-geo.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'anbu-weather-test-admin';
process.env.SESSION_SECRET = 'anbu-weather-test-secret-32-bytes-long';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const SECTOR = 12;
const TARGET = 'Frostfang Village';
const TERRITORY_KEY = `world:territory:${SECTOR}`;
const RAIDER = 'vaultweatherraider';
const ANBU = 'vaultweatheranbu';

let kv: typeof import('../_storage.js').kv;
let handler: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./anbu-infiltration.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function seed(territory: Record<string, unknown>) {
    await kv.set(TERRITORY_KEY, { sector: SECTOR, ownerVillage: TARGET, ...territory });
    await kv.set(`save:${RAIDER}`, {
        _saveVersion: 1,
        character: {
            name: RAIDER, village: 'Moonshadow Village', level: 100,
            maxHp: 9000, hp: 9000, maxChakra: 500, chakra: 500, maxStamina: 500, stamina: 500,
            stats: {}, jutsu: [], pvpItems: [], equipment: {}, inventory: [], itemStacks: [],
        },
    });
    await kv.set('game:village-state:frostfangvillage', { anbuAppointees: [ANBU] });
    await kv.set(`save:${ANBU}`, {
        character: {
            name: 'Frostfang Anbu', village: TARGET, level: 100,
            maxHp: 12000, hp: 12000, maxChakra: 1000, maxStamina: 1000,
            stats: {}, jutsu: [], pvpItems: [], equipment: {},
        },
    });
}

async function start(): Promise<Record<string, unknown>> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { action: 'start', playerName: RAIDER, sector: SECTOR },
        headers: { 'x-admin-password': 'anbu-weather-test-admin' },
        socket: { remoteAddress: '127.7.0.1' },
    } as never, res as never);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    return (out.body?.session as { environment: Record<string, unknown> }).environment;
}

test('a vault infiltration seals the sky a holding clan has stamped on the sector', async () => {
    await seed({ ownerClan: 'Frost Wardens', weather: 'ashfall' });
    const env = await start();
    assert.equal(env.weatherPositiveElement, 'Fire');
    assert.equal(env.weatherNegativeElement, 'Water');
});

test('a vault infiltration on an unheld sector seals its scheduled sky at the moment it starts', async () => {
    await seed({});
    const territory = await kv.get<Record<string, unknown>>(TERRITORY_KEY);
    const skyAt = (ms: number) => sectorWeatherElements(resolveSectorWeather(sectorBiomeOf(SECTOR), SECTOR, ms, territory));
    const before = skyAt(Date.now());
    const env = await start();
    const afterwards = skyAt(Date.now());
    // A sealed clear sky is still a string; undefined would mean nothing was sealed.
    assert.equal(typeof env.weatherPositiveElement, 'string');
    assert.ok(
        [before, afterwards].some((sky) => sky.positiveElement === env.weatherPositiveElement && sky.negativeElement === env.weatherNegativeElement),
        `sealed ${JSON.stringify(env)} is not the sector's scheduled sky ${JSON.stringify([before, afterwards])}`,
    );
});
