import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROFESSION_CHANGE_APPROVAL_ID } from '../../shared/profession-change.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'profession-handler-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
const SAVE_KEY = 'save:professiontester';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./choose.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: 'professiontester', level: 13 } });
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeReq(body: Record<string, unknown>) {
    return { method: 'POST', body, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! }, socket: { remoteAddress: '127.0.0.1' } } as never;
}
function fakeRes() {
    const out: ResponseOut = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}
async function post(body: Record<string, unknown>): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    await handler(fakeReq(body), res);
    return out;
}

describe('profession choice settlement', () => {
    it('rejects a delayed change after switching away and back, preserving newly earned XP and the next scroll', async () => {
        // A future stored timestamp simulates a regressed clock and forces both
        // transitions to advance the generation without relying on wall time.
        const generation = Date.now() + 60_000;
        await kv.set(SAVE_KEY, { _saveVersion: 1, character: {
            name: 'professiontester', level: 20, profession: 'vanguard', professionChosenAt: generation,
            inventory: Array(3).fill(PROFESSION_CHANGE_APPROVAL_ID), professionXp: 10000,
        } });
        const originalRequest = { playerName: 'professiontester', profession: 'healer', fromProfession: 'vanguard', fromProfessionChosenAt: generation, respec: true };
        const first = await post(originalRequest);
        assert.equal(first.statusCode, 200);
        const firstCharacter = first.body?.character as Record<string, unknown>;
        assert.equal(firstCharacter.professionChosenAt, generation + 1);
        const back = await post({ playerName: 'professiontester', profession: 'vanguard', fromProfession: 'healer', fromProfessionChosenAt: firstCharacter.professionChosenAt, respec: true });
        assert.equal(back.statusCode, 200);
        const current = (await kv.get(SAVE_KEY)) as { character: Record<string, unknown> };
        assert.equal(current.character.professionChosenAt, generation + 2);
        current.character.professionXp = 800;
        await kv.set(SAVE_KEY, current);
        assert.equal((await post(originalRequest)).statusCode, 409);
        assert.deepEqual(await kv.get(SAVE_KEY), current);
    });

    it('rejects scroll use below level 20 or before the first profession choice', async () => {
        for (const overrides of [{ level: 19, profession: 'vanguard' }, { level: 20 }, { level: 100, profession: 'invalid' }]) {
            const save = { _saveVersion: 2, character: { name: 'professiontester', inventory: [PROFESSION_CHANGE_APPROVAL_ID], professionXp: 4000, ...overrides } };
            await kv.set(SAVE_KEY, save);
            const result = await post({ playerName: 'professiontester', profession: 'healer', respec: true, level: 100 });
            assert.equal(result.statusCode, 403);
            assert.deepEqual(await kv.get(SAVE_KEY), save);
        }
    });

    it('allows every alternate profession at level 20 and never restores prior progression', async () => {
        for (const from of ['healer', 'vanguard', 'petTamer']) {
            for (const to of ['healer', 'vanguard', 'petTamer'].filter(profession => profession !== from)) {
                const character = {
                    name: 'professiontester', level: 20, xp: 321, profession: from, professionRank: 10,
                    professionXp: 100000, masterySpec: { old: 3 }, fateShards: 500,
                    inventory: [PROFESSION_CHANGE_APPROVAL_ID, 'kept', PROFESSION_CHANGE_APPROVAL_ID],
                };
                await kv.set(SAVE_KEY, { _saveVersion: 3, character });
                const result = await post({ playerName: 'professiontester', profession: to, fromProfession: from, respec: true });
                assert.equal(result.statusCode, 200);
                const next = result.body?.character as Record<string, unknown>;
                assert.equal(next.profession, to);
                assert.equal(next.professionRank, 1);
                assert.equal(next.professionXp, 0);
                assert.deepEqual(next.masterySpec, {});
                assert.equal(next.level, character.level);
                assert.equal(next.xp, character.xp);
                assert.equal(next.fateShards, character.fateShards);
                assert.deepEqual(next.inventory, ['kept', PROFESSION_CHANGE_APPROVAL_ID]);
                const replay = await post({ playerName: 'professiontester', profession: to, fromProfession: from, respec: true });
                assert.equal(replay.body?.idempotent, true);
                assert.deepEqual((replay.body?.character as Record<string, unknown>).inventory, next.inventory);
                const returned = await post({ playerName: 'professiontester', profession: from, fromProfession: to, respec: true });
                assert.equal(returned.statusCode, 200);
                assert.equal((returned.body?.character as Record<string, unknown>).professionXp, 0);
                assert.equal((returned.body?.character as Record<string, unknown>).professionRank, 1);
            }
        }
    });

    it('consumes exactly one stacked scroll and rejects stale or invalid destinations', async () => {
        const save = { _saveVersion: 3, character: {
            name: 'professiontester', level: 20, profession: 'vanguard', inventory: ['kept'],
            itemStacks: [{ itemId: PROFESSION_CHANGE_APPROVAL_ID, count: 2 }, { itemId: 'other', count: 7 }],
        } };
        await kv.set(SAVE_KEY, save);
        assert.equal((await post({ playerName: 'professiontester', profession: 'unknown', respec: true })).statusCode, 400);
        assert.equal((await post({ playerName: 'professiontester', profession: 'healer', fromProfession: 'petTamer', respec: true })).statusCode, 409);
        assert.deepEqual(await kv.get(SAVE_KEY), save);
        const changed = await post({ playerName: 'professiontester', profession: 'healer', fromProfessionChosenAt: null, respec: true });
        assert.equal(changed.statusCode, 200);
        const next = changed.body?.character as Record<string, unknown>;
        assert.deepEqual(next.inventory, ['kept']);
        assert.deepEqual(next.itemStacks, [{ itemId: PROFESSION_CHANGE_APPROVAL_ID, count: 1 }, { itemId: 'other', count: 7 }]);
    });

    it('is deterministic and idempotent under repeated choice requests', { concurrency: false }, async () => {
        assert.equal((await post({ playerName: 'professiontester', profession: 'vanguard' })).statusCode, 200);
        const replay = await post({ playerName: 'professiontester', profession: 'vanguard' });
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.idempotent, true);
        const conflict = await post({ playerName: 'professiontester', profession: 'healer' });
        assert.equal(conflict.statusCode, 409);
        assert.equal((await kv.get<{ character?: { profession?: string } }>(SAVE_KEY))?.character?.profession, 'vanguard');
    });

    it('consumes a profession approval and resets profession progression', { concurrency: false }, async () => {
        await kv.set(SAVE_KEY, {
            _saveVersion: 4,
            character: {
                name: 'professiontester', level: 25, profession: 'vanguard', professionRank: 7,
                professionXp: 8_400, masterySpec: { ironclad: 2 },
                inventory: [PROFESSION_CHANGE_APPROVAL_ID, 'kept-item'],
            },
        });

        const changed = await post({ playerName: 'professiontester', profession: 'healer', respec: true });
        assert.equal(changed.statusCode, 200);
        assert.equal(changed.body?.approvalConsumed, true);
        const saved = await kv.get<{ character?: Record<string, unknown> }>(SAVE_KEY);
        assert.equal(saved?.character?.profession, 'healer');
        assert.equal(saved?.character?.professionRank, 1);
        assert.equal(saved?.character?.professionXp, 0);
        assert.deepEqual(saved?.character?.inventory, ['kept-item']);
        assert.deepEqual(saved?.character?.masterySpec, {});

        const second = await post({ playerName: 'professiontester', profession: 'petTamer', respec: true });
        assert.equal(second.statusCode, 409);
        assert.equal((await kv.get<{ character?: { profession?: string } }>(SAVE_KEY))?.character?.profession, 'healer');
    });

    it('requires a fresh approval for every change, including legacy accounts', { concurrency: false }, async () => {
        await kv.set(SAVE_KEY, {
            _saveVersion: 7,
            character: {
                name: 'professiontester', level: 25, profession: 'healer', professionRank: 4,
                professionRespecUsed: true,
                inventory: [PROFESSION_CHANGE_APPROVAL_ID],
            },
        });
        const changed = await post({ playerName: 'professiontester', profession: 'petTamer', respec: true });
        assert.equal(changed.statusCode, 200);
        const saved = await kv.get<{ character?: { profession?: string; inventory?: string[] } }>(SAVE_KEY);
        assert.equal(saved?.character?.profession, 'petTamer');
        assert.deepEqual(saved?.character?.inventory, []);
    });

    it('does not consume an approval on the initial choice or an idempotent replay', { concurrency: false }, async () => {
        await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: 'professiontester', level: 13, inventory: [PROFESSION_CHANGE_APPROVAL_ID] } });
        const first = await post({ playerName: 'professiontester', profession: 'petTamer' });
        assert.equal(first.statusCode, 200);
        assert.deepEqual((await kv.get<{ character?: { inventory?: string[] } }>(SAVE_KEY))?.character?.inventory, [PROFESSION_CHANGE_APPROVAL_ID]);

        const replay = await post({ playerName: 'professiontester', profession: 'petTamer', respec: true });
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.idempotent, true);
        assert.deepEqual((await kv.get<{ character?: { inventory?: string[] } }>(SAVE_KEY))?.character?.inventory, [PROFESSION_CHANGE_APPROVAL_ID]);
    });
});
