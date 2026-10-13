import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'clan-war-list-test-session-secret-32b';

import type { ClanChallenge, ClanWar } from './_storage.js';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: { wars?: ClanWar[] } };

let handler: Handler;
let kv: typeof import('../../_storage.js').kv;
let issuePlayerToken: typeof import('../../_auth.js').issuePlayerToken;

const WAR_ID = 'alpha__beta';

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ issuePlayerToken } = await import('../../_auth.js'));
    handler = (await import('./list.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function list(viewer?: string): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Out['body']) => { out.body = body; return res; },
        end: () => res,
    };
    await handler({
        method: 'GET',
        query: {},
        headers: viewer ? { 'x-player-name': viewer, 'x-player-token': issuePlayerToken(viewer)! } : {},
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

beforeEach(async () => {
    for (const key of await kv.keys('clan-war:*')) await kv.del(key);
    const pending: ClanChallenge = {
        id: 'c1', mode: 'pvp1v1', fromClan: 'alpha', fromPlayer: 'ash',
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
    };
    await kv.set(`clan-war:${WAR_ID}`, {
        id: WAR_ID,
        clans: ['alpha', 'beta'],
        villages: { alpha: 'moonshadow', beta: 'stormveil' },
        hp: { alpha: 1000, beta: 1000 },
        startedAt: Date.now(),
        updatedAt: Date.now(),
        declaredBy: 'ash',
        pendingChallenges: [pending],
        completedChallenges: [],
    } as ClanWar);
    await kv.set('save:ash', { character: { name: 'ash', clan: 'alpha', avatarImage: 'x'.repeat(4096) } });
    await kv.set('save:dune', { character: { name: 'dune', clan: 'beta' } });
});

describe('GET /api/clan/war/list', { concurrency: false }, () => {
    it('shows the sending clan its own challenger and hides it from a rival', async () => {
        const own = await list('ash');
        assert.equal(own.statusCode, 200);
        assert.equal(own.body?.wars?.[0]?.pendingChallenges[0]?.fromPlayer, 'ash');

        const rival = await list('dune');
        assert.equal(rival.statusCode, 200);
        assert.equal(rival.body?.wars?.[0]?.pendingChallenges[0]?.fromPlayer, '');

        const anonymous = await list();
        assert.equal(anonymous.body?.wars?.[0]?.pendingChallenges[0]?.fromPlayer, '');
    });

    it('treats a viewer with no save or no clan as an outsider', async () => {
        assert.equal((await list('nobody')).body?.wars?.[0]?.pendingChallenges[0]?.fromPlayer, '');
        await kv.set('save:loner', { character: { name: 'loner' } });
        assert.equal((await list('loner')).body?.wars?.[0]?.pendingChallenges[0]?.fromPlayer, '');
    });

    it('reads the viewer save as a one-field projection, not the whole row', async () => {
        const originalGet = kv.get.bind(kv);
        const fullSaveReads: string[] = [];
        kv.get = (async (key: string) => {
            if (key.startsWith('save:')) fullSaveReads.push(key);
            return originalGet(key);
        }) as typeof kv.get;
        try {
            assert.equal((await list('ash')).body?.wars?.[0]?.pendingChallenges[0]?.fromPlayer, 'ash');
        } finally {
            kv.get = originalGet as typeof kv.get;
        }
        assert.deepEqual(fullSaveReads, []);
    });
});
