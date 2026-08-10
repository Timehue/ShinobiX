import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
const SESSION_SECRET = 'running-lobby-recovery-test-secret';
process.env.SESSION_SECRET = SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const CODE = 'ABCDEFGH';
const HOST = 'lobby-recovery-host';
const MEMBER = 'lobby-recovery-member';
const OUTSIDER = 'lobby-recovery-outsider';
const KEY = `arena:lobby:${CODE}`;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let sealedLobby: import('./_lobby-core.js').Lobby;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./lobby.js')).default as unknown as Handler;
    const { newLobby, resolveMatch, slotOf, snapshotPet } = await import('./_lobby-core.js');
    const now = Date.now();
    const lobby = newLobby(CODE, HOST, now);
    const hostSlot = slotOf(lobby, 'blue', 0);
    hostSlot.ready = true;
    hostSlot.pets = [0, 1].map((index) => snapshotPet({
        id: `host-${index}`, name: `Host ${index}`, rarity: 'rare', level: 25,
        hp: 600, attack: 80, defense: 40, speed: 60, element: 'Fire',
    }));
    const memberSlot = slotOf(lobby, 'blue', 1);
    memberSlot.name = MEMBER;
    memberSlot.joinedAt = now;
    memberSlot.ready = true;
    memberSlot.pets = [0, 1].map((index) => snapshotPet({
        id: `member-${index}`, name: `Member ${index}`, rarity: 'rare', level: 25,
        hp: 610, attack: 78, defense: 42, speed: 62, element: 'Water',
    }));
    lobby.state = 'running';
    lobby.seed = 424242;
    lobby.startedAt = now;
    lobby.match = resolveMatch(lobby, lobby.seed);
    sealedLobby = lobby;
});

beforeEach(async () => {
    for (const key of await kv.keys('ratelimit:*')) await kv.del(key);
    await kv.set(KEY, structuredClone(sealedLobby), { ex: 20 * 60 });
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeRes() {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function request(
    name: string,
    method: 'GET' | 'POST',
    action?: string,
    extraBody: Record<string, unknown> = {},
): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    process.env.SESSION_SECRET = SESSION_SECRET;
    const token = issuePlayerToken(name);
    assert.ok(token);
    await handler({
        method,
        query: method === 'GET' ? { code: CODE } : {},
        body: method === 'POST' ? { name, action, code: CODE, ...extraBody } : undefined,
        headers: { 'x-player-token': token, 'content-type': 'application/json' },
        socket: { remoteAddress: `127.0.1.${name === HOST ? 1 : name === MEMBER ? 2 : 3}` },
    } as never, res);
    return out;
}

describe('running co-op lobby recovery', { concurrency: false }, () => {
    it('keeps the immutable match after host and member leave acknowledgements', async () => {
        const original = structuredClone((await kv.get<import('./_lobby-core.js').Lobby>(KEY))!.match);

        for (const name of [HOST, MEMBER]) {
            const left = await request(name, 'POST', 'leave');
            assert.equal(left.statusCode, 200);
            assert.deepEqual(left.body, { ok: true, safeToExit: true, sealedMatchRetained: true });
            const recovered = await request(name, 'GET');
            assert.equal(recovered.statusCode, 200);
            assert.deepEqual((recovered.body?.lobby as { match?: unknown })?.match, original);
        }

        const stored = await kv.get<import('./_lobby-core.js').Lobby>(KEY);
        assert.deepEqual(stored, sealedLobby, 'leave must not mutate seats, seed, setup, or match payload');
        const outsider = await request(OUTSIDER, 'GET');
        assert.equal(outsider.statusCode, 403);
    });

    it('rejects expedition pets before snapshotting and accepts two idle owned pets', async () => {
        const { newLobby, slotOf } = await import('./_lobby-core.js');
        const open = newLobby(CODE, HOST, Date.now());
        await kv.set(KEY, open, { ex: 30 * 60 });
        await kv.set(`save:${HOST}`, {
            character: {
                name: HOST,
                pets: [
                    { id: 'busy', name: 'Busy', expedition: { endsAt: Date.now() + 60_000 } },
                    { id: 'idle-a', name: 'Idle A', hp: 500, attack: 50, defense: 30, speed: 40 },
                    { id: 'idle-b', name: 'Idle B', hp: 510, attack: 51, defense: 31, speed: 41 },
                ],
            },
        });

        const busy = await request(HOST, 'POST', 'pets', { petIds: ['busy', 'idle-a'] });
        assert.equal(busy.statusCode, 409);
        assert.match(String(busy.body?.error), /expedition/i);
        assert.equal(slotOf((await kv.get<import('./_lobby-core.js').Lobby>(KEY))!, 'blue', 0).ready, false);

        const idle = await request(HOST, 'POST', 'pets', { petIds: ['idle-a', 'idle-b'] });
        assert.equal(idle.statusCode, 200);
        const stored = await kv.get<import('./_lobby-core.js').Lobby>(KEY);
        assert.equal(slotOf(stored!, 'blue', 0).ready, true);
        assert.deepEqual(slotOf(stored!, 'blue', 0).pets.map((pet) => pet.id), ['idle-a', 'idle-b']);
    });
});
