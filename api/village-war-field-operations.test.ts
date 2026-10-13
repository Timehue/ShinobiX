import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, it, mock } from 'node:test';
process.env.NODE_ENV = 'test'; process.env.SHINOBIX_QA_MEMORY_KV = '1'; process.env.SESSION_SECRET = 'field-orders-test';
const A = 'Ashen Leaf Village', B = 'Moonshadow Village', id = 'ashenleafvillage-vs-moonshadowvillage';
let kv: typeof import('./_storage.js').kv, presence: typeof import('./_realtime/online-store.js').onlineStore;
let endpoint: typeof import('./village/war-campaign.js').default;
let api: typeof import('./_village-war-field-operations.js');
let issue: typeof import('./_auth.js').issuePlayerToken;
let now = Date.now();
before(async () => {
    ({ kv } = await import('./_storage.js')); ({ onlineStore: presence } = await import('./_realtime/online-store.js'));
    endpoint = (await import('./village/war-campaign.js')).default as unknown as typeof endpoint; api = await import('./_village-war-field-operations.js');
    ({ issuePlayerToken: issue } = await import('./_auth.js'));
});
beforeEach(async () => {
    const keys = await kv.keys('*'); if (keys.length) await kv.del(...keys);
    presence.remove('alice'); presence.remove('bob');
    (await import('./_stronghold-presence.js')).leaveStrongholdPresence('alice');
    (await import('./_stronghold-presence.js')).leaveStrongholdPresence('bob');
    (await import('./_ratelimit.js')).__resetRateLimitsForTest();
    now = Date.now(); mock.method(Date, 'now', () => now);
    const { createVillageCampaign } = await import('./_village-war-campaign.js');
    await kv.set(`world:war:${id}`, { id, villages: [A, B], startedAt: now - 1000, updatedAt: now, declarationGeneration: 1,
        hp: { [A]: 5000, [B]: 5000 }, warGroundSector: 47, warGroundHp: 1000,
        campaign: createVillageCampaign([A, B], now - 1000, 47), contributions: {} });
    for (const [village, sectors] of [[A, [9, 10, 11, 12, 13, 14, 15, 16]], [B, [17, 18, 19, 20, 21, 22, 23, 24]]] as const)
        for (const sector of sectors) await kv.set(`world:territory:${sector}`, { ownerVillage: village });
    for (const [name, village] of [['alice', A], ['bob', B]]) await kv.set(`save:${name}`, { character: { name, village, level: 100,
        hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, stats: {} } });
});
afterEach(() => { mock.restoreAll(); });
async function call(action: string, extra: Record<string, unknown> = {}, player = 'alice', handler = endpoint) {
    let status = 200; let data: any;
    await handler({ method: 'POST', body: { warId: id, name: player, action, ...extra }, headers: { 'x-player-token': issue(player), 'x-forwarded-for': '10.81.1.1' }, query: {} } as never,
        { setHeader() {}, status(n: number) { status = n; return this; }, json(value: unknown) { data = value; return this; }, end() {} } as never);
    return { status, data };
}
function arrive(sector: number, player = 'alice') {
    presence.remove(player); presence.upsert({ name: player, sector, character: { village: player === 'alice' ? A : B, level: 100 } });
}
async function waitStill(seconds: number) {
    let response = await call('operation-progress');
    for (let s = 0; s < seconds; s += 5) { now += 5000; response = await call('operation-progress'); assert.equal(response.status, 200, JSON.stringify(response.data)); }
    return response;
}
it('sabotage needs three distinct currently enemy-held outdoor sectors and real uninterrupted server time', async () => {
    const start = await call('operation-start', { operation: 'sabotage' }); assert.equal(start.status, 200);
    arrive(17); const one = await waitStill(20); assert.deepEqual(one.data.mission.completedSectors, [17]);
    await waitStill(20); assert.deepEqual((await call('view')).data.mission.completedSectors, [17]);
    arrive(18); assert.equal((await waitStill(20)).data.mission.status, 'active');
    arrive(19); const done = await waitStill(20); assert.equal(done.data.mission.status, 'complete');
    await call('operation-progress');
    const war = await kv.get<any>(`world:war:${id}`); assert.equal(war.campaign.pve[A], 20); assert.equal(war.campaign.intel[A], 1);
    assert.equal(war.campaign.usage[`${A}:0`].total, 1); assert.deepEqual(war.campaign.pvp, {});
});
it('movement, short round trips, interior entry and lost leases reset a sabotage hold', async () => {
    await call('operation-start', { operation: 'sabotage' }); arrive(17); await waitStill(10);
    const { serverWalkableTile } = await import('./_sector-obstacles.js');
    const tile = Array.from({ length: 144 }, (_, n) => n).find(n => n !== presence.get('alice')?.tile && serverWalkableTile(17, n))!;
    assert.ok(presence.moveToTile('alice', tile)); now += 5000; assert.equal((await call('operation-progress')).data.mission.holdSeconds, 0);
    await waitStill(10); presence.startTravel('alice', 18, now + 3000, 17); now += 3000;
    presence.get('alice'); presence.startTravel('alice', 17, now + 3000, 18); now += 3000; presence.get('alice');
    assert.equal((await call('operation-progress')).data.mission.holdSeconds, 0);
    await waitStill(10); const interior = await import('./_stronghold-presence.js'); interior.touchStrongholdPresence('alice', 17, 0); interior.leaveStrongholdPresence('alice');
    assert.equal((await call('operation-progress')).data.mission.holdSeconds, 0);
    now += 11_000; assert.equal((await call('operation-progress')).data.mission.holdSeconds, 0);
    assert.deepEqual((await call('view')).data.mission.completedSectors, []);
});
it('ownership flips invalidate holds, while completed sites survive a reconnect', async () => {
    await call('operation-start', { operation: 'sabotage' }); arrive(17); await waitStill(20); arrive(18); await waitStill(10);
    await kv.set('world:territory:18', { ownerVillage: A }); assert.equal((await call('operation-progress')).data.mission.holdSeconds, 0);
    await kv.set('world:territory:18', { ownerVillage: B }); arrive(18); const response = await waitStill(10);
    assert.deepEqual(response.data.mission.completedSectors, [17]); assert.equal(response.data.mission.holdSeconds, 10);
});
it('supply cannot skip its home pickup or handoff, awards once, and reserves only one capped attempt', async () => {
    const mission = (await call('operation-start', { operation: 'supply' })).data.mission;
    arrive(mission.sectors[0]); assert.equal((await waitStill(20)).data.mission.pickedUp, false);
    arrive(9); assert.equal((await waitStill(10)).data.mission.pickedUp, true);
    arrive(mission.sectors[0]); assert.equal((await waitStill(15)).data.mission.status, 'active'); now += 5000;
    assert.equal((await call('operation-progress')).data.mission.status, 'complete'); await call('operation-progress');
    const row = await kv.get<any>(`world:war:${id}`); assert.equal(row.campaign.pve[A], 10); assert.equal(row.campaign.intel[A], 1);
    assert.equal(row.campaign.usage[`${A}:0`].categories.supply, 1);
});
it('accept retries resume the same order; personal category caps, abandonment and campaign deadlines are authoritative', async () => {
    const first = await call('operation-start', { operation: 'supply' });
    const retry = await call('operation-start', { operation: 'espionage' }); assert.equal(retry.data.mission.id, first.data.mission.id);
    assert.equal((await call('view')).data.campaign.operationAllowance.total, 1);
    await call('operation-abandon'); assert.equal((await call('operation-start', { operation: 'supply' })).status, 409);
    const second = await call('operation-start', { operation: 'sabotage' }); assert.notEqual(second.data.mission.id, first.data.mission.id);
    await call('operation-abandon'); assert.equal((await call('operation-start', { operation: 'supply' })).status, 409);
    const template = await kv.get<any>('save:alice');
    for (const player of ['bob', 'carol']) await kv.set(`save:${player}`, { ...template, character: { ...template.character, name: player } });
    assert.equal((await call('operation-start', { operation: 'supply' }, 'bob')).status, 200);
    await call('operation-abandon', {}, 'bob');
    assert.equal((await call('operation-start', { operation: 'supply' }, 'carol')).status, 200, 'other villagers cannot exhaust Carol\'s personal allowance');
    await call('operation-abandon', {}, 'carol');
    assert.equal((await call('operation-start', { operation: 'supply' }, 'carol')).status, 409, 'abandonment still consumes the personal attempt');
    now += 86_400_000;
    assert.equal((await call('operation-start', { operation: 'supply' }, 'carol')).status, 200, 'Supply resets on the next campaign day');
    const war = await kv.get<any>(`world:war:${id}`); now = war.campaign.endsAt;
    assert.equal((await call('operation-start', { operation: 'sabotage' })).status, 409);
});
it('espionage fights require a sealed order and actual entry, preserve specialty targets, and resume their real AI battle', async () => {
    assert.equal((await call('start', { operation: 'espionage' })).status, 409);
    const m = (await call('operation-start', { operation: 'espionage' })).data.mission;
    const row = await kv.get<any>(`world:war:${id}`); assert.ok(!row.campaign.strongholds.some((o: any) => o.sector === m.sectors[0]));
    assert.equal((await call('start', { fieldMissionId: m.id })).status, 409);
    arrive(m.sectors[0]); assert.equal((await call('start', { fieldMissionId: m.id })).status, 409);
    assert.equal((await call('operation-enter')).status, 200);
    const first = await call('start', { fieldMissionId: m.id }); assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.session.runtime, 'solo-pve'); assert.equal(first.data.session.encounter.kind, 'village-war-operation');
    assert.equal((await call('start', { fieldMissionId: m.id })).data.runId, first.data.runId);
    assert.equal((await call('view')).data.campaign.operationAllowance.total, 1);
    assert.equal((await call('operation-abandon')).status, 409);
});
it('enemy-player espionage seals both players inside before combat and cannot score remote, late, stale or replayed proof', async () => {
    const m = (await call('operation-start', { operation: 'espionage' })).data.mission; arrive(m.sectors[0]); arrive(m.sectors[0], 'bob');
    await call('operation-enter'); assert.equal(await api.sealEspionageBattleEvidence('alice', B, 'bob'), null);
    (await import('./_stronghold-presence.js')).touchStrongholdPresence('bob', m.sectors[0], 0);
    const proof = await api.sealEspionageBattleEvidence('alice', B, 'bob'); assert.ok(proof);
    const row = await kv.get<any>(`world:war:${id}`);
    assert.deepEqual(api.applyEspionageBattleEvidence(structuredClone(row), { ...proof, generation: 2 }, 'alice', now, now + 1).campaign.intel, {});
    assert.deepEqual(api.applyEspionageBattleEvidence(structuredClone(row), proof, 'bob', now, now + 1).campaign.intel, {});
    const finished = api.applyEspionageBattleEvidence(row, proof, 'alice', now, now + 1);
    api.applyEspionageBattleEvidence(finished, proof, 'alice', now, now + 2);
    assert.equal(finished.campaign.pve[A], 20); assert.equal(finished.campaign.intel[A], 2);
    assert.equal(finished.campaign.admissions[m.id].field.status, 'complete');
});
it('a real sentry battle abandonment fails espionage automatically, settles vitals, and permits leaving without another attempt', async () => {
    const m = (await call('operation-start', { operation: 'espionage' })).data.mission;
    arrive(m.sectors[0]); await call('operation-enter'); const start = await call('start', { fieldMissionId: m.id });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    const { executeSoloPveAction } = await import('./solo-pve/_action-service.js');
    const result = await executeSoloPveAction({ sessionId: start.data.runId, ownerSlug: 'alice', expectedVersion: start.data.session.version,
        moveToken: 'field-order-abandon-001', action: { type: 'abandon' } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    await (await import('./solo-pve/_garrison-terminal-hook.js')).settleTerminalGarrisonFight(result.body.session);
    const war = await kv.get<any>(`world:war:${id}`);
    assert.equal(war.campaign.admissions[m.id].field.status, 'failed'); assert.deepEqual(war.campaign.intel, {});
    assert.equal(war.campaign.usage[`${A}:0`].total, 1);
    assert.equal((await call('operation-leave')).status, 200);
    assert.equal((await import('./_stronghold-presence.js')).strongholdLocation('alice', m.sectors[0]), undefined);
});
it('a stored sentry victory completes its bound order and pays support/intel once across terminal and report retries', async () => {
    const m = (await call('operation-start', { operation: 'espionage' })).data.mission;
    arrive(m.sectors[0]); await call('operation-enter'); const start = await call('start', { fieldMissionId: m.id });
    const store = await import('./solo-pve/_store.js'); const session = (await store.readSoloPveSession(start.data.runId))!;
    const { finalizeAbandonedSession } = await import('./solo-pve/_abandon.js');
    // A server-stored terminal fixture uses the runtime's evidence builder. The
    // report sends no outcome and cannot change this sealed result.
    const terminal = finalizeAbandonedSession(session, { ...session, status: 'done', winner: 'player', outcome: 'win' }, 'field-sentry-win-001', now);
    await store.writeSoloPveSession(terminal);
    const settle = (await import('./village/war-campaign.js')).settleTerminalCampaignSession;
    await settle(terminal); await settle(terminal);
    const report = await call('resolve', { runId: start.data.runId, winner: 'enemy', points: 10000 }); assert.equal(report.status, 200, JSON.stringify(report.data));
    const war = await kv.get<any>(`world:war:${id}`); assert.equal(war.campaign.admissions[m.id].field.status, 'complete');
    assert.equal(war.campaign.pve[A], 20); assert.equal(war.campaign.intel[A], 2);
    assert.equal(war.campaign.usage[`${A}:0`].total, 1); assert.equal(report.data.warResult.points, 20);
});
it('real world combat creation seals espionage and the real village-war continuation pays world and mission credit atomically once', async () => {
    for (const name of ['alice', 'bob']) { const save = await kv.get<any>(`save:${name}`); save.character.level = 15; await kv.set(`save:${name}`, save); }
    const m = (await call('operation-start', { operation: 'espionage' })).data.mission;
    arrive(m.sectors[0]); arrive(m.sectors[0], 'bob'); await call('operation-enter');
    const defender = await call('guard-enter', { sector: m.sectors[0], visitId: 'espionage-defender-tab' }, 'bob');
    assert.equal(defender.status, 200, JSON.stringify(defender.data));
    const pvp = (await import('./pvp/session.js')).default as unknown as typeof endpoint;
    const created = await call('create', { battleId: 'pvp-field-espionage', mode: 'standard', p1Character: { name: 'alice' }, p2Character: { name: 'bob' },
        useCurrentVitals: true, requireWorldCoLocation: true, baseRewards: true, rewardSector: m.sectors[0] }, 'alice', pvp);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const session = await kv.get<any>(`pvp:${created.data.battleId}`); assert.equal(session.rewardAuthority, 'world');
    assert.equal(session.villageWarEspionage[0].missionId, m.id);
    await kv.set(`pvp:${session.battleId}`, { ...session, status: 'done', winner: 'p1', endedAt: now + 1, joined: { p1: true, p2: true } });
    const { settlePvpVillageWarContinuation } = await import('./world-state.js');
    const result = await settlePvpVillageWarContinuation(session.battleId, 'alice'); assert.equal(result.status, 200, JSON.stringify(result.body));
    await settlePvpVillageWarContinuation(session.battleId, 'alice');
    const war = await kv.get<any>(`world:war:${id}`); assert.equal(war.campaign.pvp[A], 20); assert.equal(war.campaign.pve[A], 20);
    assert.equal(war.campaign.intel[A], 2); assert.equal(war.campaign.admissions[m.id].field.status, 'complete');
    assert.equal(war.campaign.usage[`${A}:0`].total, 1);
});
it('stale order commands cannot abandon a newer mission or act on another player’s admission', async () => {
    const first = (await call('operation-start', { operation: 'supply' })).data.mission;
    await call('operation-abandon', { missionId: first.id });
    const current = (await call('operation-start', { operation: 'sabotage' })).data.mission;
    const stale = await call('operation-abandon', { missionId: first.id }); assert.equal(stale.data.mission.id, first.id);
    assert.equal(stale.data.mission.status, 'abandoned');
    const view = await call('view'); assert.equal(view.data.mission.id, current.id); assert.equal(view.data.mission.status, 'active');
    assert.equal(view.data.campaign.operationAllowance.total, 2);
    assert.equal((await call('operation-abandon', { missionId: current.id }, 'bob')).status, 409);
    assert.equal((await call('view')).data.mission.status, 'active');
});
it('level-15 guard duty admits only current owners at ordinary active-war posts and grants no PvE admission or loot access', async () => {
    const m = (await call('operation-start', { operation: 'espionage' })).data.mission;
    const save = await kv.get<any>('save:bob'); save.character.level = 14; await kv.set('save:bob', save);
    arrive(m.sectors[0], 'bob'); const extra = { sector: m.sectors[0], visitId: 'guard-boundary-001' };
    assert.equal((await call('guard-enter', extra, 'bob')).status, 409);
    save.character.level = 15; await kv.set('save:bob', save);
    const guard = await call('guard-enter', extra, 'bob'); assert.equal(guard.status, 200, JSON.stringify(guard.data)); assert.equal(guard.data.guard.inside, true);
    const row = await kv.get<any>(`world:war:${id}`); assert.equal(row.campaign.usage[`${B}:0`], undefined); assert.equal(Object.keys(row.campaign.admissions).length, 1);
    const legacy = (await import('./village/anbu-infiltration.js')).default as unknown as typeof endpoint;
    assert.equal((await call('stronghold-enter', { playerName: 'bob', sector: m.sectors[0], presenceId: 'legacy-guard-denied' }, 'bob', legacy)).status, 403);
    const objective = row.campaign.strongholds.find((o: any) => o.village === B);
    arrive(objective.sector, 'bob'); assert.equal((await call('guard-enter', { ...extra, sector: objective.sector }, 'bob')).status, 409);
    arrive(m.sectors[0]); assert.equal((await call('guard-enter', extra)).status, 409, 'enemies cannot claim owner guard duty');
});
it('guard refresh cannot mint entry and a stale guard leave cannot eject a newer visit', async () => {
    const m = (await call('operation-start', { operation: 'espionage' })).data.mission; arrive(m.sectors[0], 'bob');
    const extra = { sector: m.sectors[0], visitId: 'guard-first-001' };
    assert.equal((await call('guard-state', extra, 'bob')).status, 409);
    await call('guard-enter', extra, 'bob'); const next = { ...extra, visitId: 'guard-second-002' }; await call('guard-enter', next, 'bob');
    assert.equal((await call('guard-state', extra, 'bob')).status, 409); await call('guard-leave', extra, 'bob');
    assert.equal((await call('guard-state', next, 'bob')).data.guard.inside, true);
    const save = await kv.get<any>('save:bob'); save.character.hp = 0; await kv.set('save:bob', save);
    assert.equal((await call('guard-leave', next, 'bob')).status, 200);
    assert.equal((await import('./_stronghold-presence.js')).strongholdLocation('bob', m.sectors[0]), undefined);
});
it('guard duty cannot be admitted before preparation ends or after the campaign deadline', async () => {
    const m = (await call('operation-start', { operation: 'espionage' })).data.mission; arrive(m.sectors[0], 'bob');
    const war = await kv.get<any>(`world:war:${id}`), extra = { sector: m.sectors[0], visitId: 'guard-timing-001' };
    const start = war.campaign.startsAt; war.campaign.startsAt = now + 1000; await kv.set(`world:war:${id}`, war);
    assert.equal((await call('guard-enter', extra, 'bob')).status, 409);
    war.campaign.startsAt = start; await kv.set(`world:war:${id}`, war); now = war.campaign.endsAt;
    assert.equal((await call('guard-enter', extra, 'bob')).status, 409);
});
it('espionage never assigns a village gate with no stronghold and does not charge an impossible order', async () => {
    const row = await kv.get<any>(`world:war:${id}`);
    const nominated = row.campaign.strongholds.filter((o: any) => o.village === B).map((o: any) => o.sector);
    for (const sector of [18, 19, 20, 21, 22, 23, 24]) if (!nominated.includes(sector)) await kv.set(`world:territory:${sector}`, { ownerVillage: A });
    assert.equal((await call('operation-start', { operation: 'espionage' })).status, 409);
    assert.equal((await call('view')).data.campaign.operationAllowance.total, 0);
    arrive(17, 'bob'); assert.equal((await call('guard-enter', { sector: 17, visitId: 'no-gate-guard-001' }, 'bob')).status, 409);
});
it('war interior admission expires on exterior travel, movement or reconnect and survives only the admitted combat epoch', async () => {
    const m = (await call('operation-start', { operation: 'espionage' })).data.mission;
    const { strongholdLocation } = await import('./_stronghold-presence.js');
    arrive(m.sectors[0]); arrive(m.sectors[0], 'bob'); await call('operation-enter');
    await call('guard-enter', { sector: m.sectors[0], visitId: 'guard-physical-proof-001' }, 'bob');
    presence.startTravel('alice', m.sectors[0] + 1, now + 1000, m.sectors[0]); now += 1000; presence.get('alice');
    presence.startTravel('alice', m.sectors[0], now + 1000, m.sectors[0] + 1); now += 1000; presence.get('alice');
    assert.equal(strongholdLocation('alice', m.sectors[0]), undefined, 'a round trip cannot resurrect interior authority');
    assert.equal(await api.sealEspionageBattleEvidence('alice', B, 'bob'), null);
    arrive(m.sectors[0]); await call('operation-enter');
    const { serverWalkableTile } = await import('./_sector-obstacles.js');
    const tile = Array.from({ length: 144 }, (_, n) => n).find(n => n !== presence.get('alice')?.tile && serverWalkableTile(m.sectors[0], n))!;
    assert.ok(presence.moveToTile('alice', tile)); assert.equal(strongholdLocation('alice', m.sectors[0]), undefined);
    await call('operation-enter'); presence.setInBattle('alice', true);
    assert.ok(strongholdLocation('alice', m.sectors[0]), 'starting the sealed fight keeps interior membership');
    presence.setInBattle('alice', false); assert.equal(strongholdLocation('alice', m.sectors[0]), undefined, 'the old exterior view cannot inherit completed-combat membership');
    arrive(m.sectors[0], 'bob'); assert.equal(strongholdLocation('bob', m.sectors[0]), undefined, 'reconnecting needs a fresh guard entry');
});
