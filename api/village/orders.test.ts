import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-order-tests-session-secret';

let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let token: typeof import('../_auth.js').issuePlayerToken;
let orderHandler: typeof handler;
const village = 'Frostfang Village';
const stateKey = 'game:village-state:frostfangvillage';
const kageKey = 'village:kage:frostfang-village';
async function council(seats: [string, string, string]) {
    const startedAt = Math.floor(Date.now() / 86400000) * 86400000;
    await kv.set('village:elder-council:frostfangvillage', { version: 1, startedAt,
        nextSelectionAt: startedAt + 30 * 86400000, seats, winningScores: [1, 1] });
}

const types = ['order', 'raid', 'guard', 'medic', 'trade', 'general'];
const order = (id: string, author: string, type = 'raid') => ({ id, author, type, authorRole: 'Forged Kage',
    title: 'Defend the village', body: 'Rally at the gate.', createdAt: 123, pinned: false });

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('../game-state.js')).default as unknown as typeof handler;
    orderHandler = (await import('./orders.js')).default as unknown as typeof handler;
    token = (await import('../_auth.js')).issuePlayerToken;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const name of ['kage', 'anbu', 'elder', 'villager', 'formerkage', 'formerelder', 'formeranbu', 'outsider']) {
        await kv.set(`save:${name}`, { character: { name, village: name === 'outsider' ? 'Stormveil Village' : village,
            elderFocus: 'training', rankTitle: 'Kage', storyTitle: 'Village Elder ANBU' } });
    }
    await council(['', 'elder', '']);
    await kv.set(kageKey, { seatedKage: 'kage', kageSystemUnlocked: true });
    await kv.set(stateKey, { seatedKage: 'formerkage', anbuAppointees: ['anbu', '', ''],
        elderAppointees: ['', 'elder', ''], noticePosts: [], treasury: { ryo: 250 } });
});

async function post(name: string, noticePosts: unknown, extra: Record<string, unknown> = {}) {
    const out = { status: 200, body: {} as Record<string, unknown> };
    const res = {
        setHeader() { return res; }, status(status: number) { out.status = status; return res; },
        json(body: Record<string, unknown>) { out.body = body; return res; }, end() { return res; },
    };
    await handler({ method: 'POST', query: {}, headers: { 'x-player-token': token(name) },
        body: { kind: 'villageState', village, state: { noticePosts, ...extra } },
        socket: { remoteAddress: '127.0.0.89' },
    } as never, res as never);
    return { ...out, state: await kv.get<Record<string, any>>(stateKey) };
}

test('ordinary villagers cannot post any order category, regardless of titles or personal focus', async () => {
    for (const type of types) {
        const result = await post('villager', [order(type, 'villager', type)]);
        assert.equal(result.status, 200, 'the shared-state endpoint suppresses rejected fields');
        assert.ok(Number(result.body.suppressed) > 0);
        assert.deepEqual(result.state!.noticePosts, []);
        assert.equal(result.state!.treasury.ryo, 250);
    }
});

test('Kage, appointed ANBU and player Elders can post every category with canonical attribution', async () => {
    for (const [name, role] of [['kage', 'Kage'], ['anbu', 'ANBU'], ['elder', 'Village Elder']]) {
        const previous = (await kv.get<any>(stateKey)).noticePosts;
        const additions = types.map(type => order(`${name}-${type}`, name, type));
        const result = await post(name, [...additions, ...previous]);
        for (const addition of additions) {
            const saved = result.state!.noticePosts.find((entry: any) => entry.id === addition.id);
            assert.ok(saved, `${name} may post ${addition.type}`);
            assert.equal(saved.authorRole, role);
            assert.ok(saved.createdAt > 123);
        }
    }
});

test('self-appointed seats and stale Kage mirrors cannot unlock orders in the same request', async () => {
    for (const name of ['villager', 'formerkage']) {
        const result = await post(name, [order('forged-role', name)], {
            seatedKage: name, anbuAppointees: [name], elderAppointees: [name],
        });
        assert.deepEqual(result.state!.noticePosts, []);
        assert.deepEqual(result.state!.anbuAppointees, ['anbu', '', '']);
        assert.deepEqual(result.state!.elderAppointees, ['', 'elder', '']);
    }
    for (const malformed of [null, {}, 'villager']) {
        const result = await post('villager', [], { anbuAppointees: malformed });
        assert.deepEqual(result.state!.anbuAppointees, ['anbu', '', '']);
    }
});

test('ordinary and former leaders cannot rewrite, pin or delete even their old orders', async () => {
    for (const name of ['villager', 'formerkage', 'formerelder', 'formeranbu']) {
        const original = order('existing', name);
        const state = await kv.get<any>(stateKey);
        await kv.set(stateKey, { ...state, noticePosts: [original] });
        for (const incoming of [[{ ...original, title: 'Tampered', body: 'Forged', pinned: true }], [], null, {}, '']) {
            const result = await post(name, incoming);
            assert.deepEqual(result.state!.noticePosts, [original]);
        }
    }
});

test('current leadership can manage its own posts; only the Kage can manage another author', async () => {
    for (const name of ['anbu', 'elder']) {
        const original = order('existing', name);
        await kv.set(stateKey, { ...(await kv.get<any>(stateKey)), noticePosts: [original] });
        const ownPin = await post(name, [{ ...original, pinned: true, authorRole: 'Kage', title: 'Forged rewrite' }]);
        assert.deepEqual(ownPin.state!.noticePosts, [{ ...original, pinned: true }]);
        const otherName = name === 'anbu' ? 'elder' : 'anbu';
        const otherPin = await post(otherName, [{ ...original, pinned: false }]);
        assert.deepEqual(otherPin.state!.noticePosts, [{ ...original, pinned: true }]);
        const otherDelete = await post(otherName, []);
        assert.deepEqual(otherDelete.state!.noticePosts, [{ ...original, pinned: true }]);
        const kagePin = await post('kage', [{ ...original, pinned: false }]);
        assert.deepEqual(kagePin.state!.noticePosts, [original]);
        const ownDelete = await post(name, []);
        assert.deepEqual(ownDelete.state!.noticePosts, []);
    }
});

test('removing an appointment or leaving the village revokes posting immediately', async () => {
    const state = await kv.get<any>(stateKey);
    await kv.set(stateKey, { ...state, anbuAppointees: [], elderAppointees: [] });
    await council(['', '', '']);
    for (const name of ['anbu', 'elder']) assert.deepEqual((await post(name, [order(name, name)])).state!.noticePosts, []);
    assert.equal((await post('outsider', [order('foreign', 'outsider')], { anbuAppointees: ['outsider'] })).status, 403);
});

test('leadership cannot impersonate another author or bypass a silence', async () => {
    for (const author of ['villager', '', 'System']) {
        assert.deepEqual((await post('anbu', [order(`spoof-${author}`, author)])).state!.noticePosts, []);
    }
    await kv.set('mod:silence:anbu', { until: Date.now() + 60_000, reason: 'test', by: 'admin', at: Date.now() });
    assert.deepEqual((await post('anbu', [order('silenced', 'anbu')])).state!.noticePosts, []);
});

async function action(name: string, body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader() { return res; }, status(status: number) { out.status = status; return res; },
        json(body: Record<string, any>) { out.body = body; return res; }, end() { return res; } };
    await orderHandler({ method: 'POST', query: {}, headers: { 'x-player-token': token(name) },
        body: { playerName: name, ...body }, socket: { remoteAddress: '127.0.0.90' } } as never, res as never);
    return out;
}

test('atomic order actions deny all ordinary players and allow every current leadership role', async () => {
    for (const name of ['villager', 'formerkage', 'formeranbu', 'formerelder']) {
        assert.equal((await action(name, { action: 'post', ...order(name, name) })).status, 403);
    }
    for (const name of ['kage', 'anbu', 'elder']) {
        for (const type of types) {
            const posted = await action(name, { action: 'post', ...order(`${name}-${type}`, 'System', type) });
            assert.equal(posted.status, 200);
            const saved = posted.body.noticePosts.find((post: any) => post.id === `${name}-${type}`);
            assert.equal(saved.author, name);
            assert.equal(saved.authorRole, name === 'elder' ? 'Village Elder' : name === 'anbu' ? 'ANBU' : 'Kage');
        }
    }
});

test('a full board accepts new orders without client deletions, with idempotent retries', async () => {
    const full = Array.from({ length: 60 }, (_, i) => order(`old-${i}`, 'kage'));
    await kv.set(stateKey, { ...(await kv.get<any>(stateKey)), noticePosts: full });
    const newOrder = { action: 'post', ...order('new-order', 'elder') };
    const posted = await action('elder', newOrder);
    assert.equal(posted.status, 200);
    assert.equal(posted.body.noticePosts.length, 60);
    assert.ok(posted.body.noticePosts.some((p: any) => p.id === 'new-order'));
    const replayed = await action('elder', newOrder);
    assert.deepEqual(replayed.body.noticePosts, posted.body.noticePosts);
    assert.equal(replayed.body.unchanged, true);
    assert.equal((await kv.get<any>(stateKey)).treasury.ryo, 250);
});

test('atomic pin/delete preserve intervening orders and enforce current authorship', async () => {
    await action('elder', { action: 'post', ...order('elder-post', 'elder') });
    await action('anbu', { action: 'post', ...order('anbu-post', 'anbu') });
    assert.equal((await action('villager', { action: 'pin', id: 'elder-post', pinned: true })).status, 403);
    assert.equal((await action('anbu', { action: 'delete', id: 'elder-post' })).status, 403);
    const pinned = await action('elder', { action: 'pin', id: 'elder-post', pinned: true });
    assert.equal(pinned.status, 200);
    assert.equal(pinned.body.noticePosts.length, 2);
    const deleted = await action('kage', { action: 'delete', id: 'elder-post' });
    assert.deepEqual(deleted.body.noticePosts.map((p: any) => p.id), ['anbu-post']);
    const state = await kv.get<any>(stateKey);
    await kv.set(stateKey, { ...state, anbuAppointees: [] });
    assert.equal((await action('anbu', { action: 'delete', id: 'anbu-post' })).status, 403);
});
