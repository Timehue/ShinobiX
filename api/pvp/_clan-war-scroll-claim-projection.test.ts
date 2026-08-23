import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'clan-war-scroll-claim-projection-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let scrollDrop: typeof import('../clan/war/_war-points.js').clanWarPvpTerritoryScrollDrop;

function response() {
    const out: { statusCode: number; body?: Record<string, any> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function request(playerName: string, battleId: string) {
    return {
        method: 'POST',
        body: { playerName, battleId, outcome: 'win', completionVersion: 1 },
        query: {},
        headers: {
            'x-player-token': issuePlayerToken(playerName),
            'x-forwarded-for': '127.0.0.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

function scrollCount(save: Record<string, any> | null): number {
    return (save?.character?.itemStacks ?? [])
        .filter((stack: Record<string, unknown>) => stack.itemId === 'territory-control-scroll')
        .reduce((sum: number, stack: Record<string, unknown>) => sum + Number(stack.count ?? 0), 0);
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ clanWarPvpTerritoryScrollDrop: scrollDrop } = await import('../clan/war/_war-points.js'));
    handler = (await import('./claim-rewards.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.DISABLE_COMBAT_RECEIPTS;
});

test('Clan War reward claim returns the exact scroll roll and versioned inventory on first claim and replay', async () => {
    const now = Date.now();
    const winner = 'scrollclaimwinner';
    const loser = 'scrollclaimloser';
    const battleId = 'pvp-clan-scroll-claim-12345678';
    const warId = 'scroll-claim-from-vs-to';
    const challengeId = 'scroll-claim-challenge';

    for (const [name, clan] of [[winner, 'From'], [loser, 'To']] as const) {
        await kv.set(`save:${name}`, {
            _saveVersion: 1,
            character: {
                name,
                clan,
                village: clan === 'From' ? 'Leaf' : 'Mist',
                level: 30,
                stats: {},
                inventory: [],
                itemStacks: [],
                clanPoints: 0,
                weeklyClanPoints: 0,
                lifetimeClanPoints: 0,
                clanPointHistory: [],
                serverSettlementReceipts: [],
            },
        });
    }
    await kv.set(`clan-war:${warId}`, {
        id: warId,
        clans: ['From', 'To'],
        villages: { From: 'Leaf', To: 'Mist' },
        hp: { From: 100, To: 100 },
        startedAt: now - 20_000,
        updatedAt: now - 20_000,
        declaredBy: winner,
        pendingChallenges: [{
            id: challengeId,
            mode: 'pvp1v1',
            fromClan: 'From',
            fromPlayer: winner,
            acceptedPlayer: loser,
            createdAt: now - 18_000,
            acceptedAt: now - 16_000,
            expiresAt: now + 60_000,
            status: 'accepted',
            battleId,
        }],
        completedChallenges: [],
    });
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: winner, character: { name: winner, clan: 'From', village: 'Leaf', level: 30 } },
        p2: { name: loser, character: { name: loser, clan: 'To', village: 'Mist', level: 30 } },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'clan-war',
        clanWarId: warId,
        clanWarChallengeId: challengeId,
        joined: { p1: true, p2: true },
        realFighters: { p1: true, p2: true },
        pvpCompletionAuthorityVersion: 1,
        pvpConsumableAuthorityVersion: 1,
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt: now - 15_000,
        lastMoveAt: now,
        endedAt: now,
    }, { ex: 48 * 60 * 60 });

    const expected = scrollDrop(battleId, winner) ? 1 : 0;
    for (const alreadyClaimed of [false, true]) {
        const result = response();
        await handler(request(winner, battleId), result.res);
        assert.equal(result.out.statusCode, 200);
        assert.equal(result.out.body?.alreadyClaimed, alreadyClaimed);
        assert.deepEqual(result.out.body?.clanWarScrollDrop, { awarded: expected, chancePercent: 20 });
        assert.equal(scrollCount({ character: result.out.body?.character }), expected);
        assert.ok(Number(result.out.body?._saveVersion) > 1);
    }

    assert.equal(scrollCount(await kv.get<Record<string, any>>(`save:${winner}`)), expected);
    assert.equal(scrollCount(await kv.get<Record<string, any>>(`save:${loser}`)), 0);
});
