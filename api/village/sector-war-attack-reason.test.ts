import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'sector-war-attack-reason-admin';
delete process.env.DISABLE_VILLAGE_WAR;
delete process.env.SESSION_SECRET;

/*
 * Registering a world PvP battle against a sector answers 200 whether or not the
 * battle counts — absence of a contest is an ordinary no-op, not a fault. That
 * shared success hid a real one: on a Card or Pet sector the fight was refused
 * the same way, so a player threw punches "for the sector" and scored nothing,
 * and the client had no way to tell the two apart to say so.
 *
 * These pin `reason`, which is what makes them distinguishable. They do NOT
 * change the status code: the client's registration retry loop treats any
 * non-200 as retryable, and turning a Card sector into an error would have made
 * every world attack there fail four times and then alert.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const NOW = Date.now();
const SECTOR = 23;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const PLAYER = 'raider';
const BATTLE_ID = 'battle-reason-1';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let sectorWarKey: typeof import('../_sector-war.js').sectorWarKey;
let newSectorWarSession: typeof import('../_sector-war.js').newSectorWarSession;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ sectorWarKey, newSectorWarSession } = await import('../_sector-war.js'));
    const loaded = await import('./sector-war.js');
    handler = ((loaded.default as unknown as { default?: Handler })?.default ?? loaded.default) as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, village: ATTACKER } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function seedContest(winCondition: 'combat' | 'card' | 'pet') {
    const contest = newSectorWarSession({ sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition, now: NOW });
    await kv.set(sectorWarKey(contest.id), contest);
    return contest;
}

async function register(): Promise<ResponseOut> {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    const req = {
        method: 'POST',
        body: { action: 'attack', playerName: PLAYER, sector: SECTOR, battleId: BATTLE_ID },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res as never);
    return out;
}

describe('sector-war battle registration names WHY it did not register', { concurrency: false }, () => {
    it('reports no-contest on a sector with no war', async () => {
        const out = await register();
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.registered, false);
        assert.equal(out.body?.noContest, true);
        assert.equal(out.body?.reason, 'no-contest');
        assert.equal(out.body?.winCondition, undefined);
    });

    it('reports win-condition — with the type and contest id — on a Card sector', async () => {
        const contest = await seedContest('card');
        const out = await register();
        assert.equal(out.statusCode, 200, 'must stay a 200: the client retries any non-200 four times');
        assert.equal(out.body?.registered, false);
        assert.equal(out.body?.reason, 'win-condition');
        assert.equal(out.body?.winCondition, 'card');
        assert.equal(out.body?.sectorWarId, contest.id);
    });

    it('reports the same for a Pet sector', async () => {
        await seedContest('pet');
        const out = await register();
        assert.equal(out.body?.reason, 'win-condition');
        assert.equal(out.body?.winCondition, 'pet');
    });

    it('does NOT short-circuit a Combat sector — it goes on to look the battle up', async () => {
        await seedContest('combat');
        const out = await register();
        // No pvp:<id> row exists, so the real registration path 404s. That is the
        // point: Combat must reach the battle lookup rather than answering a no-op.
        assert.equal(out.statusCode, 404);
        assert.equal(out.body?.reason, undefined);
    });
});
