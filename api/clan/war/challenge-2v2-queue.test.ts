import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'clan-war-2v2-queue-test-admin';
delete process.env.SESSION_SECRET;

import type { ClanChallenge, ClanWar } from './_storage.js';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let handler: Handler;
let kv: typeof import('../../_storage.js').kv;

const WAR_ID = 'alpha__beta';
const A1 = 'ash', A2 = 'briar';        // challenging clan (alpha)
const D1 = 'cinder', D2 = 'dune';      // defending clan (beta)

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    handler = (await import('./challenge.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeRes() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

/** Admin identity so the test drives all four seats without four logins. */
async function act(body: Record<string, unknown>): Promise<Out> {
    const { res, out } = fakeRes();
    await handler({
        method: 'POST',
        body: { warId: WAR_ID, ...body },
        query: {},
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res);
    return out;
}

const challengeOf = (out: Out) => out.body?.challenge as ClanChallenge | undefined;

async function seedWar(): Promise<void> {
    for (const key of await kv.keys('clan-war:*')) await kv.del(key);
    await kv.set(`clan-war:${WAR_ID}`, {
        id: WAR_ID,
        clans: ['alpha', 'beta'],
        villages: { alpha: 'moonshadow', beta: 'stormveil' },
        hp: { alpha: 1000, beta: 1000 },
        startedAt: Date.now(),
        updatedAt: Date.now(),
        declaredBy: A1,
        pendingChallenges: [],
        completedChallenges: [],
    } as ClanWar);
    for (const slug of [A1, A2, D1, D2]) {
        await kv.set(`save:${slug}`, {
            character: { name: slug, level: 40, clan: slug === A1 || slug === A2 ? 'alpha' : 'beta' },
        });
    }
}

beforeEach(seedWar);

describe('Clan War 2v2 send/accept queues', { concurrency: false }, () => {
    it('walks all four seats from an empty war to a launchable challenge', async () => {
        // 1. Seed challenger opens the send queue — NOT yet acceptable.
        const sent = await act({ action: 'send', mode: 'pvp2v2', fromClan: 'alpha', fromPlayer: A1 });
        assert.equal(sent.statusCode, 200);
        const id = challengeOf(sent)!.id;
        assert.equal(challengeOf(sent)!.status, 'queuing', 'a lone challenger cannot be accepted');

        // 2. Partner joins the send queue → the challenge becomes pending.
        const joined = await act({ action: 'join-send', challengeId: id, fromPlayer2: A2 });
        assert.equal(joined.statusCode, 200);
        assert.equal(challengeOf(joined)!.status, 'pending');
        assert.equal(challengeOf(joined)!.fromPlayer2, A2);

        // 3. First defender queues — still pending, NOT accepted.
        const accepted1 = await act({ action: 'accept', challengeId: id, acceptedPlayer: D1 });
        assert.equal(accepted1.statusCode, 200);
        assert.equal(challengeOf(accepted1)!.status, 'pending', 'one defender is not a team');
        assert.equal(challengeOf(accepted1)!.acceptedPlayer, D1);

        // 4. Second defender completes the roster → accepted.
        const accepted2 = await act({ action: 'join-accept', challengeId: id, acceptedPlayer2: D2 });
        assert.equal(accepted2.statusCode, 200);
        const ready = challengeOf(accepted2)!;
        assert.equal(ready.status, 'accepted');
        assert.deepEqual(
            [ready.fromPlayer, ready.fromPlayer2, ready.acceptedPlayer, ready.acceptedPlayer2],
            [A1, A2, D1, D2],
            'all four seats are filled in the order the match will field them',
        );

        // 5. And that is exactly the shape the match publisher requires.
        const { clanWar2v2Sides } = await import('./_mpvp.js');
        assert.deepEqual(clanWar2v2Sides(ready), { from: [A1, A2], to: [D1, D2] });
    });

    it('refuses to accept a half-crewed send queue', async () => {
        const sent = await act({ action: 'send', mode: 'pvp2v2', fromClan: 'alpha', fromPlayer: A1 });
        const id = challengeOf(sent)!.id;
        // Still 'queuing' — accept requires 'pending'.
        const early = await act({ action: 'accept', challengeId: id, acceptedPlayer: D1 });
        assert.equal(early.statusCode, 409, 'a solo challenger cannot be accepted into a 2v2');
    });

    it('refuses a second defender before the first, and the same player twice', async () => {
        const sent = await act({ action: 'send', mode: 'pvp2v2', fromClan: 'alpha', fromPlayer: A1 });
        const id = challengeOf(sent)!.id;
        await act({ action: 'join-send', challengeId: id, fromPlayer2: A2 });

        const early = await act({ action: 'join-accept', challengeId: id, acceptedPlayer2: D2 });
        assert.equal(early.statusCode, 409, 'join-accept needs a first defender');

        await act({ action: 'accept', challengeId: id, acceptedPlayer: D1 });
        const dupe = await act({ action: 'join-accept', challengeId: id, acceptedPlayer2: D1 });
        assert.equal(dupe.statusCode, 400, 'one player cannot fill both defender seats');

        const second = await act({ action: 'accept', challengeId: id, acceptedPlayer: D2 });
        assert.equal(second.statusCode, 409, 'accept is closed once a defender queued');
    });

    it('lets a queued player leave without stranding the challenge', async () => {
        const sent = await act({ action: 'send', mode: 'pvp2v2', fromClan: 'alpha', fromPlayer: A1 });
        const id = challengeOf(sent)!.id;
        await act({ action: 'join-send', challengeId: id, fromPlayer2: A2 });

        const left = await act({ action: 'leave-send', challengeId: id, player: A2 });
        assert.equal(left.statusCode, 200);
        const after = challengeOf(left)!;
        assert.equal(after.status, 'queuing', 'the challenge reopens its send queue');
        assert.ok(!after.fromPlayer2, 'the departed partner is cleared');
        assert.ok(!after.acceptedPlayer && !after.acceptedPlayer2,
            'the accept queue is cleared too, so defenders are never stranded on a hidden challenge');

        // A different clanmate can take the empty seat.
        const refilled = await act({ action: 'join-send', challengeId: id, fromPlayer2: A2 });
        assert.equal(refilled.statusCode, 200);
        assert.equal(challengeOf(refilled)!.status, 'pending');
    });

    it('keeps the 1v1 path unchanged by the 2v2 reopening', async () => {
        const sent = await act({ action: 'send', mode: 'pvp1v1', fromClan: 'alpha', fromPlayer: A1 });
        assert.equal(challengeOf(sent)!.status, 'pending', '1v1 never enters a send queue');
        const id = challengeOf(sent)!.id;
        const accepted = await act({ action: 'accept', challengeId: id, acceptedPlayer: D1 });
        assert.equal(challengeOf(accepted)!.status, 'accepted', '1v1 accepts in one call');
        const wrongQueue = await act({ action: 'join-accept', challengeId: id, acceptedPlayer2: D2 });
        assert.equal(wrongQueue.statusCode, 400, '1v1 has no accept queue');
    });
});
