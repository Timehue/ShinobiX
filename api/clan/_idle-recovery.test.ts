import assert from 'node:assert/strict';
import { before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'clan-idle-recovery-memory-only';
delete process.env.SESSION_SECRET;

/*
 * Every clan write to a member's save keeps the idle recovery that member
 * earned since their last save.
 *
 * mutatePlayerSave credits the HP, chakra and stamina recovered since the
 * regeneration cursor before it writes, and carries the cursor forward. These
 * routes used to build the next save version themselves, which fenced the
 * cursor to "now" and threw that recovery away. It hurt most when the member
 * was not online: the one being kicked, everyone in a clan being dissolved,
 * the recipient of a gift. Each test starts the member 30 s past their last
 * save at HP 10/100, chakra 20/100 and stamina 0/100, drives the real route,
 * and checks that the recovery and the carried cursor survived.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Record<string, any> };
type Route = 'kick' | 'leave' | 'exchange' | 'transfer' | 'sealDonate' | 'sealDistribute' | 'save';

let kv: typeof import('../_storage.js').kv;
const handlers = {} as Record<Route, Handler>;

const CLAN_NAME = 'Rest Clan';
const CLAN_KEY = 'save:clan-restclan';
const FOUNDER = 'restfounder';
const MEMBER = 'restmember';

let tiredAt = 0;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handlers.kick = (await import('./kick.js')).default as unknown as Handler;
    handlers.leave = (await import('./leave.js')).default as unknown as Handler;
    handlers.exchange = (await import('./exchange/purchase.js')).default as unknown as Handler;
    handlers.transfer = (await import('./treasury/transfer.js')).default as unknown as Handler;
    handlers.sealDonate = (await import('./seal-pool/donate.js')).default as unknown as Handler;
    handlers.sealDistribute = (await import('./seal-pool/distribute.js')).default as unknown as Handler;
    // Deleting the clan save dissolves the clan.
    handlers.save = (await import('../save/[name].js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set(CLAN_KEY, {
        name: CLAN_NAME,
        founderName: FOUNDER,
        level: 25,
        xp: 0,
        treasury: { ryo: 100_000, warSupply: 10 },
        members: [{ name: FOUNDER, isFounder: true }, { name: MEMBER, battleContrib: 20 }],
    });
    await kv.set(`save:${FOUNDER}`, { _saveVersion: 1, character: { name: FOUNDER, clan: CLAN_NAME, clanFounder: true } });
    tiredAt = Date.now() - 30_000;
    await kv.set(`save:${MEMBER}`, {
        _saveVersion: 1,
        _saveAt: tiredAt,
        _regenAt: tiredAt,
        character: {
            name: MEMBER, clan: CLAN_NAME, clanPoints: 4000, ryo: 50_000, profession: 'vanguard', honorSeals: 100,
            hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100,
        },
    });
});

async function call(handler: Handler, request: { method?: string; body?: Record<string, unknown>; query?: Record<string, string> }): Promise<Reply> {
    const output: Reply = { status: 200, body: {} };
    const res = {
        setHeader() { return res; },
        status(n: number) { output.status = n; return res; },
        json(payload: Record<string, any>) { output.body = payload; return res; },
        end() { return res; },
    };
    await handler({
        method: request.method ?? 'POST',
        body: request.body ?? {},
        query: request.query ?? {},
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD },
        socket: { remoteAddress: '127.0.0.91' },
    } as never, res as never);
    return output;
}

const post = (route: Route, body: Record<string, unknown>) => call(handlers[route], { body });

/** The member's save, after asserting it kept the recovery and the cursor. */
async function recovered(): Promise<Record<string, any>> {
    const saved = (await kv.get<Record<string, any>>(`save:${MEMBER}`))!;
    const character = saved.character;
    assert.ok(character.hp >= 40, `hp ${character.hp} lost the idle recovery`);
    assert.ok(character.chakra >= 50, `chakra ${character.chakra} lost the idle recovery`);
    assert.ok(character.stamina >= 30, `stamina ${character.stamina} lost the idle recovery`);
    // None of these writes moves a vital, so each carries the settled cursor.
    assert.ok(Number(saved._regenAt) >= tiredAt + 30_000 - 1_000, `cursor ${saved._regenAt} fell behind the recovery`);
    assert.equal((Number(saved._regenAt) - tiredAt) % 1_000, 0, `cursor ${saved._regenAt} was fenced to the write, not carried`);
    return saved;
}

describe('clan writes keep the idle recovery a member earned', { concurrency: false }, () => {
    test('a kicked member', async () => {
        const reply = await post('kick', { playerName: FOUNDER, clan: CLAN_NAME, targetName: MEMBER });
        assert.equal(reply.status, 200, JSON.stringify(reply.body));
        assert.equal((await recovered()).character.clan, null, 'they were still removed');
    });

    test('a member who leaves', async () => {
        const reply = await post('leave', { playerName: MEMBER, clan: CLAN_NAME });
        assert.equal(reply.status, 200, JSON.stringify(reply.body));
        const saved = await recovered();
        assert.equal(saved.character.clan, null, 'they still left');
        assert.equal(reply.body._saveVersion, saved._saveVersion, 'the reply echoes the committed version');
        assert.deepEqual(reply.body.character, saved.character, 'and the committed character');
    });

    test('a member of a dissolved clan', async () => {
        const reply = await call(handlers.save, { method: 'DELETE', query: { name: CLAN_KEY.slice('save:'.length) } });
        assert.equal(reply.status, 200, JSON.stringify(reply.body));
        assert.equal((await recovered()).character.clan, null, 'they were still released');
    });

    test('a Clan Point purchase', async () => {
        const reply = await post('exchange', { playerName: MEMBER, clan: CLAN_NAME, itemId: 'smallRyoPouch' });
        assert.equal(reply.status, 200, JSON.stringify(reply.body));
        const saved = await recovered();
        assert.ok(saved.character.clanPoints < 4000, 'the points were still spent');
        assert.equal(reply.body._saveVersion, saved._saveVersion, 'the reply echoes the committed version');
        assert.deepEqual(reply.body.character, saved.character, 'and the committed character');
    });

    test('a War Supply purchase', async () => {
        const reply = await post('exchange', {
            playerName: MEMBER,
            clan: CLAN_NAME,
            itemId: 'warSupplyGrant',
            requestId: `cex-${Date.now()}-${'a'.repeat(32)}`,
        });
        assert.equal(reply.status, 200, JSON.stringify(reply.body));
        assert.ok((await recovered()).character.clanPoints < 4000, 'the points were still spent');
    });

    test('a treasury gift to the member', async () => {
        const reply = await post('transfer', { clanName: CLAN_NAME, recipientName: MEMBER, currency: 'ryo', amount: 1000 });
        assert.equal(reply.status, 200, JSON.stringify(reply.body));
        assert.ok((await recovered()).character.ryo > 50_000, 'the gift was still credited');
    });

    test('an Honor Seal donation', async () => {
        const reply = await post('sealDonate', { playerName: MEMBER, amount: 10, requestId: 'idle-recovery-donate' });
        assert.equal(reply.status, 200, JSON.stringify(reply.body));
        assert.equal((await recovered()).character.honorSeals, 90, 'the Seals were still donated');
    });

    test('an Honor Seal gift from the clan pool', async () => {
        await kv.set(`clan-seal-pool:${CLAN_NAME.toLowerCase()}`, { clanName: CLAN_NAME, balance: 100, log: [] });
        const reply = await post('sealDistribute', {
            leaderName: FOUNDER,
            recipientName: MEMBER,
            amount: 5,
            requestId: 'idle-recovery-distribute',
        });
        assert.equal(reply.status, 200, JSON.stringify(reply.body));
        assert.equal((await recovered()).character.honorSeals, 105, 'the Seals were still credited');
    });
});
