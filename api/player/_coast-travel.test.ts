import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'coast-travel-test-secret';

/*
 * Getting to, around and back from the Unmapped Coast, through the real travel
 * route: real auth, the server's own presence store as the origin, the durable
 * save as the only proof of admission, and the real travel lease.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const PREFIX = 'coasttrav';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let lease: typeof import('../_realtime/travel-lease.js');
let admission: typeof import('../_coast-admission.js');
let coast: typeof import('../../shared/coast-world.js');
let rules: typeof import('../../shared/coast-world-rules.js');
let travelModule: { default: unknown; crossMapRefusal: (originSector: number, destinationSector: number, secondDock?: boolean) => string | null };
let travel: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    lease = await import('../_realtime/travel-lease.js');
    admission = await import('../_coast-admission.js');
    coast = await import('../../shared/coast-world.js');
    rules = await import('../../shared/coast-world-rules.js');
    travelModule = await import('./travel.js');
    travel = travelModule.default as unknown as Handler;
});

beforeEach(async () => {
    admission.clearCoastAdmissionCache();
    for (const pattern of [`save:${PREFIX}*`, `world:travel-lease:${PREFIX}*`, 'lock:*', `ratelimit:*${PREFIX}*`]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

/** A finished first quest: the boat, and coast region 1. `region` opens further regions. */
const sailed = (region = 1) => ({ v: 1, active: {}, done: { 'shuttered-boat': { at: 1, marks: 1, opensRegion: region, unlocks: ['boat'] } } });

let seq = 0;
/** A fresh player with a save, standing where the test puts them. */
async function player(options: { level?: number; questLines?: unknown; sector: number; tile?: number }): Promise<string> {
    const name = `${PREFIX}${++seq}`;
    await kv.set(`save:${name}`, {
        _saveVersion: 1,
        currentSector: options.sector,
        ...(options.questLines ? { questLines: options.questLines } : {}),
        character: { name, village: 'Stormveil Village', level: options.level ?? 75, ryo: 0, inventory: [] },
    });
    onlineStore.upsert({ name, sector: options.sector, tile: options.tile ?? 60, character: null });
    return name;
}

async function go(name: string, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await travel({
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(name) ?? '' },
        socket: { remoteAddress: `127.8.${seq % 250}.${name.length}` },
    } as never, res as never);
    return out;
}

describe('the two maps are joined only by the boat', () => {
    it('answers for every pairing of origin and destination', () => {
        const { crossMapRefusal } = travelModule;
        assert.equal(crossMapRefusal(7, 5), null, 'home to home is not a crossing');
        assert.equal(crossMapRefusal(101, 140), null, 'coast to coast is not a crossing');
        assert.equal(crossMapRefusal(7, 101), null, 'the boat lands at the slip');
        assert.equal(crossMapRefusal(40, 101), null, 'and can be taken from anywhere on the home map');
        assert.match(String(crossMapRefusal(7, 105)), /lands at Saltstair Slip/);
        assert.equal(crossMapRefusal(105, 7), null, 'the boat home lands at the harbor');
        assert.equal(crossMapRefusal(105, 0), null, 'Village is an instant return from the coast too');
        assert.match(String(crossMapRefusal(105, 30)), /Take the boat home first/);
        assert.match(String(crossMapRefusal(105, 99)), /Take the boat home first/);
        // The second dock is the Low Water Quay, and only once it has been opened.
        assert.match(String(crossMapRefusal(7, 116)), /lands at Saltstair Slip/);
        assert.equal(crossMapRefusal(7, 116, true), null);
        assert.match(String(crossMapRefusal(7, 117, true)), /lands at Saltstair Slip/, 'it opens one quay, not the coast');
        assert.equal(crossMapRefusal(7, 101, true), null, 'the slip stays open');
    });
});

describe('the second dock', () => {
    /** The boat, regions 1 and 2, and The Uncounted I finished or not. */
    const withQuay = (opened: boolean) => ({ v: 1, active: {}, done: {
        'shuttered-boat': { at: 1, marks: 1, opensRegion: 2, unlocks: ['boat'] },
        ...(opened ? { 'uncounted-1': { at: 2, marks: 2, unlocks: ['second-dock'] } } : {}),
    } });

    it('lands a player at the Low Water Quay once The Uncounted has opened it', async () => {
        const closed = await player({ level: 80, questLines: withQuay(false), sector: 7 });
        const refused = await go(closed, { destinationSector: 116 });
        assert.equal(refused.statusCode, 409);
        assert.match(String(refused.body?.error), /lands at Saltstair Slip/);

        const name = await player({ level: 80, questLines: withQuay(true), sector: 7 });
        const out = await go(name, { destinationSector: 116 });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const quay = coast.coastSite('brackwater-dock-116')!;
        assert.deepEqual([out.body?.destinationSector, out.body?.travelMs, out.body?.arrivalTile], [116, 3_000, quay.approach]);
        assert.equal(rules.coastTileWalkable(coast.coastLayout(116)!.mask, quay.approach), true, 'the landing can be stood on');
        assert.deepEqual([admission.COAST_SECOND_DOCK.sector, admission.COAST_SECOND_DOCK.siteId], [quay.sector, 'brackwater-dock-116']);
    });

    it('still asks for the quay\'s region, and opens no other landing', async () => {
        const noRegion = await player({ level: 80, sector: 7, questLines: { v: 1, active: {}, done: {
            'shuttered-boat': { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] }, 'uncounted-1': { at: 2, marks: 2, unlocks: ['second-dock'] },
        } } });
        assert.deepEqual([(await go(noRegion, { destinationSector: 116 })).body?.reason], ['region']);
        const name = await player({ level: 80, questLines: withQuay(true), sector: 7 });
        assert.match(String((await go(name, { destinationSector: 118 })).body?.error), /lands at Saltstair Slip/);
    });
});

describe('admission is read from the save', () => {
    it('names the first thing a player is missing', () => {
        const { coastAdmissionOf, coastEntryRefusal } = admission;
        const save = (level: number, questLines?: unknown) => coastAdmissionOf({ character: { level }, questLines });
        assert.equal(coastEntryRefusal(save(74, sailed()), 101)?.reason, 'level');
        assert.equal(coastEntryRefusal(save(75), 101)?.reason, 'boat');
        assert.equal(coastEntryRefusal(save(75, sailed(1)), 101), null);
        assert.equal(coastEntryRefusal(save(75, sailed(1)), 111)?.reason, 'region');
        assert.equal(coastEntryRefusal(save(75, sailed(2)), 111), null);
        assert.equal(coastEntryRefusal(save(100, sailed(4)), 141)?.reason, 'region');
        assert.equal(coastEntryRefusal(save(100, sailed(5)), 141), null);
        assert.equal(coastEntryRefusal(save(100, sailed(5)), 74)?.reason, 'not-coast');
        assert.deepEqual(coastAdmissionOf(null), { level: 0, boat: false, region: 0, secondDock: false, lastGarrison: false });

        // The Last Crown stays shut inside an open Hushcrown until The Crossing War V opens the last Garrison.
        const shut = coastEntryRefusal(save(100, sailed(5)), 150);
        assert.deepEqual([shut?.reason, shut?.error], ['sealed', 'The Last Crown is shut. Break the Twin Ward first.']);
        assert.equal(coastEntryRefusal(save(100, sailed(5)), 149), null, 'its neighbours are open');
        const broken = { ...sailed(5), done: { ...sailed(5).done, 'crossing-war-5': { at: 2, marks: 4, unlocks: ['last-garrison'] } } };
        assert.equal(coastEntryRefusal(save(100, broken), 150), null);
        assert.deepEqual([admission.coastSealedSectors(save(100, sailed(5))), admission.coastSealedSectors(save(100, broken))], [[150], []]);
        assert.equal(coastEntryRefusal(save(100, { ...sailed(4), done: { ...broken.done, 'shuttered-boat': sailed(4).done['shuttered-boat'] } }), 150)?.reason, 'region', 'the region still comes first');
        // A quest record the client forged into its character does nothing: only the top-level record counts.
        assert.equal(coastAdmissionOf({ character: { level: 75, questLines: sailed() } }).boat, false);
    });
});

describe('sailing out', () => {
    it('refuses a player under level 75, and one who has not finished the first quest', async () => {
        const young = await player({ level: 74, questLines: sailed(), sector: 7 });
        const early = await go(young, { destinationSector: 101 });
        assert.deepEqual([early.statusCode, early.body?.reason], [403, 'level']);
        assert.match(String(early.body?.error), /level 75 or higher/);

        const unsent = await player({ level: 80, sector: 7 });
        const noBoat = await go(unsent, { destinationSector: 101 });
        assert.deepEqual([noBoat.statusCode, noBoat.body?.reason], [403, 'boat']);
        assert.equal(await lease.getTravelLease(unsent), null, 'a refused crossing records no journey');
        assert.equal(onlineStore.get(unsent)?.sector, 7, 'and moves nobody');
    });

    it('takes three seconds, lands on the slip, and is written to the save on arrival', async () => {
        const name = await player({ questLines: sailed(), sector: 7 });
        const out = await go(name, { destinationSector: 101, level: 100, questLines: sailed(5) });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.deepEqual([out.body?.destinationSector, out.body?.travelMs, out.body?.arrivalTile], [101, 3_000, coast.COAST_DOCK.tile]);

        const journey = await lease.getTravelLease(name);
        assert.deepEqual([journey?.originSector, journey?.destinationSector, journey?.arrivalTile], [7, 101, coast.COAST_DOCK.tile]);
        assert.equal(await lease.settleTravelLease(name, undefined, Number(out.body?.arrivalAt) + 1), true);
        const saved = await kv.get<Record<string, unknown>>(`save:${name}`);
        assert.deepEqual([saved?.currentSector, saved?.currentTile, saved?.currentBiome], [101, coast.COAST_DOCK.tile, coast.coastBiomeOf(101)]);
    });

    it('lands only at the slip, wherever on the coast the client asks for', async () => {
        const name = await player({ questLines: sailed(5), sector: 7 });
        const out = await go(name, { destinationSector: 105 });
        assert.equal(out.statusCode, 409);
        assert.match(String(out.body?.error), /lands at Saltstair Slip/);
    });
});

describe('moving on the coast', () => {
    it('map travel reaches an opened region and is refused for one that is not', async () => {
        const name = await player({ questLines: sailed(1), sector: 101 });
        const ok = await go(name, { destinationSector: 105 });
        assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
        assert.equal(rules.coastTileWalkable(coast.coastLayout(105)!.mask, Number(ok.body?.arrivalTile)), true, 'arrival is on ground that can be stood on');

        const fenced = await player({ questLines: sailed(1), sector: 101 });
        const closed = await go(fenced, { destinationSector: 111 });
        assert.deepEqual([closed.statusCode, closed.body?.reason], [403, 'region']);
        const opened = await player({ questLines: sailed(2), sector: 101 });
        assert.equal((await go(opened, { destinationSector: 111 })).statusCode, 200);

        const far = await player({ level: 100, questLines: sailed(5), sector: 101 });
        const hushcrown = await go(far, { destinationSector: 141 });
        assert.equal(hushcrown.statusCode, 200);
    });

    it('a trail is crossed at once, by its own exit, and lands one step inside', async () => {
        const trail = coast.coastExits(101).find(exit => exit.destinationSector === 102)!;
        const name = await player({ questLines: sailed(1), sector: 101, tile: trail.tile });
        const out = await go(name, { mode: 'edge', destinationSector: 102, originSector: 101, originTile: trail.tile, exitId: trail.id });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.deepEqual([out.body?.travelMs, out.body?.arrivalTile], [0, trail.destinationTile]);
        assert.equal(onlineStore.get(name)?.sector, 102);
    });

    it('a trail cannot be crossed from the wrong tile, by another sector\'s exit, or into a closed region', async () => {
        const trail = coast.coastExits(101).find(exit => exit.destinationSector === 102)!;
        const wrongTile = await player({ questLines: sailed(1), sector: 101, tile: trail.tile });
        assert.equal((await go(wrongTile, { mode: 'edge', destinationSector: 102, originTile: trail.tile + 1, exitId: trail.id })).statusCode, 409);

        const elsewhere = await player({ questLines: sailed(1), sector: 105, tile: trail.tile });
        assert.equal((await go(elsewhere, { mode: 'edge', destinationSector: 102, originTile: trail.tile, exitId: trail.id })).statusCode, 409, 'the exit belongs to sector 101');

        const brine = coast.coastExits(101).find(exit => exit.destinationSector === 111)!;
        const fenced = await player({ questLines: sailed(1), sector: 101, tile: brine.tile });
        const closed = await go(fenced, { mode: 'edge', destinationSector: 111, originTile: brine.tile, exitId: brine.id });
        assert.deepEqual([closed.statusCode, closed.body?.reason], [403, 'region']);

        const boundary = coast.coastExits(138).find(exit => exit.destinationSector === 141)!;
        const rim = await player({ level: 100, questLines: sailed(5), sector: 138, tile: boundary.tile });
        assert.equal((await go(rim, { mode: 'edge', destinationSector: 141, originTile: boundary.tile, exitId: boundary.id })).statusCode, 200, 'the earned final region can be reached by its boundary trail');
    });
});

describe('coming home', () => {
    it('the boat lands at the harbor, and Village is still an instant return', async () => {
        const sailor = await player({ questLines: sailed(1), sector: 105 });
        const boat = await go(sailor, { destinationSector: 7 });
        assert.equal(boat.statusCode, 200, JSON.stringify(boat.body));
        assert.deepEqual([boat.body?.travelMs, typeof boat.body?.arrivalTile], [3_000, 'number']);

        const homesick = await player({ questLines: sailed(1), sector: 105 });
        const village = await go(homesick, { destinationSector: 0 });
        assert.equal(village.statusCode, 200, JSON.stringify(village.body));
        assert.equal((await lease.getTravelLease(homesick))?.originSector, 105, 'a journey that starts on the coast can be recorded');
    });

    it('nothing else on the home map can be reached from the coast', async () => {
        const name = await player({ questLines: sailed(5), level: 100, sector: 105 });
        for (const destination of [30, 99, 1]) {
            const out = await go(name, { destinationSector: destination });
            assert.equal(out.statusCode, 409, `sector ${destination}`);
            assert.match(String(out.body?.error), /Take the boat home first/);
        }
    });
});

describe('the home map is unchanged', () => {
    it('home travel works as before, and a number on neither map is still refused', async () => {
        const name = await player({ level: 10, sector: 7 });
        const out = await go(name, { destinationSector: 5 });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.travelMs, 3_000);
        const nowhere = await player({ level: 100, questLines: sailed(5), sector: 7 });
        for (const destination of [75, 100, 151]) assert.equal((await go(nowhere, { destinationSector: destination })).statusCode, 400, `sector ${destination}`);
    });
});
