import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-ranked-start-authority-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let startHandler: Handler;
let issuePlayerToken: (name: string) => string | null;

const players = [
    'rankedstartalpha',
    'rankedstartbravo',
    'rankedstartcharlie',
    'rankedstartdelta',
    'rankedstartecho',
    'rankedstartfoxtrot',
    'rankedstartgolf',
];

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function request(body: Record<string, unknown>, player: string) {
    return {
        method: 'POST',
        body,
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(player) ?? '',
        },
        socket: { remoteAddress: `127.0.0.${players.indexOf(player) + 10}` },
    } as never;
}

async function post(handler: Handler, player: string, body: Record<string, unknown>): Promise<Out> {
    const { res, out } = response();
    await handler(request(body, player), res);
    return out;
}

async function queuePair(a: string, b: string): Promise<Record<string, unknown>> {
    const pairId = randomUUID();
    const createdAt = Date.now();
    const initiator = a < b ? a : b;
    const matchA = {
        opponent: b,
        opponentElo: 1000,
        opponentLevel: 20,
        initiator: a === initiator,
        createdAt,
        pairId,
    };
    const matchB = {
        opponent: a,
        opponentElo: 1000,
        opponentLevel: 20,
        initiator: b === initiator,
        createdAt,
        pairId,
    };
    await Promise.all([
        kv.set(`pvp:pet-ranked-queue:match:${a}`, matchA, { ex: 30 }),
        kv.set(`pvp:pet-ranked-queue:match:${b}`, matchB, { ex: 30 }),
    ]);
    return a === initiator ? matchA : matchB;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    startHandler = (await import('./ranked-start.js')).default as unknown as Handler;
    for (const [index, name] of players.entries()) {
        const pet = {
            id: `${name}-pet`,
            name: `${name} Pet`,
            rarity: 'standard',
            level: 20,
            xp: 0,
            maxLevel: 100,
            hp: 300 + index,
            attack: 60,
            defense: 40,
            speed: 35,
            jutsus: [{ name: 'Strike', power: 50, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
        };
        await kv.set(`save:${name}`, {
            _saveVersion: 1,
            character: {
                name,
                level: 20,
                petRankedRating: 1000 + index,
                activePetId: pet.id,
                pets: [pet],
            },
        });
    }
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('an authenticated caller cannot mint a ranked proof for an arbitrary victim', async () => {
    const out = await post(startHandler, players[0], {
        opponentName: players[1],
        petId: `${players[0]}-pet`,
    });
    assert.equal(out.statusCode, 409);
    assert.match(String(out.body?.error), /retained reciprocal ranked pairing/i);
    assert.deepEqual(await kv.keys('pet:ranked-token:*'), []);
    assert.equal(await kv.get('pet:ranked-active'), null);
});

test('a retained reciprocal compatibility proof mints one token and concurrent/lost-response retries reuse it', async () => {
    const [alpha, bravo] = players;
    const match = await queuePair(alpha, bravo);
    assert.equal(match.initiator, true);
    assert.match(String(match.pairId), /^[0-9a-f-]{36}$/i);

    const body = { opponentName: bravo, petId: `${alpha}-pet` };
    const [first, retry] = await Promise.all([
        post(startHandler, alpha, body),
        post(startHandler, alpha, body),
    ]);
    assert.equal(first.statusCode, 200);
    assert.equal(retry.statusCode, 200);
    assert.equal(first.body?.matchToken, retry.body?.matchToken);
    assert.equal(first.body?.seed, retry.body?.seed);
    assert.ok(first.body?.replayed === true || retry.body?.replayed === true);

    const matchToken = String(first.body?.matchToken ?? '');
    const proof = await kv.get<Record<string, unknown>>(`pet:ranked-token:${matchToken}`);
    assert.equal(proof?.authority, 'pet-ranked-queue-v1');
    assert.equal(proof?.pairId, match.pairId);
    assert.equal(proof?.a, alpha);
    assert.equal(proof?.b, bravo);
    const registry = await kv.get<Record<string, Record<string, unknown>>>('pet:ranked-active');
    assert.equal(registry?.[alpha]?.matchToken, matchToken);
    assert.equal(registry?.[bravo]?.matchToken, matchToken);
    assert.equal(await kv.get(`pvp:pet-ranked-queue:match:${alpha}`), null);
    assert.equal(await kv.get(`pvp:pet-ranked-queue:match:${bravo}`), null);

    const replay = await post(startHandler, alpha, body);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body?.replayed, true);
    assert.equal(replay.body?.matchToken, matchToken);
});

test('only the proof-selected initiator may bind a pair and one active match blocks a second compatibility proof', async () => {
    const delta = players[3];
    const echo = players[4];
    const match = await queuePair(delta, echo);
    assert.equal(match.initiator, true);
    const nonInitiator = await post(startHandler, echo, { opponentName: delta, petId: `${echo}-pet` });
    assert.equal(nonInitiator.statusCode, 409);
    assert.match(String(nonInitiator.body?.error), /retained reciprocal ranked pairing/i);

    const alpha = players[0];
    const charlie = players[2];
    await queuePair(alpha, charlie);
    const secondStart = await post(startHandler, alpha, { opponentName: charlie, petId: `${alpha}-pet` });
    assert.equal(secondStart.statusCode, 409);
    assert.match(String(secondStart.body?.error), /active ranked pet match/i);
    assert.ok(await kv.get(`pvp:pet-ranked-queue:match:${charlie}`), 'the unconsumed compatibility proof remains recoverable');
});

test('a held matchmaking lock fails closed without minting or reserving either player', async () => {
    const foxtrot = players[5];
    const golf = players[6];
    await queuePair(foxtrot, golf);
    await kv.set('lock:pvp:pet-ranked-queue', 'held-by-test', { ex: 5 });
    try {
        const before = await kv.keys('pet:ranked-token:*');
        const blocked = await post(startHandler, foxtrot, {
            opponentName: golf,
            petId: `${foxtrot}-pet`,
        });
        assert.equal(blocked.statusCode, 503);
        assert.deepEqual(await kv.keys('pet:ranked-token:*'), before);
        const registry = await kv.get<Record<string, unknown>>('pet:ranked-active');
        assert.equal(registry?.[foxtrot], undefined);
        assert.equal(registry?.[golf], undefined);
    } finally {
        await kv.del('lock:pvp:pet-ranked-queue');
    }
});
