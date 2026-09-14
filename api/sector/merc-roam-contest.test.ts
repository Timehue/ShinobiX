import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'merc-roam-contest-admin';
delete process.env.DISABLE_VILLAGE_WAR;
delete process.env.SESSION_SECRET;

/*
 * The roster read is the World Map's ONLY per-sector poll, so it is where the
 * client learns which game an attack in this sector opens (§17.2). Before this,
 * the map knew nothing about sector wars at all: a Card/Pet sector silently ran
 * a shinobi fight the server then scored at zero. These tests pin the contest
 * projection — including that it is answered for EVERY win-condition, not just
 * the Combat one the merc bands care about.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };
type ContestOut = {
    id: string; sector: number; winCondition: string;
    attackerVillage: string; defenderVillage: string; endsAt: number;
};

const NOW = Date.now();
const SECTOR = 23;
const OTHER_SECTOR = 24;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const PLAYER = 'watcher';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let sectorWarKey: typeof import('../_sector-war.js').sectorWarKey;
let newSectorWarSession: typeof import('../_sector-war.js').newSectorWarSession;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ sectorWarKey, newSectorWarSession } = await import('../_sector-war.js'));
    const loaded = await import('./merc-roam.js');
    handler = ((loaded.default as unknown as { default?: Handler })?.default ?? loaded.default) as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, village: DEFENDER } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function seedContest(winCondition: 'combat' | 'card' | 'pet', sector = SECTOR) {
    const contest = newSectorWarSession({ sector, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition, now: NOW });
    await kv.set(sectorWarKey(contest.id), contest);
    return contest;
}

async function roster(sector = SECTOR): Promise<ResponseOut> {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    const req = {
        method: 'POST',
        body: { action: 'roster', playerName: PLAYER, village: DEFENDER, sector },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res as never);
    return out;
}

describe('sector roster projects the active contest', { concurrency: false }, () => {
    it('answers the Card win-condition the World Map has to route on', async () => {
        const seeded = await seedContest('card');
        const out = await roster();
        assert.equal(out.statusCode, 200);
        const contest = out.body?.contest as ContestOut;
        assert.equal(contest.id, seeded.id);
        assert.equal(contest.sector, SECTOR);
        assert.equal(contest.winCondition, 'card');
        assert.equal(contest.attackerVillage, ATTACKER);
        assert.equal(contest.defenderVillage, DEFENDER);
        assert.equal(contest.endsAt, seeded.endsAt);
    });

    it('answers Pet and Combat too — the projection is not merc-band-shaped', async () => {
        await seedContest('pet');
        assert.equal((((await roster()).body?.contest) as ContestOut).winCondition, 'pet');

        const keys = await kv.keys('*');
        if (keys.length) await kv.del(...keys);
        await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, village: DEFENDER } });
        await seedContest('combat');
        assert.equal((((await roster()).body?.contest) as ContestOut).winCondition, 'combat');
    });

    it('is null with no war, and never leaks a neighbouring sector\'s war', async () => {
        assert.equal((await roster()).body?.contest, null);

        await seedContest('card', OTHER_SECTOR);
        assert.equal((await roster(SECTOR)).body?.contest, null);
        assert.equal((((await roster(OTHER_SECTOR)).body?.contest) as ContestOut).sector, OTHER_SECTOR);
    });

    it('answers garrisonReady per VIEWER, so the client never re-derives the rule', async () => {
        // PLAYER defends this sector, so they must never be offered the garrison
        // that exists because their own side is absent.
        const quiet = newSectorWarSession({
            sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER,
            winCondition: 'card', now: NOW - 3 * 60 * 60 * 1000,
        });
        quiet.lastLiveBattleAt = NOW - 3 * 60 * 60 * 1000;
        await kv.set(sectorWarKey(quiet.id), quiet);
        assert.equal(((await roster()).body?.contest as { garrisonReady?: boolean }).garrisonReady, false,
            'the DEFENDING viewer is never offered it');

        // The same contest read by a member of the ATTACKING village.
        await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, village: ATTACKER } });
        assert.equal(((await roster()).body?.contest as { garrisonReady?: boolean }).garrisonReady, true);
    });

    it('withholds garrisonReady while the defence is still fighting', async () => {
        const busy = newSectorWarSession({
            sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER,
            winCondition: 'card', now: NOW - 3 * 60 * 60 * 1000,
        });
        busy.lastLiveBattleAt = NOW - 5 * 60 * 1000; // a defender fought 5 min ago
        await kv.set(sectorWarKey(busy.id), busy);
        await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, village: ATTACKER } });
        assert.equal(((await roster()).body?.contest as { garrisonReady?: boolean }).garrisonReady, false);
    });

    it('never offers a garrison on a Combat sector — that one has its own flow', async () => {
        const combat = newSectorWarSession({
            sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER,
            winCondition: 'combat', now: NOW - 3 * 60 * 60 * 1000,
        });
        combat.lastLiveBattleAt = NOW - 3 * 60 * 60 * 1000;
        await kv.set(sectorWarKey(combat.id), combat);
        await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, village: ATTACKER } });
        assert.equal(((await roster()).body?.contest as { garrisonReady?: boolean }).garrisonReady, false);
    });

    it('still returns the merc roster alongside it', async () => {
        await seedContest('card');
        const out = await roster();
        assert.ok(Array.isArray(out.body?.mercs), 'roster must keep answering mercs');
    });
});
