import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'legacy-ranked-drain-test-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

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

function request(player: string, battleId: string, outcome: 'win' | 'loss') {
    return {
        method: 'POST',
        body: { battleId, playerName: player, outcome },
        query: {},
        headers: {
            'x-player-token': issuePlayerToken(player),
            'x-forwarded-for': '127.0.0.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function runLegacyDrain(suffix: string) {
    const a = `legacyalice${suffix}`;
    const b = `legacybob${suffix}`;
    const battleId = `pvp-legacy-${suffix}`;
    await Promise.all([
        kv.set(`save:${a}`, {
            _saveVersion: 1,
            character: {
                name: a,
                rankedRating: 1000,
                rankedWins: 0,
                itemStacks: [{ itemId: 'legacy-potion', count: 2 }],
                serverSettlementReceipts: [],
            },
        }),
        kv.set(`save:${b}`, {
            _saveVersion: 101,
            character: {
                name: b,
                rankedRating: 1000,
                rankedLosses: 0,
                itemStacks: [{ itemId: 'legacy-potion', count: 2 }],
                serverSettlementReceipts: [],
            },
        }),
    ]);
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: a },
        p2: { name: b },
        status: 'done',
        winner: 'p1',
        ranked: true,
        rankedKind: 'player',
        p1Rating: 1000,
        p2Rating: 1000,
        rewardAuthority: 'ranked',
        joined: { p1: true, p2: true },
        baseRewards: false,
        realFighters: { p1: true, p2: true },
        itemsUsed: {
            p1: { 'legacy-potion': 1 },
            p2: { 'legacy-potion': 1 },
        },
        log: [],
        createdAt: Date.now(),
    }, { ex: 900 });

    const first = response();
    await handler(request(a, battleId, 'win'), first.res);
    assert.equal(first.out.statusCode, 200);
    const savedA = await kv.get<Record<string, any>>(`save:${a}`);
    const savedB = await kv.get<Record<string, any>>(`save:${b}`);
    assert.equal(savedA?.character.rankedRating, 1012);
    assert.equal(savedB?.character.rankedRating, 988);
    assert.equal(savedA?.character.itemStacks?.[0]?.count, 1);
    assert.equal(savedB?.character.itemStacks?.[0]?.count, 1);
    assert.equal(first.out.body?._saveVersion, savedA?._saveVersion,
        'claim response echoes the authenticated caller after both legacy saves settle');
    assert.notEqual(first.out.body?._saveVersion, savedB?._saveVersion,
        'the response must not leak or adopt the opponent save version');

    const replay = response();
    await handler(request(a, battleId, 'win'), replay.res);
    assert.equal(replay.out.statusCode, 200);
    const replayedA = await kv.get<Record<string, any>>(`save:${a}`);
    const replayedB = await kv.get<Record<string, any>>(`save:${b}`);
    assert.equal(replayedA?.character.rankedWins, 1);
    assert.equal(replayedB?.character.rankedLosses, 1);
    assert.equal(replayedA?.character.itemStacks?.[0]?.count, 1);
    assert.equal(replayedB?.character.itemStacks?.[0]?.count, 1);
    assert.equal(replay.out.body?._saveVersion, replayedA?._saveVersion);
    assert.deepEqual(await kv.keys('player:ranked-journal:*'), [], 'legacy drain never creates a V2 journal');
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
    delete process.env.ENABLE_PLAYER_RANKED_V2;
});

test('upgraded claim drains and replays a d76a ranked terminal while V2 is off', async () => {
    delete process.env.ENABLE_PLAYER_RANKED_V2;
    await runLegacyDrain('off');
});

test('upgraded claim preserves the legacy path after V2 admissions turn on', async () => {
    process.env.ENABLE_PLAYER_RANKED_V2 = '1';
    await runLegacyDrain('on');
});
