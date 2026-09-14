import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { ShowdownReplayScript } from '../../shared/pet-showdown-contract.js';
import { PET_RANKED_ACTIVE_REGISTRY_KEY, petRankedCompletedKey, petRankedResultKey } from './_ranked-authority.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'ranked-replay-lifecycle-local-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let queue: Handler, start: Handler, watch: Handler, settle: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    queue = (await import('../pvp/pet-ranked-queue.js')).default as unknown as Handler;
    start = (await import('./ranked-start.js')).default as unknown as Handler;
    watch = (await import('./ranked-watch.js')).default as unknown as Handler;
    settle = (await import('./battle-result.js')).default as unknown as Handler;
});

async function call(handler: Handler, name: string, body: Record<string, unknown>) {
    const output = { status: 200, body: {} as Record<string, any> };
    const response = {
        setHeader: () => response,
        status: (value: number) => { output.status = value; return response; },
        json: (value: Record<string, any>) => { output.body = value; return response; },
        end: () => response,
    };
    await handler({ method: 'POST', body, headers: { 'x-player-token': issuePlayerToken(name) }, socket: { remoteAddress: '203.0.113.97' } } as never, response as never);
    return output;
}

async function pair(prefix: string) {
    const a = `${prefix}alpha`, b = `${prefix}bravo`;
    for (const [name, multiplier] of [[a, 1], [b, 2]] as const) {
        await kv.set(`save:${name}`, { _saveVersion: 1, character: {
            name, level: 40, ryo: 0, petRankedRating: 1000,
            pets: [{ id: `${name}-pet`, name: `${name} pet`, rarity: 'rare', element: 'Fire', role: 'assassin', level: 40,
                hp: 900 * multiplier, attack: 120 * multiplier, defense: 70, speed: 80, jutsus: [] }],
        } });
    }
    assert.equal((await call(queue, a, { name: a, action: 'join' })).body.state, 'queued');
    assert.equal((await call(queue, b, { name: b, action: 'join' })).body.state, 'paired');
    const begun = await call(start, b, { opponentName: a });
    assert.equal(begun.status, 200);
    return { a, b, matchToken: String(begun.body.matchToken) };
}

test('peer settlement preserves discovery and viewer-relative replays, without repaying or blocking another match', async () => {
    const { a, b, matchToken } = await pair('replayflow');
    const bWatch = await call(watch, b, { matchToken });
    assert.equal(bWatch.status, 200);
    const bScript = bWatch.body.script as ShowdownReplayScript;
    assert.equal(bScript.initialState.player[0].name, `${b} pet`);
    assert.equal(bScript.initialState.enemyTeamName, a);
    assert.equal(bScript.finalState.outcome, bWatch.body.winnerName === b ? 'win' : 'loss');

    const first = await call(settle, b, { ranked: true, playerName: b, opponentName: a, matchToken, outcome: bScript.finalState.outcome, reportKey: `${matchToken}:ranked` });
    assert.equal(first.status, 200);
    assert.equal(await kv.get(`pet:ranked-token:${matchToken}`), null);
    assert.equal(await kv.get(`pet:ranked-intent:${matchToken}`), null);
    assert.ok((await kv.get<Record<string, unknown>>(petRankedResultKey(matchToken)))?.replay);

    const slowPoll = await call(queue, a, { name: a, action: 'poll' });
    assert.equal(slowPoll.body.state, 'completed');
    assert.equal(slowPoll.body.matchToken, matchToken);
    const aWatch = await call(watch, a, { matchToken });
    assert.equal(aWatch.status, 200);
    const aScript = aWatch.body.script as ShowdownReplayScript;
    assert.equal(aScript.initialState.player[0].name, `${a} pet`);
    assert.equal(aScript.initialState.enemyTeamName, b);
    assert.equal(aScript.finalState.outcome, aWatch.body.winnerName === a ? 'win' : 'loss');
    assert.equal(aWatch.body.winnerName, bWatch.body.winnerName);
    assert.notEqual(aScript.finalState.outcome, bScript.finalState.outcome);
    assert.deepEqual(aScript.initialState.player, bScript.initialState.enemy);
    for (const [index, event] of aScript.events.entries()) {
        const other = bScript.events[index];
        assert.equal(other.t, event.t);
        if ('actorSide' in event && 'actorSide' in other) assert.notEqual(event.actorSide, other.actorSide);
        if ('targetSide' in event && 'targetSide' in other) assert.notEqual(event.targetSide, other.targetSide);
        if ('side' in event && 'side' in other) assert.notEqual(event.side, other.side);
        if (event.t === 'end' && other.t === 'end') assert.notEqual(event.outcome, other.outcome);
    }
    assert.equal((await call(watch, 'replayoutsider', { matchToken })).status, 403);
    const savesBefore = await Promise.all([kv.get(`save:${a}`), kv.get(`save:${b}`)]);
    assert.equal((await call(settle, a, { ranked: true, playerName: a, matchToken, outcome: aScript.finalState.outcome, reportKey: `${matchToken}:ranked` })).status, 200);
    assert.deepEqual(await Promise.all([kv.get(`save:${a}`), kv.get(`save:${b}`)]), savesBefore);
    assert.equal((await call(queue, b, { name: b, action: 'acknowledge', matchToken })).body.state, 'idle');
    assert.equal((await call(queue, a, { name: a, action: 'poll' })).body.state, 'completed');
    assert.equal((await call(queue, b, { name: b, action: 'join' })).body.state, 'queued');
    await call(queue, b, { name: b, action: 'leave' });
    // A stale exit from another tab must not discard a newer replay.
    const newerToken = randomUUID();
    await kv.set(petRankedCompletedKey(a), { matchToken: newerToken, opponent: b, expiresAt: Date.now() + 60_000 });
    await call(queue, a, { name: a, action: 'acknowledge', matchToken });
    assert.equal((await kv.get<Record<string, unknown>>(petRankedCompletedKey(a)))?.matchToken, newerToken);
});

test('failed reservation cleanup keeps discovery recoverable and acknowledgment releases only a paid match', async () => {
    const { a, b, matchToken } = await pair('replayretry');
    const originalSet = kv.set;
    const originalDel = kv.del;
    try {
        kv.set = async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
            if (key === PET_RANKED_ACTIVE_REGISTRY_KEY) throw new Error('injected reservation cleanup outage');
            return originalSet(key, value, options);
        };
        kv.del = async (...keys: string[]) => {
            if (keys.includes(PET_RANKED_ACTIVE_REGISTRY_KEY)) throw new Error('injected reservation cleanup outage');
            return originalDel(...keys);
        };
        const result = await call(settle, b, { ranked: true, playerName: b, matchToken, outcome: 'win', reportKey: `${matchToken}:ranked` });
        assert.equal(result.status, 200, 'the rating remains committed despite presentation-pointer cleanup failure');
    } finally { kv.set = originalSet; kv.del = originalDel; }
    assert.equal((await call(queue, a, { name: a, action: 'poll' })).body.state, 'active');
    assert.equal((await call(watch, a, { matchToken })).status, 200);
    assert.equal((await call(queue, a, { name: a, action: 'acknowledge', matchToken })).body.state, 'idle');
    assert.equal((await call(queue, b, { name: b, action: 'poll' })).body.state, 'active', 'one viewer cannot acknowledge the other viewer');
    await call(queue, b, { name: b, action: 'acknowledge', matchToken });

    const fresh = await pair('replayunpaid');
    assert.equal((await call(queue, fresh.a, { name: fresh.a, action: 'acknowledge', matchToken: fresh.matchToken })).body.state, 'active', 'acknowledgment cannot bypass an unsettled reservation');
});

test('a durable settlement retry after active-token expiry still publishes the slower participant replay', async () => {
    const { a, b, matchToken } = await pair('replaydelayed');
    const originalSet = kv.set;
    const originalNow = Date.now;
    const startTime = originalNow();
    try {
        kv.set = async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
            if (key === petRankedResultKey(matchToken)) throw new Error('injected result receipt outage');
            return originalSet(key, value, options);
        };
        assert.equal((await call(settle, b, { ranked: true, playerName: b, matchToken, outcome: 'win', reportKey: `${matchToken}:ranked` })).status, 503);
        kv.set = originalSet;
        Date.now = () => startTime + 16 * 60_000;
        assert.equal(await kv.get(`pet:ranked-token:${matchToken}`), null);
        await pair('replayintervening');
        const registry = await kv.get<Record<string, unknown>>(PET_RANKED_ACTIVE_REGISTRY_KEY);
        assert.equal(registry?.[a], undefined, 'unrelated matchmaking pruned the expired global reservation');
        assert.equal((await call(queue, a, { name: a, action: 'poll' })).body.state, 'active', 'the independent presentation pointer recovers the durable intent');
        assert.equal((await call(settle, b, { ranked: true, playerName: b, matchToken, outcome: 'win', reportKey: `${matchToken}:ranked` })).status, 200);
        const slow = await call(queue, a, { name: a, action: 'poll' });
        assert.equal(slow.body.state, 'completed');
        assert.equal(slow.body.matchToken, matchToken);
        assert.equal((await call(watch, a, { matchToken })).status, 200);
    } finally { kv.set = originalSet; Date.now = originalNow; }
});

test('poll recovers the live token if its registry read raced token publication', async () => {
    const { a, matchToken } = await pair('replaymint');
    const originalGet = kv.get;
    try {
        // The registry read starts before publication while the pairing read
        // observes consumption afterward. The later presentation read must
        // bridge those two snapshots using the already-published live token.
        kv.get = async <T>(key: string): Promise<T | null> => key === PET_RANKED_ACTIVE_REGISTRY_KEY ? null : originalGet<T>(key);
        const state = await call(queue, a, { name: a, action: 'poll' });
        assert.equal(state.body.state, 'active');
        assert.equal(state.body.matchToken, matchToken);
    } finally { kv.get = originalGet; }
});
