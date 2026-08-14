import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'heal-handler-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let token = '';
let healerToken = '';
const PLAYER = 'hospitalpayer';
const SAVE_KEY = `save:${PLAYER}`;
const HEALER = 'receiptmedic';
const TARGET = 'receiptpatient';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    const auth = await import('../_auth.js');
    token = auth.issuePlayerToken(PLAYER)!;
    healerToken = auth.issuePlayerToken(HEALER)!;
    handler = (await import('./heal.js')).default as unknown as Handler;
});

beforeEach(async () => {
    onlineStore.remove(TARGET);
    await kv.set(SAVE_KEY, {
        _saveVersion: 1,
        character: {
            name: PLAYER,
            profession: 'vanguard',
            ryo: 10_000,
            hp: 1,
            maxHp: 100,
            chakra: 1,
            maxChakra: 100,
            stamina: 1,
            maxStamina: 100,
            hospitalized: true,
            hospitalizedAt: Date.now(),
            hospitalizedUntil: Date.now() + 60_000,
        },
    });
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

function request() {
    return {
        method: 'POST',
        body: { targetName: PLAYER, paySkip: true },
        headers: { 'content-type': 'application/json', 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

function response() {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

test('concurrent paid discharge debits exactly once', { concurrency: false }, async () => {
    const a = response();
    const b = response();
    await Promise.all([handler(request(), a.res), handler(request(), b.res)]);
    assert.deepEqual([a.out.statusCode, b.out.statusCode].sort(), [200, 200]);
    const charges = [Number(a.out.body?.chargedRyo ?? 0), Number(b.out.body?.chargedRyo ?? 0)].sort((x, y) => x - y);
    assert.deepEqual(charges, [0, 2_500]);
    const stored = await kv.get<{ character?: { ryo?: number; hospitalized?: boolean } }>(SAVE_KEY);
    assert.equal(stored?.character?.ryo, 7_500);
    assert.equal(stored?.character?.hospitalized, false);
    assert.equal(a.out.body?._saveVersion, 2);
    assert.equal(b.out.body?._saveVersion, 2);
});

test('self top-up returns the version that was actually persisted', { concurrency: false }, async () => {
    await kv.set(SAVE_KEY, {
        _saveVersion: 7,
        character: {
            name: PLAYER,
            profession: 'healer',
            ryo: 10_000,
            hp: 10,
            maxHp: 100,
            chakra: 10,
            maxChakra: 100,
            stamina: 10,
            maxStamina: 100,
            hospitalized: false,
        },
    });
    const req = request() as unknown as { body: Record<string, unknown> };
    req.body = { targetName: PLAYER, topUp: true };
    const out = response();
    await handler(req as never, out.res);
    assert.equal(out.out.statusCode, 200);
    assert.equal(out.out.body?._saveVersion, 8);
    const stored = await kv.get<Record<string, unknown>>(SAVE_KEY);
    assert.equal(stored?._saveVersion, 8);
});

test('active-battle rejection does not reserve the target heal cooldown', { concurrency: false }, async () => {
    await kv.set(`save:${HEALER}`, {
        _saveVersion: 1,
        character: { name: HEALER, profession: 'healer', professionXp: 0, village: 'Ember Village', chakra: 100 },
    });
    await kv.set(`save:${TARGET}`, {
        _saveVersion: 1,
        character: {
            name: TARGET,
            village: 'Ember Village',
            hp: 20,
            maxHp: 100,
            chakra: 5,
            maxChakra: 80,
            stamina: 5,
            maxStamina: 70,
            hospitalized: true,
            hospitalizedAt: Date.now(),
            hospitalizedUntil: Date.now() + 60_000,
        },
    });
    onlineStore.upsert({ name: TARGET, sector: 1, inBattle: true } as never);
    const req = {
        method: 'POST',
        body: { healerName: HEALER, targetName: TARGET, requestId: 'heal_active_battle_0001' },
        headers: { 'content-type': 'application/json', 'x-player-token': healerToken },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    const out = response();
    await handler(req, out.res);
    assert.equal(out.out.statusCode, 409);
    assert.equal(await kv.get(`heal:lastHealedAt:${TARGET}`), null);
});

test('cross-player heal request is receipt-backed and idempotent', { concurrency: false }, async () => {
    await kv.set(`save:${HEALER}`, {
        _saveVersion: 1,
        character: {
            name: HEALER,
            profession: 'healer',
            professionXp: 0,
            professionRank: 1,
            village: 'Ember Village',
            chakra: 100,
        },
    });
    await kv.set(`save:${TARGET}`, {
        _saveVersion: 1,
        character: {
            name: TARGET,
            profession: 'vanguard',
            village: 'Ember Village',
            hp: 20,
            maxHp: 100,
            chakra: 5,
            maxChakra: 80,
            stamina: 5,
            maxStamina: 70,
            hospitalized: true,
            hospitalizedAt: Date.now(),
            hospitalizedUntil: Date.now() + 60_000,
        },
    });
    const req = {
        method: 'POST',
        body: { healerName: HEALER, targetName: TARGET, requestId: 'heal_receipt_test_000001' },
        headers: { 'content-type': 'application/json', 'x-player-token': healerToken },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;

    const first = response();
    const replay = response();
    await handler(req, first.res);
    await handler(req, replay.res);
    assert.equal(first.out.statusCode, 200);
    assert.equal(replay.out.statusCode, 200);
    assert.equal(replay.out.body?.replayed, true);

    const healer = await kv.get<{ character: { chakra: number; professionXp: number; serverSettlementReceipts: unknown[] } }>(`save:${HEALER}`);
    const target = await kv.get<{ character: { hp: number; hospitalized: boolean; serverSettlementReceipts: unknown[] } }>(`save:${TARGET}`);
    assert.equal(healer?.character.chakra, 80);
    assert.equal(healer?.character.professionXp, 120);
    assert.equal(healer?.character.serverSettlementReceipts.length, 1);
    assert.equal(target?.character.hp, 100);
    assert.equal(target?.character.hospitalized, false);
    assert.equal(target?.character.serverSettlementReceipts.length, 1);
    const storedHealer = await kv.get<{ _saveVersion: number }>(`save:${HEALER}`);
    assert.equal(replay.out.body?._saveVersion, storedHealer?._saveVersion);
});
