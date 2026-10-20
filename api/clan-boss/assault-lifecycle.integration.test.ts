import assert from 'node:assert/strict';
import test, { before, mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'clan-assault-lifecycle-test-admin';
delete process.env.SESSION_SECRET;
delete process.env.DISABLE_CLAN_BOSS;

type Handler = (req: never, res: never) => Promise<unknown>;
let start: Handler, settle: Handler, myRun: Handler;
let kv: typeof import('../_storage.js').kv;
let catalog: typeof import('./_storage.js');
let store: typeof import('../towers/_tower-store.js');
before(async () => {
    ({ kv } = await import('../_storage.js'));
    catalog = await import('./_storage.js');
    store = await import('../towers/_tower-store.js');
    start = (await import('./assault-start.js')).default as unknown as Handler;
    settle = (await import('./assault-settle.js')).default as unknown as Handler;
    myRun = (await import('../towers/my-run.js')).default as unknown as Handler;
});

async function call(handler: Handler, body: Record<string, unknown>, method = 'POST') {
    const out: { status: number; body: Record<string, any> } = { status: 200, body: {} };
    const res = { setHeader: () => res, status: (value: number) => { out.status = value; return res; },
        json: (value: Record<string, any>) => { out.body = value; return res; }, end: () => res };
    await handler({ method, body, query: body, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return out;
}

for (const [index, bossId] of ['oni-warlord', 'abyss-leviathan', 'fallen-kage', 'stone-golem'].entries()) {
    for (const winner of ['squad', 'enemy'] as const) test(`${bossId} ${winner}: accepted run resumes, banks once and leaves no completed operation to rejoin`, async () => {
        const slug = `clanflow${index}${winner}`;
        const clanName = `FlowClan${index}${winner}`;
        const now = Date.now(), weekId = catalog.clanBossWeekId(now);
        await kv.set(catalog.clanBossWeekKey(weekId), { weekId, bossId, spawnedAt: now - 1000, endsAt: now + 86400000 });
        await kv.set(`save:${slug}`, { _saveVersion: 1, character: { name: slug, clan: clanName, level: 85, hp: 8000, maxHp: 8000,
            chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000, ryo: 1000, fateShards: 0,
            stats: { strength: 100, speed: 100, taijutsuOffense: 1000, taijutsuDefense: 1000 }, specialty: 'Taijutsu', inventory: [], equipment: {} } });
        await kv.set(`save:clan-${clanName.toLowerCase()}`, { name: clanName, members: [{ name: slug }] });
        const launch = { hostName: slug, requestId: `launch-${slug}` };
        const first = await call(start, launch);
        assert.equal(first.status, 200, JSON.stringify(first.body));
        const runId = first.body.runId as string;
        const progressBefore = await catalog.loadClanBossProgress(weekId, clanName);
        const replay = await call(start, launch);
        assert.equal(replay.body.runId, runId);
        assert.deepEqual(await catalog.loadClanBossProgress(weekId, clanName), progressBefore);
        const active = await call(myRun, { playerName: slug }, 'GET');
        assert.equal(active.body.runId, runId);
        assert.equal(active.body.session.phaseState.bossId, first.body.session.phaseState.bossId);
        assert.equal((await call(settle, { runId, playerName: slug })).status, 400, 'unfinished combat cannot bank damage');
        const session = (await store.readSession(runId))!;
        const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
        boss.hp = winner === 'squad' ? 0 : Math.floor(boss.maxHp * 0.75);
        const damage = boss.maxHp - boss.hp;
        session.status = 'done'; session.winner = winner;
        if (winner === 'enemy') for (const actor of session.actors.filter(actor => actor.side === 'squad')) actor.hp = 0;
        await store.writeSession(session);
        const terminal = await call(myRun, { playerName: slug }, 'GET');
        assert.equal(terminal.body.runId, runId, 'completed but unsettled assault stays recoverable');
        if (index === 0 && winner === 'squad') {
            const originalSet = kv.set.bind(kv);
            const interrupted = mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
                if (args[0] === `tower:${runId}` && (args[1] as { rewardSettlementState?: string })?.rewardSettlementState === 'settled') {
                    throw new Error('Injected final operation write outage.');
                }
                return originalSet(...args);
            });
            try {
                assert.equal((await call(settle, { runId, playerName: slug })).status, 500);
                assert.notEqual((await store.readSession(runId))!.rewardSettlementState, 'settled');
                assert.equal((await call(myRun, { playerName: slug }, 'GET')).body.runId, runId);
            } finally { interrupted.mock.restore(); }
        }
        if (index === 0 && winner === 'enemy') {
            const missingSave = await kv.get(`save:${slug}`);
            await kv.del(`save:${slug}`);
            assert.equal((await call(settle, { runId, playerName: slug })).status, 503);
            assert.notEqual((await store.readSession(runId))!.rewardSettlementState, 'settled');
            assert.equal((await call(myRun, { playerName: slug }, 'GET')).body.runId, runId);
            await kv.set(`save:${slug}`, missingSave);
        }
        const paid = await call(settle, { runId, playerName: slug });
        assert.equal(paid.status, 200, JSON.stringify(paid.body));
        assert.equal(paid.body.ok, true);
        assert.equal(paid.body.pool, progressBefore!.pool - Math.min(damage, progressBefore!.pool));
        const progressAfter = await catalog.loadClanBossProgress(weekId, clanName);
        const saveAfter = await kv.get(`save:${slug}`);
        assert.equal(progressAfter!.assaults.filter(entry => entry.runId === runId).length, 1);
        assert.equal((await call(settle, { runId, playerName: slug })).status, 200);
        assert.deepEqual(await catalog.loadClanBossProgress(weekId, clanName), progressAfter);
        assert.deepEqual(await kv.get(`save:${slug}`), saveAfter, 'replay cannot grant the same operation rewards twice');
        const finished = await call(myRun, { playerName: slug }, 'GET');
        assert.equal(finished.body.runId, null, 'a fully settled operation must not reopen as an unpaid fight');
        assert.equal((await store.readSession(runId))!.rewardSettlementState, 'settled');
    });
}
