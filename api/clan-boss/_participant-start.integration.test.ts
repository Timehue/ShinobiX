import test, { before, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'isolated-clan-participant-test';
delete process.env.DISABLE_CLAN_BOSS;
delete process.env.DISABLE_CLAN_BOSS_PARTIES;
let kv: typeof import('../_storage.js').kv;
let catalog: typeof import('./_storage.js');
let parties: typeof import('./_party.js');
let store: typeof import('../towers/_tower-store.js');
let start: typeof import('./assault-start.js').default;
let partyRoute: typeof import('./party.js').default;
let issue: typeof import('../_auth.js').issuePlayerToken;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    catalog = await import('./_storage.js'); parties = await import('./_party.js');
    store = await import('../towers/_tower-store.js');
    start = (await import('./assault-start.js')).default as unknown as typeof start; partyRoute = (await import('./party.js')).default as unknown as typeof partyRoute;
    issue = (await import('../_auth.js')).issuePlayerToken;
});
async function call(handler: typeof start, host: string, body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status: (n: number) => { out.status = n; return res; },
        json: (b: typeof out.body) => { out.body = b; return res; }, end: () => res };
    await handler({ method: 'POST', body, headers: { 'x-player-token': issue(host)!, 'x-player-name': host },
        socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return out;
}
let sequence = 0;
async function setup(size = 3, rulesVersion?: 1 | 2) {
    const id = ++sequence, clanName = `BudgetClan${id}`, weekId = catalog.clanBossWeekId(Date.now());
    const slugs = Array.from({ length: size }, (_, i) => `budget${id}hero${i}`);
    const week = { weekId, bossId: 'oni-warlord', spawnedAt: Date.now() - 1000, endsAt: Date.now() + 86400000, rulesVersion };
    await kv.set(catalog.clanBossWeekKey(weekId), week);
    for (const slug of slugs) await kv.set(`save:${slug}`, { _saveVersion: 1, character: {
        name: slug, clan: clanName, level: 85, hp: 8000, maxHp: 8000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, inventory: [], equipment: {}, stats: { strength: 100, speed: 100, taijutsuOffense: 1000, taijutsuDefense: 1000 },
    } });
    await kv.set(`save:clan-${clanName.toLowerCase()}`, { name: clanName, members: slugs.map(name => ({ name })) });
    const host = slugs[0]!, contexts = await Promise.all(slugs.map(slug => parties.loadPartyPlayerContext(slug)));
    let party = parties.createPartyRecord({ player: contexts[0]!, weekId, bossId: week.bossId, sectorId: 66, visibility: 'private', now: Date.now() });
    for (const context of contexts.slice(1)) { const added = parties.addPartyMember(party, context!, Date.now()); assert.ok(added.ok); party = added.party; }
    party.members = party.members.map((m, i) => ({ ...m, ready: true, snapshot: parties.snapshotForPlayer(contexts[i]!, Date.now()) }));
    await parties.saveParty(party); await parties.indexPartyMembers(party);
    const request = { hostName: host, partyId: party.id, expectedVersion: party.version, requestId: `participant-${id}` };
    return { id, clanName, weekId, slugs, host, party, request, week };
}
test('ordinary authenticated trio charges every participant once; same paid request resumes despite its active battle', async () => {
    const f = await setup(3, 2);
    const first = await call(start, f.host, f.request); assert.equal(first.status, 200, JSON.stringify(first.body));
    const before = await catalog.loadClanBossProgress(f.weekId, f.clanName);
    assert.deepEqual(before!.memberAttempts, Object.fromEntries(f.slugs.map(s => [s, 1])));
    assert.ok(first.body.session.clanBossGuard);
    const session = (await store.readSession(first.body.runId))!;
    session.round = 3; await store.writeSession(session);
    const replay = await call(start, f.host, f.request);
    assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.equal(replay.body.session.round, 3);
    assert.equal(replay.body.runId, first.body.runId);
    assert.deepEqual(await catalog.loadClanBossProgress(f.weekId, f.clanName), before);
});
test('exhausted ally denies the entire start without charging host; roster can reopen', async () => {
    const f = await setup(3, 2), p = catalog.newClanBossProgress(f.clanName, f.week, 3);
    p.memberAttempts[f.slugs[1]!] = 5; await catalog.saveClanBossProgress(p);
    const result = await call(start, f.host, f.request);
    assert.equal(result.status, 409); assert.deepEqual(result.body.members, [f.slugs[1]]);
    assert.deepEqual(await catalog.loadClanBossProgress(f.weekId, f.clanName), p);
    assert.equal((await parties.loadParty(f.party.id))!.status, 'forming');
});
test('concurrent distinct solo starts share one remaining ticket and publish one run', async () => {
    const f = await setup(1, 2), p = catalog.newClanBossProgress(f.clanName, f.week, 1);
    p.memberAttempts[f.host] = 4; await catalog.saveClanBossProgress(p);
    const results = await Promise.all([1, 2].map(i => call(start, f.host, { hostName: f.host, requestId: `concurrent-${f.id}-${i}` })));
    assert.equal(results.filter(r => r.status === 200).length, 1, JSON.stringify(results));
    assert.equal((await catalog.loadClanBossProgress(f.weekId, f.clanName))!.memberAttempts[f.host], 5);
});
test('publication failure preserves paid roster; rollover and party flag changes retry the original run', async () => {
    const f = await setup(3, 2), original = kv.set.bind(kv);
    const failure = mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (args[0].startsWith('tower:cboss-')) throw new Error('Injected session publication failure');
        return original(...args);
    });
    let failed;
    try { failed = await call(start, f.host, f.request); } finally { failure.mock.restore(); }
    assert.equal(failed!.status, 500);
    const paid = (await catalog.loadClanBossProgress(f.weekId, f.clanName))!;
    assert.deepEqual(paid.memberAttempts, Object.fromEntries(f.slugs.map(s => [s, 1])));
    assert.equal((await parties.loadParty(f.party.id))!.status, 'starting');
    for (const action of ['disband', 'transfer', 'leave', 'cancel-queue']) {
        const result = await call(partyRoute, f.host, { playerName: f.host, partyId: f.party.id,
            action, target: f.slugs[1], requestId: `locked-${f.id}-${action}`, expectedVersion: (await parties.loadParty(f.party.id))!.version });
        assert.equal(result.status, 409, JSON.stringify(result));
    }
    await kv.set(catalog.clanBossWeekKey(f.weekId), { ...f.week, endsAt: 1 });
    process.env.DISABLE_CLAN_BOSS_PARTIES = '1';
    try {
        const replay = await call(start, f.host, f.request);
        assert.equal(replay.status, 200, JSON.stringify(replay.body));
        assert.equal(replay.body.runId, paid.startRequests![0]!.runId);
        const restored = (await catalog.loadClanBossProgress(f.weekId, f.clanName))!;
        assert.deepEqual(restored.memberAttempts, paid.memberAttempts);
        assert.equal(restored.pool, paid.pool);
        assert.equal(restored.startRequests![0]!.runId, paid.startRequests![0]!.runId);
        assert.ok(restored.startRequests![0]!.publishedAt);
    } finally { delete process.env.DISABLE_CLAN_BOSS_PARTIES; }
});
test('legacy new clan retains deployed pool, discounted enemies and host-only accounting', async () => {
    const f = await setup(2), result = await call(start, f.host, f.request);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const p = (await catalog.loadClanBossProgress(f.weekId, f.clanName))!;
    assert.equal(p.poolMax, 30000); assert.deepEqual(p.memberAttempts, { [f.host]: 1 });
    assert.equal(result.body.session.clanBossGuard, undefined);
    const boss = result.body.session.actors.find((a: any) => a.id === result.body.session.phaseState.bossId);
    assert.equal(boss.maxHp, 24000);
});

test('paid recovery crosses an actual ISO-week boundary without charging the new week', async t => {
    const beforeReset = Date.UTC(2026, 10, 1, 23, 59);
    t.mock.timers.enable({ apis: ['Date'], now: beforeReset });
    const f = await setup(3, 2), first = await call(start, f.host, f.request);
    assert.equal(first.status, 200);
    const before = (await catalog.loadClanBossProgress(f.weekId, f.clanName))!;
    t.mock.timers.setTime(beforeReset + 120000);
    const nextWeek = catalog.clanBossWeekId(Date.now()); assert.notEqual(nextWeek, f.weekId);
    await kv.set(catalog.clanBossWeekKey(nextWeek), { ...f.week, weekId: nextWeek, spawnedAt: Date.now(), endsAt: Date.now() + 604800000 });
    const replay = await call(start, f.host, f.request);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.runId, first.body.runId);
    assert.deepEqual(await catalog.loadClanBossProgress(f.weekId, f.clanName), before);
    assert.equal(await catalog.loadClanBossProgress(nextWeek, f.clanName), null);
});

test('lost/recovered marker accepts the same paid run; missing published session cannot be recreated', async () => {
    const f = await setup(1, 2), first = await call(start, f.host, f.request);
    assert.equal(first.status, 200);
    const leases = await import('../towers/_battle-lease.js');
    await kv.del(leases.clanBossBattleMarkerKey(f.host));
    await leases.refreshClanBossBattleMarkers(first.body.runId, [f.host]);
    assert.equal((await call(start, f.host, f.request)).status, 200);
    const before = await catalog.loadClanBossProgress(f.weekId, f.clanName);
    await kv.del(store.sessionKey(first.body.runId));
    const expired = await call(start, f.host, f.request);
    assert.equal(expired.status, 410);
    assert.equal(await store.readSession(first.body.runId), null);
    assert.deepEqual(await catalog.loadClanBossProgress(f.weekId, f.clanName), before);
});

for (const point of ['before-charge', 'charge-response', 'publication-receipt', 'assault-record', 'invite', 'activation']) {
    test(`failure at ${point} retries one reservation without double charging`, async () => {
        const f = await setup(3, 2), original = kv.set.bind(kv);
        let injected = false;
        const failure = mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            const [key, raw] = args, value = raw as Record<string, any>;
            const progress = key === catalog.clanBossProgressKey(f.weekId, f.clanName);
            const matches = point === 'before-charge' || point === 'charge-response' ? progress && !value.startRequests?.[0]?.publishedAt
                : point === 'publication-receipt' ? progress && !!value.startRequests?.[0]?.publishedAt
                : point === 'assault-record' ? key.startsWith('clan-boss:assault:')
                : point === 'invite' ? key === `tower-invite:${f.host}`
                : key === parties.partyKey(f.party.id) && value.status === 'active';
            if (matches && !injected) {
                injected = true;
                if (point === 'charge-response') await original(...args);
                throw new Error(`Injected ${point} failure`);
            }
            return original(...args);
        });
        let interrupted;
        try { interrupted = await call(start, f.host, f.request); } finally { failure.mock.restore(); }
        assert.ok(injected); assert.equal(interrupted!.status, 500);
        const reserved = await catalog.loadClanBossProgress(f.weekId, f.clanName);
        if (point === 'before-charge') assert.equal(reserved, null);
        else assert.deepEqual(reserved!.memberAttempts, Object.fromEntries(f.slugs.map(s => [s, 1])));
        const party = (await parties.loadParty(f.party.id))!;
        // A precharge failure reopens readiness; paid failures freeze the original roster.
        if (point === 'before-charge') {
            assert.equal(party.status, 'forming'); f.request.expectedVersion = party.version;
        } else assert.equal(party.status, 'starting');
        const retry = await call(start, f.host, f.request);
        assert.equal(retry.status, 200, JSON.stringify(retry.body));
        const after = (await catalog.loadClanBossProgress(f.weekId, f.clanName))!;
        assert.deepEqual(after.memberAttempts, Object.fromEntries(f.slugs.map(s => [s, 1])));
        if (reserved) assert.equal(retry.body.runId, reserved.startRequests![0]!.runId);
        assert.equal((await parties.loadParty(f.party.id))!.status, 'active');
    });
}

test('missing-version progress remains host-only even under a version-two weekly record', async () => {
    const f = await setup(2, 2), legacyWeek = { ...f.week, rulesVersion: undefined };
    const p = catalog.newClanBossProgress(f.clanName, legacyWeek, 2);
    p.memberAttempts[f.slugs[1]!] = 5; await catalog.saveClanBossProgress(p);
    const ready = await call(partyRoute, f.slugs[1]!, { playerName: f.slugs[1], action: 'ready', partyId: f.party.id,
        expectedVersion: f.party.version, requestId: `legacy-ready-${f.id}` });
    assert.equal(ready.status, 200, JSON.stringify(ready.body));
    const current = (await parties.loadParty(f.party.id))!; f.request.expectedVersion = current.version;
    const launched = await call(start, f.host, f.request);
    assert.equal(launched.status, 200, JSON.stringify(launched.body));
    assert.deepEqual((await catalog.loadClanBossProgress(f.weekId, f.clanName))!.memberAttempts, { [f.host]: 1, [f.slugs[1]!]: 5 });
    assert.equal(launched.body.session.clanBossGuard, undefined);
});

test('a duplicate timing out behind a committed reservation cannot reopen its paid party', async () => {
    const f = await setup(1, 2);
    const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
    const reachedLocator = deferred(), allowLocator = deferred(), allowSaveReturn = deferred();
    const original = kv.set.bind(kv), progressKey = catalog.clanBossProgressKey(f.weekId, f.clanName);
    const locatorKey = `clan-boss:start:${f.host}:${f.request.requestId}`;
    let paused = false;
    const hook = mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        const [key, , options] = args;
        if (key === locatorKey && !paused) { paused = true; reachedLocator.resolve(); await allowLocator.promise; }
        if (key === `lock:${progressKey}` && paused && options?.nx) allowLocator.resolve();
        const result = await original(...args);
        if (key === progressKey) await allowSaveReturn.promise;
        return result;
    });
    let first: ReturnType<typeof call> | undefined;
    try {
        first = call(start, f.host, f.request); await reachedLocator.promise;
        const duplicate = await call(start, f.host, f.request);
        assert.equal(duplicate.status, 500);
        assert.equal((await parties.loadParty(f.party.id))!.status, 'starting');
        assert.deepEqual((await catalog.loadClanBossProgress(f.weekId, f.clanName))!.memberAttempts, { [f.host]: 1 });
        allowSaveReturn.resolve();
        const launched = await first; assert.equal(launched.status, 200);
        assert.equal((await parties.loadParty(f.party.id))!.status, 'active');
        const replay = await call(start, f.host, f.request);
        assert.equal(replay.status, 200); assert.equal(replay.body.runId, launched.body.runId);
        assert.deepEqual((await catalog.loadClanBossProgress(f.weekId, f.clanName))!.memberAttempts, { [f.host]: 1 });
    } finally {
        allowLocator.resolve(); allowSaveReturn.resolve();
        if (first) await first;
        hook.mock.restore();
    }
});

test('forming-party cancellation spends zero; stale ready/queue and exhausted joins fail early', async () => {
    const f = await setup(2, 2), p = catalog.newClanBossProgress(f.clanName, f.week, 2);
    p.memberAttempts[f.slugs[1]!] = 5; await catalog.saveClanBossProgress(p);
    for (const [action, actor] of [['ready', f.slugs[1]!], ['queue', f.host]] as const) {
        const party = (await parties.loadParty(f.party.id))!;
        const result = await call(partyRoute, actor, { playerName: actor, action, partyId: party.id,
            requestId: `eligibility-${f.id}-${action}`, expectedVersion: party.version });
        assert.equal(result.status, 409); assert.equal(result.body.errorCode, 'attempts-exhausted');
    }
    const party = (await parties.loadParty(f.party.id))!;
    const cancelled = await call(partyRoute, f.host, { playerName: f.host, action: 'disband', partyId: party.id,
        requestId: `cancel-${f.id}`, expectedVersion: party.version });
    assert.equal(cancelled.status, 200);
    assert.deepEqual(await catalog.loadClanBossProgress(f.weekId, f.clanName), p);
    const create = await call(partyRoute, f.slugs[1]!, { playerName: f.slugs[1], action: 'create', requestId: `create-exhausted-${f.id}` });
    assert.equal(create.status, 409); assert.equal(create.body.errorCode, 'attempts-exhausted');
    const fresh = await call(partyRoute, f.host, { playerName: f.host, action: 'create', visibility: 'public', requestId: `fresh-party-${f.id}` });
    assert.equal(fresh.status, 200);
    const join = await call(partyRoute, f.slugs[1]!, { playerName: f.slugs[1], action: 'join', partyId: fresh.body.party.id,
        expectedVersion: fresh.body.party.version, requestId: `join-exhausted-${f.id}` });
    assert.equal(join.status, 409); assert.equal(join.body.errorCode, 'attempts-exhausted');
    assert.deepEqual(await catalog.loadClanBossProgress(f.weekId, f.clanName), p);
});

for (const missing of ['input', 'session-after-publication-receipt-failure']) test(`${missing} expires safely without reclaiming members or resetting a paid battle`, async t => {
    const f = await setup(1, 2), original = kv.set.bind(kv);
    const hook = mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        const [key, value] = args;
        if (missing === 'input' ? key.startsWith('tower:cboss-')
            : key === catalog.clanBossProgressKey(f.weekId, f.clanName) && !!(value as Record<string, any>).startRequests?.[0]?.publishedAt) {
            throw new Error(`Injected ${missing} publication gap`);
        }
        return original(...args);
    });
    let failed;
    try { failed = await call(start, f.host, f.request); } finally { hook.mock.restore(); }
    assert.equal(failed!.status, 500);
    const paid = (await catalog.loadClanBossProgress(f.weekId, f.clanName))!, receipt = paid.startRequests![0]!;
    assert.equal(receipt.publishedAt, undefined);
    const leases = await import('../towers/_battle-lease.js');
    if (missing === 'input') { await kv.del(receipt.inputKey!); await kv.del(leases.clanBossBattleMarkerKey(f.host)); }
    else {
        assert.ok(await store.readSession(receipt.runId));
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 25 * 3600000 });
        assert.equal(await store.readSession(receipt.runId), null, 'real retention expiry, not immediate deletion');
        assert.ok(await kv.get(receipt.inputKey!), 'the old immutable inputs still exist');
    }
    assert.equal(await kv.get(leases.clanBossBattleMarkerKey(f.host)), null);
    const replay = await call(start, f.host, f.request);
    assert.equal(replay.status, 410, JSON.stringify(replay.body));
    assert.equal(await store.readSession(receipt.runId), null);
    assert.equal(await kv.get(leases.clanBossBattleMarkerKey(f.host)), null);
    assert.deepEqual(await catalog.loadClanBossProgress(f.weekId, f.clanName), paid);
});

for (const state of ['published', 'unpublished', 'reopened']) test(`pre-rollout receipt without locator recovers across reset (${state})`, async t => {
    const beforeReset = Date.UTC(2026, 9, 25, 23, 59);
    t.mock.timers.enable({ apis: ['Date'], now: beforeReset });
    const f = await setup(1), first = await call(start, f.host, f.request);
    assert.equal(first.status, 200);
    const p = (await catalog.loadClanBossProgress(f.weekId, f.clanName))!;
    const receipt = p.startRequests![0]!;
    delete receipt.inputKey; delete receipt.publishedAt; delete receipt.requestFingerprint; delete receipt.partyId;
    await catalog.saveClanBossProgress(p);
    await kv.del(`clan-boss:start:${f.host}:${f.request.requestId}`);
    if (state !== 'published') {
        await kv.del(store.sessionKey(first.body.runId));
        await kv.del(`clan-boss:assault:${first.body.runId}`);
        const party = (await parties.loadParty(f.party.id))!;
        await parties.saveParty({ ...party, status: 'starting', runId: undefined, version: f.request.expectedVersion + 1 });
        if (state === 'reopened') await parties.reopenPartyStart(f.party.id, f.request.requestId);
    }
    t.mock.timers.setTime(beforeReset + 120000);
    process.env.DISABLE_CLAN_BOSS_PARTIES = '1';
    try {
        const retry = await call(start, f.host, f.request);
        assert.equal(retry.status, 200, JSON.stringify(retry.body));
        assert.equal(retry.body.runId, first.body.runId); assert.equal(retry.body.session.clanBossGuard, undefined);
        assert.equal(retry.body.session.actors.find((a: any) => a.id === retry.body.session.phaseState.bossId).maxHp, 22000);
        assert.deepEqual((await catalog.loadClanBossProgress(f.weekId, f.clanName))!.memberAttempts, { [f.host]: 1 });
        assert.equal(await catalog.loadClanBossProgress(catalog.clanBossWeekId(Date.now()), f.clanName), null);
        assert.equal((await parties.loadParty(f.party.id))!.status, 'active');
        const { loadAssault } = await import('./_assault.js');
        assert.equal((await loadAssault(first.body.runId))!.partyId, f.party.id);
    } finally { delete process.env.DISABLE_CLAN_BOSS_PARTIES; }
});

for (const changed of ['created-later', 'version', 'member-index']) test(`legacy party recovery refuses an unrelated or changed party (${changed})`, async () => {
    const f = await setup(2), reservedAt = Date.now();
    const party = { ...f.party, version: f.request.expectedVersion + 2, updatedAt: reservedAt };
    if (changed === 'created-later') party.createdAt = reservedAt + 1;
    if (changed === 'version') party.version++;
    if (changed === 'member-index') await kv.set(parties.partyPlayerKey(f.slugs[1]!), 'another-party');
    await parties.saveParty(party);
    const result = await parties.recoverLegacyPartyStart({ partyId: party.id, requestId: f.request.requestId,
        host: f.host, clanName: f.clanName, weekId: f.weekId, bossId: f.week.bossId,
        members: f.slugs, reservedAt, expectedVersion: f.request.expectedVersion });
    assert.equal(result, null);
    assert.deepEqual(await parties.loadParty(party.id), party);
});

test('an expired legacy retry never locks its reopened forming party', async t => {
    const f = await setup(1), first = await call(start, f.host, f.request);
    assert.equal(first.status, 200);
    const paid = (await catalog.loadClanBossProgress(f.weekId, f.clanName))!, receipt = paid.startRequests![0]!;
    delete receipt.inputKey; delete receipt.publishedAt; delete receipt.requestFingerprint; delete receipt.partyId;
    await catalog.saveClanBossProgress(paid);
    await kv.del(`clan-boss:start:${f.host}:${f.request.requestId}`);
    await kv.del(store.sessionKey(first.body.runId));
    await kv.del(`clan-boss:assault:${first.body.runId}`);
    await parties.saveParty({ ...(await parties.loadParty(f.party.id))!, status: 'starting', runId: undefined,
        version: f.request.expectedVersion + 1 });
    await parties.reopenPartyStart(f.party.id, f.request.requestId);
    const reopened = (await parties.loadParty(f.party.id))!;
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 25 * 3600000 });
    // Refreshed party presence can outlive the paid battle's retention.
    await parties.saveParty(reopened); await parties.indexPartyMembers(reopened);
    const replay = await call(start, f.host, f.request);
    assert.equal(replay.status, 410, JSON.stringify(replay.body));
    assert.deepEqual(await parties.loadParty(f.party.id), reopened);
    assert.deepEqual(await catalog.loadClanBossProgress(f.weekId, f.clanName), paid);
});
