process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-notices-route-test-secret';
process.env.ADMIN_PASSWORD = 'village-notices-route-admin';

import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

// The Town Hall activity log rule (api/_village-state-validate.ts, `notices`)
// through the real POST /api/game-state { kind: 'villageState' } route: the
// membership check, the village lock, the caller identity the silence check
// reads, and the row that is actually stored.

let kv: typeof import('./_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let token: typeof import('./_auth.js').issuePlayerToken;

const village = 'Frostfang Village';
const stateKey = 'game:village-state:frostfangvillage';
const log = ['mei donated 500 ryo to the village treasury.', 'kai joined the Village Guard queue with +2.0% defense.'];

before(async () => {
    ({ kv } = await import('./_storage.js'));
    handler = (await import('./game-state.js')).default as unknown as typeof handler;
    token = (await import('./_auth.js')).issuePlayerToken;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const name of ['rin', 'jin']) await kv.set(`save:${name}`, { character: { name, village } });
    await kv.set('save:outsider', { character: { name: 'outsider', village: 'Stormveil Village' } });
    await kv.set(stateKey, { notices: log, treasury: { ryo: 250 } });
});

function asPlayer(name: string) {
    const playerToken = token(name);
    assert.ok(playerToken, 'SESSION_SECRET is set, so a session token is minted');
    return { 'x-player-token': playerToken };
}
const asAdmin = { 'x-admin-password': 'village-notices-route-admin' };

async function post(headers: Record<string, string>, notices: unknown) {
    const out = { status: 200, body: {} as Record<string, unknown> };
    const res = {
        setHeader() { return res; }, status(status: number) { out.status = status; return res; },
        json(body: Record<string, unknown>) { out.body = body; return res; }, end() { return res; },
    };
    await handler({ method: 'POST', query: {}, headers,
        body: { kind: 'villageState', village, state: { notices } },
        socket: { remoteAddress: '127.0.0.91' },
    } as never, res as never);
    return { ...out, notices: (await kv.get<Record<string, unknown>>(stateKey))?.notices };
}

test('each member write lands its one line, and a stale copy loses nobody else\'s', async () => {
    const rinLine = 'rin donated 1,000 ryo to the village treasury.';
    const first = await post(asPlayer('rin'), [rinLine, ...log]);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.notices, [rinLine, ...log]);
    // jin's Town Hall still holds the log from before rin's line. The old
    // wholesale merge stored jin's list as sent and erased rin's line.
    const jinLine = 'jin selected the war focus.';
    const second = await post(asPlayer('jin'), [jinLine, ...log]);
    assert.deepEqual(second.notices, [jinLine, rinLine, ...log]);
});

test('a member cannot clear or rewrite the stored log through the route', async () => {
    assert.deepEqual((await post(asPlayer('rin'), [])).notices, log);
    const rewritten = await post(asPlayer('rin'), ['mei donated 5 ryo to the village treasury.', log[1]]);
    const out = rewritten.notices as string[];
    assert.deepEqual(out.slice(-log.length), log, 'the stored lines survive, in order');
    assert.ok(out.length <= log.length + 1);
});

test('the stored line is the moderated one, and the silence read is the caller\'s own', async () => {
    const linked = await post(asPlayer('rin'), ['rin found free ryo at www.example-scam.com/claim', ...log]);
    assert.match((linked.notices as string[])[0], /\[redacted link\]/);
    await kv.set('mod:silence:jin', { until: Date.now() + 60_000, reason: 'test', by: 'admin', at: Date.now() });
    const stored = linked.notices as string[];
    const silenced = await post(asPlayer('jin'), ['jin selected the war focus.', ...stored]);
    assert.deepEqual(silenced.notices, stored, 'a silenced member adds nothing');
    assert.ok(Number(silenced.body.suppressed) > 0);
    const other = await post(asPlayer('rin'), ['rin selected the war focus.', ...stored]);
    assert.deepEqual(other.notices, ['rin selected the war focus.', ...stored], 'rin is not silenced');
});

test('an admin request replaces the log; a non-member cannot write it at all', async () => {
    const admin = await post(asAdmin, ['Maintenance tonight: https://shinobijourney.com/status']);
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
    assert.deepEqual(admin.notices, ['Maintenance tonight: https://shinobijourney.com/status']);
    const outsider = await post(asPlayer('outsider'), ['outsider was here.', ...log]);
    assert.equal(outsider.status, 403);
    assert.deepEqual(outsider.notices, admin.notices);
});
