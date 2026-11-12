import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-launch-fixes-session-secret-32-chars';
process.env.ADMIN_PASSWORD = 'npc-launch-fixes-admin';
delete process.env.DISABLE_NPC_VILLAGE;

/*
 * Launch-readiness fixes for Cinderhold (2026-11-11):
 *   1. a PLAYER who holds an NPC's account name is never driven, posted or possessed as an NPC;
 *   2. the kill switch, or session tokens being off, freezes a village war with Cinderhold;
 *   3. the presence tick reads only the save fields it needs, never a whole save;
 *   4. a duel-win rebuild of one NPC rebuilds only that NPC (no full registry read);
 *   5. the shinobi duel seat and the clan-war card seat hold a cross-process lease.
 * Test player names are checked against shared/npc-village-roster.ts (none is an NPC id).
 */

const CH = 'Cinderhold Village';
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('./_storage.js').kv;
let online: typeof import('./_realtime/online-store.js').onlineStore;
let roster: typeof import('../shared/npc-village-roster.js');
let seed: typeof import('./_npc-village-seed.js');
let ownership: typeof import('./_npc-ownership.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore: online } = await import('./_realtime/online-store.js'));
    roster = await import('../shared/npc-village-roster.js');
    seed = await import('./_npc-village-seed.js');
    ownership = await import('./_npc-ownership.js');
    (await import('./_npc-duel-driver.js')).setNpcActionBeatForTest(0);
    (await import('./_npc-clan-war-campaign.js')).setNpcClanCardBeatForTest(0);
    await kv.set('npc-village:state', { baseLevel: 40, target: 40, sample: 30, computedAt: Date.now() });
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
    for (const name of ['launchplayer', 'leaseplayer', 'cardleaseplayer']) assert.equal(roster.isNpcAccount(name), false, `${name} is no NPC id`);
});

after(async () => {
    delete process.env.ADMIN_PASSWORD;
});

async function adminCall(body: Record<string, unknown> | null, method = 'POST') {
    const handler = (await import('./admin/npc-possess.js')).default as unknown as Handler;
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json(v: Record<string, any>) { out.body = v; return res; }, end: () => res };
    await handler({ method, body: body ?? undefined, query: {}, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! }, socket: { remoteAddress: '10.91.0.1' } } as never, res as never);
    return out;
}

describe('1. a player holding an NPC account name is never treated as the NPC', { concurrency: false }, () => {
    it('presence, the seats, war jobs and admin possession all leave the player alone', async () => {
        const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'commander')!;
        const authKey = `auth:${npc.id}`;
        const npcAuth = await kv.get<Record<string, unknown>>(authKey);
        assert.equal(npcAuth?.npcVillage, true);
        // The name is really a PLAYER's (a password login), and they are online in Sector 12.
        await kv.set(authKey, { createdAt: 1, hash: 'player-hash', salt: 'player-salt' });
        ownership.forgetNpcOwnership();
        (await import('./_npc-war-roster.js')).resetNpcWarParticipantsCacheForTest();
        online.remove(npc.name);
        online.upsert({ name: npc.name, sector: 12, character: { name: npc.name, village: 'Frostfang Village', level: 30 }, tile: 40, tileSector: 12 });
        const { readPlayerSessionEpoch } = await import('./_auth.js');
        const epochBefore = await readPlayerSessionEpoch(npc.id);
        try {
            // The presence tick never posts, moves or removes the player's row.
            const presence = await import('./_npc-presence.js');
            await presence.refreshNpcPresence(Date.now());
            const row = online.get(npc.name);
            assert.equal(row?.sector, 12, 'the player stays where they are');
            assert.equal((row?.character as Record<string, unknown>)?.village, 'Frostfang Village', 'their own presence, not an NPC row');
            // No seat can act as them: every NPC request needs a token, and none is minted.
            const driver = await import('./_npc-duel-driver.js');
            let reached = false;
            const reply = await driver.asNpc(() => { reached = true; }, npc.id, npc.name, {});
            assert.equal(reply.status, 503);
            assert.equal(reached, false, 'no route is ever called as the player');
            // No war job (front posts, strikes, raids, shrine, field orders).
            const participants = await (await import('./_npc-war-roster.js')).npcWarParticipants(Date.now());
            assert.equal(participants.some((p) => p.id === npc.id), false);
            const { npcCampaignFighterFree } = await import('./_npc-village-campaign.js');
            assert.equal(await npcCampaignFighterFree(npc.id, { forCopy: true }), false);
            // Admin possession: listed as a player account, never taken or released.
            const listing = await adminCall(null, 'GET');
            const entry = (listing.body.npcs as Array<Record<string, unknown>>).find((n) => n.id === npc.id)!;
            assert.equal(entry.seeded, false);
            assert.equal(entry.playerAccount, true);
            const take = await adminCall({ npc: npc.id, action: 'take' });
            assert.equal(take.status, 409, JSON.stringify(take.body));
            assert.equal(take.body.token, undefined, 'no token for their account');
            const release = await adminCall({ npc: npc.id, action: 'release' });
            assert.equal(release.status, 409);
            assert.equal(await readPlayerSessionEpoch(npc.id), epochBefore, 'the player is never signed out');
            // The seeder still leaves their account alone.
            const passed = await seed.seedNpcVillage();
            assert.ok(passed.warnings.some((w) => w.startsWith(`${npc.id}:`)));
            assert.equal((await kv.get<Record<string, unknown>>(authKey))?.hash, 'player-hash');
        } finally {
            online.remove(npc.name);
            await kv.set(authKey, npcAuth);
            ownership.forgetNpcOwnership();
            (await import('./_npc-war-roster.js')).resetNpcWarParticipantsCacheForTest();
        }
    });
});

describe('2. Cinderhold closed freezes its village war', { concurrency: false }, () => {
    it('no ending and no settlement while closed (kill switch or no session tokens); it ends at its own end time once back', async () => {
        const { createVillageCampaign } = await import('./_village-war-campaign.js');
        const { bringVillageWarCurrent } = await import('./world-state.js');
        const { npcVillageWarFrozen } = await import('./_npc-war-roster.js');
        const startsAt = Date.now() - 10 * 86_400_000;
        const campaign = createVillageCampaign([CH, 'Frostfang Village'], startsAt, 5, { [CH]: [68, 69, 70, 71], 'Frostfang Village': [2, 3, 4, 5] });
        const war = { id: 'launch-fixes-war', villages: [CH, 'Frostfang Village'], startedAt: startsAt, updatedAt: startsAt, campaign } as never;
        const secret = process.env.SESSION_SECRET;
        for (const close of [() => { process.env.DISABLE_NPC_VILLAGE = '1'; }, () => { delete process.env.SESSION_SECRET; }]) {
            close();
            try {
                assert.equal(npcVillageWarFrozen(war), true);
                assert.deepEqual(bringVillageWarCurrent(war, Date.now()), { war, changed: false }, 'frozen: no ending is stamped');
                assert.equal(npcVillageWarFrozen({ attackerVillage: 'Frostfang Village', defenderVillage: 'Stormveil Village' }), false, 'player wars never freeze');
            } finally { delete process.env.DISABLE_NPC_VILLAGE; process.env.SESSION_SECRET = secret; }
        }
        assert.equal(npcVillageWarFrozen(war), false);
        const current = bringVillageWarCurrent(war, Date.now());
        assert.equal(current.changed, true);
        assert.equal((current.war as { endedAt?: number }).endedAt, campaign.endsAt, 'ended at its own sealed end time');
    });
});

describe('3. the presence tick reads no whole NPC save', { concurrency: false }, () => {
    it('only the projected presence fields, one guarded tick at a time', async () => {
        const presence = await import('./_npc-presence.js');
        const { projectKvValue } = await import('./_storage-projection.js');
        const rawMget = kv.mget.bind(kv);
        const projected: string[] = [];
        (kv as { mgetProjected?: unknown }).mgetProjected = async (keys: string[], projection: Record<string, readonly string[]>) => {
            projected.push(...keys);
            return (await rawMget(...keys)).map((value) => projectKvValue(value, projection));
        };
        const mget = mock.method(kv, 'mget');
        const get = mock.method(kv, 'get');
        try {
            const shown = await presence.refreshNpcPresence(Date.now());
            assert.ok(shown > 0, 'NPCs are on the map');
            const whole = [...mget.mock.calls.flatMap((c) => c.arguments as unknown[]), ...get.mock.calls.map((c) => c.arguments[0])]
                .map(String).filter((key) => roster.NPC_VILLAGE_ROSTER.some((npc) => key === `save:${npc.id}`));
            assert.deepEqual(whole, [], 'no NPC save is read whole');
            assert.ok(roster.NPC_VILLAGE_ROSTER.every((npc) => projected.includes(`save:${npc.id}`)), 'every NPC save is read projected');
            const row = roster.NPC_VILLAGE_ROSTER.map((npc) => online.get(npc.name)).find(Boolean)!;
            const character = row.character as Record<string, unknown>;
            assert.ok(character.name && Number(character.level) > 0 && Array.isArray(character.pets), 'the presence row still carries what it shows');
            assert.equal(character.jutsu, undefined, 'and nothing it does not');
        } finally {
            mget.mock.restore(); get.mock.restore();
            delete (kv as { mgetProjected?: unknown }).mgetProjected;
        }
        // Reentrancy: a tick still running is never stacked on.
        const [a, b] = await Promise.all([presence.runNpcPresenceTick(), presence.runNpcPresenceTick()]);
        assert.equal([a, b].filter((x) => x === null).length, 1, 'the second, overlapping tick stands down');
    });
});

describe('4. a duel-win rebuild touches only that NPC', { concurrency: false }, () => {
    it('no full registry read, no other NPC save, and its own registry row is current', async () => {
        const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'jonin')!;
        const { npcDuelRecordKey } = await import('./_npc-duel.js');
        await kv.set(npcDuelRecordKey(npc.id), { wins: 7, losses: 0, draws: 0, rivals: {} });
        const hgetall = mock.method(kv, 'hgetall');
        const get = mock.method(kv, 'get');
        const mget = mock.method(kv, 'mget');
        try {
            await seed.reseedNpc(npc.id);
            assert.equal(hgetall.mock.callCount(), 0, 'the whole player registry is never read');
            const keys = [...get.mock.calls.map((c) => c.arguments[0]), ...mget.mock.calls.flatMap((c) => c.arguments as unknown[])].map(String);
            const others = keys.filter((key) => key.startsWith('save:') && key !== `save:${npc.id}` && roster.NPC_VILLAGE_ROSTER.some((n) => key === `save:${n.id}`));
            assert.deepEqual(others, [], 'no other NPC is rebuilt');
            assert.equal(keys.filter((key) => key.startsWith('auth:') && key !== `auth:${npc.id}`).length, 0, 'nor any other account read');
        } finally {
            hgetall.mock.restore(); get.mock.restore(); mget.mock.restore();
        }
        assert.equal((await kv.get<Record<string, any>>(`save:${npc.id}`))!.character.totalPvpKills, 7, 'its save carries the new record');
        const { REGISTRY_KEY } = await import('./player/_public-index.js');
        const registry = (await kv.hgetall<Record<string, any>>(REGISTRY_KEY))!;
        const row = typeof registry[npc.id] === 'string' ? JSON.parse(registry[npc.id]) : registry[npc.id];
        assert.equal(row.totalPvpKills, 7, 'and so does its own registry row');
    });
});

describe('5. one seat per duel across processes', { concurrency: false }, () => {
    it('the shinobi duel seat never acts while another process holds the duel, and an idle sweep writes nothing', async () => {
        const driver = await import('./_npc-duel-driver.js');
        const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'elite')!;
        // Idle: a duel still being published gives the seat nothing to do, and nothing is written.
        const set = mock.method(kv, 'set');
        try {
            assert.equal(await driver.driveNpcDuel('lease-unpublished', 'p2', Date.now()), 'idle');
            assert.equal(set.mock.callCount(), 0, 'an idle sweep writes nothing, not even a lease');
        } finally { set.mock.restore(); }
        // Work to do (the NPC has to take its seat), but another process holds the duel.
        const battleId = 'lease-duel-1';
        await kv.set(`pvp:${battleId}`, { battleId, status: 'active', createdAt: Date.now() - 60_000, log: [],
            p1: { name: 'leaseplayer' }, p2: { name: npc.name }, joined: { p1: true } });
        assert.equal(driver.npcDuelHasWork(battleId, 'p2', 0, (await kv.get(`pvp:${battleId}`)) as never, Date.now()), true);
        await kv.set(driver.npcDuelLeaseKey(battleId), 'another-process', { ex: 30 });
        const move = mock.method(kv, 'set');
        try {
            assert.equal(await driver.driveNpcDuel(battleId, 'p2', 0), 'idle');
            const written = move.mock.calls.map((c) => String(c.arguments[0]));
            assert.deepEqual(written.filter((key) => key !== driver.npcDuelLeaseKey(battleId)), [], 'nothing but the refused lease attempt');
        } finally { move.mock.restore(); }
        assert.equal((await kv.get<Record<string, any>>(`pvp:${battleId}`))!.joined.p2, undefined, 'the seat did not join');
        assert.equal(await kv.get(driver.npcDuelLeaseKey(battleId)), 'another-process', 'and left the other process its lease');
        // Once the other process lets go, this one takes the lease, acts and releases it.
        await kv.del(driver.npcDuelLeaseKey(battleId));
        const taken = mock.method(kv, 'set');
        try {
            await driver.driveNpcDuel(battleId, 'p2', 0);
            assert.ok(taken.mock.calls.some((c) => c.arguments[0] === driver.npcDuelLeaseKey(battleId)), 'the lease is taken before acting');
        } finally { taken.mock.restore(); }
        assert.equal(await kv.get(driver.npcDuelLeaseKey(battleId)), null, 'and released after');
        await kv.del(`pvp:${battleId}`);
    });

    it('the clan-war card seat never acts while another process holds the duel', async () => {
        const campaign = await import('./_npc-clan-war-campaign.js');
        const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'jonin')!;
        const challengeId = 'lease-card-1';
        await kv.set(`cw-tilecards:${challengeId}`, { status: 'awaiting-p2', p1Name: 'cardleaseplayer', createdAt: Date.now() - 60_000 });
        const sent: Array<Record<string, unknown>> = [];
        campaign.setNpcClanTilecardsSendForTest(async (_npc, body) => { sent.push(body); return { status: 200, body: {} }; });
        try {
            await kv.set(`npc-clan-card:lease:${challengeId}`, 'another-process', { ex: 30 });
            assert.equal(await campaign.driveNpcClanCardDuel(challengeId, { npc: npc.id, warId: 'lease-war', at: Date.now() - 60_000 }), 'idle');
            assert.deepEqual(sent, [], 'no move while the other process plays it');
            await kv.del(`npc-clan-card:lease:${challengeId}`);
            assert.equal(await campaign.driveNpcClanCardDuel(challengeId, { npc: npc.id, warId: 'lease-war', at: Date.now() - 60_000 }), 'acted');
            assert.equal((sent as Array<Record<string, unknown>>)[0]?.action, 'join', 'it acts once the duel is free');
            assert.equal(await kv.get(`npc-clan-card:lease:${challengeId}`), null, 'and lets the lease go');
        } finally {
            campaign.setNpcClanTilecardsSendForTest(null);
            await kv.del(`cw-tilecards:${challengeId}`);
        }
    });
});
