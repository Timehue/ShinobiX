import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { makePveEngineTestSession } from './_pve-engine-test-fixture.js';
import { getFloor } from './_floor-catalog.js';
import { sealTowerCatalogFloor } from './_session-floor.js';
import type { TowerSession } from './_tower-session.js';

/*
 * A solo Story/Spire run can be forfeited by its owner. Before this, the only
 * way out of a run was to die or to walk away and wait up to thirty minutes
 * for the lapse reconciler, while the account lease (`battle-lock:<slug>`)
 * made every other combat start answer "finish your Battle Towers run".
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'tower-forfeit-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let claim: typeof import('./_battle-lease.js').claimTowerBattleLeases;
let findConflict: typeof import('../_tower-battle-guard.js').findTowerBattleStartConflict;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let forfeit: typeof import('./_lapse.js').forfeitTowerRun;
let forfeitLine: string;
let action: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ claimTowerBattleLeases: claim } = await import('./_battle-lease.js'));
    ({ findTowerBattleStartConflict: findConflict } = await import('../_tower-battle-guard.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ forfeitTowerRun: forfeit, TOWER_FORFEIT_LOG_LINE: forfeitLine } = await import('./_lapse.js'));
    action = (await import('./action.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

function storyRun(runId: string, over: Partial<TowerSession> = {}): TowerSession {
    const session = makePveEngineTestSession({ enemyLevel: 10, runId });
    session.towerId = 'celestial';
    session.floor = 1;
    delete session.encounterFloor;
    sealTowerCatalogFloor(session, getFloor(1)!, 'story');
    session.actors[0].ownerSlug = 'rill';
    session.actors[0].hp = 120;
    // A LIVE run: the lapse pre-check on every endpoint terminalizes anything
    // past its expiry before the forfeit is even looked at.
    return { ...session, lastActionAt: Date.now(), expiresAt: Date.now() + 10 * 60_000, ...over };
}

async function seedSave(slug: string) {
    await kv.set(`save:${slug}`, {
        _saveVersion: 1,
        character: { name: slug, level: 30, hp: 800, maxHp: 800, stats: {}, inventory: [] },
    });
}

async function post(runId: string, playerName: string, body: Record<string, unknown> = {}) {
    const out = { status: 200, body: {} as Record<string, unknown> };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.status = code; return res; },
        json: (value: Record<string, unknown>) => { out.body = value; return res; },
        end: () => res,
    };
    await action({
        method: 'POST',
        body: { playerName, runId, type: 'forfeit', ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(playerName)! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

describe('forfeiting a solo Tower run', { concurrency: false }, () => {
    it('ends the run as a defeat, settles the owner, and releases the account lease at once', async () => {
        const runId = 'tower-forfeit-solo';
        await seedSave('rill');
        await kv.set(`tower:${runId}`, storyRun(runId));
        assert.equal((await claim({ runId, members: ['rill'] })).ok, true);
        assert.ok(await findConflict(['rill']), 'the live run blocks every other combat start');

        const forfeited = await post(runId, 'rill');
        assert.equal(forfeited.status, 200, JSON.stringify(forfeited.body));
        assert.equal(forfeited.body.applied, true);
        const session = forfeited.body.session as TowerSession;
        assert.equal(session.status, 'done');
        assert.equal(session.winner, 'enemy', 'a forfeit is an enemy win — nothing to pay');
        assert.equal(session.rewardSettlementState, 'settled');
        assert.ok(session.forfeitedAt);
        assert.equal(session.log.at(-1), forfeitLine);

        assert.equal(await findConflict(['rill']), null, 'the lease is gone, other battles may start');
        assert.equal(await kv.get('battle-lock:rill'), null);
        assert.equal(await kv.get('battle-state:rill'), null);
        const stored = await kv.get<TowerSession>(`tower:${runId}`);
        assert.equal(stored?.status, 'done');
        const save = await kv.get<{ character: { hp: number } }>('save:rill');
        assert.equal(save?.character.hp, 120, 'the HP the owner left the run with is settled, nothing is refunded');
    });

    it('a replayed forfeit answers that the run is already over and settles nothing twice', async () => {
        const runId = 'tower-forfeit-replay';
        await seedSave('rill');
        await kv.set(`tower:${runId}`, storyRun(runId));
        assert.equal((await claim({ runId, members: ['rill'] })).ok, true);
        assert.equal((await post(runId, 'rill')).body.applied, true);
        const again = await post(runId, 'rill');
        assert.equal(again.status, 200);
        assert.equal(again.body.applied, false);
        assert.equal(again.body.reason, 'session-done');
        const save = await kv.get<{ character: { hp: number } }>('save:rill');
        assert.equal(save?.character.hp, 120);
    });

    it('refuses a non-member, a party run, a two-human run and a non-catalog run', async () => {
        await seedSave('rill');
        await seedSave('bob');
        const solo = 'tower-forfeit-foreign';
        await kv.set(`tower:${solo}`, storyRun(solo));
        const foreign = await post(solo, 'bob');
        assert.equal(foreign.status, 403);
        assert.equal((await kv.get<TowerSession>(`tower:${solo}`))?.status, 'active');

        const party = 'tower-forfeit-party';
        await kv.set(`tower:${party}`, { ...storyRun(party), towerPartyId: `tparty-${'a'.repeat(32)}` });
        const refusedParty = await post(party, 'rill');
        assert.equal(refusedParty.status, 409);
        assert.equal(refusedParty.body.reason, 'cannot-forfeit');
        assert.equal((await kv.get<TowerSession>(`tower:${party}`))?.status, 'active', 'a party run is untouched');

        const duo = storyRun('tower-forfeit-duo');
        duo.actors.push({ ...duo.actors[0], id: 'ally', ownerSlug: 'bob', name: 'Bob' });
        await kv.set(`tower:${duo.runId}`, duo);
        assert.equal((await post(duo.runId, 'rill')).status, 409, 'a second human fighter keeps the run alive');

        const encounter = makePveEngineTestSession({ enemyLevel: 10, runId: 'tower-forfeit-encounter' });
        encounter.actors[0].ownerSlug = 'rill';
        encounter.lastActionAt = Date.now();
        encounter.expiresAt = Date.now() + 10 * 60_000;
        await kv.set(`tower:${encounter.runId}`, encounter);
        assert.equal((await post(encounter.runId, 'rill')).status, 409, 'only Story/Spire runs are forfeitable');
    });

    it('the pure transition is refused for the same reasons without touching storage', async () => {
        const refusedBy = async (session: TowerSession, player: string) => {
            const rows = new Map<string, TowerSession>([[session.runId, session]]);
            const result = await forfeit(session.runId, player, {
                read: async (runId) => rows.get(runId) ?? null,
                write: async (next) => { rows.set(next.runId, next); },
                lock: async (_key, fn) => fn(),
                now: () => 1_800_000_000_000,
                releaseLeases: async () => undefined,
                closeParty: async () => null,
                settle: async () => ({ ok: true, applied: true }),
            });
            return { result, stored: rows.get(session.runId)! };
        };
        const ok = await refusedBy(storyRun('pure-solo'), 'rill');
        assert.equal(ok.result.ok && ok.result.transitioned, true);
        assert.equal(ok.stored.status, 'done');
        assert.equal(ok.stored.lapsedAt, 1_800_000_000_000, 'stamped at the forfeit so the lapse readers retry its consequences');

        const foreign = await refusedBy(storyRun('pure-foreign'), 'bob');
        assert.deepEqual(foreign.result, { ok: false, status: 403, error: 'Not a member of this run.' });
        assert.equal(foreign.stored.status, 'active');

        const worldBoss = await refusedBy(storyRun('pure-world-boss', { worldBossEvent: { eventId: 'wb', bossId: 'b' } as never }), 'rill');
        assert.equal(worldBoss.result.ok, false);
        assert.equal(worldBoss.stored.status, 'active');
    });
});
