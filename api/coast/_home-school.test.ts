/*
 * The school a clan favours on the coast sector it holds.
 *
 * On the home map a clan chose one offense stat for a captured sector and its
 * members' jutsu of that type hit 10% harder there. Clans hold land on the coast
 * only now, and the owner carried the bonus over (2026-11-21). These cases prove
 * who may choose it, and that a player fight and an AI fight on the sector both
 * seal it for the holder's members and for nobody else, and only when the server
 * itself has placed the fight on that sector. The 10% itself is
 * `homeTerrainMultiplier` (api/combat-core/_formulas.test.ts, api/pvp/_home-terrain.test.ts).
 */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'coast-home-school-test-secret';

import { clanRecordKey } from '../_utils.js';
import { coastPatrolsIn } from './_patrols.js';
import {
    COAST_LAND, coastHomeSchool, coastHomeSchoolFor, coastLandViews, grantCoastClaim, readCoastClaim, setCoastClaimSchool,
} from './_land.js';

const T0 = 1_800_000_000_000;
const STRAND = 102, SEAM = 103;
const CREW = ['founder', 'second', 'third', 'fourth', 'fifth'];

type Handler = (req: never, res: never) => Promise<unknown>;
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
        inventory: [], itemStacks: [], jutsu: [], jutsuMastery: [],
        stats: {
            strength: 900, speed: 900, intelligence: 900, willpower: 900,
            ninjutsuOffense: 1500, ninjutsuDefense: 1500, taijutsuOffense: 900, taijutsuDefense: 900,
            bukijutsuOffense: 900, bukijutsuDefense: 900, genjutsuOffense: 900, genjutsuDefense: 900,
        },
        equippedJutsuIds: ['starter-universal-flicker'],
    };
}

async function player(name: string, clan: string | null, sector = STRAND) {
    await kv.set(`save:${name}`, {
        _saveVersion: 1, currentSector: sector, acceptedMissionIds: [], missionProgress: {}, savedBloodlines: [], creatorJutsus: [],
        character: character(name, clan),
        questLines: { v: 1, active: {}, done: { 'crossing-war-1': { at: 1, marks: 2, unlocks: [COAST_LAND.unlock] } } },
    });
}

/** A clan whose founder is the first name, with one officer, holding the Strand. */
async function holding(name = 'Tidewatch', members = CREW, sector = STRAND) {
    await kv.set(clanRecordKey(name), {
        name, founderName: members[0], createdAt: 1_000, treasury: { items: [] },
        members: members.map(member => ({ name: member, joinedAt: 1_000 })),
        roleOverrides: { [members[1]]: 'Officer' },
    });
    for (const member of members) await player(member, name, sector);
    const granted = await grantCoastClaim({ sector, clanName: name, now: T0 });
    assert.equal(granted.ok, true, JSON.stringify(granted));
}

const choose = (who: string, terrainBuffStat: unknown, sector = STRAND) => setCoastClaimSchool({ playerName: who, sector, terrainBuffStat });

describe('choosing the school', () => {
    it('is for the holding clan\'s founder, leaders and officers, and names one of the four schools', async () => {
        await holding();
        await player('outsider', null);
        assert.equal(await coastHomeSchool(STRAND), null, 'no school until an officer chooses one');

        assert.deepEqual([(await choose('third', 'ninjutsuOffense')).ok, (await choose('outsider', 'ninjutsuOffense')).ok], [false, false]);
        for (const bad of ['', 'speed', 'Ninjutsu', null, 7]) assert.equal((await choose('founder', bad)).ok, false, String(bad));
        assert.equal((await choose('founder', 'ninjutsuOffense', 107)).ok, false, 'ground that cannot be held');
        assert.equal((await choose('founder', 'ninjutsuOffense', SEAM)).ok, false, 'ground the clan does not hold');
        assert.equal((await readCoastClaim(STRAND))?.terrainBuffStat, undefined, 'a refusal writes nothing');

        assert.equal((await choose('founder', 'ninjutsuOffense')).ok, true);
        assert.deepEqual(await coastHomeSchool(STRAND), { clanSlug: 'tidewatch', school: 'Ninjutsu' });
        // An officer may change it, at any time, as on the home map.
        assert.equal((await choose('second', 'taijutsuOffense')).ok, true);
        assert.deepEqual(await coastHomeSchool(STRAND), { clanSlug: 'tidewatch', school: 'Taijutsu' });
        const shown = (await coastLandViews(T0)).find(view => view.sector === STRAND)!;
        assert.equal(shown.holder?.terrainBuffStat, 'taijutsuOffense', 'the land status shows it to everyone');
    });

    it('favours the holder\'s members only, and does not pass to the next holder', async () => {
        await holding();
        await player('outsider', null);
        await choose('founder', 'genjutsuOffense');
        const save = async (name: string) => kv.get<Record<string, unknown>>(`save:${name}`);
        assert.equal(await coastHomeSchoolFor(STRAND, await save('fourth')), 'Genjutsu');
        assert.equal(await coastHomeSchoolFor(STRAND, await save('outsider')), '');
        assert.equal(await coastHomeSchoolFor(SEAM, await save('fourth')), '', 'only on the sector the clan holds');
        assert.equal(await coastHomeSchoolFor(5, await save('fourth')), '', 'never on the home map');
        assert.equal(await coastHomeSchoolFor(undefined, await save('fourth')), '');

        // The sector changes hands: the new holder starts with no school.
        await holding('Reedwake', ['rival', 'r2', 'r3', 'r4', 'r5']);
        assert.equal((await readCoastClaim(STRAND))?.clan, 'Reedwake');
        assert.equal(await coastHomeSchool(STRAND), null);
        assert.equal(await coastHomeSchoolFor(STRAND, await save('fourth')), '');

        // A holder whose clan record is gone favours nobody.
        await choose('rival', 'bukijutsuOffense');
        assert.deepEqual(await coastHomeSchool(STRAND), { clanSlug: 'reedwake', school: 'Bukijutsu' });
        await kv.del(clanRecordKey('Reedwake'));
        assert.equal(await coastHomeSchool(STRAND), null);
    });

    it('is set through the land route by the signed-in officer', async () => {
        const handler = (await import('./land.js')).default as unknown as Handler;
        const call = async (body: Record<string, unknown>, who: string) => {
            const out = { status: 200, body: {} as Record<string, unknown> };
            const res = { setHeader() { return res; }, status(value: number) { out.status = value; return res; }, json(value: Record<string, unknown>) { out.body = value; return res; }, end() { return res; } };
            await handler({ method: 'POST', body, query: {}, headers: { 'x-player-token': token(who) }, socket: { remoteAddress: '127.4.9.8' } } as never, res as never);
            return out;
        };
        await holding();
        assert.equal((await call({ action: 'terrain', sector: STRAND, terrainBuffStat: 'bukijutsuOffense' }, 'third')).status, 403);
        assert.equal((await call({ action: 'terrain', sector: STRAND, terrainBuffStat: 'everything' }, 'founder')).status, 400);
        const set = await call({ action: 'terrain', sector: STRAND, terrainBuffStat: 'bukijutsuOffense' }, 'founder');
        assert.equal(set.status, 200, JSON.stringify(set.body));
        assert.equal((set.body.claim as { terrainBuffStat?: string }).terrainBuffStat, 'bukijutsuOffense');
    });
});

describe('a fight on the held sector', () => {
    it('seals the school on the holder\'s member in an AI fight, and on nobody else', async () => {
        const start = (await import('../missions/ai-fight-start.js')).default as unknown as Handler;
        const { readSoloPveSession } = await import('../solo-pve/_store.js');
        const sealed = async (name: string, ip: string) => {
            const out: { status: number; body?: Record<string, unknown> } = { status: 200 };
            const res = { setHeader: () => res, status: (value: number) => { out.status = value; return res; }, json: (value: Record<string, unknown>) => { out.body = value; return res; }, end: () => res };
            const [patrol] = coastPatrolsIn(STRAND, Date.now());
            await start({
                method: 'POST', body: { playerName: name, worldEncounter: { kind: 'coast-patrol', sourceId: patrol.id, sector: STRAND, stage: 0 } },
                headers: { 'content-type': 'application/json', 'x-player-token': token(name) ?? '' }, socket: { remoteAddress: ip },
            } as never, res as never);
            assert.equal(out.status, 200, JSON.stringify(out.body));
            const session = await readSoloPveSession(String(out.body?.sessionId ?? (out.body?.session as Record<string, unknown>)?.sessionId));
            return (session?.player.character as Record<string, unknown>).homeTerrainType;
        };
        await holding();
        await player('outsider', null);
        assert.equal(await sealed('third', '127.6.1.1'), undefined, 'nothing while the clan has chosen no school');
        await choose('founder', 'ninjutsuOffense');
        assert.equal(await sealed('fourth', '127.6.1.2'), 'Ninjutsu');
        assert.equal(await sealed('outsider', '127.6.1.3'), undefined);
    });

    /** Create a player fight through the real route and read back the school sealed on each side. */
    async function duel(battleId: string, creator: string, other: string, body: Record<string, unknown>, ip: string) {
        const session = (await import('../pvp/session.js')).default as unknown as Handler;
        const out: { status: number; body?: Record<string, unknown> } = { status: 200 };
        const res = { setHeader: () => res, status: (value: number) => { out.status = value; return res; }, json: (value: Record<string, unknown>) => { out.body = value; return res; }, end: () => res };
        await session({
            method: 'POST', query: {},
            body: { battleId, p1Character: { name: creator }, p2Character: { name: other }, ...body },
            headers: { 'x-player-token': token(creator), 'x-forwarded-for': ip }, socket: { remoteAddress: ip },
        } as never, res as never);
        assert.equal(out.status, 200, JSON.stringify(out.body));
        const stored = await kv.get<import('../pvp/session.js').PvpSession>(`pvp:${battleId}`);
        const school = (side: 'p1' | 'p2') => (stored?.[side].character as Record<string, unknown>).homeTerrainType;
        return [school('p1'), school('p2')];
    }
    const stand = (name: string, clan: string | null, sector: number) => {
        online.remove(name);
        online.upsert({ name, sector, tile: 60, character: character(name, clan) } as never);
    };

    it('seals it on the holder\'s member in a player fight, and not on their opponent', async () => {
        await holding();
        await player('outsider', null);
        await choose('founder', 'taijutsuOffense');
        stand('fifth', 'Tidewatch', STRAND);
        stand('outsider', null, STRAND);
        try {
            assert.deepEqual(
                await duel('pvp-22222222-1234-4123-8123-123456789020', 'outsider', 'fifth', { useCurrentVitals: true, requireWorldCoLocation: true, rewardSector: STRAND }, '127.6.1.4'),
                [undefined, 'Taijutsu'],
            );
        } finally {
            online.remove('fifth');
            online.remove('outsider');
        }
    });

    it('is not sealed for a member who only NAMES the sector: the server must have both fighters there', async () => {
        await holding();
        await player('outsider', null, SEAM);
        await player('third', 'Tidewatch', SEAM);
        await choose('founder', 'taijutsuOffense');
        // A member standing somewhere else names the clan's sector in a fight that is not a proven world attack.
        stand('third', 'Tidewatch', SEAM);
        stand('outsider', null, SEAM);
        try {
            assert.deepEqual(
                await duel('pvp-22222222-1234-4123-8123-123456789021', 'third', 'outsider', { rewardSector: STRAND }, '127.6.1.5'),
                [undefined, undefined],
            );
        } finally {
            online.remove('third');
            online.remove('outsider');
        }
    });
});
