import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFESSION_CHANGE_APPROVAL_ID as SCROLL } from '../../shared/profession-change.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'profession-scroll-integration';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let choose: Handler;
let purchase: Handler;
let sanitize: typeof import('../save/[name].js').sanitizeCharacterSave;
const playerName = 'scrollintegration';
const key = `save:${playerName}`;
const original = {
    name: playerName, level: 20, xp: 321, village: 'Stormveil Village', createdAt: 100,
    profession: 'vanguard', professionChosenAt: 1000, professionRank: 10, professionXp: 100000,
    masterySpec: { 'seal-cap': 1 }, fateShards: 500, ryo: 1000,
    stats: {}, inventory: ['kept-item'], itemStacks: [], pets: [], equipment: {},
};

before(async () => {
    ({ kv } = await import('../_storage.js'));
    choose = (await import('./choose.js')).default as unknown as Handler;
    purchase = (await import('../shop/purchase.js')).default as unknown as Handler;
    sanitize = (await import('../save/[name].js')).sanitizeCharacterSave;
});
beforeEach(async () => { await kv.set(key, { _saveVersion: 1, character: structuredClone(original) }); });
after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function post(handler: Handler, body: Record<string, unknown>, authenticated = true) {
    const result = { status: 200, body: {} as Record<string, unknown> };
    const res = {
        setHeader: () => res,
        status: (status: number) => { result.status = status; return res; },
        json: (body: Record<string, unknown>) => { result.body = body; return res; },
        end: () => res,
    };
    await handler({ method: 'POST', body: { playerName, ...body },
        headers: authenticated ? { 'x-admin-password': process.env.ADMIN_PASSWORD } : {},
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return result;
}

test('purchase → use → retry → autosave preserves the paid scroll change and character progress', async () => {
    const buy = { itemId: SCROLL, qty: 1, requestId: 'profession-scroll-integration-buy' };
    const bought = await post(purchase, buy);
    assert.equal(bought.status, 200);
    const afterBuy = bought.body.character as Record<string, unknown>;
    assert.equal(afterBuy.fateShards, 300);
    assert.deepEqual(afterBuy.inventory, ['kept-item', SCROLL]);
    assert.ok(Number(bought.body._saveVersion) > 1);

    const change = { profession: 'healer', fromProfession: original.profession, fromProfessionChosenAt: original.professionChosenAt, respec: true };
    const changed = await post(choose, change);
    assert.equal(changed.status, 200);
    const next = changed.body.character as Record<string, unknown>;
    assert.equal(next.profession, 'healer');
    assert.equal(next.professionRank, 1);
    assert.equal(next.professionXp, 0);
    assert.deepEqual(next.masterySpec, {});
    assert.deepEqual(next.inventory, ['kept-item']);
    assert.equal(next.level, original.level);
    assert.equal(next.xp, original.xp);
    assert.equal(next.fateShards, 300);
    assert.ok(Number(changed.body._saveVersion) > Number(bought.body._saveVersion));

    const retriedBuy = await post(purchase, buy);
    assert.equal(retriedBuy.status, 200);
    assert.equal(retriedBuy.body.replayed, true);
    assert.equal((retriedBuy.body.character as Record<string, unknown>).fateShards, 300);
    assert.deepEqual((retriedBuy.body.character as Record<string, unknown>).inventory, ['kept-item']);
    const retriedChange = await post(choose, change);
    assert.equal(retriedChange.body.idempotent, true);

    const stored = await kv.get<Record<string, unknown>>(key);
    const stale = sanitize({ character: { ...original, inventory: ['kept-item', SCROLL] } }, stored);
    const saved = stale.character as Record<string, unknown>;
    assert.equal(saved.profession, 'healer');
    assert.equal(saved.professionRank, 1);
    assert.equal(saved.professionXp, 0);
    assert.deepEqual(saved.masterySpec, {});
    assert.deepEqual(saved.inventory, ['kept-item']);
    assert.equal(saved.fateShards, 300);
    assert.equal(saved.level, original.level);
    assert.equal(saved.xp, original.xp);
    assert.equal(saved.professionChosenAt, next.professionChosenAt, 'an autosave cannot roll the change generation backward');
});

test('generic saves cannot replace, omit, or invent a profession choice generation', () => {
    for (const generation of [undefined, null, 0, 9999999999999]) {
        const next = sanitize({ character: { ...original, professionChosenAt: generation } }, { character: original });
        assert.equal((next.character as Record<string, unknown>).professionChosenAt, original.professionChosenAt);
    }
    const { professionChosenAt: _generation, ...legacy } = original;
    const next = sanitize({ character: { ...legacy, professionChosenAt: 123 } }, { character: legacy });
    assert.equal((next.character as Record<string, unknown>).professionChosenAt, undefined);
});

test('both purchase and profession use require authentication before changing the save', async () => {
    const beforeSave = await kv.get(key);
    assert.equal((await post(purchase, { itemId: SCROLL, requestId: 'unauthenticated-scroll-buy' }, false)).status, 401);
    assert.equal((await post(choose, { profession: 'healer', respec: true }, false)).status, 401);
    assert.deepEqual(await kv.get(key), beforeSave);
});
