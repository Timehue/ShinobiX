import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-economy-telemetry-test-secret-32';
process.env.ENABLE_LEGACY = '0';

/*
 * 2026-10 economy rebalance, pets slice:
 *  - I-19 (PET-6): the pet currency writers record their committed deltas once,
 *    after the commit; a replay records nothing. The per-win arena and Warfront
 *    purses stay off the recent-txn list (econ:txns) and land in the day rows.
 *  - PET-8: a pet win that is the first save write of a new UTC day zeroes the
 *    other counters keyed to lastDailyReset, so yesterday's 20 missions cannot
 *    lock today's mission board.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type SourceCount = { c: number; d: number; n: number };
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let drainBackgroundWork: typeof import('../_background-work.js').drainBackgroundWork;
let econ: typeof import('../_economy.js');
let settleShowdownWin: typeof import('./showdown.js').settleShowdownWin;
let createShowdownSession: typeof import('../_pet-showdown/engine.js').createShowdownSession;
let hasDailyMissionSlot: typeof import('../missions/_mission-catalog.js').hasDailyMissionSlot;
let PET_CATALOG: typeof import('./_catalog.js').PET_CATALOG;
let battleResult: Handler;
let gauntlet: Handler;
let progress: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ drainBackgroundWork } = await import('../_background-work.js'));
    econ = await import('../_economy.js');
    ({ settleShowdownWin } = await import('./showdown.js'));
    ({ createShowdownSession } = await import('../_pet-showdown/engine.js'));
    ({ hasDailyMissionSlot } = await import('../missions/_mission-catalog.js'));
    ({ PET_CATALOG } = await import('./_catalog.js'));
    battleResult = (await import('./battle-result.js')).default as unknown as Handler;
    gauntlet = (await import('./gauntlet.js')).default as unknown as Handler;
    progress = (await import('./progress.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ENABLE_LEGACY;
});

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

async function call(endpoint: Handler, player: string, body: Json, address: string) {
    const out = { status: 200, body: {} as Json };
    const res = { setHeader: () => res, status: (status: number) => { out.status = status; return res; },
        json: (value: Json) => { out.body = value; return res; }, end: () => res };
    await endpoint({ method: 'POST', body: { playerName: player, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(player) },
        socket: { remoteAddress: address } } as never, res as never);
    return out;
}

async function dayRow(player: string, currency: string): Promise<Record<string, SourceCount>> {
    await drainBackgroundWork();
    const row = await kv.get<Record<string, Record<string, SourceCount>>>(econ.econPlayerDayKey(econ.econUtcDay(Date.now()), player));
    return row?.[currency] ?? {};
}

async function listed(player: string, source: string) {
    await drainBackgroundWork();
    return ((await kv.get<Array<{ player: string; source: string; delta: number; currency: string }>>(econ.ECON_TXN_LIST_KEY)) ?? [])
        .filter((txn) => txn.player === player && txn.source === source);
}

/** Yesterday's counters, stamped yesterday: the state a first write of today meets. */
const staleCounters = () => ({
    lastDailyReset: yesterday(), dailyPetWins: 100, dailyMissionsCompleted: 20, dailyFateSpins: 5, dailyHollowGateRuns: 3,
});

test('a paid arena win rolls the shared day and records its purse once, off the recent list', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const player = 'petarenatelemetry';
    const template = PET_CATALOG['standard-0'];
    const pet = { ...template, id: 'arena-pet', templateId: template.id, level: 25, unlockedForPve: true };
    await kv.set(`save:${player}`, { _saveVersion: 1, character: {
        name: player, level: 30, ryo: 1000, totalPetWins: 0, ...staleCounters(), pets: [pet],
    } });
    const session = createShowdownSession({
        sessionId: 'arenatelemetry01', playerName: player, format: '1v1', tier: 'warrior', seed: 9,
        playerPets: [pet] as never, enemyPets: [{ ...pet, id: 'foe', level: 30 }] as never, enemyTeamName: 'Foes',
        rewardEligible: true,
    });
    const paid = await settleShowdownWin(player, session);
    assert.ok(Number(paid.reward) > 0, JSON.stringify(paid));
    const replay = await settleShowdownWin(player, session);
    assert.equal(replay.reward, 0);

    const character = ((await kv.get<Json>(`save:${player}`))!.character) as Json;
    assert.equal(character.lastDailyReset, today());
    assert.equal(character.dailyPetWins, 1, 'yesterday\'s 100 wins are not today\'s');
    assert.equal(character.dailyMissionsCompleted, 0, 'yesterday\'s 20 missions must not lock today\'s board');
    assert.equal(character.dailyFateSpins, 0);
    assert.equal(character.dailyHollowGateRuns, 0);
    assert.ok(hasDailyMissionSlot(character, today()));

    assert.deepEqual((await dayRow(player, 'ryo'))['pet.arena'], { c: Number(paid.reward), d: 0, n: 1 });
    assert.deepEqual(await listed(player, 'pet.arena'), [], 'the per-win purse stays off econ:txns');
});

test('a paid casual (Warfront-policy) win rolls the shared day and records its purse once', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const player = 'petcasualtelemetry';
    const pet = {
        id: 'casual-pet', name: 'Guardian', rarity: 'standard', level: 20, xp: 0, maxLevel: 100,
        hp: 100_000, attack: 10_000, defense: 10_000, speed: 1_000, unlockedForPve: true,
        jutsus: [{ name: 'Verdict', power: 1_000, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
    };
    const battleToken = 'CasualTelemetryReceipt01';
    const reportKey = `pet:${battleToken}`;
    await kv.set(`save:${player}`, { _saveVersion: 1, character: {
        name: player, level: 20, ryo: 90, totalPetWins: 4, ...staleCounters(),
        starterCardsClaimed: true, tileCards: [], pets: [pet],
    } });
    await kv.set(`pet:battle-token:${player}:${battleToken}`, {
        // The pre-cutover compatibility shape: no settlement policy, so it pays.
        playerName: player, reportKey, opponentLevel: 20, rewardRyo: 40,
        playerPetIds: [pet.id], opponentPetIds: ['retired-opponent'], authoritativeOutcome: 'win', mode: '1v1',
    }, { ex: 15 * 60 });
    await kv.set(`pet:battle-active:${player}`, battleToken, { ex: 15 * 60 });

    const settled = await call(battleResult, player, { outcome: 'win', reportKey, battleToken }, '198.51.100.40');
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal(settled.body.reward, 40);
    const replay = await call(battleResult, player, { outcome: 'win', reportKey, battleToken }, '198.51.100.41');
    assert.equal(replay.body.reward, 0);

    const character = ((await kv.get<Json>(`save:${player}`))!.character) as Json;
    assert.equal(character.ryo, 130);
    assert.equal(character.dailyPetWins, 1);
    assert.equal(character.dailyMissionsCompleted, 0, 'yesterday\'s 20 missions must not lock today\'s board');
    assert.equal(character.dailyHollowGateRuns, 0);
    assert.ok(hasDailyMissionSlot(character, today()));

    assert.deepEqual((await dayRow(player, 'ryo'))['pet.warfront'], { c: 40, d: 0, n: 1 });
    assert.deepEqual(await listed(player, 'pet.warfront'), []);
});

test('the Gauntlet logs its entry fee as a sink and its run payout once', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const player = 'petgauntlettelemetry';
    await kv.set(`save:${player}`, { _saveVersion: 1, character: { name: player, ryo: 2_000 } });
    const free = await call(gauntlet, player, { action: 'start' }, '198.51.100.42');
    assert.equal(free.body.chargedRyo, 0);
    const charged = await call(gauntlet, player, { action: 'start' }, '198.51.100.42');
    assert.equal(charged.body.chargedRyo, 1_500);
    assert.deepEqual((await listed(player, 'pet.gauntlet.fee')).map((txn) => txn.delta), [-1_500], 'the free run logs nothing');

    // Seed 1 clears round one with this transcript (250 ryo from the sealed schedule).
    const runToken = 'gauntlet-telemetry-run';
    await kv.set(`petgauntlet:tok:${runToken}`, {
        player, weekKey: 'w1', seed: 1, rewardEligible: true, perRound: 250, clearBonus: 1500, maxRounds: 10, startHearts: 3,
    }, { ex: 3600 });
    const transcript = [{ k: 'buy', i: 0 }, { k: 'buy', i: 1 }, { k: 'fight' }];
    const reported = await call(gauntlet, player, { action: 'report', runToken, transcript }, '198.51.100.43');
    assert.equal(reported.status, 200, JSON.stringify(reported.body));
    assert.equal(reported.body.ryo, 250);
    // A replayed report finds the retired seal's saved receipt (main's idempotent
    // report): it answers the same payout and pays, and logs, nothing again.
    const replay = await call(gauntlet, player, { action: 'report', runToken, transcript }, '198.51.100.43');
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.ryo, 250);
    assert.equal(((await kv.get<Json>(`save:${player}`))!.character as Json).ryo, 2_000 - 1_500 + 250, 'paid once');
    assert.deepEqual((await dayRow(player, 'ryo'))['pet.gauntlet'], { c: 250, d: 0, n: 1 });
});

test('a companion rename logs its 10 Fate Shard fee as a sink', async () => {
    const player = 'petnicknametelemetry';
    await kv.set(`save:${player}`, { _saveVersion: 1, character: {
        name: player, fateShards: 25,
        pets: [{ id: 'nick-pet', name: 'Kumo', rarity: 'standard', level: 5, xp: 0, maxLevel: 100, hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [] }],
    } });
    const renamed = await call(progress, player, { action: 'nickname', petId: 'nick-pet', nickname: 'Mizu' }, '198.51.100.44');
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal((renamed.body.character as Json).fateShards, 15);
    const second = await call(progress, player, { action: 'nickname', petId: 'nick-pet', nickname: 'Sora' }, '198.51.100.44');
    assert.equal(second.status, 200);
    const broke = await call(progress, player, { action: 'nickname', petId: 'nick-pet', nickname: 'Kaze' }, '198.51.100.44');
    assert.equal(broke.status, 409, 'five shards cannot pay a rename');
    const fees = await listed(player, 'pet.nickname.fee');
    assert.deepEqual(fees.map((txn) => [txn.currency, txn.delta]), [['fateShards', -10], ['fateShards', -10]], 'each paid rename is one sink entry; a refused one logs nothing');
});
