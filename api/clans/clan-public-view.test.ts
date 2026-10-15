process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'clan-public-view-test-secret-32-bytes';
process.env.ADMIN_PASSWORD = 'clan-public-view-test-admin';

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * L10 (security audit 2026-10-15): a clan's shared record is read whole only
 * by its members and admins. Every other logged-in player gets the public clan
 * view, through all three doors: /api/save/clan-<slug>, /api/clans/list and
 * /api/clan/seal-pool/get.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let saveHandler: Handler;
let listHandler: Handler;
let poolHandler: Handler;
let view: typeof import('./_clan-public-view.js');

const MEMBER = 'emberwarden';
const OUTSIDER = 'drifterfox';
const CLAN = 'Ember Pact';
const SLUG = 'emberpact';

const PRIVATE_FIELDS = ['treasury', 'settlementReceipts', 'joinRequestsSecret', 'roleOverrides', 'notices',
    'activeWar', 'warHistory', 'upgrades', 'campaignHistory', 'program', 'memberJoinedAt', 'serverCreatedAt',
    'clanBossRewardReceipts', 'pvpWarXpReceipts', '_saveVersion'];

const CLAN_RECORD: Json = {
    name: CLAN,
    village: 'Leaf',
    founderName: MEMBER,
    image: '',
    doctrine: 'warmonger',
    recruitment: 'Fire walks with us.',
    createdAt: 1_700_000_000_000,
    serverCreatedAt: 1_700_000_000_000,
    level: 4,
    xp: 120,
    members: [{ name: MEMBER, village: 'Leaf', level: 30, specialty: 'Ninjutsu', battleContrib: 1, eventContrib: 0, missionContrib: 0, isFounder: true, month: '2026-10' }],
    memberJoinedAt: { [MEMBER]: 1_700_000_000_000 },
    joinRequests: [{ name: 'hopeful', village: 'Leaf', level: 5, specialty: 'Taijutsu', battleContrib: 0, eventContrib: 0, missionContrib: 0, isFounder: false, month: '2026-10', requestedAt: 1 }],
    treasury: { ryo: 99_999, fateShards: 4, boneCharms: 0, auraStones: 0, mythicSeals: 0, warSupply: 0, provisions: 0, items: [] },
    upgrades: { scoutNetwork: 2 },
    roleOverrides: { someone: 'Leader' },
    notices: [{ id: 'n1', title: 'Raid at dawn', body: 'secret plan', author: MEMBER }],
    activeWar: { opponentClan: 'Rivals', enemyVillage: 'Sand', ourScore: 3, enemyScore: 1, startedAt: 1, endsAt: Date.now() + 86_400_000 },
    warHistory: [{ opponent: 'Old foes', result: 'Won', warCrateId: 'crate-1' }],
    settlementReceipts: { abc: 1 },
    campaignHistory: [{ season: 'x' }],
    campaignPrestige: { earnedBanners: ['b1'] },
    program: { id: 'p' },
    _saveVersion: 7,
};

function response() {
    const out: { statusCode: number; body?: unknown } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: unknown) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

let ipSeed = 0;
function playerHeaders(name: string): Json {
    const ip = `10.77.0.${++ipSeed}`;
    return { 'x-player-name': name, 'x-player-token': issuePlayerToken(name), 'x-forwarded-for': ip };
}
function adminHeaders(): Json {
    return { 'x-admin-password': process.env.ADMIN_PASSWORD, 'x-forwarded-for': `10.78.0.${++ipSeed}` };
}

async function call(handler: Handler, headers: Json, query: Json) {
    const { out, res } = response();
    await handler({ method: 'GET', query, headers, socket: { remoteAddress: String(headers['x-forwarded-for']) } } as never, res);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    saveHandler = (await import('../save/[name].js')).default as unknown as Handler;
    listHandler = (await import('./list.js')).default as unknown as Handler;
    poolHandler = (await import('../clan/seal-pool/get.js')).default as unknown as Handler;
    view = await import('./_clan-public-view.js');
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set(`save:clan-${SLUG}`, CLAN_RECORD);
    await kv.set(`save:${MEMBER}`, { _saveVersion: 1, character: { name: MEMBER, clan: CLAN, village: 'Leaf', level: 30 } });
    await kv.set(`save:${OUTSIDER}`, { _saveVersion: 1, character: { name: OUTSIDER, village: 'Leaf', level: 12 } });
    await kv.set(`clan-seal-pool:${CLAN.toLowerCase()}`, {
        clanName: CLAN, balance: 40, log: [{ donor: MEMBER, amount: 40, at: 1 }],
    });
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_PASSWORD;
});

function assertPublicOnly(body: Json) {
    for (const field of PRIVATE_FIELDS) assert.equal(field in body, false, `${field} must not reach a non-member`);
    // Everything the client reads from another clan stays.
    assert.equal(body.name, CLAN);
    assert.equal(body.village, 'Leaf');
    assert.equal(body.founderName, MEMBER);
    assert.equal(body.doctrine, 'warmonger');
    assert.equal(body.recruitment, 'Fire walks with us.');
    assert.equal(body.level, 4);
    assert.deepEqual(body.members, CLAN_RECORD.members);
    assert.deepEqual(body.joinRequests, CLAN_RECORD.joinRequests, 'join requests stay: the join flow re-posts them');
    assert.deepEqual(body.campaignPrestige, CLAN_RECORD.campaignPrestige);
}

describe('clan public view (L10)', { concurrency: false }, () => {
    it('the view is an allowlist', () => {
        const projected = view.clanPublicView({ ...CLAN_RECORD, futureServerField: 'x' })!;
        assert.equal('futureServerField' in projected, false);
        assertPublicOnly(projected);
        assert.equal(view.clanPublicView(null), null);
    });

    it('GET /api/save/clan-<slug>: a non-member gets the public view', async () => {
        const out = await call(saveHandler, playerHeaders(OUTSIDER), { name: `clan-${SLUG}` });
        assert.equal(out.statusCode, 200);
        assertPublicOnly(out.body as Json);
    });

    it('GET /api/save/clan-<slug>: a member and an admin get the full record', async () => {
        const member = await call(saveHandler, playerHeaders(MEMBER), { name: `clan-${SLUG}` });
        assert.equal(member.statusCode, 200);
        assert.deepEqual(member.body, CLAN_RECORD);
        const admin = await call(saveHandler, adminHeaders(), { name: `clan-${SLUG}` });
        assert.equal(admin.statusCode, 200);
        assert.deepEqual(admin.body, CLAN_RECORD);
    });

    it('GET /api/clans/list: other clans are projected, the caller\'s own clan is whole', async () => {
        const outsider = await call(listHandler, playerHeaders(OUTSIDER), {});
        assert.equal(outsider.statusCode, 200);
        const outsiderRows = outsider.body as Json[];
        assert.equal(outsiderRows.length, 1);
        assertPublicOnly(outsiderRows[0]);

        const member = await call(listHandler, playerHeaders(MEMBER), {});
        assert.deepEqual(member.body, [CLAN_RECORD]);
        const admin = await call(listHandler, adminHeaders(), {});
        assert.deepEqual(admin.body, [CLAN_RECORD]);
    });

    it('a join request built from the public view keeps every private field (client enhanceClanData echo)', async () => {
        const { validateClanSaveWrite } = await import('../_clan-save-validate.js');
        const projected = view.clanPublicView(CLAN_RECORD)!;
        const request = { name: OUTSIDER, village: 'Leaf', level: 12, specialty: 'Ninjutsu', battleContrib: 0, eventContrib: 0, missionContrib: 0, isFounder: false, month: '2026-10', requestedAt: 2 };
        // What ClanHall.requestJoinClan posts: enhanceClanData() fills the
        // stripped fields with empty defaults, then appends the request.
        const echoed: Json = {
            ...projected,
            treasury: { ryo: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, warSupply: 0, items: [] },
            upgrades: { trainingGrounds: 0, warRoom: 0, treasury: 0, petDen: 0, medicalWing: 0, blacksmith: 0, scoutNetwork: 0 },
            warHistory: [], roleOverrides: {}, notices: [],
            joinRequests: [...(projected.joinRequests as Json[]), request],
        };
        const { next } = validateClanSaveWrite(structuredClone(CLAN_RECORD), JSON.parse(JSON.stringify(echoed)), { callerName: OUTSIDER, isAdmin: false });
        for (const field of ['treasury', 'upgrades', 'warHistory', 'roleOverrides', 'notices', 'activeWar', 'settlementReceipts', 'campaignHistory', 'program']) {
            assert.deepEqual(next[field], CLAN_RECORD[field], `${field} is pinned to the stored value`);
        }
        assert.deepEqual(next.joinRequests, [...(CLAN_RECORD.joinRequests as Json[]), request], 'the request lands');
    });

    it('GET /api/clan/seal-pool/get: donor log for members and admins only', async () => {
        const outsider = await call(poolHandler, playerHeaders(OUTSIDER), { clanName: CLAN });
        assert.equal(outsider.statusCode, 200);
        assert.deepEqual(outsider.body, { clanName: CLAN, balance: 40, log: [] });

        const member = await call(poolHandler, playerHeaders(MEMBER), { clanName: CLAN });
        assert.deepEqual((member.body as Json).log, [{ donor: MEMBER, amount: 40, at: 1 }]);
        const admin = await call(poolHandler, adminHeaders(), { clanName: CLAN });
        assert.deepEqual((admin.body as Json).log, [{ donor: MEMBER, amount: 40, at: 1 }]);
    });
});
