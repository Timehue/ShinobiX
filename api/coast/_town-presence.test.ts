/*
 * A clan's town on the coast is a safe zone for its members.
 *
 * The owner asked for a town a clan's members can enter on the sector the clan
 * holds, and for it to be safe "like a village". A village is sector 0; a town
 * is inside a field sector, so the server issues "inside" itself. These cases
 * prove who is let in, that nobody inside attacks or is attacked, that a logout
 * inside leaves no sleeper camp, and that the safety ends the moment the member
 * steps out, the town shuts, or the clan loses the ground.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'coast-town-presence-test-secret';

import { clanRecordKey } from '../_utils.js';
import { inSafeRoom } from '../_stronghold-presence.js';
import { worldInteractionBlock } from '../_realtime/presence-gating.js';
import { sleeperAttackerBlock } from '../player/sleeper-kill.js';
import { grantCoastClaim, readCoastClaim } from './_land.js';
import {
    COAST_TOWN_RECHECK_MS, __resetCoastTownVisitsForTest, endCoastTownVisitAtLogout, enterCoastTown, inCoastTown, leaveCoastTown, refreshCoastTownVisit,
} from './_town-presence.js';
import { sectorPresenceBlock, stepOutForFieldAction } from '../_sector-presence-gate.js';

const T0 = 1_800_000_000_000;
const STRAND = 102, SEAM = 103;
const CREW = ['founder', 'second', 'third', 'fourth', 'fifth'];
const SAFE = 'World attacks are disabled in safe zones.';

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let online: typeof import('../_realtime/online-store.js').onlineStore;
let camps: typeof import('../_realtime/sleeper-camps.js');
let token: typeof import('../_auth.js').issuePlayerToken;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    camps = await import('../_realtime/sleeper-camps.js');
    ({ issuePlayerToken: token } = await import('../_auth.js'));
});
beforeEach(async () => {
    __resetCoastTownVisitsForTest();
    for (const name of [...CREW, 'outsider', 'rival', 'r2', 'r3', 'r4', 'r5']) online.remove(name);
    for (const pattern of ['coast:*', 'save:*', 'lock:*', 'ratelimit:*', 'world:sleeper*', 'sleeper*', 'travel*', 'player-fp:*', 'player-ip:*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

async function player(name: string, clan: string | null, sector = STRAND) {
    await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: sector, character: { name, level: 80, clan, village: 'Stormveil Village', inventory: [], itemStacks: [] } });
}
/** Put a player on a sector as a fresh arrival. A beat alone does not move a record between field sectors. */
const arrive = (name: string, clan: string | null, sector = STRAND) => {
    online.remove(name);
    return online.upsert({ name, sector, tile: 60, character: { name, level: 80, clan, village: 'Stormveil Village' } } as never);
};

/** A clan holding the Strand, with a Landing at the given tier standing on it. */
async function town(tier = 1, status: 'active' | 'dormant' = 'active', name = 'Tidewatch', members = CREW) {
    await kv.set(clanRecordKey(name), {
        name, founderName: members[0], createdAt: 1_000, treasury: { items: [] },
        members: members.map(member => ({ name: member, joinedAt: 1_000 })), roleOverrides: {},
    });
    for (const member of members) await player(member, name);
    // Calling this again for the same clan only changes the Landing that stands on its ground.
    if ((await readCoastClaim(STRAND))?.clan !== name) {
        const granted = await grantCoastClaim({ sector: STRAND, clanName: name, now: T0 });
        assert.equal(granted.ok, true, JSON.stringify(granted));
    }
    const claim = (await readCoastClaim(STRAND))!;
    await kv.set(`coast:landing:${claim.clanSlug}`, {
        clan: name, clanSlug: claim.clanSlug, generation: claim.generation, sector: STRAND, landingEpoch: claim.landingEpoch,
        status, tier, stores: {}, works: [], foundedAt: T0, foundedBy: members[0], upkeepWeek: 0, dormantWeeks: 0, contributions: {},
    });
    return claim;
}
const refused = async (name: string) => { const result = await enterCoastTown(name); return result.ok ? 'entered' : result.error; };

describe('entering the town', () => {
    it('is for a member of the holding clan, standing in its sector, when a town stands there', async () => {
        await town(1);
        await player('outsider', null);
        arrive('outsider', null);
        assert.match(await refused('outsider'), /for the members of the clan/);
        assert.match(await refused('third'), /presence is not ready/, 'not online');
        arrive('third', 'Tidewatch', SEAM);
        assert.match(await refused('third'), /Stand in the sector your clan holds/);

        arrive('third', 'Tidewatch');
        const entered = await enterCoastTown('third');
        assert.deepEqual(entered, { ok: true, sector: STRAND, town: ['clan-hall', 'cafeteria'] });
        assert.equal(inCoastTown('third'), true);
        assert.equal(inSafeRoom(online.get('third')!), true);
        // Asking again from inside is a renewal, not a refusal: the town screen does it each time it opens.
        assert.equal((await enterCoastTown('third')).ok, true);
        leaveCoastTown('third');
        assert.deepEqual([inCoastTown('third'), inSafeRoom(online.get('third')!)], [false, false]);
    });

    it('needs a Landing above the staked plot that is paying its upkeep', async () => {
        await town(0);
        arrive('second', 'Tidewatch');
        assert.match(await refused('second'), /no town standing yet/);
        await town(2, 'dormant');
        assert.match(await refused('second'), /dormant, and its town is shut/);
        await town(3);
        const entered = await enterCoastTown('second');
        assert.equal(entered.ok && entered.town.length, 8);
    });

    it('is not a way out of a fight', async () => {
        await town(1);
        arrive('fourth', 'Tidewatch');
        online.setInBattle('fourth', true);
        assert.match(await refused('fourth'), /Finish your fight/);
        online.setInBattle('fourth', false);
        online.setPendingAttacker('fourth', { name: 'outsider' });
        assert.match(await refused('fourth'), /Finish your fight/, 'an attack another player has just started');
        online.clearPendingAttacker('fourth');
        assert.equal(await refused('fourth'), 'entered');
    });
});

describe('inside the town', () => {
    it('nobody attacks a member, a member attacks nobody, and members do not attack each other', async () => {
        await town(1);
        await player('outsider', null);
        const raider = arrive('outsider', null);
        arrive('fifth', 'Tidewatch');
        arrive('second', 'Tidewatch');
        assert.equal(worldInteractionBlock(raider, online.get('fifth')), null, 'on the open sector a member can be attacked');

        await enterCoastTown('fifth');
        assert.equal(worldInteractionBlock(raider, online.get('fifth'))?.error, SAFE);
        assert.equal(worldInteractionBlock(online.get('fifth'), raider)?.error, SAFE);
        assert.equal(sleeperAttackerBlock(online.get('fifth'), STRAND)?.error, SAFE);
        await enterCoastTown('second');
        assert.equal(worldInteractionBlock(online.get('second'), online.get('fifth'))?.error, SAFE);

        leaveCoastTown('fifth');
        assert.equal(worldInteractionBlock(raider, online.get('fifth')), null, 'and again once they walk out');
    });

    it('lasts only while the member stays put: a step onto the sector ends it', async () => {
        await town(1);
        arrive('third', 'Tidewatch');
        await enterCoastTown('third');
        const record = online.get('third')!;
        assert.ok(online.moveToTile('third', record.tile === 61 ? 62 : 61), 'the walk is accepted');
        assert.equal(inSafeRoom(online.get('third')!), false, 'out at once, with no word from the client');
        await refreshCoastTownVisit('third');
        assert.deepEqual([inCoastTown('third'), endCoastTownVisitAtLogout(online.get('third')!)], [false, false]);
    });

    it('ends when the member works the field: the sector\'s rewards are taken where they can be attacked for them', async () => {
        await town(1);
        for (const name of ['second', 'third', 'fourth']) { arrive(name, 'Tidewatch'); await enterCoastTown(name); }
        // Talking in the sector is not a field action.
        assert.equal(sectorPresenceBlock('second', STRAND, { shelterKept: true }), null);
        assert.equal(inCoastTown('second'), true);
        // Exploring, a pet encounter and the like pass the field gate, and passing it walks the member out.
        assert.equal(sectorPresenceBlock('second', STRAND), null);
        assert.equal(inCoastTown('second'), false);
        // A refused gate takes nobody out of anything.
        assert.equal(sectorPresenceBlock('third', SEAM)?.reason, 'sector-mismatch');
        assert.equal(inCoastTown('third'), true);
        // Gathering and a world fight go through the same rule by name.
        stepOutForFieldAction('fourth');
        assert.deepEqual([inCoastTown('fourth'), inSafeRoom(online.get('fourth')!)], [false, false]);
        // And a refresh does not put any of them back.
        await refreshCoastTownVisit('second');
        await refreshCoastTownVisit('fourth');
        assert.deepEqual([inCoastTown('second'), inCoastTown('fourth')], [false, false]);
    });

    it('does not survive a logout: a member who logs back in on the sector is on the open sector', async () => {
        await town(1);
        arrive('fifth', 'Tidewatch');
        await enterCoastTown('fifth');
        // The old record goes stale and a new one is made. Its movement count starts over at the same number.
        await new Promise(resolve => setTimeout(resolve, 5));
        const back = arrive('fifth', 'Tidewatch');
        assert.equal(back.movementSeq ?? 0, 0);
        await refreshCoastTownVisit('fifth');
        assert.deepEqual([inCoastTown('fifth'), inSafeRoom(online.get('fifth')!)], [false, false]);
    });

    it('is renewed by the heartbeat, and a fight from a town facility only pauses it', async () => {
        await town(3);
        arrive('second', 'Tidewatch');
        await enterCoastTown('second');
        const now = Date.now();
        await refreshCoastTownVisit('second', now + 20_000);
        assert.equal(inCoastTown('second', now + 20_000), true);

        online.setInBattle('second', true);
        assert.equal(inSafeRoom(online.get('second')!), false, 'a fighter is not in the room; nothing can attack a fighter anyway');
        await refreshCoastTownVisit('second');
        assert.equal(inCoastTown('second'), false);
        online.setInBattle('second', false);
        await refreshCoastTownVisit('second');
        assert.equal(inCoastTown('second'), true, 'back inside on the first beat after it: they never moved');
    });

    it('ends within a beat of the town shutting, the clan losing the ground, or the member leaving the clan', async () => {
        const later = () => Date.now() + COAST_TOWN_RECHECK_MS + 1_000;
        const claim = await town(2);
        for (const name of ['second', 'third', 'fourth']) { arrive(name, 'Tidewatch'); await enterCoastTown(name); }

        // Before the re-check is due a beat renews without reading the town again.
        await kv.set(`coast:landing:${claim.clanSlug}`, { ...(await kv.get<Record<string, unknown>>(`coast:landing:${claim.clanSlug}`)), status: 'dormant' });
        await refreshCoastTownVisit('second');
        assert.equal(inCoastTown('second'), true);
        await refreshCoastTownVisit('second', later());
        assert.equal(inCoastTown('second'), false, 'the Landing went dormant');

        await kv.set(`coast:landing:${claim.clanSlug}`, { ...(await kv.get<Record<string, unknown>>(`coast:landing:${claim.clanSlug}`)), status: 'active' });
        await player('third', null);
        await refreshCoastTownVisit('third', later());
        assert.equal(inCoastTown('third'), false, 'they left the clan');

        await town(1, 'active', 'Reedwake', ['rival', 'r2', 'r3', 'r4', 'r5']);
        await refreshCoastTownVisit('fourth', later());
        assert.equal(inCoastTown('fourth'), false, 'another clan holds the ground now');
    });
});

describe('logging off in the town', () => {
    it('leaves no sleeper camp, where a logout on the open sector leaves one', async () => {
        await town(1);
        await player('outsider', null);
        const inside = arrive('fifth', 'Tidewatch');
        const outside = arrive('outsider', null);
        await enterCoastTown('fifth');
        const gone = [{ ...online.get('fifth')! }, { ...outside }];
        assert.equal(inside.sector, STRAND);
        online.remove('fifth');
        online.remove('outsider');
        await camps.materializeSleeperCamps(gone);
        assert.equal(await camps.getSleeperCamp('fifth'), null, 'a town is a safe zone, like a village');
        assert.equal((await camps.getSleeperCamp('outsider'))?.sector, STRAND);
        // The visit ended with the logout: back on the sector, they are outside until they walk in again.
        arrive('fifth', 'Tidewatch');
        await refreshCoastTownVisit('fifth');
        assert.equal(inCoastTown('fifth'), false);
    });
});

describe('the Landing route', () => {
    it('lets a member walk in and out, and says whether the server holds them as inside', async () => {
        const handler = (await import('./landing.js')).default as unknown as Handler;
        const call = async (body: Record<string, unknown>, who: string) => {
            const out = { status: 200, body: {} as Record<string, unknown> };
            const res = { setHeader() { return res; }, status(value: number) { out.status = value; return res; }, json(value: Record<string, unknown>) { out.body = value; return res; }, end() { return res; } };
            await handler({ method: 'POST', body, query: {}, headers: { 'x-player-token': token(who) }, socket: { remoteAddress: '127.4.9.9' } } as never, res as never);
            return out;
        };
        await town(2);
        arrive('second', 'Tidewatch', SEAM);
        assert.equal((await call({ action: 'town-enter' }, 'second')).status, 409);
        arrive('second', 'Tidewatch');
        const entered = await call({ action: 'town-enter' }, 'second');
        assert.equal(entered.status, 200, JSON.stringify(entered.body));
        assert.deepEqual(entered.body.town, ['clan-hall', 'cafeteria', 'bank', 'shop', 'hospital']);
        assert.equal((await call({ action: 'status' }, 'second')).body.inTown, true);
        assert.equal((await call({ action: 'town-leave' }, 'second')).status, 200);
        assert.equal((await call({ action: 'status' }, 'second')).body.inTown, false);
    });
});
