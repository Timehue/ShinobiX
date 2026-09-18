import { before, after, test, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import type { ActivitySpine } from '../../shared/activity-spine.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'activity-fixture-admin';
process.env.ENABLE_LEGACY = '1';
delete process.env.SESSION_SECRET;
let handler: typeof import('./activity-spine.js').default;
let kv: typeof import('../_storage.js').kv;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./activity-spine.js')).default as unknown as typeof handler;
});
after(() => { mock.restoreAll(); delete process.env.ADMIN_PASSWORD; delete process.env.ENABLE_LEGACY; });

const base = { name: 'guidetest', village: 'Stormveil Village', level: 55, hp: 100, onboardingStep: 'done', statPoints: 0,
    storyProgress: 4, ryo: 2000, lastLoginRewardDate: new Date().toISOString().slice(0, 10),
    pets: [], inventory: [], itemStacks: [], examsPassed: ['genin', 'chunin'] };

async function request(character = {}, focus?: unknown, auth = true) {
    const saved = { _saveVersion: 30, character: { ...base, ...character } };
    await kv.set('save:guidetest', saved);
    const reads: string[] = [];
    const read = kv.get.bind(kv);
    const spy = mock.method(kv, 'get', async (key: string) => { reads.push(key); return read(key); });
    const writes = ['set', 'del', 'compareSet', 'delIfEqual'].map(method => mock.method(kv, method as 'set', async () => { throw new Error(`Guidance wrote ${method}`); }));
    let status = 200;
    let body: { spine?: ActivitySpine; error?: string } = {};
    const headers = new Map();
    const res = { setHeader: (k: string, v: string) => headers.set(k, v), status: (v: number) => { status = v; return res; }, json: (v: typeof body) => { body = v; return res; }, end: () => res };
    try {
        await handler({ method: 'GET', query: { player: 'guidetest', ...(focus === undefined ? {} : { focus }) }, headers: auth ? { 'x-admin-password': process.env.ADMIN_PASSWORD } : {}, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    } finally { spy.mock.restore(); writes.forEach(w => w.mock.restore()); }
    assert.deepEqual(await kv.get('save:guidetest'), saved);
    return { status, body, reads, headers, bytes: Buffer.byteLength(JSON.stringify(body)) };
}

test('GET uses server save facts, supports explicit API/save focus and Auto-only client override without writing preferences', async () => {
    const explicit = await request({ masteryFocus: 'clan-war' });
    assert.equal(explicit.status, 200);
    assert.equal(explicit.body.spine?.selectedFocus, 'clan-war');
    assert.equal(explicit.body.spine?.horizons.now[0]?.id, 'clan-join-now');
    const automatic = await request({ masteryFocus: 'clan-war' }, 'auto');
    assert.equal(automatic.body.spine?.selectedFocus, 'auto');
    assert.equal(automatic.body.spine?.horizons.now[0]?.id, 'story-now');
    for (const focus of ['not-real', ['ranked-pvp'], {}, null]) {
        assert.equal((await request({}, focus)).body.spine?.selectedFocus, 'auto');
    }
    assert.equal(explicit.headers.get('Cache-Control'), 'private, no-store');
});

test('handler remains private and reports bounded reads/response sizes for representative focuses', async () => {
    assert.equal((await request({}, 'auto', false)).status, 401);
    for (const focus of ['auto', 'companions', 'chronicle-showdown', 'profession', 'legacy']) {
        const result = await request({}, focus);
        assert.equal(result.status, 200);
        assert.ok(result.reads.length <= 5, `${focus}: ${result.reads.join(', ')}`);
        assert.ok(result.bytes < 7000);
        console.log(`activity-spine ${focus}: ${result.reads.length} storage reads, ${result.bytes} JSON bytes`);
    }
});

test('hospital and authoritative active runs remain before focus and malformed inventory does not claim readiness', async () => {
    assert.equal((await request({ hospitalized: true }, 'chronicle-showdown')).body.spine?.horizons.now[0]?.id, 'recover-hospital');
    assert.equal((await request({ endlessTowerRun: { wave: 3 } }, 'companions')).body.spine?.horizons.now[0]?.id, 'resume-active-run');
    const unknown = await request({ storyProgress: 'bad', pets: null, cardClashDeck: 'bad' }, 'village-chronicle');
    assert.equal(unknown.body.spine?.horizons.now[0]?.id, 'story-review-now');
});

test('stale clan party pointers stay read-only; exhausted operation is never advertised as ready', async () => {
    await kv.set('clan-boss:party-player:guidetest', 'cbp-00000000000000000000000000000000');
    const result = await request({ clan: 'fixtureclan' }, 'clan-war');
    assert.equal(result.status, 200);
    assert.equal(result.body.spine?.horizons.now[0]?.id, 'clan-review-now');
    assert.equal(await kv.get('clan-boss:party-player:guidetest'), 'cbp-00000000000000000000000000000000');
});
