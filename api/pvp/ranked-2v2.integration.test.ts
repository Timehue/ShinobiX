import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
const priorSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = 'ranked-2v2-handler-integration-secret';

let kv: typeof import('../_storage.js').kv;
let duo: typeof import('./_ranked-2v2.js');
let handler: typeof import('./ranked-2v2.js').default;
let writeMatch: typeof import('../towers/_pvp-store.js').writeTowerPvpMatch;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    duo = await import('./_ranked-2v2.js');
    handler = (await import('./ranked-2v2.js')).default as unknown as typeof handler;
    ({ writeTowerPvpMatch: writeMatch } = await import('../towers/_pvp-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
});
after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    if (priorSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = priorSecret;
});

async function call(name: string, matchId: string, command: Record<string, unknown> = {}) {
    let status = 200;
    let body: Record<string, unknown> = {};
    const response = {
        setHeader: () => response,
        status: (code: number) => { status = code; return response; },
        json: (value: Record<string, unknown>) => { body = value; return response; },
        end: () => response,
    };
    await handler({
        method: 'POST', body: { action: 'settle', playerName: name, matchId, ...command },
        headers: { 'x-player-token': issuePlayerToken(name)! },
        socket: { remoteAddress: `10.29.0.${name.length}` },
    } as never, response as never);
    return { status, body };
}

test('all four ranked 2v2 players can acknowledge the same result after pointers clear', async () => {
    const names = ['duoalpha', 'duobeta', 'duogamma', 'duodelta'];
    for (const name of names) {
        await kv.set(`save:${name}`, { character: {
            name, level: 40, ranked2v2Rating: 1000,
            maxHp: 1200, maxChakra: 200, maxStamina: 200,
            specialty: 'Taijutsu', stats: { strength: 200 }, jutsu: [],
        } });
    }
    await duo.inviteRanked2v2Partner({ actor: names[0], target: names[1] });
    await duo.acceptRanked2v2Invite(names[1]);
    await duo.queueRanked2v2(names[0]);
    await duo.inviteRanked2v2Partner({ actor: names[2], target: names[3] });
    await duo.acceptRanked2v2Invite(names[3]);
    await duo.queueRanked2v2(names[2]);
    const match = (await duo.ranked2v2Status(names[0])).match!;
    await writeMatch({ ...match, status: 'done', winner: 'amber', updatedAt: Date.now() });

    assert.equal((await call('duoepsilon', match.matchId)).status, 404, 'an outsider cannot settle this match');

    const first = await call(names[0], match.matchId);
    assert.equal(first.status, 200);
    assert.equal((first.body.character as { name: string }).name, names[0]);
    assert.ok(Number(first.body._saveVersion) > 0);
    const registry = await kv.hgetall<Record<string, { ranked2v2Rating: number }>>('player:registry');
    assert.ok((registry?.[names[0]]?.ranked2v2Rating ?? 1000) !== 1000, 'the public board receives the rated result');
    assert.ok((registry?.[names[2]]?.ranked2v2Rating ?? 1000) !== 1000, 'opposing team is projected too');
    assert.equal((await duo.ranked2v2Status(names[1])).match, null, 'the first settlement clears old pointers');

    for (const name of names.slice(1)) {
        const replay = await call(name, match.matchId);
        assert.equal(replay.status, 200, `${name} can still acknowledge by match ID`);
        assert.equal((replay.body.character as { name: string }).name, name);
        assert.ok(Number(replay.body._saveVersion) > 0);
    }
    const rated = await kv.get<{ character: { ranked2v2Wins?: number; ranked2v2Losses?: number } }>(`save:${names[0]}`);
    assert.equal((rated?.character.ranked2v2Wins ?? 0) + (rated?.character.ranked2v2Losses ?? 0), 1);
});

test('ranked ready checks authenticate each member and start only after all four confirm', async () => {
    const names = ['readyalpha', 'readybeta', 'readygamma', 'readydelta'];
    for (const name of names) await kv.set(`save:${name}`, { character: {
        name, level: 40, maxHp: 1200, maxChakra: 200, maxStamina: 200,
        specialty: 'Taijutsu', stats: { strength: 200 }, jutsu: [],
    } });
    for (const [a, b] of [[names[0], names[1]], [names[2], names[3]]]) {
        assert.equal((await duo.inviteRanked2v2Partner({ actor: a, target: b })).ok, true);
        await duo.acceptRanked2v2Invite(b);
        await duo.queueRanked2v2(a);
    }
    let match = (await duo.ranked2v2Status(names[0])).match!;
    const command = { action: 'ready', ready: true, expectedVersion: match.version, requestId: crypto.randomUUID() };
    assert.equal((await call('readyoutsider', match.matchId, command)).status, 403);
    assert.equal((await call(names[0], match.matchId, { ...command, requestId: '' })).status, 400);
    await writeMatch({ ...match, binding: { kind: 'public-queue' } });
    const foreignSurface = await call(names[0], match.matchId, command);
    assert.equal(foreignSurface.status, 403);
    assert.equal(foreignSurface.body.errorCode, 'wrong-surface');
    await writeMatch(match);
    const first = await call(names[0], match.matchId, command);
    assert.equal(first.status, 200);
    assert.equal((await call(names[0], match.matchId, command)).body.replayed, true);
    match = (await duo.ranked2v2Status(names[0])).match!;
    assert.equal(match.status, 'ready');
    for (const name of names.slice(1)) {
        const result = await call(name, match.matchId, { action: 'ready', ready: true,
            expectedVersion: match.version, requestId: crypto.randomUUID() });
        assert.equal(result.status, 200);
        match = (await duo.ranked2v2Status(names[0])).match!;
    }
    assert.equal(match.status, 'active');
    assert.ok(match.roster.every(member => member.ready));
    assert.ok(match.combat.turnQueue.length > 0);
});
