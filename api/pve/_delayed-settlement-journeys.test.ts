process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'delayed-settlement-journeys-secret-32b';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, type TestContext } from 'node:test';
import type { SoloPveSession } from '../solo-pve/_session.js';
import type { TowerSession } from '../towers/_tower-session.js';
import type { HollowGateRunToken } from '../hollow-gate/_run-token.js';

/*
 * The "delayed first settlement" free heal, driven through the mounted handlers
 * over the in-memory KV.
 *
 * Every PvE settlement wrote the player's HP as an ABSOLUTE value read from the
 * fight's sealed session. A fight seeded from the save is right to do that only
 * while the save still holds what the fight was seeded from. So: finish fight A
 * at high HP and hold its report back (a finished AI fight blocks only another
 * AI fight), fight something else, lose HP in it and settle it, then report A.
 * A's write set HP back up to A's end value, erasing the other fight's cost.
 * And the other fight was fought on HP that A had already spent.
 *
 * Two fixes, two blocks of journeys. A new fight sealed from the save first
 * settles every fight the player is holding (api/pve/_held-fights.ts), so it is
 * never fought on phantom HP. And a settlement that still lands late charges
 * whatever the save lost since its fight was sealed
 * (missions/_ai-fight-outcome.ts `vitalLostSinceSeal`). Each journey below fails
 * on the code before the fix. The pure rules are in _delayed-settlement-paths.test.ts.
 */

type Json = Record<string, any>;
type Handler = (req: never, res: never) => Promise<unknown>;

const HANDLERS = {
    aiFightStart: '../missions/ai-fight-start.js',
    reportAiFight: '../missions/report-ai-fight.js',
    combatStart: '../missions/combat-start.js',
    fightOutcome: './fight-outcome.js',
    storyBossStart: '../story/boss-start.js',
    storySettle: '../story/settle.js',
    weeklyBoss: '../weekly-boss.js',
    gateCombatStart: '../hollow-gate/combat-start.js',
    gateCombatSettle: '../hollow-gate/combat-settle.js',
} as const;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let readSoloPveSession: typeof import('../solo-pve/_store.js').readSoloPveSession;
let writeSoloPveSession: typeof import('../solo-pve/_store.js').writeSoloPveSession;
let writeTowerSession: typeof import('../towers/_tower-store.js').writeSession;
let makePveEngineTestSession: typeof import('../towers/_pve-engine-test-fixture.js').makePveEngineTestSession;
let resetRateLimits: () => void;
let PET_BREEDING_MIGRATION_VERSION: number;
const handlers = {} as Record<keyof typeof HANDLERS, Handler>;
let ipSeed = 0;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js'));
    ({ writeSession: writeTowerSession } = await import('../towers/_tower-store.js'));
    ({ makePveEngineTestSession } = await import('../towers/_pve-engine-test-fixture.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    for (const [name, path] of Object.entries(HANDLERS)) {
        handlers[name as keyof typeof HANDLERS] = (await import(path)).default as unknown as Handler;
    }
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    resetRateLimits();
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

/**
 * Idle recovery credits vitals by the second, so an exact assertion drifts with
 * the wall clock. Each journey runs on one frozen instant; the one that needs
 * recovery sets the save's regen cursor in the past instead.
 */
function freezeClock(t: TestContext): number {
    const frozen = Date.now();
    t.mock.method(Date, 'now', () => frozen);
    return frozen;
}

async function call(name: keyof typeof HANDLERS, player: string, body: Json): Promise<{ status: number; body: Json }> {
    const out = { status: 200, body: {} as Json };
    const res = {
        setHeader() { return res; },
        status(code: number) { out.status = code; return res; },
        json(value: Json) { out.body = value; return res; },
        end() { return res; },
    };
    const ip = `10.83.0.${++ipSeed}`;
    await handlers[name]({
        method: 'POST', body, query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': player, 'x-player-token': issuePlayerToken(player) ?? '', 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res as never);
    return out;
}

const SECTOR = 61;
const EXPLORE_RECEIPT = 'delayedexplore01';

function character(name: string, extra: Json = {}): Json {
    return {
        name, village: 'Stormveil Village', storyProgress: 0, level: 10, rankTitle: 'Genin', specialty: 'Ninjutsu',
        hp: 600, maxHp: 600, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300, ryo: 500,
        inventory: [], itemStacks: [], pets: [], equippedJutsuIds: ['starter-universal-flicker'],
        petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
        stats: {
            strength: 80, speed: 80, intelligence: 100, willpower: 90,
            ninjutsuOffense: 200, ninjutsuDefense: 180, taijutsuOffense: 80, taijutsuDefense: 80,
            bukijutsuOffense: 80, bukijutsuDefense: 80, genjutsuOffense: 80, genjutsuDefense: 80,
        },
        // A sealed exploration receipt, the authority an explore ambush fight starts from.
        redeemedSectorExplorations: [{ id: EXPLORE_RECEIPT, sector: SECTOR, at: Date.now(), outcome: { kind: 'battle' } }],
        ...extra,
    };
}

async function seedPlayer(name: string, extra: Json = {}, record: Json = {}): Promise<void> {
    await kv.set(`save:${name}`, {
        _saveVersion: 1, _saveAt: Date.now(), currentSector: SECTOR,
        savedBloodlines: [], creatorJutsus: [], acceptedMissionIds: [], missionProgress: {},
        ...record,
        character: character(name, extra),
    });
}

async function saved(name: string): Promise<Json> {
    return ((await kv.get<Json>(`save:${name}`))?.character ?? {}) as Json;
}

async function hp(name: string): Promise<number> {
    return Number((await saved(name)).hp);
}

/** The player loses vitals outside any fight this test drives: another player's attack, say. */
async function woundElsewhere(name: string, vitals: Json): Promise<void> {
    const record = await kv.get<Json>(`save:${name}`);
    await kv.set(`save:${name}`, { ...record, _saveVersion: Number(record?._saveVersion ?? 1) + 1, character: { ...record?.character, ...vitals } });
}

/** End a sealed Solo-PvE fight the way the engine records a terminal move. */
async function finish(sessionId: string, outcome: 'win' | 'loss', player: Partial<SoloPveSession['player']>): Promise<void> {
    const session = await readSoloPveSession(sessionId);
    assert.ok(session, `${sessionId} was sealed`);
    const winner = outcome === 'win' ? 'player' as const : 'enemy' as const;
    const version = session.version + 1;
    const done: SoloPveSession = {
        ...session,
        player: { ...session.player, ...player },
        enemy: { ...session.enemy, hp: outcome === 'win' ? 0 : Math.max(1, Math.floor(session.enemy.hp / 2)) },
        status: 'done', winner, outcome, settlementState: 'pending', version,
        terminalEvidence: {
            finishedAt: Date.now(), finalMoveToken: `terminal-${sessionId}`, finalVersion: version, finalEventSeq: session.eventSeq,
            winner, outcome, itemsUsed: { ...session.itemsUsed }, settlementState: 'pending',
        },
    };
    await writeSoloPveSession(done);
}

/** Fight A: an exploration ambush (a continuous, open-world fight), sealed by the real start route. */
async function startExplore(name: string): Promise<{ token: string; sessionId: string; session: SoloPveSession }> {
    const out = await call('aiFightStart', name, { playerName: name, battleKind: 'explore', sector: SECTOR, worldExploreRequestId: EXPLORE_RECEIPT });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    return { token: String(out.body.token), sessionId: String(out.body.sessionId), session: out.body.session as SoloPveSession };
}

async function startMission(name: string): Promise<{ status: number; body: Json }> {
    return call('combatStart', name, { playerName: name, missionId: 'combat-e-drill' });
}

/** Fight B: a combat mission, started, won at `endHp` and settled through the routes a client uses. Returns what it was seeded with. */
async function fightMission(name: string, endHp: number): Promise<SoloPveSession['player']> {
    const started = await startMission(name);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const runId = String(started.body.runId);
    await finish(runId, 'win', { hp: endHp });
    const settled = await call('fightOutcome', name, { playerName: name, runId });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal(settled.body.applied, true);
    return started.body.session.player;
}

async function startStoryBoss(name: string): Promise<string> {
    const boss = await call('storyBossStart', name, { playerName: name });
    assert.equal(boss.status, 200, JSON.stringify(boss.body));
    return String(boss.body.runId);
}

async function startWeeklyBoss(name: string, now: number): Promise<{ runId: string; weekKey: string }> {
    const weekKey = 'delayed-week';
    await kv.set('game:weekly-boss-state', {
        weekKey, aiId: 'ashen-dragon', bossName: 'Ashen Dragon', hpMax: 100_000, hpRemaining: 100_000,
        scaleFactor: 1, damageByPlayer: {}, attemptsByPlayer: {}, startedAt: now - 60_000, expiresAt: now + 60 * 60_000,
    });
    const started = await call('weeklyBoss', name, { kind: 'startFight', weekKey });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    return { runId: String(started.body.runId), weekKey };
}

/** A Hollow Gate dive standing on a Hound tile at (5,1) of floor 1 (the board
 *  api/hollow-gate/_encounter-no-strand.integration.test.ts drives). */
async function seedDive(name: string, token: string): Promise<string> {
    const { hollowGateRunKey } = await import('../hollow-gate/_run-token.js');
    const { validateHollowGateFloorManifest } = await import('../hollow-gate/_floor-manifest.js');
    const width = 15;
    const tiles = Array.from({ length: width * 11 }, () => ({ kind: 'empty', terrain: 'room_floor' }));
    let index = 20;
    for (const [kind, count] of [['battle', 5], ['elite', 1], ['trap', 1], ['chest', 3], ['shard_vein', 1], ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1]] as const) {
        for (let placed = 0; placed < count; placed += 1) tiles[index++].kind = kind;
    }
    tiles[width * 9 + 1].kind = 'exit';
    tiles[width * 9 + 13].kind = 'descend';
    const manifest = validateHollowGateFloorManifest({ floor: 1, finalFloor: false, width, height: 11, playerX: 1, playerY: 1, tiles });
    assert.ok(manifest.ok);
    const run: HollowGateRunToken = {
        playerName: name, mintedAt: Date.now(), floorDepth: 5, currentFloor: 1,
        seed: `${name}-seed`, entryCurrencies: { ryo: 500 }, entryItems: {},
        offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
        floorManifests: { '1': manifest.manifest }, position: { x: 5, y: 1 },
        torch: 8, threat: 12, stepVersion: 3, recentStepIds: [],
    };
    await kv.set(hollowGateRunKey(name, token), run);
    await seedPlayer(name, { hollowGateRun: { runToken: token, serverSeed: run.seed, floor: 1 } });
    return `floor:1:tile:${1 * width + 5}`;
}

describe('a new fight is sealed only after the fights a player is holding are settled', { concurrency: false }, () => {
    it('an AI fight won and held back is written before a mission is seeded, so the mission is fought on what is left', async (t) => {
        freezeClock(t);
        await seedPlayer('heldreport');
        const fight = await startExplore('heldreport');
        assert.equal(fight.session.player.hp, 600);
        await finish(fight.sessionId, 'win', { hp: 550 });

        // The report is held back. The mission start writes the AI fight's HP
        // first, then seeds from that.
        assert.equal((await fightMission('heldreport', 200)).hp, 550, 'not the 600 the AI fight had already spent 50 of');
        assert.equal(await hp('heldreport'), 200);

        // The held report still pays, and leaves the HP alone.
        const ryoBefore = Number((await saved('heldreport')).ryo);
        const reported = await call('reportAiFight', 'heldreport', { playerName: 'heldreport', aiFightToken: fight.token });
        assert.equal(reported.status, 200, JSON.stringify(reported.body));
        assert.equal(reported.body.outcome, 'win');
        assert.equal(await hp('heldreport'), 200);
        assert.ok(Number((await saved('heldreport')).ryo) > ryoBefore, 'the win is still paid');
    });

    it('an AI fight left OPEN is abandoned when another fight starts, at the walk-away cost', async (t) => {
        freezeClock(t);
        await seedPlayer('heldopen');
        const fight = await startExplore('heldopen');
        // Still active: the player walks away from it standing on 580.
        const live = (await readSoloPveSession(fight.sessionId))!;
        await writeSoloPveSession({ ...live, player: { ...live.player, hp: 580 }, version: live.version + 1 });

        assert.equal((await fightMission('heldopen', 200)).hp, 520, '580 less the 10% walk-away cost');
        const abandoned = await readSoloPveSession(fight.sessionId);
        assert.equal(abandoned?.status, 'done');
        assert.equal(abandoned?.outcome, 'loss');
    });

    it('a knockout held back sends the player to the hospital before they can start another fight', async (t) => {
        freezeClock(t);
        await seedPlayer('heldko');
        const fight = await startExplore('heldko');
        await finish(fight.sessionId, 'loss', { hp: 0 });

        const refused = await startMission('heldko');
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.errorCode, 'hospitalized');
        assert.equal((await saved('heldko')).hospitalized, true);
    });

    it('a held open-world fight\'s chakra and stamina are charged before the next one is seeded', async (t) => {
        freezeClock(t);
        await seedPlayer('heldchakra');
        const fight = await startExplore('heldchakra');
        assert.deepEqual([fight.session.seededVitals?.chakra, fight.session.seededVitals?.stamina], [300, 300]);
        await finish(fight.sessionId, 'win', { hp: 550, chakra: 120, stamina: 90 });

        const mission = await fightMission('heldchakra', 200);
        assert.deepEqual([mission.chakra, mission.stamina], [120, 90], 'the mission starts on the bars the explore fight left');
    });

    it('a story boss won and held back is written before a mission is seeded; its settle adds the 25 once', async (t) => {
        freezeClock(t);
        await seedPlayer('heldstory');
        const runId = await startStoryBoss('heldstory');
        await finish(runId, 'win', { hp: 560 });

        assert.equal((await fightMission('heldstory', 200)).hp, 560);
        const settled = await call('storySettle', 'heldstory', { playerName: 'heldstory', runId, kind: 'storyBoss' });
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal(settled.body.progress, 1, 'the chapter is still paid');
        assert.equal(await hp('heldstory'), 225, 'the mission left 200; the boss\'s reward is +25 on top');
    });

    it('a Weekly Boss attempt held back is written before a mission is seeded; logging it banks the damage only', async (t) => {
        const now = freezeClock(t);
        await seedPlayer('heldweekly');
        const { runId, weekKey } = await startWeeklyBoss('heldweekly', now);
        await finish(runId, 'loss', { hp: 520 });

        assert.equal((await fightMission('heldweekly', 200)).hp, 520);
        const logged = await call('weeklyBoss', 'heldweekly', { kind: 'logFight', weekKey, runId });
        assert.equal(logged.status, 200, JSON.stringify(logged.body));
        assert.equal(await hp('heldweekly'), 200);
    });

    it('an open Hollow Gate dive fight refuses another fight until the dive settles it', async (t) => {
        freezeClock(t);
        const token = 'heldgatetoken001';
        const nodeId = await seedDive('heldgate', token);
        const started = await call('gateCombatStart', 'heldgate', { playerName: 'heldgate', token, floor: 1, kind: 'battle', nodeId, mode: 'pve' });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        await finish(String(started.body.runId), 'win', { hp: 570 });

        // Nothing on the server used to stop a crafted client leaving a dive for a mission.
        const refused = await startMission('heldgate');
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.errorCode, 'hollow-gate-encounter-open');

        const settled = await call('gateCombatSettle', 'heldgate', { playerName: 'heldgate', token, runId: started.body.runId });
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        const mission = await startMission('heldgate');
        assert.equal(mission.status, 200, JSON.stringify(mission.body));
        assert.equal(mission.body.session.player.hp, 570);
    });

    it('that refusal comes before any other held fight is touched, even one sealed earlier', async (t) => {
        // Two starts racing can leave an open fight sealed BEFORE the dive fight
        // in the index. Refusing only on reaching the dive fight abandoned it first.
        let clock = Date.now();
        t.mock.method(Date, 'now', () => clock);
        const token = 'heldgatetoken002';
        const nodeId = await seedDive('heldgatefirst', token);
        const started = await call('gateCombatStart', 'heldgatefirst', { playerName: 'heldgatefirst', token, floor: 1, kind: 'battle', nodeId, mode: 'pve' });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        const dive = started.body.session as SoloPveSession;
        await writeSoloPveSession({
            ...dive,
            sessionId: 'heldgate-race-earlier',
            encounter: { kind: 'generic-ai', id: 'race', sourceId: dive.encounter.sourceId, level: dive.encounter.level },
            createdAt: dive.createdAt - 1_000,
        });
        clock += 1_000;

        const refused = await startMission('heldgatefirst');
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.errorCode, 'hollow-gate-encounter-open');
        assert.equal((await readSoloPveSession('heldgate-race-earlier'))?.status, 'active', 'the earlier fight is still the player\'s to finish');
        assert.equal(await hp('heldgatefirst'), 600, 'and nothing was charged for it');
    });
});

describe('a settlement that still lands late charges what the save lost since', { concurrency: false }, () => {
    it('a held AI fight reported after HP was lost elsewhere cannot set it back up', async (t) => {
        freezeClock(t);
        await seedPlayer('lateai');
        const fight = await startExplore('lateai');
        await finish(fight.sessionId, 'win', { hp: 550 });
        await woundElsewhere('lateai', { hp: 200 });

        const reported = await call('reportAiFight', 'lateai', { playerName: 'lateai', aiFightToken: fight.token });
        assert.equal(reported.status, 200, JSON.stringify(reported.body));
        assert.equal(await hp('lateai'), 150, '600 less 50 for the AI fight and 400 lost elsewhere, not the 550 it ended on');
    });

    it('nor after a Tower run fought since, which seats a full pool and seals nothing from the save', async (t) => {
        freezeClock(t);
        await seedPlayer('latetower');
        const fight = await startExplore('latetower');
        await finish(fight.sessionId, 'win', { hp: 550 });

        const run = makePveEngineTestSession({ enemyLevel: 10, runId: 'delayed-tower-run', playerMaxHp: 600 });
        run.actors[0] = { ...run.actors[0], ownerSlug: 'latetower', hp: 250 };
        await writeTowerSession({ ...run, status: 'done', winner: 'enemy' } as TowerSession);
        const tower = await call('fightOutcome', 'latetower', { playerName: 'latetower', runId: 'delayed-tower-run' });
        assert.equal(tower.status, 200, JSON.stringify(tower.body));
        assert.equal(await hp('latetower'), 250);

        const reported = await call('reportAiFight', 'latetower', { playerName: 'latetower', aiFightToken: fight.token });
        assert.equal(reported.status, 200, JSON.stringify(reported.body));
        assert.equal(await hp('latetower'), 200, '550 less the 350 the Tower run cost');
    });

    it('a held open-world fight cannot waive its own chakra and stamina cost', async (t) => {
        freezeClock(t);
        await seedPlayer('latechakra');
        const fight = await startExplore('latechakra');
        // Lost but standing, so the report pays nothing: a win's stat growth can
        // raise the bars too, and that reward is kept on top of this sum.
        await finish(fight.sessionId, 'loss', { hp: 550, chakra: 200, stamina: 220 });
        await woundElsewhere('latechakra', { chakra: 120, stamina: 100 });

        const reported = await call('reportAiFight', 'latechakra', { playerName: 'latechakra', aiFightToken: fight.token });
        assert.equal(reported.status, 200, JSON.stringify(reported.body));
        const after = await saved('latechakra');
        assert.deepEqual([after.chakra, after.stamina], [20, 20], '300 - 100 for the fight - 180 elsewhere; 300 - 80 - 200');
    });

    it('an open AI fight abandoned late is charged the walk-away from what is left', async (t) => {
        freezeClock(t);
        await seedPlayer('lateopen');
        const fight = await startExplore('lateopen');
        const live = (await readSoloPveSession(fight.sessionId))!;
        await writeSoloPveSession({ ...live, player: { ...live.player, hp: 580 }, version: live.version + 1 });
        await woundElsewhere('lateopen', { hp: 200 });

        const abandoned = await call('fightOutcome', 'lateopen', { playerName: 'lateopen', runId: fight.sessionId });
        assert.equal(abandoned.status, 200, JSON.stringify(abandoned.body));
        assert.equal(await hp('lateopen'), 120, '520 after the walk-away, less the 400 lost elsewhere, not 520');
    });

    it('a story boss settled late adds its 25 to what is left', async (t) => {
        freezeClock(t);
        await seedPlayer('latestory');
        const runId = await startStoryBoss('latestory');
        await finish(runId, 'win', { hp: 560 });
        await woundElsewhere('latestory', { hp: 200 });

        const settled = await call('storySettle', 'latestory', { playerName: 'latestory', runId, kind: 'storyBoss' });
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal(await hp('latestory'), 185, '560 less the 400 lost elsewhere, plus 25, not 585');
    });

    it('a Hollow Gate dive fight settled late cannot set HP back up', async (t) => {
        freezeClock(t);
        const token = 'lategatetoken001';
        const nodeId = await seedDive('lategate', token);
        const started = await call('gateCombatStart', 'lategate', { playerName: 'lategate', token, floor: 1, kind: 'battle', nodeId, mode: 'pve' });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        await finish(String(started.body.runId), 'win', { hp: 570 });
        await woundElsewhere('lategate', { hp: 200 });

        const settled = await call('gateCombatSettle', 'lategate', { playerName: 'lategate', token, runId: started.body.runId });
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal(settled.body.won, true);
        assert.equal(await hp('lategate'), 170, '570 less the 400 lost elsewhere, not 570');
    });

    it('a prompt report still writes exactly the HP the fight left, with idle recovery accrued during it', async (t) => {
        const now = freezeClock(t);
        // Two minutes of idle recovery are owed on the save (1 HP a second
        // at a 600 pool), and nothing battle-locks a Solo-PvE fight.
        await seedPlayer('promptreport', { hp: 300 }, { _saveAt: now - 120_000, _regenAt: now - 120_000 });
        const fight = await startExplore('promptreport');
        assert.equal(fight.session.player.hp, 300, 'the start seeds from the save as stored');
        await finish(fight.sessionId, 'win', { hp: 250 });

        const reported = await call('reportAiFight', 'promptreport', { playerName: 'promptreport', aiFightToken: fight.token });
        assert.equal(reported.status, 200, JSON.stringify(reported.body));
        assert.equal(await hp('promptreport'), 250, 'the settle writes what the fight left; recovery during it is not credited');
    });
});

describe('the caravan fights, which start on idle recovery the save has not written', { concurrency: false }, () => {
    /** A convoy standing on its first road node, about to be struck. */
    async function caravanAtCombat(player: string, now: number, sessionId: (node: string) => string, hpNow: number, owedMs = 0): Promise<string> {
        const { departCaravan } = await import('../festival/_caravan.js');
        const { caravanDaily } = await import('../../shared/sunscar/caravan-contracts.js');
        const { festivalDay } = await import('../festival/_rally.js');
        const empty = { reputation: 0, deliveries: 0, lastEntryDay: null, current: null, chains: {}, discoveries: [], history: [] };
        const contract = caravanDaily(player, festivalDay(now), empty).contracts.find(c => c.reputationRequired <= 0)!;
        const departed = departCaravan(character(player, { hp: hpNow }), player, { contractId: contract.id, tools: ['water', 'repair', 'smoke'] }, now);
        const progress = departed.sunscarCaravan as { current: Json };
        const node = String(progress.current.available[0]);
        progress.current.currentNodeId = node;
        progress.current.status = 'combat';
        progress.current.combat = { sessionId: sessionId(node), enemy: 'raider', nodeId: node, settled: false };
        await seedPlayer(player, { hp: hpNow, sunscarCaravan: progress }, owedMs > 0 ? { _saveAt: now - owedMs, _regenAt: now - owedMs } : {});
        return String(progress.current.id);
    }

    it('a caravan ambush finished after HP was lost elsewhere charges that loss too', async (t) => {
        const now = freezeClock(t);
        const { startCaravanCombat, finishCaravanCombat } = await import('../festival/_caravan-combat.js');
        const player = 'heldcaravan';
        const runId = await caravanAtCombat(player, now, node => `caravan-tower:held:${node}`, 600);

        const ambush = await startCaravanCombat(player, runId) as TowerSession;
        await writeTowerSession({
            ...ambush, status: 'done', winner: 'squad',
            actors: ambush.actors.map(actor => actor.side === 'enemy' ? { ...actor, hp: 0 } : actor.ownerSlug === player ? { ...actor, hp: 500 } : actor),
        });
        // The Tower lease the ambush holds refuses other fight starts, but not
        // every way to lose HP (another player's attack, for one).
        await woundElsewhere(player, { hp: 250 });

        await finishCaravanCombat(player, runId);
        assert.equal(await hp(player), 150, '500 less the 350 lost elsewhere, not 500');
        assert.equal(ambush.caravanAmbush?.seededVitals?.hp, 600, 'the ambush re-seeds its fighter from the save and seals it');
    });

    it('an honest caravan ambush is not charged the recovery it was seeded with', async (t) => {
        const now = freezeClock(t);
        const { startCaravanCombat, finishCaravanCombat } = await import('../festival/_caravan-combat.js');
        const player = 'owedambush';
        // A minute of idle recovery is owed: 1 HP a second at a 600 pool.
        const runId = await caravanAtCombat(player, now, node => `caravan-tower:owed:${node}`, 400, 60_000);

        // The start settles the owed minute into the fighter (460) without
        // writing it back, and the lease it claims stops recovery until the
        // ambush settles, so the save still stores 400 when it does.
        const ambush = await startCaravanCombat(player, runId) as TowerSession;
        await writeTowerSession({
            ...ambush, status: 'done', winner: 'squad',
            actors: ambush.actors.map(actor => actor.side === 'enemy' ? { ...actor, hp: 0 } : actor.ownerSlug === player ? { ...actor, hp: 450 } : actor),
        });

        await finishCaravanCombat(player, runId);
        assert.equal(await hp(player), 450, 'nothing was lost since the ambush began, so it writes what the ambush left');
        assert.equal(ambush.caravanAmbush?.seededVitals?.hp, 400, 'the seal is what the save stores');
    });

    it('a caravan escort fight seals what the save stores, not the recovery its start settled', async (t) => {
        const now = freezeClock(t);
        const { startCaravanCombat } = await import('../festival/_caravan-combat.js');
        const player = 'owedescort';
        const runId = await caravanAtCombat(player, now, node => `caravan-escort-owed-${node}`, 400, 60_000);

        const session = await startCaravanCombat(player, runId) as SoloPveSession;
        assert.equal(session.player.hp, 460, 'the escort fight starts on the recovered pool');
        assert.equal(session.seededVitals?.hp, 400);
    });
});

describe('a story boss\'s HP lands once, whichever of its two writes comes first', { concurrency: false }, () => {
    for (const first of ['outcome report', 'story settle'] as const) {
        it(`the ${first} first: the fight's HP plus the 25, once`, async (t) => {
            freezeClock(t);
            const player = first === 'outcome report' ? 'storyoutcome' : 'storysettle';
            await seedPlayer(player);
            const runId = await startStoryBoss(player);
            await finish(runId, 'win', { hp: 560 });

            const report = () => call('fightOutcome', player, { playerName: player, runId });
            const settle = () => call('storySettle', player, { playerName: player, runId, kind: 'storyBoss' });
            for (const write of first === 'outcome report' ? [report, settle] : [settle, report]) {
                const out = await write();
                assert.equal(out.status, 200, JSON.stringify(out.body));
            }
            assert.equal(await hp(player), 585);
            assert.equal((await saved(player)).storyProgress, 1);
        });
    }
});
