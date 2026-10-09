import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

/*
 * POST /api/sector/road-flee: fleeing a road ambush is charged by the server.
 *
 * Pinned here: the price comes from the settled save, never the request; a
 * replayed flee is charged once; an exploration ambush is settled by its flee
 * (so a fight cannot start for it afterwards, and a fight already started
 * cannot be fled); and a lost compare-and-set hands everything back.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'road-flee-admin';
delete process.env.SESSION_SECRET;

type Json = Record<string, unknown>;
type Out = { statusCode: number; body?: Json };

const FIXED_NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const PREFIX = 'roadfleeqa';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let exploreBattleMarkerKey: typeof import('../missions/_generic-ai-fight-authority.js').exploreBattleMarkerKey;
let unresolvedExploreBattle: typeof import('../world/_pending-battle.js').unresolvedExploreBattle;
let roadFleeReceiptKey: typeof import('./road-flee.js').roadFleeReceiptKey;
let PET_BREEDING_MIGRATION_VERSION: number;

before(async () => {
    mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
    ({ kv } = await import('../_storage.js'));
    const route = './road-flee.js';
    const routeModule = await import(route);
    handler = routeModule.default as typeof handler;
    roadFleeReceiptKey = routeModule.roadFleeReceiptKey;
    ({ exploreBattleMarkerKey } = await import('../missions/_generic-ai-fight-authority.js'));
    ({ unresolvedExploreBattle } = await import('../world/_pending-battle.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
});

beforeEach(async () => {
    for (const key of await kv.keys(`*${PREFIX}*`)) await kv.del(key);
});

after(async () => {
    for (const key of await kv.keys(`*${PREFIX}*`)) await kv.del(key);
    mock.timers.reset();
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

const RECEIPT_ID = 'explore_receipt_0001';

async function seed(name: string, extra: Json = {}): Promise<void> {
    await kv.set(`save:${name}`, {
        _saveVersion: 5,
        _saveAt: FIXED_NOW,
        _regenAt: FIXED_NOW,
        currentSector: 12,
        character: {
            name, level: 40, village: 'Frostfang Village', pets: [], inventory: [],
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            hp: 900, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            ryo: 5_000, fateShards: 0, boneCharms: 0,
            redeemedSectorExplorations: [{ id: RECEIPT_ID, sector: 12, at: FIXED_NOW - 60_000, outcome: { kind: 'battle' } }],
            ...extra,
        },
    });
}

async function flee(body: Json): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(payload: Json) { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body,
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': ADMIN_PASSWORD, 'x-forwarded-for': '127.0.0.94' },
        socket: { remoteAddress: '127.0.0.94' },
    } as never, res as never);
    return out;
}

async function character(name: string): Promise<Json> {
    return ((await kv.get<Json>(`save:${name}`))!.character) as Json;
}

describe('road flee', () => {
    it('charges half the HP and a capped tenth of the purse from the save, ignoring any amount sent', async () => {
        const name = `${PREFIX}road`;
        await seed(name);
        const out = await flee({ playerName: name, fleeId: 'flee_road_000001', kind: 'road', hp: 0, ryo: 0, cost: { hp: 0, ryo: 0 } });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.ok, true);
        // level 40 → the hospital's skip fee is 1,000 ryo, above 10% of 5,000.
        assert.deepEqual(out.body?.cost, { hp: 450, ryo: 500 });
        assert.deepEqual(out.body?.totals, { hp: 450, ryo: 4_500 });
        assert.equal(typeof out.body?._saveVersion, 'number');
        const after = await character(name);
        assert.equal(after.hp, 450);
        assert.equal(after.ryo, 4_500);
    });

    it('charges a replayed flee once', async () => {
        const name = `${PREFIX}replay`;
        await seed(name);
        const first = await flee({ playerName: name, fleeId: 'flee_replay_00001', kind: 'road' });
        const second = await flee({ playerName: name, fleeId: 'flee_replay_00001', kind: 'road' });
        assert.equal(first.body?.ok, true);
        assert.equal(second.body?.ok, true);
        assert.equal(second.body?.replay, true);
        assert.deepEqual(second.body?.totals, { hp: 450, ryo: 4_500 });
        assert.equal((await character(name)).ryo, 4_500, 'the retry must not drop the purse twice');
        const third = await flee({ playerName: name, fleeId: 'flee_replay_00002', kind: 'road' });
        assert.deepEqual(third.body?.cost, { hp: 225, ryo: 450 }, 'a NEW flee is a new choice and pays again');
    });

    it('never knocks the player out and never takes banked ryo', async () => {
        const name = `${PREFIX}low`;
        await seed(name, { hp: 1, ryo: 0, bankRyo: 90_000 });
        const out = await flee({ playerName: name, fleeId: 'flee_low_0000001', kind: 'road' });
        assert.deepEqual(out.body?.cost, { hp: 0, ryo: 0 });
        const after = await character(name);
        assert.equal(after.hp, 1);
        assert.equal(after.bankRyo, 90_000);
    });

    it('settles an exploration ambush so no fight can start for it, and the next exploration is not bounced back', async () => {
        const name = `${PREFIX}explore`;
        await seed(name);
        const before = await unresolvedExploreBattle(name, [{ id: RECEIPT_ID, sector: 12, at: FIXED_NOW - 60_000, outcome: { kind: 'battle' } }], FIXED_NOW);
        assert.ok(before, 'the rolled ambush starts out owed');
        const out = await flee({ playerName: name, fleeId: 'flee_explore_0001', kind: 'explore', sector: 12, requestId: RECEIPT_ID });
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
        const marker = await kv.get<Json>(exploreBattleMarkerKey(name, RECEIPT_ID));
        assert.equal(marker?.fled, true);
        const owed = await unresolvedExploreBattle(name, [{ id: RECEIPT_ID, sector: 12, at: FIXED_NOW - 60_000, outcome: { kind: 'battle' } }], FIXED_NOW);
        assert.equal(owed, null, 'a fled ambush is no longer owed');
    });

    it('refuses to flee an ambush whose fight already started, or one that is not this player\'s', async () => {
        const name = `${PREFIX}started`;
        await seed(name);
        await kv.set(exploreBattleMarkerKey(name, RECEIPT_ID), { playerName: name, token: 'tok12345', sessionId: 'session123', at: FIXED_NOW });
        const started = await flee({ playerName: name, fleeId: 'flee_started_001', kind: 'explore', sector: 12, requestId: RECEIPT_ID });
        assert.equal(started.body?.ok, false);
        assert.equal(started.body?.reason, 'already-resolved');
        assert.equal(started.body?.error, 'That fight has already begun.');
        assert.equal(started.body?._saveVersion, undefined, 'a refusal changed nothing and carries no version');
        const wrongSector = await flee({ playerName: name, fleeId: 'flee_started_002', kind: 'explore', sector: 13, requestId: RECEIPT_ID });
        assert.equal(wrongSector.body?.reason, 'invalid-encounter');
        assert.equal((await character(name)).ryo, 5_000, 'refusals charge nothing');
    });

    it('hands back the receipt and the ambush marker when the save write loses its compare-and-set', async () => {
        const name = `${PREFIX}conflict`;
        await seed(name);
        const original = kv.compareSet;
        let armed = true;
        kv.compareSet = async (key, expected, value, options) => {
            if (armed && key === `save:${name}`) { armed = false; return false; }
            return original.call(kv, key, expected, value, options);
        };
        try {
            const lost = await flee({ playerName: name, fleeId: 'flee_conflict_01', kind: 'explore', sector: 12, requestId: RECEIPT_ID });
            assert.equal(lost.statusCode, 503);
        } finally {
            kv.compareSet = original;
        }
        assert.equal(await kv.get(exploreBattleMarkerKey(name, RECEIPT_ID)), null, 'the ambush is still owed');
        assert.equal((await character(name)).ryo, 5_000);
        const retry = await flee({ playerName: name, fleeId: 'flee_conflict_01', kind: 'explore', sector: 12, requestId: RECEIPT_ID });
        assert.equal(retry.body?.ok, true);
        assert.notEqual(retry.body?.replay, true, 'the retry is charged as the first real flee');
        assert.equal((await character(name)).ryo, 4_500);
    });

    it('a save write that fails without landing hands everything back, so the retry is charged exactly once', async () => {
        const name = `${PREFIX}unconfirmed`;
        await seed(name);
        const original = kv.compareSet;
        let armed = true;
        // A transport failure: nothing is written, and it is NOT a version conflict.
        kv.compareSet = async (key, expected, value, options) => {
            if (armed && key === `save:${name}`) { armed = false; throw new Error('socket hang up'); }
            return original.call(kv, key, expected, value, options);
        };
        try {
            const failed = await flee({ playerName: name, fleeId: 'flee_unconfirm_1', kind: 'explore', sector: 12, requestId: RECEIPT_ID });
            assert.equal(failed.statusCode, 500);
        } finally {
            kv.compareSet = original;
        }
        assert.equal(await kv.get(roadFleeReceiptKey(name, 'flee_unconfirm_1')), null, 'the unpaid receipt was handed back');
        assert.equal(await kv.get(exploreBattleMarkerKey(name, RECEIPT_ID)), null, 'the ambush is still owed');
        assert.equal((await character(name)).ryo, 5_000);
        const retry = await flee({ playerName: name, fleeId: 'flee_unconfirm_1', kind: 'explore', sector: 12, requestId: RECEIPT_ID });
        assert.equal(retry.body?.ok, true);
        assert.notEqual(retry.body?.replay, true, 'the retry is the real, first charge');
        assert.equal((await character(name)).ryo, 4_500);
    });

    it('a save write that lands but loses its acknowledgement is charged once, never twice', async () => {
        const name = `${PREFIX}landed`;
        await seed(name);
        const original = kv.compareSet;
        let armed = true;
        kv.compareSet = async (key, expected, value, options) => {
            const result = await original.call(kv, key, expected, value, options);
            if (armed && key === `save:${name}`) { armed = false; throw new Error('ack lost'); }
            return result;
        };
        try {
            const first = await flee({ playerName: name, fleeId: 'flee_landed_0001', kind: 'road' });
            assert.equal(first.body?.ok, true, 'the read-back confirms the commit');
        } finally {
            kv.compareSet = original;
        }
        const retry = await flee({ playerName: name, fleeId: 'flee_landed_0001', kind: 'road' });
        assert.equal(retry.body?.replay, true);
        assert.equal((await character(name)).ryo, 4_500);
    });

    it('rejects a request without flee details', async () => {
        const name = `${PREFIX}bad`;
        await seed(name);
        assert.equal((await flee({ playerName: name, kind: 'road' })).statusCode, 400);
        assert.equal((await flee({ playerName: name, fleeId: 'flee_bad_0000001', kind: 'bandit' })).statusCode, 400);
        assert.equal((await flee({ playerName: name, fleeId: 'flee_bad_0000002', kind: 'explore', sector: 12 })).statusCode, 400);
    });
});
