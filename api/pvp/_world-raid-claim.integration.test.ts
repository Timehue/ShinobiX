import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'world-raid-claim-integration-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

/*
 * The 2026-09-01 incident, driven through the REAL claim-rewards handler.
 *
 * Two players were pinned on the victory screen after an open-world duel in
 * Frostfang Icefields (sector 59). `settleRaidTerritoryDamage` synthesised a
 * default `world:territory:59` row, then used that projection as the CAS
 * `expected` — which on an absent key compiles to `UPDATE ... WHERE value = ?`
 * and matches nothing. Every retry threw `raid-territory-row-conflict`, so the
 * claim 503'd forever and neither fighter could leave.
 *
 * The unit tests cover settleRaidTerritoryDamage and
 * settleRaidProgressionWithDailyCap. This one covers the thing players actually
 * hit: POST /api/pvp/claim-rewards must return 200 for a world-PvP win in a
 * sector that has never been captured or raided. Sectors 25 and 34-66 were all
 * in that state in production — more than half the map.
 *
 * The session fixture is the shape of the real battle, read out of kv_store
 * during the incident.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

const SECTOR = 59;
const WINNER = 'worldraidwinner';
const LOSER = 'worldraidloser';
const BATTLE_ID = 'pvp-world-raid-virgin-sector-1';
const VILLAGE = 'Frostfang Village';
const CLAN = 'Meow';

function response() {
    const out: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Record<string, unknown>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function request(playerName: string, outcome: 'win' | 'loss') {
    return {
        method: 'POST',
        body: { playerName, battleId: BATTLE_ID, outcome, completionVersion: 1 },
        query: {},
        headers: {
            'x-player-token': issuePlayerToken(playerName),
            'x-forwarded-for': '127.0.0.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

function fighter(name: string) {
    return {
        name,
        hp: 100, maxHp: 100,
        character: { name, village: VILLAGE, clan: CLAN, level: 20 },
    };
}

async function seed(now: number) {
    for (const name of [WINNER, LOSER]) {
        await kv.set(`save:${name}`, {
            _saveVersion: 1,
            currentSector: SECTOR,
            acceptedMissionIds: [],
            missionProgress: {},
            character: {
                name,
                village: VILLAGE,
                clan: CLAN,
                level: 20,
                ryo: 100,
                profession: 'healer',
                professionRank: 1,
                professionXp: 0,
                stats: {},
                inventory: [],
                itemStacks: [],
                serverSettlementReceipts: [],
            },
        });
    }
    await kv.set(`pvp:${BATTLE_ID}`, {
        battleId: BATTLE_ID,
        p1: fighter(WINNER),
        p2: fighter(LOSER),
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'world',
        progressionAuthorityVersion: 1,
        worldAttacker: { side: 'p1', name: WINNER, village: VILLAGE, clan: CLAN },
        worldTerritoryEvidence: {
            version: 1,
            sector: SECTOR,
            ownerClan: '',
            ownerVillage: '',
            raidDamage: 0,
            observedAt: now - 60_000,
        },
        rewardSector: SECTOR,
        baseRewards: true,
        joined: { p1: true, p2: true },
        realFighters: { p1: true, p2: true },
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt: now - 60_000,
        endedAt: now - 1_000,
    }, { ex: 24 * 60 * 60 });
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./claim-rewards.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.DISABLE_COMBAT_RECEIPTS;
});

test('a world-PvP win settles in a sector that has no territory row', async () => {
    const now = Date.now();
    await seed(now);
    assert.equal(
        await kv.get(`world:territory:${SECTOR}`),
        null,
        'precondition: the sector has never been captured or raided',
    );

    const first = response();
    await handler(request(WINNER, 'win'), first.res);

    assert.notEqual(
        first.out.statusCode,
        503,
        `the winner's claim 503'd — this is the incident: ${JSON.stringify(first.out.body)}`,
    );
    assert.equal(first.out.statusCode, 200, JSON.stringify(first.out.body));
    assert.equal(first.out.body?.ok, true);

    // The settle must have created the row it previously CAS'd against.
    const row = await kv.get<Record<string, unknown>>(`world:territory:${SECTOR}`);
    assert.ok(row, 'the sector row must exist after settlement');
    assert.equal(row.sector, SECTOR);

    // And the raid progression receipt must be on the winner's save.
    const save = await kv.get<Record<string, unknown>>(`save:${WINNER}`);
    const character = save?.character as Record<string, unknown>;
    const receipts = (character.raidProgressionSettlements ?? []) as Array<{ proofId?: string }>;
    assert.ok(
        receipts.some((entry) => entry.proofId === `pvp-raid:${BATTLE_ID}`),
        'the world-raid progression receipt must be sealed into the winner save',
    );
});

test("the loser's claim settles too — both fighters were trapped, not just the winner", async () => {
    // The raid block is gated on the SESSION's sealed attacker, not the caller,
    // so it ran for the loser's claim as well and 503'd them identically.
    const loser = response();
    await handler(request(LOSER, 'loss'), loser.res);
    assert.notEqual(loser.out.statusCode, 503, JSON.stringify(loser.out.body));
    assert.equal(loser.out.statusCode, 200, JSON.stringify(loser.out.body));
});

test('a retry of the same claim replays instead of double-settling', async () => {
    const retry = response();
    await handler(request(WINNER, 'win'), retry.res);
    assert.equal(retry.out.statusCode, 200, JSON.stringify(retry.out.body));
    assert.equal(retry.out.body?.alreadyClaimed, true);

    const save = await kv.get<Record<string, unknown>>(`save:${WINNER}`);
    const character = save?.character as Record<string, unknown>;
    const receipts = (character.raidProgressionSettlements ?? []) as Array<{ proofId?: string }>;
    assert.equal(
        receipts.filter((entry) => entry.proofId === `pvp-raid:${BATTLE_ID}`).length,
        1,
        'one receipt per proof, however many times the claim is retried',
    );
});
