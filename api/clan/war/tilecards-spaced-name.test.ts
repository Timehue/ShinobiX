/* A player whose display name has a space ("Kaede Morrow", account
 * "kaedemorrow") can open and join a clan-war Chronicle Showdown. The join
 * used to lowercase the display name and compare it with the seated account
 * slugs, so such a player was refused as "not an accepted participant". */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'cw-tilecards-spaced-name-secret-32by!';

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { statusCode: number; body: Record<string, unknown> };

const WAR = 'war-spaced-name';
let tilecards: Handler;
let kv: typeof import('../../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ issuePlayerToken } = await import('../../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../../_ratelimit.js'));
    tilecards = (await import('./tilecards.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    resetRateLimits();
    await kv.set('save:kaedemorrow', { _saveVersion: 1, character: { name: 'Kaede Morrow', clan: 'Ash', level: 30, chroniclePoints: 0 } });
    await kv.set('save:mira-frost_2', { _saveVersion: 1, character: { name: 'Mira Frost 2', clan: 'Rime', level: 30, chroniclePoints: 0 } });
    await kv.set('save:outsider', { _saveVersion: 1, character: { name: 'Out Sider', clan: 'Rime', level: 30, chroniclePoints: 0 } });
    await kv.set(`clan-war:${WAR}`, {
        id: WAR, clans: ['Ash', 'Rime'],
        pendingChallenges: [{ id: 'cwm-spaced', mode: 'tilecards', status: 'accepted', fromClan: 'Ash', fromPlayer: 'kaedemorrow', acceptedPlayer: 'mira-frost_2' }],
    });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function call(player: string, body: Record<string, unknown>): Promise<Reply> {
    const out: Reply = { statusCode: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (b: Record<string, unknown>) => { out.body = b; return res; },
        end: () => res,
    };
    await tilecards({
        method: 'POST', query: {}, body: { warId: WAR, ...body },
        headers: { 'x-player-name': player, 'x-player-token': issuePlayerToken(player) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

describe('clan-war card duels accept players with spaced display names', { concurrency: false }, () => {
    it('both seated players join by their account, whatever their display name, and play the same duel', async () => {
        const opened = await call('kaedemorrow', { action: 'join', challengeId: 'cwm-spaced', deck: [] });
        assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
        assert.equal((opened.body.session as { viewerSide?: string }).viewerSide, 'p1');

        const joined = await call('mira-frost_2', { action: 'join', challengeId: 'cwm-spaced', deck: [] });
        assert.equal(joined.statusCode, 200, JSON.stringify(joined.body));
        const row = await kv.get<{ status: string; p1Name: string; p2Name: string; p1Clan: string; p2Clan: string }>('cw-tilecards:cwm-spaced');
        assert.equal(row?.status, 'active');
        assert.deepEqual([row?.p1Clan, row?.p2Clan], ['Ash', 'Rime']);

        // Both duelists see their own seat afterwards (state, re-join).
        const mine = await call('kaedemorrow', { action: 'state', challengeId: 'cwm-spaced' });
        assert.equal(mine.statusCode, 200, JSON.stringify(mine.body));
        const again = await call('mira-frost_2', { action: 'join', challengeId: 'cwm-spaced', deck: [] });
        assert.equal(again.statusCode, 200, JSON.stringify(again.body));

        // The finished duel pays each duelist's OWN account, never a save named
        // after a display name that does not reduce to it.
        const live = (await kv.get<Record<string, any>>('cw-tilecards:cwm-spaced'))!;
        live.state.status = 'complete'; live.state.winner = 'p1'; live.state.turnNumber = 6;
        live.status = 'done';
        live.participation = { startedAt: Date.now() - 100_000, p1Actions: 7, p2Actions: 6, endedBy: 'play' };
        await kv.set('cw-tilecards:cwm-spaced', live);
        const settled = await call('kaedemorrow', { action: 'state', challengeId: 'cwm-spaced' });
        assert.equal(settled.statusCode, 200, JSON.stringify(settled.body));
        const loser = await call('mira-frost_2', { action: 'state', challengeId: 'cwm-spaced' });
        // Each reply hands back the duelist's own committed save once.
        assert.deepEqual(settled.body.chroniclePoints, { earned: 20, status: 'paid', pairWeight: 1 });
        assert.equal((settled.body.character as { name: string; chroniclePoints: number }).chroniclePoints, 20);
        assert.equal((settled.body.character as { name: string }).name, 'Kaede Morrow');
        assert.deepEqual(loser.body.chroniclePoints, { earned: 8, status: 'paid', pairWeight: 1 });
        assert.equal((loser.body.character as { name: string; chroniclePoints: number }).chroniclePoints, 8);
        assert.equal((loser.body.character as { name: string }).name, 'Mira Frost 2');
        assert.equal(await kv.get('save:mirafrost2'), null, 'no save was created under the display name');
    });

    it('a player who is not seated is still refused', async () => {
        const refused = await call('outsider', { action: 'join', challengeId: 'cwm-spaced', deck: [] });
        assert.equal(refused.statusCode, 403, JSON.stringify(refused.body));
    });
});
