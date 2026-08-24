import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pvp-bounty-test-secret-32-bytes-long!!';

/*
 * /api/pvp/bounty World Herald coverage: a posted bounty reaches the feed
 * ('medium'), a collected one reaches every village chat ('high'), and both
 * are exact-once under retries.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const PLACER = 'bountyplacer';
const HUNTER = 'bountyhunter';
const TARGET = 'bountytarget';

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let issuePlayerToken: (name: string) => string | null;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./bounty.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(`save:${PLACER}`, { _saveVersion: 1, character: { name: 'Bounty Placer', ryo: 50_000 } });
    await kv.set(`save:${HUNTER}`, { _saveVersion: 1, character: { name: 'Bounty Hunter', ryo: 100 } });
    await kv.set(`save:${TARGET}`, { _saveVersion: 1, character: { name: 'Bounty Target', ryo: 100 } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function call(playerName: string, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (b: Record<string, unknown>) => { out.body = b; return res; },
        end: () => res,
    };
    const req = {
        method: 'POST',
        body: { ...body, playerName },
        headers: { 'x-player-name': playerName, 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    };
    await handler(req as never, res as never);
    return out;
}

async function feedOf(type: string) {
    return ((await kv.get<Array<Record<string, unknown>>>('game:announcements')) ?? []).filter((a) => a.type === type);
}

test('placing a bounty posts Bounty Posted exactly once per board stamp', async () => {
    const frozen = 1_900_000_000_000;
    const realNow = Date.now;
    Date.now = () => frozen;
    try {
        const first = await call(PLACER, { action: 'place', target: 'Bounty Target', amount: 1_000 });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        // Same stamp (a retried request) -> same receipt -> no second post.
        const second = await call(PLACER, { action: 'place', target: 'Bounty Target', amount: 1_500 });
        assert.equal(second.statusCode, 200, JSON.stringify(second.body));
    } finally {
        Date.now = realNow;
    }
    const posts = await feedOf('bounty_placed');
    assert.equal(posts.length, 1, JSON.stringify(posts));
    assert.equal(posts[0].importance, 'medium');
    assert.equal(posts[0].title, 'Bounty Posted');
    // Thousands separators, en-US, so the Herald reads the same for everyone.
    assert.equal(posts[0].message, "Bounty Placer put 1,000 ryo on Bounty Target's head (total 1,000).");
    assert.equal(posts[0].receiptId, `bounty-placed:${TARGET}:${frozen}`);
    // Medium importance is feed-only: no herald line in the village chats.
    assert.equal(await kv.get('chat:village:stormveil-village'), null);
    // The target is told — both stakes land in their inbox (cap 10).
    const notices = (await kv.get<Array<Record<string, unknown>>>(`offline-notices:${TARGET}`)) ?? [];
    assert.equal(notices.length, 2, JSON.stringify(notices));
    assert.deepEqual(
        notices.map((n) => [n.kind, n.by, n.sector, n.amount, n.total]),
        [['bounty-placed', 'Bounty Placer', 0, 1_000, 1_000], ['bounty-placed', 'Bounty Placer', 0, 1_500, 2_500]],
    );
    assert.equal(await kv.get(`offline-notices:${PLACER}`), null, 'placer gets no notice');
});

test('collecting a bounty heralds Bounty Collected exactly once per battle', async () => {
    const now = Date.now();
    const placed = await call(PLACER, { action: 'place', target: 'Bounty Target', amount: 2_000 });
    assert.equal(placed.statusCode, 200, JSON.stringify(placed.body));

    const battleId = 'pvp-bounty-herald-battle-12345678';
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: 'Bounty Hunter', character: { name: 'Bounty Hunter' } },
        p2: { name: 'Bounty Target', character: { name: 'Bounty Target' } },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'world',
        joined: { p1: true, p2: true },
        baseRewards: true,
        log: [],
        createdAt: now - 5_000,
        endedAt: now - 1_000,
    });

    const first = await call(HUNTER, { action: 'claim', battleId });
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.equal(first.body?.amount, 2_000);
    const second = await call(HUNTER, { action: 'claim', battleId });
    assert.equal(second.statusCode, 200, JSON.stringify(second.body));
    assert.equal(second.body?.alreadyClaimed, true);

    const posts = await feedOf('bounty_claimed');
    assert.equal(posts.length, 1, JSON.stringify(posts));
    assert.equal(posts[0].importance, 'high');
    assert.equal(posts[0].title, 'Bounty Collected');
    assert.equal(posts[0].message, 'Bounty Hunter collected the 2,000-ryo bounty on Bounty Target.');
    assert.equal(posts[0].receiptId, `bounty-claimed:${battleId}`);
    const chat = (await kv.get<Array<Record<string, unknown>>>('chat:village:ashen-leaf-village')) ?? [];
    assert.equal(chat.filter((m) => m.receiptId === posts[0].receiptId).length, 1);
    // The loser is told exactly once (the retry short-circuits before paying).
    const notices = (await kv.get<Array<Record<string, unknown>>>(`offline-notices:${TARGET}`)) ?? [];
    const claimed = notices.filter((n) => n.kind === 'bounty-claimed');
    assert.equal(claimed.length, 1, JSON.stringify(notices));
    assert.equal(claimed[0].by, 'Bounty Hunter');
    assert.equal(claimed[0].amount, 2_000);
    assert.equal(claimed[0].sector, 0);
    assert.equal(await kv.get(`offline-notices:${HUNTER}`), null, 'winner gets no notice');
});
