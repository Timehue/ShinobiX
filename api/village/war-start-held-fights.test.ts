process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'war-start-held-fights-secret-32-bytes';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, type TestContext } from 'node:test';
import type { HollowGateRunToken } from '../hollow-gate/_run-token.js';

/*
 * The two war fights, the ANBU Vault raid and the sector-war garrison assault,
 * driven through their mounted handlers over the in-memory KV.
 *
 * Both seat the player on the HP their save holds. Neither start used to settle
 * the fights the player was holding first, so a mission won and held back left
 * the war fight seated on HP the mission had already spent, and the contest
 * points or the vault's rewards were won on that phantom HP. Both starts now
 * settle held fights before the save is read (api/pve/_held-fights.ts), the
 * rule every other fight start follows (owner ruling 2026-10-10). That ends a
 * mission still being fought as a walk-away, and an open Hollow Gate dive fight
 * refuses the war fight instead.
 *
 * The settle runs after each start's own gates, so a start those gates refuse
 * ends nothing: the "refused" cases pin that placement. Every other case fails
 * on the code before the change.
 */

type Json = Record<string, any>;
type Handler = (req: never, res: never) => Promise<unknown>;

const HANDLERS = {
    combatStart: '../missions/combat-start.js',
    fightOutcome: '../pve/fight-outcome.js',
    sectorWar: './sector-war.js',
    infiltration: './anbu-infiltration.js',
    gateCombatStart: '../hollow-gate/combat-start.js',
} as const;

const SECTOR = 12;
const ATTACKER_VILLAGE = 'Stormveil Village';
const DEFENDER_VILLAGE = 'Frostfang Village';
const CONTEST_ID = `${SECTOR}:stormveilvillage-vs-frostfangvillage`;
const ANBU_SLUG = 'heldwaranbu';
const HOUR = 60 * 60 * 1000;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let readSoloPveSession: typeof import('../solo-pve/_store.js').readSoloPveSession;
let writeSoloPveSession: typeof import('../solo-pve/_store.js').writeSoloPveSession;
let resetRateLimits: () => void;
let PET_BREEDING_MIGRATION_VERSION: number;
const handlers = {} as Record<keyof typeof HANDLERS, Handler>;
let nameSeed = 0;
let ipSeed = 0;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js'));
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

/** A new player per case: the online roster and the stronghold presence are
 *  process-wide and keyed by name, so no case inherits another's. */
const freshName = (prefix: string) => `${prefix}${++nameSeed}`;

/** Idle recovery credits vitals by the second, so each case runs on one frozen instant. */
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
    const ip = `10.86.0.${(++ipSeed % 250) + 1}`;
    await handlers[name]({
        method: 'POST', body: { playerName: player, ...body }, query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': player, 'x-player-token': issuePlayerToken(player) ?? '', 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res as never);
    return out;
}

async function seedPlayer(name: string): Promise<void> {
    await kv.set(`save:${name}`, {
        _saveVersion: 1, _saveAt: Date.now(), currentSector: SECTOR,
        savedBloodlines: [], creatorJutsus: [], acceptedMissionIds: [], missionProgress: {},
        character: {
            name, village: ATTACKER_VILLAGE, storyProgress: 0, level: 10, rankTitle: 'Genin', specialty: 'Ninjutsu',
            hp: 600, maxHp: 600, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300, ryo: 500,
            inventory: [], itemStacks: [], pets: [], equippedJutsuIds: ['starter-universal-flicker'],
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            stats: {
                strength: 80, speed: 80, intelligence: 100, willpower: 90,
                ninjutsuOffense: 200, ninjutsuDefense: 180, taijutsuOffense: 80, taijutsuDefense: 80,
                bukijutsuOffense: 80, bukijutsuDefense: 80, genjutsuOffense: 80, genjutsuDefense: 80,
            },
        },
    });
}

async function saved(name: string): Promise<Json> {
    return ((await kv.get<Json>(`save:${name}`))?.character ?? {}) as Json;
}

/** Fight A: a combat mission, sealed by the real start route. */
async function startMission(name: string): Promise<string> {
    const started = await call('combatStart', name, { missionId: 'combat-e-drill' });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    return String(started.body.runId);
}

/** End a sealed Solo-PvE fight the way the engine records a terminal move. Its report is held back. */
async function finish(sessionId: string, outcome: 'win' | 'loss', hp: number): Promise<void> {
    const session = await readSoloPveSession(sessionId);
    assert.ok(session, `${sessionId} was sealed`);
    const winner = outcome === 'win' ? 'player' as const : 'enemy' as const;
    const version = session.version + 1;
    await writeSoloPveSession({
        ...session,
        player: { ...session.player, hp },
        enemy: { ...session.enemy, hp: outcome === 'win' ? 0 : Math.max(1, Math.floor(session.enemy.hp / 2)) },
        status: 'done', winner, outcome, settlementState: 'pending', version,
        terminalEvidence: {
            finishedAt: Date.now(), finalMoveToken: `terminal-${sessionId}`, finalVersion: version, finalEventSeq: session.eventSeq,
            winner, outcome, itemsUsed: { ...session.itemsUsed }, settlementState: 'pending',
        },
    });
}

/** Fight A is still being fought, with the player standing on `hp`. */
async function stillFighting(sessionId: string, hp: number): Promise<void> {
    const live = await readSoloPveSession(sessionId);
    assert.ok(live, `${sessionId} was sealed`);
    await writeSoloPveSession({ ...live, player: { ...live.player, hp }, version: live.version + 1 });
}

async function seedAnbu(): Promise<void> {
    await kv.set('game:village-state:frostfangvillage', { anbuAppointees: [ANBU_SLUG] });
    await kv.set(`save:${ANBU_SLUG}`, {
        character: {
            name: 'Frostfang Anbu', village: DEFENDER_VILLAGE, level: 100,
            maxHp: 12_000, hp: 12_000, maxChakra: 1_000, maxStamina: 1_000,
            stats: {}, jutsu: [], pvpItems: [], equipment: {},
        },
    });
}

/** A Combat sector war on Frostfang's sector, the player's village attacking. By
 *  default no live battle has landed for three hours, so the garrison is open. */
async function seedGarrisonWar(now: number, lastLiveBattleAgo = 3 * HOUR): Promise<void> {
    const startedAt = now - 3 * HOUR;
    await kv.set(`world:territory:${SECTOR}`, { sector: SECTOR, ownerVillage: DEFENDER_VILLAGE, updatedAt: now });
    await kv.set(`shared:sector-war:${CONTEST_ID}`, {
        id: CONTEST_ID, sector: SECTOR, attackerVillage: ATTACKER_VILLAGE, defenderVillage: DEFENDER_VILLAGE,
        winCondition: 'combat', attackerPoints: 0, defenderPoints: 0,
        startedAt, endsAt: startedAt + 72 * HOUR, updatedAt: startedAt,
        lastLiveBattleAt: now - lastLiveBattleAgo, flipped: false, appliedBattles: [],
    });
    await seedAnbu();
}

/** Frostfang holds the sector and its ANBU defends the vault; the raider is level 100. */
async function seedVault(name: string): Promise<void> {
    await kv.set(`world:territory:${SECTOR}`, { sector: SECTOR, ownerVillage: DEFENDER_VILLAGE, updatedAt: Date.now() });
    await seedAnbu();
    const record = await kv.get<Json>(`save:${name}`);
    await kv.set(`save:${name}`, { ...record, character: { ...record?.character, level: 100 } });
}

/** The raider walks into the sector's stronghold and stands beside the vault, its patrols cleared. */
async function besideTheVault(name: string): Promise<void> {
    const { onlineStore } = await import('../_realtime/online-store.js');
    const { handleStrongholdAction, strongholdVisitKey } = await import('./_stronghold.js');
    const { STRONGHOLD_VAULT } = await import('../../shared/sector-stronghold.js');
    onlineStore.upsert({ name, sector: SECTOR, character: await saved(name) });
    const entered = await handleStrongholdAction(name, 'stronghold-enter', { sector: SECTOR, presenceId: `held-war-${name}` });
    assert.equal(entered.status, 200, JSON.stringify(entered.body));
    await kv.set(strongholdVisitKey(name, SECTOR), { ...(entered.body.visit as Json), tile: STRONGHOLD_VAULT - 1 });
}

function startGarrison(name: string): Promise<{ status: number; body: Json }> {
    return call('sectorWar', name, { action: 'garrison-start', sector: SECTOR });
}

function startVault(name: string): Promise<{ status: number; body: Json }> {
    return call('infiltration', name, { action: 'start', sector: SECTOR });
}

/** A Hollow Gate dive standing on a Hound tile at (5,1) of floor 1 (the board
 *  api/pve/_delayed-settlement-journeys.test.ts drives). Returns the node to fight. */
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
    const record = await kv.get<Json>(`save:${name}`);
    await kv.set(`save:${name}`, { ...record, character: { ...record?.character, hollowGateRun: { runToken: token, serverSeed: run.seed, floor: 1 } } });
    return `floor:1:tile:${1 * width + 5}`;
}

describe('garrison assault: the fights a player is holding are settled before the attacker is seated', { concurrency: false }, () => {
    it('a mission won and held back: the assault starts on what the mission left, and the mission\'s own report is a replay', async (t) => {
        const now = freezeClock(t);
        const name = freshName('garrheld');
        await seedPlayer(name);
        const mission = await startMission(name);
        await finish(mission, 'win', 450);
        await seedGarrisonWar(now);

        const assault = await startGarrison(name);
        assert.equal(assault.status, 200, JSON.stringify(assault.body));
        assert.equal(assault.body.session.player.hp, 450, 'not the 600 the mission had already spent 150 of');
        assert.equal((await saved(name)).hp, 450, 'the mission\'s cost is on the save');

        const reported = await call('fightOutcome', name, { runId: mission });
        assert.equal(reported.status, 200, JSON.stringify(reported.body));
        assert.equal(reported.body.applied, false, 'the start already wrote the mission\'s body');
        assert.equal((await saved(name)).hp, 450, 'and the report does not charge it again');
    });

    it('a mission still being fought is walked away from: a loss, at the 10% cost', async (t) => {
        const now = freezeClock(t);
        const name = freshName('garropen');
        await seedPlayer(name);
        const mission = await startMission(name);
        await stillFighting(mission, 580);
        await seedGarrisonWar(now);

        const assault = await startGarrison(name);
        assert.equal(assault.status, 200, JSON.stringify(assault.body));
        assert.equal(assault.body.session.player.hp, 520, '580 less the walk-away cost, 10% of 600');
        const abandoned = await readSoloPveSession(mission);
        assert.equal(abandoned?.status, 'done');
        assert.equal(abandoned?.outcome, 'loss');
    });

    it('an assault the war refuses ends no fight', async (t) => {
        const now = freezeClock(t);
        const name = freshName('garrrefused');
        await seedPlayer(name);
        const mission = await startMission(name);
        await stillFighting(mission, 580);
        await seedGarrisonWar(now, 10 * 60_000); // a defender fought ten minutes ago

        const refused = await startGarrison(name);
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.match(String(refused.body.error), /still contesting/);
        assert.equal((await readSoloPveSession(mission))?.status, 'active', 'the mission is still the player\'s to finish');
        assert.equal((await saved(name)).hp, 600, 'and nothing was charged for it');
    });

    it('a knockout held back sends the attacker to the hospital instead of the garrison', async (t) => {
        const now = freezeClock(t);
        const name = freshName('garrko');
        await seedPlayer(name);
        await finish(await startMission(name), 'loss', 0);
        await seedGarrisonWar(now);

        const refused = await startGarrison(name);
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.errorCode, 'hospitalized');
        assert.equal((await saved(name)).hospitalized, true);
        const { garrisonActiveRunKey } = await import('../_sector-war-garrison-store.js');
        assert.equal(await kv.get(garrisonActiveRunKey(name, SECTOR)), null, 'no assault was sealed');
    });

    it('an open Hollow Gate dive fight refuses the assault, and is left to its dive', async (t) => {
        const now = freezeClock(t);
        const name = freshName('garrgate');
        await seedPlayer(name);
        const token = 'heldwargatetoken01';
        const nodeId = await seedDive(name, token);
        const dive = await call('gateCombatStart', name, { token, floor: 1, kind: 'battle', nodeId, mode: 'pve' });
        assert.equal(dive.status, 200, JSON.stringify(dive.body));
        await finish(String(dive.body.runId), 'win', 570);
        await seedGarrisonWar(now);

        const refused = await startGarrison(name);
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.errorCode, 'hollow-gate-encounter-open');
        assert.equal((await saved(name)).hp, 600, 'the dive settles its own fight');
        const { garrisonActiveRunKey } = await import('../_sector-war-garrison-store.js');
        assert.equal(await kv.get(garrisonActiveRunKey(name, SECTOR)), null, 'no assault was sealed');
    });
});

describe('ANBU Vault raid: the fights a player is holding are settled before the raider is seated', { concurrency: false }, () => {
    it('a mission won and held back: the raid starts on what the mission left', async (t) => {
        freezeClock(t);
        const name = freshName('vaultheld');
        await seedPlayer(name);
        await finish(await startMission(name), 'win', 450);
        await seedVault(name);
        await besideTheVault(name);

        const raid = await startVault(name);
        assert.equal(raid.status, 200, JSON.stringify(raid.body));
        assert.equal(raid.body.session.player.hp, 450, 'not the 600 the mission had already spent 150 of');
        assert.equal((await saved(name)).hp, 450, 'the mission\'s cost is on the save');
    });

    it('a raid refused short of the vault ends no fight', async (t) => {
        freezeClock(t);
        const name = freshName('vaultrefused');
        await seedPlayer(name);
        const mission = await startMission(name);
        await stillFighting(mission, 580);
        await seedVault(name); // never walks into the stronghold

        const refused = await startVault(name);
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.match(String(refused.body.error), /Reach the Anbu/);
        assert.equal((await readSoloPveSession(mission))?.status, 'active', 'the mission is still the player\'s to finish');
        assert.equal((await saved(name)).hp, 600, 'and nothing was charged for it');
    });

    it('a knockout held back sends the raider to the hospital, and spends no daily attempt', async (t) => {
        const now = freezeClock(t);
        const name = freshName('vaultko');
        await seedPlayer(name);
        await finish(await startMission(name), 'loss', 0);
        await seedVault(name);
        await besideTheVault(name);

        const refused = await startVault(name);
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        assert.equal(refused.body.errorCode, 'hospitalized');
        assert.equal((await saved(name)).hospitalized, true);
        const { infilActiveRunKey, infilStartCountKey } = await import('../_anbu-infiltration-store.js');
        const { utcDateKey } = await import('../_anbu-infiltration.js');
        assert.equal(await kv.get(infilActiveRunKey(name, SECTOR)), null, 'no raid was sealed');
        assert.equal(await kv.get(infilStartCountKey(name, utcDateKey(now))), null, 'no daily attempt was spent');
    });
});
