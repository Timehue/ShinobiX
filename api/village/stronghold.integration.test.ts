import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { STRONGHOLD_SPAWN, type StrongholdVisit } from '../../shared/sector-stronghold.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'stronghold-integration-secret-32chars';
let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let action: typeof import('./_stronghold.js').handleStrongholdAction;
let location: typeof import('../_stronghold-presence.js');
let gate: typeof import('../_realtime/presence-gating.js').worldInteractionBlock;
let solo: typeof import('../solo-pve/_store.js');
const sector = 12;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    const { handleStrongholdAction } = await import('./_stronghold.js');
    action = (name, operation, body) => handleStrongholdAction(name, operation, { presenceId: `test-tab-${name}`, ...body });
    location = await import('../_stronghold-presence.js');
    ({ worldInteractionBlock: gate } = await import('../_realtime/presence-gating.js'));
    solo = await import('../solo-pve/_store.js');
});

async function seed(name: string, level = 100, atSector = sector) {
    const character = { name, level, village: 'Frostfang Village', hp: 10000, maxHp: 10000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, stats: {}, equipment: {}, inventory: [], itemStacks: [], jutsu: [], jutsuMastery: [] };
    await kv.set(`save:${name}`, { _saveVersion: 1, character });
    onlineStore.upsert({ name, sector: atSector, character });
}
const visitOf = (result: Awaited<ReturnType<typeof action>>) => result.body.visit as StrongholdVisit;

test('Obsidian Stronghold admits level 100, opens the altar, and patrol victory adds no bonus rewards', async () => {
    const name = 'shobsidian', sector = 99;
    await seed('shobsidianlow', 99, sector);
    assert.equal((await action('shobsidianlow', 'stronghold-enter', { sector })).status, 403);
    await seed(name, 100, sector);
    const entered = await action(name, 'stronghold-enter', { sector });
    assert.equal(entered.status, 200, JSON.stringify(entered.body));
    let visit = visitOf(entered);
    const { strongholdVisitKey, strongholdVaultReady } = await import('./_stronghold.js');
    const { STRONGHOLD_VAULT } = await import('../../shared/sector-stronghold.js');
    visit = { ...visit, tile: STRONGHOLD_VAULT - 1, threat: 96, steps: 24 };
    await kv.set(strongholdVisitKey(name, sector), visit);
    const step = await action(name, 'stronghold-step', { sector, version: visit.version, tile: STRONGHOLD_VAULT });
    assert.equal(step.status, 200, JSON.stringify(step.body));
    visit = visitOf(step);
    assert.equal(visit.tile, STRONGHOLD_VAULT);
    assert.equal(visit.threat, 100);
    assert.equal(await strongholdVaultReady(name, sector), false);
    const patrol = (await solo.readSoloPveSession(visit.patrolId!))!;
    assert.equal(patrol.enemy.name, 'Cinder Sentry');
    assert.equal(patrol.environment.biome, 'volcano');
    const before = (await kv.get<{ character: Record<string, unknown> }>(`save:${name}`))!.character;
    patrol.status = 'done'; patrol.winner = 'player'; patrol.outcome = 'win';
    patrol.terminalEvidence = { finishedAt: Date.now(), finalMoveToken: 'obsidian-win', finalVersion: patrol.version,
        finalEventSeq: patrol.eventSeq, winner: 'player', outcome: 'win', itemsUsed: {}, settlementState: 'pending' };
    await solo.writeSoloPveSession(patrol);
    const report = await action(name, 'stronghold-patrol-report', { sector, runId: patrol.sessionId });
    assert.equal(report.status, 200, JSON.stringify(report.body));
    const after = report.body.character as Record<string, unknown>;
    assert.equal(Number(after.ryo ?? 0), Number(before.ryo ?? 0));
    assert.deepEqual(after.jutsuMastery, before.jutsuMastery);
    assert.equal(visitOf(report).threat, 0);
});

test('admission needs actual sector presence and level 100', async () => {
    assert.equal((await action('shmissing', 'stronghold-enter', { sector })).status, 409);
    await seed('shlow', 99);
    assert.equal((await action('shlow', 'stronghold-enter', { sector })).status, 403);
    await seed('shwrong');
    assert.equal((await action('shwrong', 'stronghold-enter', { sector: 21 })).status, 409);
});

test('the authenticated public route drives entry, movement and exit and rejects another identity', async () => {
    const { default: handler } = await import('./anbu-infiltration.js');
    const { issuePlayerToken } = await import('../_auth.js');
    const name = 'shhttproute'; await seed(name);
    async function post(operation: string, fields: Record<string, unknown> = {}) {
        const result: { status: number; body: Record<string, unknown> } = { status: 200, body: {} };
        const response = { setHeader() { return response; }, status(status: number) { result.status = status; return response; },
            json(body: Record<string, unknown>) { result.body = body; return response; }, end() { return response; } };
        await (handler as unknown as (req: never, res: never) => Promise<unknown>)({ method: 'POST', query: {}, body: { action: `stronghold-${operation}`, playerName: name, sector, presenceId: 'http-route-lease', ...fields },
            headers: { 'x-player-name': name, 'x-player-token': issuePlayerToken(name), 'x-forwarded-for': '10.43.0.1' }, socket: { remoteAddress: '10.43.0.1' } } as never, response as never);
        return result;
    }
    assert.equal((await post('enter', { playerName: 'somebodyelse' })).status, 403);
    const enter = await post('enter'); assert.equal(enter.status, 200, JSON.stringify(enter.body));
    const visit = enter.body.visit as StrongholdVisit;
    const moved = await post('step', { tile: visit.tile + 1, version: visit.version });
    assert.equal((moved.body.visit as StrongholdVisit).threat, 4);
    assert.equal((await post('leave')).status, 200);
    assert.equal((await post('state')).status, 409);
});

test('server rejects walls and stale steps; reload and leave retain exploration and threat', async () => {
    await seed('shwalker');
    let visit = visitOf(await action('shwalker', 'stronghold-enter', { sector }));
    assert.equal((await action('shwalker', 'stronghold-step', { sector, version: visit.version, tile: 0 })).status, 409);
    const step = { sector, version: visit.version, tile: visit.tile + 1 };
    visit = visitOf(await action('shwalker', 'stronghold-step', step));
    assert.equal(visit.threat, 4);
    assert.equal(visitOf(await action('shwalker', 'stronghold-step', step)).steps, 1);
    await action('shwalker', 'stronghold-leave', { sector });
    assert.equal(location.strongholdLocation('shwalker', sector), undefined);
    assert.deepEqual(visitOf(await action('shwalker', 'stronghold-enter', { sector })), visit);
});

test('only interior peers appear, and PvP co-location separates the stronghold from outside', async () => {
    await seed('shinside1'); await seed('shinside2'); await seed('shoutside');
    await action('shinside1', 'stronghold-enter', { sector });
    assert.match(gate(onlineStore.get('shinside1'), onlineStore.get('shoutside'))!.error, /inside the stronghold/);
    await action('shinside2', 'stronghold-enter', { sector });
    assert.equal(gate(onlineStore.get('shinside1'), onlineStore.get('shinside2')), null);
    const snapshot = await action('shinside1', 'stronghold-state', { sector });
    const peers = snapshot.body.peers as Array<{ name: string; stronghold?: { tile: number } }>;
    assert.ok(peers.some(p => p.name === 'shinside2' && p.stronghold?.tile === STRONGHOLD_SPAWN));
    assert.ok(!peers.some(p => p.name === 'shoutside'));
    const t = Date.now();
    location.touchStrongholdPresence('shexpired', sector, STRONGHOLD_SPAWN, t);
    assert.equal(location.strongholdLocation('shexpired', sector, t + location.STRONGHOLD_PRESENCE_TTL + 1), undefined);
});

test('queued polls and steps cannot re-enter after exit; another tab replaces the old exploration lease', async () => {
    const name = 'shlease'; await seed(name);
    const visit = visitOf(await action(name, 'stronghold-enter', { sector }));
    assert.equal((await action(name, 'stronghold-leave', { sector })).status, 200);
    assert.equal((await action(name, 'stronghold-state', { sector })).status, 409);
    assert.equal((await action(name, 'stronghold-step', { sector, tile: visit.tile + 1, version: visit.version })).status, 409);
    assert.equal(location.strongholdLocation(name, sector), undefined);
    await action(name, 'stronghold-enter', { sector, presenceId: 'new-tab-lease' });
    assert.equal((await action(name, 'stronghold-state', { sector })).status, 409);
    assert.equal((await action(name, 'stronghold-leave', { sector })).status, 409);
    assert.equal((await action(name, 'stronghold-state', { sector, presenceId: 'new-tab-lease' })).status, 200);
});

test('combat retains interior presence while the exploration screen is unmounted', async () => {
    const name = 'shcombatpresence'; await seed(name);
    const now = Date.now();
    location.touchStrongholdPresence(name, sector, STRONGHOLD_SPAWN, now - location.STRONGHOLD_PRESENCE_TTL - 1);
    onlineStore.setInBattle(name, true);
    assert.equal(location.strongholdLocation(name, sector, now)?.tile, STRONGHOLD_SPAWN);
    onlineStore.setInBattle(name, false);
    assert.equal(location.strongholdLocation(name, sector, now), undefined);
});

for (const outcome of ['loss', 'fled'] as const) test(`patrol ${outcome} settles once, removes interior presence and returns to the entrance`, async () => {
    const name = `sh${outcome}`; await seed(name);
    let visit = visitOf(await action(name, 'stronghold-enter', { sector }));
    for (let n = 1; n <= 25; n++) visit = visitOf(await action(name, 'stronghold-step', { sector, version: visit.version, tile: STRONGHOLD_SPAWN + n % 2 }));
    const session = (await solo.readSoloPveSession(visit.patrolId!))!;
    session.status = 'done'; session.winner = 'enemy'; session.outcome = outcome;
    session.player.hp = outcome === 'loss' ? 0 : 5000;
    session.terminalEvidence = { finishedAt: Date.now(), finalMoveToken: `test-${outcome}`, finalVersion: session.version,
        finalEventSeq: session.eventSeq, winner: 'enemy', outcome, itemsUsed: {}, settlementState: 'pending' };
    await solo.writeSoloPveSession(session);
    const report = await action(name, 'stronghold-patrol-report', { sector, runId: session.sessionId });
    assert.equal(report.status, 200, JSON.stringify(report.body));
    assert.equal(report.body.won, false);
    assert.equal(visitOf(report).tile, STRONGHOLD_SPAWN);
    assert.equal(visitOf(report).threat, 0);
    assert.equal(location.strongholdLocation(name, sector), undefined);
    assert.equal((await action(name, 'stronghold-state', { sector })).status, 409);
    const replay = await action(name, 'stronghold-patrol-report', { sector, runId: session.sessionId });
    assert.equal(replay.body._saveVersion, report.body._saveVersion);
    assert.equal(location.strongholdLocation(name, sector), undefined);
});

test('25 steps seal one patrol; retries resume it, victory settles once and resumes the same tile', async () => {
    const name = 'shpatrol'; await seed(name);
    let visit = visitOf(await action(name, 'stronghold-enter', { sector }));
    for (let count = 1; count <= 25; count++) {
        const result = await action(name, 'stronghold-step', { sector, version: visit.version, tile: STRONGHOLD_SPAWN + count % 2 });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        visit = visitOf(result);
    }
    assert.equal(visit.threat, 100); assert.ok(visit.patrolId);
    const runId = visit.patrolId!;
    const resumed = await action(name, 'stronghold-enter', { sector });
    assert.equal((resumed.body.patrol as { sessionId: string }).sessionId, runId);
    const stopped = visitOf(await action(name, 'stronghold-step', { sector, version: visit.version, tile: STRONGHOLD_SPAWN }));
    assert.equal(stopped.steps, 25);
    assert.equal((await action(name, 'stronghold-patrol-report', { sector, runId })).status, 409);
    const session = (await solo.readSoloPveSession(runId))!;
    session.status = 'done'; session.winner = 'player'; session.outcome = 'win'; session.player.hp = 8000;
    session.terminalEvidence = { finishedAt: Date.now(), finalMoveToken: 'test-win', finalVersion: session.version,
        finalEventSeq: session.eventSeq, winner: 'player', outcome: 'win', itemsUsed: {}, settlementState: 'pending' };
    await solo.writeSoloPveSession(session);
    const result = await action(name, 'stronghold-patrol-report', { sector, runId });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.won, true); assert.equal(visitOf(result).threat, 0);
    assert.equal(visitOf(result).tile, visit.tile); assert.equal(visitOf(result).patrolId, undefined);
    assert.equal((result.body.character as { hp: number }).hp, 8000);
    const replay = await action(name, 'stronghold-patrol-report', { sector, runId });
    assert.equal(replay.body._saveVersion, result.body._saveVersion);
});

test('an engaged player cannot leave or move through a pending PvP attack', async () => {
    const name = 'shengaged'; await seed(name);
    const visit = visitOf(await action(name, 'stronghold-enter', { sector }));
    onlineStore.setPendingAttacker(name, { name: 'rival' });
    assert.equal((await action(name, 'stronghold-leave', { sector })).status, 409);
    assert.equal((await action(name, 'stronghold-step', { sector, version: visit.version, tile: visit.tile + 1 })).status, 409);
    onlineStore.clearPendingAttacker(name);
});

test('final Anbu admission requires vault proximity and refuses an unresolved patrol', async () => {
    const { strongholdVaultReady, strongholdVisitKey } = await import('./_stronghold.js');
    const { STRONGHOLD_VAULT } = await import('../../shared/sector-stronghold.js');
    const name = 'shvault'; await seed(name);
    const visit = visitOf(await action(name, 'stronghold-enter', { sector }));
    assert.equal(await strongholdVaultReady(name, sector), false);
    const atVault = { ...visit, tile: STRONGHOLD_VAULT - 1 };
    await kv.set(strongholdVisitKey(name, sector), atVault);
    location.touchStrongholdPresence(name, sector, atVault.tile);
    assert.equal(await strongholdVaultReady(name, sector), true);
    await kv.set(strongholdVisitKey(name, sector), { ...atVault, threat: 100, patrolId: 'owed' });
    assert.equal(await strongholdVaultReady(name, sector), false);
});
