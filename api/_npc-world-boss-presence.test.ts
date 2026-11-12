import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';

// World-boss presence (2026-11-10): while a boss event is live, a few
// Cinderhold shinobi stand in the boss's sector like players do, and nothing
// more. No world-boss route ever lets an NPC queue, take a party slot, turn in
// shards, settle a contribution or collect a cache, whether the call comes
// through the registered route or in-process with the NPC's own token.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-world-boss-presence-secret-32-chars';

let kv: typeof import('./_storage.js').kv;
let roster: typeof import('../shared/npc-village-roster.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    roster = await import('../shared/npc-village-roster.js');
    const seed = await import('./_npc-village-seed.js');
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
});

async function liveBoss(spawnSector: number, now: number) {
    const { WORLD_BOSS_ACTIVE_KEY, worldBossEventKey } = await import('./world-boss-event/_event.js');
    const eventId = `npc-presence-${spawnSector}`;
    await kv.set(WORLD_BOSS_ACTIVE_KEY, eventId);
    await kv.set(worldBossEventKey(eventId), {
        eventId, bossId: 'hollow-beast', bossName: 'Chicxulub', status: 'roaming', hp: 1_000_000, maxHp: 1_000_000,
        startedAt: now - 1_000, roamEndsAt: now + 48 * 3_600_000, endsAt: now + 72 * 3_600_000,
        spawnSector, targetVillage: 'Stormveil Village', participants: {},
    });
}

test('a live boss draws three NPCs to its sector, a player village\'s block included (they roam the whole world)', async () => {
    const roam = await import('./_npc-roam.js');
    const presence = await import('./_npc-presence.js');
    const now = Date.now();
    await liveBoss(58, now);
    roam.resetNpcWorldBossCacheForTest();
    assert.equal(await roam.npcWorldBossSector(now), 58);
    const posts = presence.npcPosts(now, undefined, [], new Set(), { bossSector: 58 });
    assert.equal([...posts.values()].filter((p) => p.sector === 58).length, roam.NPC_BOSS_WATCHERS);
    await liveBoss(5, now);
    roam.resetNpcWorldBossCacheForTest();
    assert.equal(await roam.npcWorldBossSector(now), 5, 'they follow it into a player village too');
    const inVillage = presence.npcPosts(now, undefined, [], new Set(), { bossSector: 5 });
    assert.equal([...inVillage.values()].filter((p) => p.sector === 5).length, roam.NPC_BOSS_WATCHERS);
    await kv.del('world-boss-event:active');
    roam.resetNpcWorldBossCacheForTest();
    assert.equal(await roam.npcWorldBossSector(now), null, 'no event, no watchers');
});

test('every world-boss route refuses an NPC, registered or in-process', async () => {
    const guard = await import('./_npc-guard.js');
    const { asNpc, routeHandler } = await import('./_npc-duel-driver.js');
    const routes = ['/world-boss-event', '/world-boss-event/queue', '/world-boss-event/settle'];
    for (const route of routes) assert.ok(guard.NPC_BLOCKED_ROUTES.includes(route), `${route} is refused at registration`);
    const source = readFileSync('server-api-routes.ts', 'utf8');
    for (const route of routes) assert.ok(source.includes(`route('${route}'`), `${route} is registered (so the guard wraps it)`);

    const npc = roster.NPC_VILLAGE_ROSTER[0]!;
    const now = Date.now();
    await liveBoss(58, now);
    const queue = await asNpc(routeHandler(await import('./world-boss-event/queue.js')), npc.id, npc.name, { playerName: npc.id, action: 'join' });
    assert.equal(queue.status, 403, JSON.stringify(queue.body));
    const settle = await asNpc(routeHandler(await import('./world-boss-event/settle.js')), npc.id, npc.name, { playerName: npc.id, runId: 'any-run' });
    assert.equal(settle.status, 403, JSON.stringify(settle.body));
    const deposit = await asNpc(routeHandler(await import('./world-boss-event.js')), npc.id, npc.name, {
        action: 'depositHollowShards', playerName: npc.id, eventId: 'npc-presence-58', requestId: 'npc-deposit-request-0001',
    });
    assert.equal(deposit.status, 403, JSON.stringify(deposit.body));

    // The personal view delivers top caches, so it is refused too.
    const { issuePlayerToken, readPlayerSessionEpoch } = await import('./_auth.js');
    const npcToken = issuePlayerToken(npc.id, 60_000, await readPlayerSessionEpoch(npc.id));
    const view = { status: 200, body: {} as Record<string, unknown> };
    const res = { setHeader: () => res, status(n: number) { view.status = n; return res; }, json(v: Record<string, unknown>) { view.body = v; return res; }, end: () => res };
    await routeHandler(await import('./world-boss-event.js'))({ method: 'GET', query: { playerName: npc.id }, headers: { 'x-player-token': issuePlayerToken(npc.id), 'x-forwarded-for': '10.7.7.7' }, socket: { remoteAddress: '10.7.7.7' } } as never, res as never);
    assert.equal(view.status, 403, JSON.stringify(view.body));

    // The registration wrapper refuses the NPC's token before the handler runs.
    let reached = false;
    const wrapped = guard.refuseNpcAccounts(() => { reached = true; });
    const blocked = { status: 200 };
    const res2 = { setHeader: () => res2, status(n: number) { blocked.status = n; return res2; }, json: () => res2, end: () => res2 };
    await wrapped({ method: 'POST', body: { playerName: npc.id, action: 'join' }, headers: { 'x-player-token': npcToken } } as never, res2 as never);
    assert.equal(blocked.status, 403);
    assert.equal(reached, false);
    await kv.del('world-boss-event:active');
});
