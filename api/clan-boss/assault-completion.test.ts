import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { buildTowerEncounter } from '../towers/_encounter.js';
import { CLAN_BOSS_FLOORS } from '../towers/_floor-catalog.js';
import { configureClanBossEncounter } from './_encounter-config.js';
import type { TowerSession } from '../towers/_tower-session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'clan-completion-test-admin';
delete process.env.SESSION_SECRET;
delete process.env.DISABLE_CLAN_BOSS;
delete process.env.DISABLE_LEGACY;
process.env.ENABLE_LEGACY = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let store: typeof import('../towers/_tower-store.js');
let bossStore: typeof import('./_storage.js');
let assaultStore: typeof import('./_assault.js');
let settle: Handler, myRun: Handler;
let sequence = 0;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    store = await import('../towers/_tower-store.js');
    bossStore = await import('./_storage.js');
    assaultStore = await import('./_assault.js');
    settle = (await import('./assault-settle.js')).default as unknown as Handler;
    myRun = (await import('../towers/my-run.js')).default as unknown as Handler;
});
beforeEach(async () => { for (const key of await kv.keys('*')) await kv.del(key); });

async function request(handler: Handler, player: string, runId?: string) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status: (status: number) => { out.status = status; return res; },
        json: (body: Record<string, any>) => { out.body = body; return res; }, end: () => res };
    await handler({ method: runId ? 'POST' : 'GET', query: { playerName: player }, body: { playerName: player, runId },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return out;
}

async function seed(members = ['host', 'peer'], usedItem = false) {
    const now = Date.now(), weekId = bossStore.clanBossWeekId(now);
    const week = { weekId, bossId: 'stone-golem', spawnedAt: now - 1_000, endsAt: now + 86_400_000 };
    await kv.set(`clan-boss:week:${weekId}`, week);
    const characters = members.map(name => ({ name, clan: 'Completion', level: 100, profession: 'healer',
        professionXp: 0, professionRank: 1, hp: 10_000, maxHp: 10_000, chakra: 10_000, maxChakra: 10_000,
        stamina: 10_000, maxStamina: 10_000, ryo: 100, stats: {}, equipment: {}, jutsu: [],
        equippedJutsuIds: [], inventory: usedItem && name === 'host' ? ['pot', 'pot'] : [] }));
    for (const character of characters) await kv.set(`save:${character.name}`, { _saveVersion: 1, character });
    const runId = `cboss-completion-${++sequence}`;
    const floor = CLAN_BOSS_FLOORS[3]!;
    const session = buildTowerEncounter({ floor, runId, seed: 7, partySize: members.length, towerId: 'clan-boss', now,
        squad: characters.map(character => ({ id: character.name, name: character.name, ownerSlug: character.name, ai: false, character })) });
    configureClanBossEncounter(session, floor, 22_000);
    session.round = 5;
    session.clanBossContributions = { host: { actions: 5, damage: 22_000, healing: 1_000, shielding: 100, cleanses: 0, objective: 0 } };
    if (usedItem) session.actors.find(actor => actor.id === 'host')!.itemsUsed = { pot: 1 };
    await store.writeSession(session);
    for (const member of members) await store.setTowerInvite(member, runId);
    await assaultStore.saveAssault({ runId, weekId, clanName: 'Completion', host: 'host', party: members, bossId: week.bossId, createdAt: now });
    // A previously sealed pool is intentionally preserved despite new defaults.
    await kv.set(bossStore.clanBossProgressKey(weekId, 'Completion'), {
        ...bossStore.newClanBossProgress('Completion', week, members.length), poolMax: 22_000, pool: 22_000,
    });
    return { runId, session, weekId };
}

async function finish(session: TowerSession) {
    session.status = 'done'; session.winner = 'squad'; session.objectiveState.completed = true;
    for (const actor of session.actors) if (actor.side === 'enemy') actor.hp = 0;
    await store.writeSession(session);
}

async function evidence(weekId: string, members = ['host', 'peer']) {
    return { progress: await bossStore.loadClanBossProgress(weekId, 'Completion'),
        saves: await Promise.all(members.map(member => kv.get(`save:${member}`))),
        legacy: await Promise.all(members.map(member => kv.get(`legacy:stats:${member}`))) };
}

describe('Clan Boss complete-flow recovery', { concurrency: false }, () => {
    it('keeps active and pending assaults, then removes recovery for every human only after settlement', async () => {
        const { session, runId, weekId } = await seed();
        assert.equal((await request(myRun, 'host')).body.runId, runId);
        await finish(session);
        for (const member of ['host', 'peer']) assert.equal((await request(myRun, member)).body.runId, runId);
        const result = await request(settle, 'host', runId);
        assert.equal(result.status, 200); assert.equal(result.body.settled, true);
        assert.equal((await store.readSession(runId))?.rewardSettlementState, 'settled');
        const progress = await bossStore.loadClanBossProgress(weekId, 'Completion');
        assert.equal(progress?.pool, 0); assert.equal(progress.poolMax, 22_000);
        for (const member of ['host', 'peer']) assert.equal((await request(myRun, member)).body.runId, null);
        const before = await evidence(weekId);
        assert.ok(before.legacy[0], 'the active contributor receives real Legacy combat credit');
        assert.equal((await request(settle, 'peer', runId)).status, 200);
        assert.deepEqual(await evidence(weekId), before, 'replay cannot bank damage or pay any reward twice');
    });

    it('preserves recovery through failed party cleanup and Legacy delivery', async () => {
        const { session, runId } = await seed(['host']); await finish(session);
        const parties = await import('./_party.js');
        const record = await kv.get<{ character: Record<string, unknown> }>('save:host');
        const party = parties.createPartyRecord({ id: `cbp-${'a'.repeat(32)}`, weekId: 'test', bossId: 'stone-golem',
            sectorId: 66, visibility: 'public', now: Date.now(), player: { slug: 'host', displayName: 'Host', clanName: 'Completion', saveVersion: 1, character: record!.character } });
        party.status = 'active'; party.runId = runId; await parties.saveParty(party); await parties.indexPartyMembers(party);
        const assault = await assaultStore.loadAssault(runId); await assaultStore.saveAssault({ ...assault!, partyId: party.id });
        const original = kv.set;
        for (const failedKey of [parties.partyKey(party.id), 'legacy:stats:host']) {
            kv.set = (async (key: string, ...rest: unknown[]) => {
                if (key === failedKey) throw new Error('injected terminal delivery outage');
                return original.call(kv, key, ...rest as [never]);
            }) as typeof kv.set;
            try { assert.ok((await request(settle, 'host', runId)).status >= 500); } finally { kv.set = original; }
            assert.equal((await store.readSession(runId))?.rewardSettlementState, 'pending');
            assert.equal((await request(myRun, 'host')).body.runId, runId);
        }
        assert.equal((await request(settle, 'host', runId)).status, 200);
        assert.equal((await parties.loadParty(party.id))?.status, 'completed');
        assert.equal((await request(myRun, 'host')).body.runId, null);
    });

    it('keeps item contention recoverable and deducts supplies exactly once on retry', async () => {
        const { session, runId, weekId } = await seed(['host'], true); await finish(session);
        const original = kv.get;
        kv.get = (async (key: string, ...rest: unknown[]) => {
            if (key === 'save:host') throw new Error('injected supply-save outage');
            return original.call(kv, key, ...rest as []);
        }) as typeof kv.get;
        let failed;
        try { failed = await request(settle, 'host', runId); } finally { kv.get = original; }
        assert.equal(failed.status, 503);
        assert.equal((await store.readSession(runId))?.rewardSettlementState, 'pending');
        assert.equal((await request(myRun, 'host')).body.runId, runId);
        const result = await request(settle, 'host', runId); assert.equal(result.status, 200);
        const record = await kv.get<{ character: { inventory: string[] } }>('save:host');
        assert.equal(record?.character.inventory.filter(id => id === 'pot').length, 1);
        const before = await evidence(weekId, ['host']);
        await request(settle, 'host', runId);
        assert.deepEqual(await evidence(weekId, ['host']), before);
        assert.equal((await request(myRun, 'host')).body.runId, null);
    });

    it('does not close recovery when another member award fails after damage banking', async () => {
        const { session, runId, weekId } = await seed(); await finish(session);
        const original = kv.get;
        kv.get = (async (key: string, ...rest: unknown[]) => {
            if (key === 'save:peer') throw new Error('injected peer award outage');
            return original.call(kv, key, ...rest as []);
        }) as typeof kv.get;
        try { assert.equal((await request(settle, 'host', runId)).status, 500); } finally { kv.get = original; }
        assert.equal((await assaultStore.loadAssault(runId))?.settled, true, 'damage was already banked');
        assert.equal((await store.readSession(runId))?.rewardSettlementState, 'pending');
        assert.equal((await request(myRun, 'peer')).body.runId, runId);
        assert.equal((await request(settle, 'host', runId)).status, 200);
        assert.equal((await bossStore.loadClanBossProgress(weekId, 'Completion'))?.assaults.length, 1);
        assert.equal((await request(myRun, 'peer')).body.runId, null);
    });

    it('keeps a failed terminal projection retryable without duplicate receipts or stale resurrection', async () => {
        const { session, runId, weekId } = await seed(); await finish(session);
        const original = kv.set;
        kv.set = (async (key: string, ...rest: unknown[]) => {
            if (key === store.sessionKey(runId)) throw new Error('injected terminal projection outage');
            return original.call(kv, key, ...rest as [never]);
        }) as typeof kv.set;
        try { assert.equal((await request(settle, 'host', runId)).status, 500); } finally { kv.set = original; }
        assert.equal((await store.readSession(runId))?.rewardSettlementState, 'pending');
        const before = await evidence(weekId);
        assert.equal((await request(settle, 'host', runId)).status, 200);
        assert.deepEqual(await evidence(weekId), before);
        const newer = structuredClone(session); newer.runId = `${runId}-new`; newer.status = 'active'; newer.winner = null;
        newer.rewardSettlementState = 'pending'; await store.writeSession(newer); await store.setTowerInvite('host', newer.runId);
        assert.equal((await request(settle, 'peer', runId)).status, 200);
        assert.equal((await request(myRun, 'host')).body.runId, newer.runId, 'old settlement cannot remove a genuine newer rejoin');
    });
});
