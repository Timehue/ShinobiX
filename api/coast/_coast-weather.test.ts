/*
 * Weather on the Unmapped Coast.
 *
 * The coast had no weather: its fights sealed none, and its screens named none.
 * The owner asked for both halves of what the home map has (2026-11-21, "Yes,
 * add both"): the scheduled sky every sector has, and a holding clan's right to
 * fix the sky over its own sector. These cases prove the coast reads the SAME
 * schedule as the home map with its own ground, who may fix a sky, and that a
 * fight seals a clan's fixed sky only where the server itself placed the fight.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'coast-weather-test-secret';

import { sectorBiomeOf } from '../../shared/sector-geo.js';
import { clanRecordKey } from '../_utils.js';
import { OPEN_COAST_SECTOR_IDS, coastBiomeOf } from '../../shared/coast-world.js';
import { WEATHER_ELEMENTS, biomeWeatherTables, resolveSectorWeather, sectorWeatherElements, type SectorWeather, type SectorWeatherBiome } from '../../shared/sector-weather.js';
import { sealedSectorWeather, sectorWeatherNow } from '../_sector-weather-seal.js';
import { coastPatrolsIn } from './_patrols.js';
import { COAST_CLAIM_WEATHER, COAST_LAND, coastLandViews, coastWeatherStamp, grantCoastClaim, readCoastClaim, setCoastClaimSchool, setCoastClaimWeather } from './_land.js';

const T0 = 1_800_000_000_000;
const STRAND = 102, SEAM = 103;
const CREW = ['founder', 'second', 'third', 'fourth', 'fifth'];

type Handler = (req: never, res: never) => Promise<unknown>;
type Sky = { weatherPositiveElement?: string; weatherNegativeElement?: string };
let kv: typeof import('../_storage.js').kv;
let online: typeof import('../_realtime/online-store.js').onlineStore;
let token: typeof import('../_auth.js').issuePlayerToken;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken: token } = await import('../_auth.js'));
});
beforeEach(async () => {
    for (const pattern of ['coast:*', 'save:*', 'lock:*', 'ratelimit:*', 'pvp:*', 'solo-pve:*', 'player-fp:*', 'player-ip:*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

function character(name: string, clan: string | null) {
    return {
        name, level: 80, clan, village: 'Stormveil Village', rankTitle: 'Jonin', specialty: 'Ninjutsu',
        hp: 9000, maxHp: 9000, chakra: 3000, maxChakra: 3000, stamina: 3000, maxStamina: 3000,
        inventory: [], itemStacks: [], jutsu: [], jutsuMastery: [], stats: {}, equippedJutsuIds: ['starter-universal-flicker'],
    };
}
async function player(name: string, clan: string | null, sector = STRAND) {
    await kv.set(`save:${name}`, {
        _saveVersion: 1, currentSector: sector, acceptedMissionIds: [], missionProgress: {}, savedBloodlines: [], creatorJutsus: [],
        character: character(name, clan),
        questLines: { v: 1, active: {}, done: { 'crossing-war-1': { at: 1, marks: 2, unlocks: [COAST_LAND.unlock] } } },
    });
}
async function holding(name = 'Tidewatch', members = CREW) {
    await kv.set(clanRecordKey(name), {
        name, founderName: members[0], createdAt: 1_000, treasury: { items: [] },
        members: members.map(member => ({ name: member, joinedAt: 1_000 })), roleOverrides: { [members[1]]: 'Officer' },
    });
    for (const member of members) await player(member, name);
    const granted = await grantCoastClaim({ sector: STRAND, clanName: name, now: T0 });
    assert.equal(granted.ok, true, JSON.stringify(granted));
}
const fix = (who: string, weather: unknown, sector = STRAND) => setCoastClaimWeather({ playerName: who, sector, weather });
const scheduled = (sector: number, now: number) => resolveSectorWeather(coastBiomeOf(sector), sector, now);
const sky = (weather: SectorWeather): Sky => {
    const elements = sectorWeatherElements(weather);
    return { weatherPositiveElement: elements.positiveElement, weatherNegativeElement: elements.negativeElement };
};
/** A sky the schedule is not showing over the Strand now or in the next window, so a fixed sky can be told from it. */
function unscheduled(): SectorWeather {
    const now = Date.now();
    const showing = new Set([scheduled(STRAND, now), scheduled(STRAND, now + 41 * 60_000)]);
    return (Object.keys(WEATHER_ELEMENTS) as SectorWeather[]).find(weather => weather !== 'clear' && !showing.has(weather))!;
}

describe('the coast\'s own sky', () => {
    it('is the home map\'s schedule read with the coast\'s ground, on every open sector, and nowhere off both maps', async () => {
        const now = Date.now();
        for (const sector of OPEN_COAST_SECTOR_IDS) {
            const biome = coastBiomeOf(sector) as SectorWeatherBiome;
            assert.ok(biomeWeatherTables[biome], `sector ${sector}: ${biome} has a climate`);
            const weather = await sectorWeatherNow(sector, now);
            assert.equal(weather, scheduled(sector, now), `sector ${sector}`);
            assert.ok(biomeWeatherTables[biome].includes(weather!), `sector ${sector}: ${weather} is a sky its ground has`);
        }
        assert.deepEqual([await sectorWeatherNow(0, now), await sectorWeatherNow(151, now), await sectorWeatherNow(undefined, now)], [null, null, null]);
        assert.deepEqual(await sealedSectorWeather(0, now), {}, 'a village seals no weather');
        // The home map is read exactly as before.
        assert.equal(await sectorWeatherNow(9, now), resolveSectorWeather(sectorBiomeOf(9), 9, now));
    });

    it('turns over the day and differs between sectors, so it is weather and not a label', () => {
        const day = Array.from({ length: 36 }, (_, window) => T0 + window * 40 * 60_000);
        const over = (sector: number) => new Set(day.map(now => scheduled(sector, now)));
        assert.ok(over(STRAND).size > 1, 'one sector sees more than one sky in a day');
        assert.ok(OPEN_COAST_SECTOR_IDS.some(sector => scheduled(sector, T0) !== scheduled(STRAND, T0)), 'and not every sector shares it');
    });
});

describe('fixing the sky over held ground', () => {
    it('is for the holding clan\'s founder, leaders and officers, and can be handed back to the schedule', async () => {
        await holding();
        await player('outsider', null);
        assert.equal(await coastWeatherStamp(STRAND), null);
        assert.deepEqual([(await fix('third', 'rain')).ok, (await fix('outsider', 'rain')).ok], [false, false]);
        for (const bad of ['', 'snow', 'Rain', null, 3]) assert.equal((await fix('founder', bad)).ok, false, String(bad));
        assert.equal((await fix('founder', 'rain', SEAM)).ok, false, 'ground the clan does not hold');
        assert.equal((await readCoastClaim(STRAND))?.weather, undefined, 'a refusal writes nothing');
        assert.deepEqual([...COAST_CLAIM_WEATHER].sort(), ['scheduled', ...Object.keys(WEATHER_ELEMENTS)].sort());

        assert.equal((await fix('second', 'thunderstorm')).ok, true, 'an officer may');
        assert.deepEqual(await coastWeatherStamp(STRAND), { ownerClan: 'Tidewatch', weather: 'thunderstorm' });
        const now = Date.now();
        assert.equal(await sectorWeatherNow(STRAND, now), 'thunderstorm');
        assert.equal(await sectorWeatherNow(STRAND, now, { stamped: false }), scheduled(STRAND, now), 'the schedule is still there under it');
        const shown = (await coastLandViews(now)).find(view => view.sector === STRAND)!;
        assert.deepEqual([shown.sky, shown.holder?.weather], [{ weather: 'thunderstorm', fixed: true }, 'thunderstorm']);
        // Choosing a school does not disturb the sky, and the other way round.
        assert.equal((await setCoastClaimSchool({ playerName: 'founder', sector: STRAND, terrainBuffStat: 'genjutsuOffense' })).ok, true);
        assert.deepEqual([(await readCoastClaim(STRAND))?.weather, (await readCoastClaim(STRAND))?.terrainBuffStat], ['thunderstorm', 'genjutsuOffense']);

        assert.equal((await fix('founder', 'scheduled')).ok, true);
        assert.equal(await coastWeatherStamp(STRAND), null);
        assert.deepEqual([(await readCoastClaim(STRAND))?.weather, (await readCoastClaim(STRAND))?.terrainBuffStat], [undefined, 'genjutsuOffense']);
        const after = (await coastLandViews(now)).find(view => view.sector === STRAND)!;
        assert.deepEqual(after.sky, { weather: scheduled(STRAND, now), fixed: false });
        // Unheld ground shows its scheduled sky too.
        assert.deepEqual((await coastLandViews(now)).find(view => view.sector === SEAM)!.sky, { weather: scheduled(SEAM, now), fixed: false });
    });

    it('goes with the ground: the next holder starts under the schedule, and a holder that is gone fixes nothing', async () => {
        await holding();
        await fix('founder', 'tornado');
        await holding('Reedwake', ['rival', 'r2', 'r3', 'r4', 'r5']);
        assert.deepEqual([(await readCoastClaim(STRAND))?.clan, await coastWeatherStamp(STRAND)], ['Reedwake', null]);
        await fix('rival', 'ashfall');
        assert.equal((await coastWeatherStamp(STRAND))?.weather, 'ashfall');
        await kv.del(clanRecordKey('Reedwake'));
        assert.equal(await coastWeatherStamp(STRAND), null);
        assert.equal(await sectorWeatherNow(STRAND, T0), scheduled(STRAND, T0));
    });

    it('is set through the land route by the signed-in officer', async () => {
        const handler = (await import('./land.js')).default as unknown as Handler;
        const call = async (body: Record<string, unknown>, who: string) => {
            const out = { status: 200, body: {} as Record<string, unknown> };
            const res = { setHeader() { return res; }, status(value: number) { out.status = value; return res; }, json(value: Record<string, unknown>) { out.body = value; return res; }, end() { return res; } };
            await handler({ method: 'POST', body, query: {}, headers: { 'x-player-token': token(who) }, socket: { remoteAddress: '127.4.9.6' } } as never, res as never);
            return out;
        };
        await holding();
        assert.equal((await call({ action: 'weather', sector: STRAND, weather: 'rain' }, 'third')).status, 403);
        assert.equal((await call({ action: 'weather', sector: STRAND, weather: 'blizzard' }, 'founder')).status, 400);
        const set = await call({ action: 'weather', sector: STRAND, weather: 'rain' }, 'founder');
        assert.equal(set.status, 200, JSON.stringify(set.body));
        assert.equal((set.body.claim as { weather?: string }).weather, 'rain');
        const status = await call({ action: 'status' }, 'third');
        const row = (status.body.sectors as Array<{ sector: number; sky?: unknown }>).find(entry => entry.sector === STRAND);
        assert.deepEqual(row?.sky, { weather: 'rain', fixed: true });
    });
});

describe('what a fight on the coast seals', () => {
    async function patrolFight(name: string, ip: string): Promise<Sky> {
        const start = (await import('../missions/ai-fight-start.js')).default as unknown as Handler;
        const out: { status: number; body?: Record<string, unknown> } = { status: 200 };
        const res = { setHeader: () => res, status: (value: number) => { out.status = value; return res; }, json: (value: Record<string, unknown>) => { out.body = value; return res; }, end: () => res };
        const [patrol] = coastPatrolsIn(STRAND, Date.now());
        await start({
            method: 'POST', body: { playerName: name, worldEncounter: { kind: 'coast-patrol', sourceId: patrol.id, sector: STRAND, stage: 0 } },
            headers: { 'content-type': 'application/json', 'x-player-token': token(name) ?? '' }, socket: { remoteAddress: ip },
        } as never, res as never);
        assert.equal(out.status, 200, JSON.stringify(out.body));
        const env = ((out.body?.session as Record<string, unknown>)?.environment ?? {}) as Sky;
        return { weatherPositiveElement: env.weatherPositiveElement, weatherNegativeElement: env.weatherNegativeElement };
    }
    async function duel(battleId: string, creator: string, other: string, body: Record<string, unknown>, ip: string): Promise<Sky> {
        const session = (await import('../pvp/session.js')).default as unknown as Handler;
        const out: { status: number; body?: Record<string, unknown> } = { status: 200 };
        const res = { setHeader: () => res, status: (value: number) => { out.status = value; return res; }, json: (value: Record<string, unknown>) => { out.body = value; return res; }, end: () => res };
        await session({
            method: 'POST', query: {}, body: { battleId, p1Character: { name: creator }, p2Character: { name: other }, ...body },
            headers: { 'x-player-token': token(creator), 'x-forwarded-for': ip }, socket: { remoteAddress: ip },
        } as never, res as never);
        assert.equal(out.status, 200, JSON.stringify(out.body));
        const stored = await kv.get<import('../pvp/session.js').PvpSession>(`pvp:${battleId}`);
        return { weatherPositiveElement: stored?.weatherPositiveElement, weatherNegativeElement: stored?.weatherNegativeElement };
    }
    const stand = (name: string, clan: string | null, sector: number) => {
        online.remove(name);
        online.upsert({ name, sector, tile: 60, character: character(name, clan) } as never);
    };
    /** The scheduled sky may turn between the read and the fight; the seal must be one of the two. */
    const scheduledNowOrNext = () => { const now = Date.now(); return [sky(scheduled(STRAND, now)), sky(scheduled(STRAND, now + 41 * 60_000))]; };

    it('an AI fight is fought under the sector\'s scheduled sky, and under the holder\'s fixed sky once there is one', async () => {
        await holding();
        await player('outsider', null);
        const expected = scheduledNowOrNext();
        const open = await patrolFight('third', '127.6.2.1');
        assert.ok(expected.some(one => isDeepStrictEqual(one, open)), `sealed ${JSON.stringify(open)}, scheduled ${JSON.stringify(expected)}`);

        const fixed = unscheduled();
        await fix('founder', fixed);
        // Weather is the ground's, not the clan's: everyone who fights there is under it, member or not.
        assert.deepEqual(await patrolFight('fourth', '127.6.2.2'), sky(fixed));
        assert.deepEqual(await patrolFight('outsider', '127.6.2.3'), sky(fixed));
    });

    it('a player fight gets a fixed sky only where the server placed the fight; one that only names the sector gets the schedule', async () => {
        await holding();
        await player('outsider', null);
        const fixed = unscheduled();
        await fix('founder', fixed);
        stand('fifth', 'Tidewatch', STRAND);
        stand('outsider', null, STRAND);
        // Elsewhere on the coast, a member names the clan's sector in a fight that is not a proven world attack.
        await player('third', 'Tidewatch', SEAM);
        await player('visitor', null, SEAM);
        stand('third', 'Tidewatch', SEAM);
        stand('visitor', null, SEAM);
        try {
            const proven = await duel('pvp-33333333-1234-4123-8123-123456789030', 'outsider', 'fifth', { useCurrentVitals: true, requireWorldCoLocation: true, rewardSector: STRAND }, '127.6.2.4');
            assert.deepEqual(proven, sky(fixed));
            const expected = scheduledNowOrNext();
            const named = await duel('pvp-33333333-1234-4123-8123-123456789031', 'third', 'visitor', { rewardSector: STRAND }, '127.6.2.5');
            assert.notDeepEqual(named, sky(fixed), 'the clan\'s chosen sky is not handed to a fight that only names its sector');
            assert.ok(expected.some(one => isDeepStrictEqual(one, named)), `sealed ${JSON.stringify(named)}, scheduled ${JSON.stringify(expected)}`);
        } finally {
            for (const name of ['fifth', 'outsider', 'third', 'visitor']) online.remove(name);
        }
    });
});
