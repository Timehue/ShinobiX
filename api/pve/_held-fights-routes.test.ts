process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'held-fights-routes-secret-32-bytes!';

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { after, before, beforeEach, describe, it, type TestContext } from 'node:test';
import type { SoloPveSession } from '../solo-pve/_session.js';
import type { TowerSession } from '../towers/_tower-session.js';
import type { HollowGateRunToken } from '../hollow-gate/_run-token.js';

/*
 * Every route that seals a fight from the save settles the fights the player is
 * holding first (api/pve/_held-fights.ts), so the new fight is never seeded on
 * HP an earlier fight already spent.
 *
 * The first block drives the real start routes: a mission is finished but not
 * settled, and each route's new fight must start on what the mission left. The
 * second is the ratchet that keeps the rule whole: every non-test api file that
 * builds a fight from the save must call settleHeldFights, or be a builder that
 * a listed route calls, so a new route fails this test until someone wires it.
 */

type Json = Record<string, any>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let readSoloPveSession: typeof import('../solo-pve/_store.js').readSoloPveSession;
let writeSoloPveSession: typeof import('../solo-pve/_store.js').writeSoloPveSession;
let resetRateLimits: () => void;
let PET_BREEDING_MIGRATION_VERSION: number;
let ipSeed = 0;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
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

function freezeClock(t: TestContext): number {
    const frozen = Date.now();
    t.mock.method(Date, 'now', () => frozen);
    return frozen;
}

async function call(path: string, player: string, body: Json): Promise<{ status: number; body: Json }> {
    const handler = (await import(path)).default as unknown as Handler;
    const out = { status: 200, body: {} as Json };
    const res = {
        setHeader() { return res; },
        status(code: number) { out.status = code; return res; },
        json(value: Json) { out.body = value; return res; },
        end() { return res; },
    };
    const ip = `10.84.0.${++ipSeed}`;
    await handler({
        method: 'POST', body, query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': player, 'x-player-token': issuePlayerToken(player) ?? '', 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res as never);
    return out;
}

const SECTOR = 61;
const EXPLORE_RECEIPT = 'heldroutesexplore';

async function seedPlayer(name: string, extra: Json = {}): Promise<void> {
    await kv.set(`save:${name}`, {
        _saveVersion: 1, _saveAt: Date.now(), currentSector: SECTOR,
        savedBloodlines: [], creatorJutsus: [], acceptedMissionIds: [], missionProgress: {},
        character: {
            name, village: 'Stormveil Village', storyProgress: 0, level: 10, rankTitle: 'Genin', specialty: 'Ninjutsu',
            hp: 600, maxHp: 600, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300, ryo: 500,
            inventory: [], itemStacks: [], pets: [], equippedJutsuIds: ['starter-universal-flicker'],
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            stats: {
                strength: 80, speed: 80, intelligence: 100, willpower: 90,
                ninjutsuOffense: 200, ninjutsuDefense: 180, taijutsuOffense: 80, taijutsuDefense: 80,
                bukijutsuOffense: 80, bukijutsuDefense: 80, genjutsuOffense: 80, genjutsuDefense: 80,
            },
            redeemedSectorExplorations: [{ id: EXPLORE_RECEIPT, sector: SECTOR, at: Date.now(), outcome: { kind: 'battle' } }],
            ...extra,
        },
    });
}

/** A convoy on its first road node, about to be struck; `sessionId` picks the ambush or the escort fight. */
async function caravanAtCombat(name: string, now: number, sessionId: (node: string) => string): Promise<string> {
    const { departCaravan } = await import('../festival/_caravan.js');
    const { caravanDaily } = await import('../../shared/sunscar/caravan-contracts.js');
    const { festivalDay } = await import('../festival/_rally.js');
    const empty = { reputation: 0, deliveries: 0, lastEntryDay: null, current: null, chains: {}, discoveries: [], history: [] };
    const contract = caravanDaily(name, festivalDay(now), empty).contracts.find(c => c.reputationRequired <= 0)!;
    const record = await kv.get<Json>(`save:${name}`);
    const departed = departCaravan(record!.character, name, { contractId: contract.id, tools: ['water', 'repair', 'smoke'] }, now);
    const progress = departed.sunscarCaravan as { current: Json };
    const node = String(progress.current.available[0]);
    progress.current.currentNodeId = node;
    progress.current.status = 'combat';
    progress.current.combat = { sessionId: sessionId(node), enemy: 'raider', nodeId: node, settled: false };
    await kv.set(`save:${name}`, { ...record, character: { ...record!.character, sunscarCaravan: progress } });
    return String(progress.current.id);
}

/** A combat mission won at 450, its outcome never reported: a held fight. */
async function holdMission(name: string): Promise<void> {
    const started = await call('../missions/combat-start.js', name, { playerName: name, missionId: 'combat-e-drill' });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const session = (await readSoloPveSession(String(started.body.runId)))!;
    const version = session.version + 1;
    await writeSoloPveSession({
        ...session,
        player: { ...session.player, hp: 450 },
        enemy: { ...session.enemy, hp: 0 },
        status: 'done', winner: 'player', outcome: 'win', settlementState: 'pending', version,
        terminalEvidence: {
            finishedAt: Date.now(), finalMoveToken: `terminal-${session.sessionId}`, finalVersion: version, finalEventSeq: session.eventSeq,
            winner: 'player', outcome: 'win', itemsUsed: {}, settlementState: 'pending',
        },
    });
}

describe('each route that seals a fight from the save settles a held fight first', { concurrency: false }, () => {
    const cases: Array<{ route: string; start: (name: string, now: number) => Promise<number> }> = [
        {
            route: 'AI fight (explore)',
            async start(name) {
                const out = await call('../missions/ai-fight-start.js', name, { playerName: name, battleKind: 'explore', sector: SECTOR, worldExploreRequestId: EXPLORE_RECEIPT });
                assert.equal(out.status, 200, JSON.stringify(out.body));
                return Number(out.body.session.player.hp);
            },
        },
        {
            route: 'World encounter',
            async start(name) {
                // A wanderer ambush only finds a shinobi with a robbery streak behind them.
                const record = await kv.get<Json>(`save:${name}`);
                await kv.set(`save:${name}`, { ...record, currentSector: 2, character: { ...record?.character, robberStreak: 5 } });
                const out = await call('../missions/ai-fight-start.js', name, {
                    playerName: name, worldEncounter: { kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 2, stage: 0 },
                });
                assert.equal(out.status, 200, JSON.stringify(out.body));
                return Number(out.body.session.player.hp);
            },
        },
        {
            route: 'stronghold patrol',
            async start(name) {
                const { onlineStore } = await import('../_realtime/online-store.js');
                const { handleStrongholdAction, strongholdVisitKey } = await import('../village/_stronghold.js');
                const { STRONGHOLD_SPAWN } = await import('../../shared/sector-stronghold.js');
                const sector = 12;
                const presenceId = `held-routes-${name}`;
                // A stronghold admits level 100, standing in its sector.
                const record = await kv.get<Json>(`save:${name}`);
                const character = { ...record?.character, level: 100 };
                await kv.set(`save:${name}`, { ...record, character });
                onlineStore.upsert({ name, sector, character });
                const entered = await handleStrongholdAction(name, 'stronghold-enter', { sector, presenceId });
                assert.equal(entered.status, 200, JSON.stringify(entered.body));
                // One step short of the threat that seals a patrol.
                const visit: Json = { ...(entered.body.visit as Json), threat: 96, steps: 24 };
                await kv.set(strongholdVisitKey(name, sector), visit);
                const stepped = await handleStrongholdAction(name, 'stronghold-step', { sector, presenceId, version: visit.version, tile: STRONGHOLD_SPAWN + 1 });
                assert.equal(stepped.status, 200, JSON.stringify(stepped.body));
                const patrol = await readSoloPveSession(String((stepped.body.visit as Json).patrolId));
                assert.ok(patrol, 'the step sealed a patrol');
                return Number(patrol.player.hp);
            },
        },
        {
            route: 'story boss',
            async start(name) {
                const out = await call('../story/boss-start.js', name, { playerName: name });
                assert.equal(out.status, 200, JSON.stringify(out.body));
                return Number(out.body.session.player.hp);
            },
        },
        {
            route: 'Weekly Boss',
            async start(name, now) {
                await kv.set('game:weekly-boss-state', {
                    weekKey: 'held-routes-week', aiId: 'ashen-dragon', bossName: 'Ashen Dragon', hpMax: 100_000, hpRemaining: 100_000,
                    scaleFactor: 1, damageByPlayer: {}, attemptsByPlayer: {}, startedAt: now - 60_000, expiresAt: now + 60 * 60_000,
                });
                const out = await call('../weekly-boss.js', name, { kind: 'startFight', weekKey: 'held-routes-week' });
                assert.equal(out.status, 200, JSON.stringify(out.body));
                return Number(out.body.session.player.hp);
            },
        },
        {
            route: 'Endless wave',
            async start(name) {
                const runToken = 'heldroutesrun12345';
                const record = await kv.get<Json>(`save:${name}`);
                await kv.set(`save:${name}`, { ...record, character: { ...record?.character, endlessTowerRun: { runToken, wave: 1, bankedRyo: 0, bankedXp: 0, startedAt: Date.now(), highestMilestoneClaimed: 0 } } });
                const out = await call('../endless/wave-start.js', name, { playerName: name, runToken });
                assert.equal(out.status, 200, JSON.stringify(out.body));
                return Number(out.body.session.player.hp);
            },
        },
        {
            route: 'Hollow Gate dive fight',
            async start(name) {
                const { hollowGateRunKey } = await import('../hollow-gate/_run-token.js');
                const { validateHollowGateFloorManifest } = await import('../hollow-gate/_floor-manifest.js');
                const token = 'heldroutesgate01';
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
                const out = await call('../hollow-gate/combat-start.js', name, { playerName: name, token, floor: 1, kind: 'battle', nodeId: `floor:1:tile:${1 * width + 5}`, mode: 'pve' });
                assert.equal(out.status, 200, JSON.stringify(out.body));
                return Number(out.body.session.player.hp);
            },
        },
        {
            route: 'Sunscar caravan ambush',
            async start(name, now) {
                const { startCaravanCombat } = await import('../festival/_caravan-combat.js');
                const runId = await caravanAtCombat(name, now, node => `caravan-tower:held:${node}`);
                const ambush = await startCaravanCombat(name, runId) as TowerSession;
                return Number(ambush.actors.find(actor => actor.ownerSlug === name && !actor.ai)?.hp);
            },
        },
        {
            route: 'Sunscar caravan escort',
            async start(name, now) {
                const { startCaravanCombat } = await import('../festival/_caravan-combat.js');
                const runId = await caravanAtCombat(name, now, node => `caravan-escort-held-${node}`);
                const escort = await startCaravanCombat(name, runId) as SoloPveSession;
                return Number(escort.player.hp);
            },
        },
    ];

    for (const { route, start } of cases) {
        it(`${route}: starts on the 450 the held mission left, not the 600 it had spent`, async (t) => {
            const now = freezeClock(t);
            const name = `heldroute${cases.findIndex((entry) => entry.route === route)}`;
            await seedPlayer(name);
            await holdMission(name);
            assert.equal(await start(name, now), 450);
            assert.equal(Number((await kv.get<Json>(`save:${name}`))?.character?.hp), 450, 'the mission\'s cost is on the save');
        });
    }
});

// ─── The ratchet ──────────────────────────────────────────────────────────────
//
// A file "seals a fight from the save" when it builds a Solo-PvE encounter
// (buildSoloPveAiEncounter seeds HP from the save). The caravan ambush, the one
// Tower run re-seeded from the save, lives in a file that also seals the escort.

const SEALS_FROM_SAVE = /\bbuildSoloPveAiEncounter\(/;

/** Builders that seal for a route, and the route that settles held fights before calling them. */
const BUILDERS: Record<string, { reason: string; route?: string }> = {
    'api/solo-pve/_ai-encounter.ts': { reason: 'defines buildSoloPveAiEncounter' },
    'api/endless/_wave-session.ts': { reason: 'builds the wave api/endless/wave-start.ts seals', route: 'api/endless/wave-start.ts' },
    'api/hollow-gate/_encounter.ts': { reason: 'builds the dive fight api/hollow-gate/combat-start.ts seals', route: 'api/hollow-gate/combat-start.ts' },
};

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(absolute, out);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(absolute);
    }
    return out;
}

describe('every route that seals a fight from the save settles held fights first', () => {
    // process.cwd(), like the other api source scans: api tests also compile
    // into the CommonJS server build, where import.meta is not allowed.
    const root = process.cwd();
    const sealers = sourceFiles(join(root, 'api'))
        .filter((file) => SEALS_FROM_SAVE.test(readFileSync(file, 'utf8')))
        .map((file) => relative(root, file).replaceAll('\\', '/'));
    const settles = (file: string) => /\bsettleHeldFights\(/.test(readFileSync(join(root, file), 'utf8'));

    it('still finds the sealers (the scan matches real code)', () => {
        for (const known of [
            'api/missions/combat-start.ts', 'api/missions/ai-fight-start.ts', 'api/story/boss-start.ts', 'api/story/spar-start.ts',
            'api/weekly-boss.ts', 'api/festival/_caravan-combat.ts', 'api/village/_stronghold.ts',
        ]) {
            assert.ok(sealers.includes(known), `${known} should be detected as sealing a fight from the save`);
        }
    });

    it('each sealer settles held fights, or is a builder whose route does', () => {
        const unwired = sealers.filter((file) => {
            const builder = BUILDERS[file];
            if (builder) return builder.route ? !settles(builder.route) : false;
            return !settles(file);
        });
        assert.deepEqual(unwired, [], `These files seal a fight from the save without settling the player's held fights first. Call settleHeldFights (api/pve/_held-fights.ts) before the save is read, or list a builder in BUILDERS with the route that does:\n${unwired.join('\n')}`);
    });

    it('lists no stale builders', () => {
        const stale = Object.keys(BUILDERS).filter((file) => !sealers.includes(file));
        assert.deepEqual(stale, [], 'a listed builder no longer seals fights; drop it from BUILDERS');
    });
});
