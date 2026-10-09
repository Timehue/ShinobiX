process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'free-heal-journeys-test-secret-32-bytes';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { PvpFighter } from '../pvp/session.js';
import type { SoloPveSession } from '../solo-pve/_session.js';
import type { TowerSession } from '../towers/_tower-session.js';

/*
 * The PvE "free heal" journeys, driven through the mounted handlers over the
 * in-memory KV. Each mode below settles a fight's HP under its own receipt, and
 * /api/pve/fight-outcome writes it from the same session: a late call, after
 * the player had lost HP elsewhere, set HP back up to the fight's end value.
 * Each test fails on the code before the fix. The pure rules are pinned in
 * _free-heal-paths.test.ts.
 */

type Json = Record<string, any>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let createSoloPveSession: typeof import('../solo-pve/_session.js').createSoloPveSession;
let readSoloPveSession: typeof import('../solo-pve/_store.js').readSoloPveSession;
let writeSoloPveSession: typeof import('../solo-pve/_store.js').writeSoloPveSession;
let writeSession: typeof import('../towers/_tower-store.js').writeSession;
let makePveEngineTestSession: typeof import('../towers/_pve-engine-test-fixture.js').makePveEngineTestSession;
let pveOutcomeReceiptKey: typeof import('./_fight-outcome-settlement.js').pveOutcomeReceiptKey;
let PET_BREEDING_MIGRATION_VERSION: number;
let fightOutcome: Handler;
let ipSeed = 0;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ createSoloPveSession } = await import('../solo-pve/_session.js'));
    ({ readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js'));
    ({ writeSession } = await import('../towers/_tower-store.js'));
    ({ makePveEngineTestSession } = await import('../towers/_pve-engine-test-fixture.js'));
    ({ pveOutcomeReceiptKey } = await import('./_fight-outcome-settlement.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    fightOutcome = (await import('./fight-outcome.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function call(handler: Handler, player: string, body: Json, method: 'GET' | 'POST' = 'POST'): Promise<{ status: number; body: Json }> {
    const out = { status: 200, body: {} as Json };
    const res = {
        setHeader() { return res; },
        status(code: number) { out.status = code; return res; },
        json(value: Json) { out.body = value; return res; },
        end() { return res; },
    };
    const ip = `10.81.0.${++ipSeed}`;
    await handler({
        method, body, query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': player, 'x-player-token': issuePlayerToken(player) ?? '', 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res as never);
    return out;
}

const reportOutcome = (player: string, runId: string) => call(fightOutcome, player, { playerName: player, runId });

function fighter(name: string, hp: number, maxHp: number): PvpFighter {
    return {
        name, hp, maxHp, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], pos: 62,
        character: { name, level: 30, specialty: 'Taijutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} },
    };
}

function finished(session: SoloPveSession, over: Partial<SoloPveSession>): SoloPveSession {
    const done: SoloPveSession = { ...session, status: 'done', winner: 'enemy', outcome: 'loss', version: session.version + 1, ...over };
    return {
        ...done,
        terminalEvidence: {
            finishedAt: Date.now(), finalMoveToken: 'journey-terminal', finalVersion: done.version, finalEventSeq: done.eventSeq,
            winner: done.winner ?? 'enemy', outcome: done.outcome ?? 'loss', itemsUsed: {}, settlementState: 'pending',
        },
    };
}

async function seedSave(name: string, character: Json): Promise<void> {
    await kv.set(`save:${name}`, {
        _saveVersion: 1,
        _saveAt: Date.now(),
        character: { name, level: 30, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, inventory: [], petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION, ...character },
    });
}

async function character(name: string): Promise<Json> {
    return ((await kv.get<Json>(`save:${name}`))?.character ?? {}) as Json;
}

/** The player loses HP somewhere else after the fight was settled. */
async function woundElsewhere(name: string, hp: number): Promise<void> {
    const record = await kv.get<Json>(`save:${name}`);
    await kv.set(`save:${name}`, { ...record, _saveVersion: Number(record?._saveVersion ?? 1) + 1, character: { ...record?.character, hp } });
}

describe('free heals through /api/pve/fight-outcome', { concurrency: false }, () => {
    it('a finished Tower run cannot lift a wounded player to the full-pool HP it left', async () => {
        await seedSave('rill', { hp: 100, maxHp: 800 });
        const run = makePveEngineTestSession({ enemyLevel: 10, runId: 'journey-tower-run', playerMaxHp: 800 });
        run.actors[0] = { ...run.actors[0], ownerSlug: 'rill', hp: 600 };
        await writeSession({ ...run, status: 'done', winner: 'enemy' } as TowerSession);

        const out = await reportOutcome('rill', 'journey-tower-run');
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal((await character('rill')).hp, 100, 'the run seated rill at 800; its 600 is no heal');
    });

    it('a Hollow Gate dive fight is neither abandoned nor settled here', async () => {
        await seedSave('rill', { hp: 100, maxHp: 100 });
        const session = createSoloPveSession({
            sessionId: 'hgcombat-journey-dive', ownerSlug: 'rill', encounter: { kind: 'hollow-gate', id: 'hound' },
            player: fighter('Rill', 100, 100), enemy: fighter('Hollow Hound', 60, 100), now: Date.now(),
        });
        await writeSoloPveSession(session);

        const out = await reportOutcome('rill', session.sessionId);
        assert.equal(out.status, 409, JSON.stringify(out.body));
        assert.equal(out.body.reason, 'hollow-gate-dive');
        assert.equal((await readSoloPveSession(session.sessionId))?.status, 'active', 'the dive still owns its fight');
        assert.equal((await character('rill')).hp, 100, 'no walk-out cost and no write from here');
    });
});

describe('Endless waves settle their HP once', { concurrency: false }, () => {
    const runToken = 'freehealrun12345';
    let endless: Handler;
    before(async () => { endless = (await import('../endless/run.js')).default as unknown as Handler; });

    async function wave(name: string, waveRunId: string, over: Partial<SoloPveSession>, saveHp: number): Promise<void> {
        const { createEndlessWaveBinding, endlessWaveBindingKey } = await import('../endless/_wave-session.js');
        await seedSave(name, { hp: saveHp, maxHp: 600, endlessTowerRun: { runToken, wave: 1, bankedRyo: 0, bankedXp: 0, startedAt: Date.now(), highestMilestoneClaimed: 0 } });
        await kv.set(endlessWaveBindingKey(waveRunId), createEndlessWaveBinding({ runId: waveRunId, playerName: name, runToken, wave: 1, opponentId: 'wave-foe' }));
        const session = createSoloPveSession({
            sessionId: waveRunId, ownerSlug: name,
            encounter: { kind: 'endless-wave', id: `${runToken}:1`, sourceId: 'wave-foe', bindingId: waveRunId },
            player: fighter(name, 300, 600), enemy: fighter('Wave Foe', 0, 500), now: Date.now(),
        });
        await writeSoloPveSession(finished(session, over));
    }
    const settle = (name: string, waveRunId: string) => call(endless, name, { playerName: name, action: 'settle', runToken, waveRunId });

    it('a lost wave settled by Endless is not written again by a late generic report', async () => {
        const waveRunId = `endlesswave-${'a'.repeat(32)}`;
        await wave('endlessloss', waveRunId, {}, 600);
        const settled = await settle('endlessloss', waveRunId);
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal((await character('endlessloss')).hp, 300, 'the wave cost what it cost');

        await woundElsewhere('endlessloss', 120);
        const late = await reportOutcome('endlessloss', waveRunId);
        assert.equal(late.status, 200, JSON.stringify(late.body));
        assert.equal((await character('endlessloss')).hp, 120, 'HP is not set back up to the wave\'s 300');
    });

    it('a generic report that came first is not written again by the Endless settle', async () => {
        const waveRunId = `endlesswave-${'b'.repeat(32)}`;
        await wave('endlessfirst', waveRunId, {}, 600);
        const first = await reportOutcome('endlessfirst', waveRunId);
        assert.equal(first.status, 200, JSON.stringify(first.body));
        assert.equal((await character('endlessfirst')).hp, 300);

        await woundElsewhere('endlessfirst', 120);
        const settled = await settle('endlessfirst', waveRunId);
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal((await character('endlessfirst')).hp, 120, 'the settle does not write the wave\'s HP a second time');
        assert.equal((await character('endlessfirst')).endlessTowerRun, null, 'and still ends the run');
    });

    it('a won wave is stamped too, so a late generic report replays', async () => {
        const waveRunId = `endlesswave-${'c'.repeat(32)}`;
        await wave('endlesswin', waveRunId, { winner: 'player', outcome: 'win', player: fighter('endlesswin', 450, 600) }, 500);
        const settled = await settle('endlesswin', waveRunId);
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal((await character('endlesswin')).hp, 450);

        await woundElsewhere('endlesswin', 200);
        const late = await reportOutcome('endlesswin', waveRunId);
        assert.equal(late.status, 200, JSON.stringify(late.body));
        assert.equal((await character('endlesswin')).hp, 200);
    });
});

describe('a Weekly Boss attempt settles its HP once', { concurrency: false }, () => {
    const PLAYER = 'weeklyfreeheal';
    const WEEK_KEY = 'free-heal-week';
    const STARTED_AT = 1_900_000_000_000;
    const RUN_ID = 'weekly-free-heal-run';

    it('logFight\'s HP is not written again by a late generic report', async () => {
        const handler = (await import('../weekly-boss.js')).default as unknown as Handler;
        await kv.set('game:weekly-boss-state', {
            weekKey: WEEK_KEY, aiId: 'ashen-dragon', bossName: 'Ashen Dragon', hpMax: 100_000, hpRemaining: 100_000,
            scaleFactor: 1, damageByPlayer: {}, attemptsByPlayer: { [PLAYER]: 1 }, startedAt: STARTED_AT, expiresAt: Date.now() + 60 * 60_000,
        });
        await kv.set(`weekly-boss-run:${RUN_ID}`, {
            runId: RUN_ID, playerName: PLAYER, weekKey: WEEK_KEY, aiId: 'ashen-dragon', bossStartedAt: STARTED_AT,
            initialBossHp: 100_000, createdAt: STARTED_AT + 1, startState: 'ready',
        });
        await seedSave(PLAYER, { hp: 900, maxHp: 1000 });
        const session = createSoloPveSession({
            sessionId: RUN_ID, ownerSlug: PLAYER,
            encounter: { kind: 'weekly-boss', id: WEEK_KEY, sourceId: 'ashen-dragon', bindingId: RUN_ID, metadata: { weekKey: WEEK_KEY, bossStartedAt: STARTED_AT } },
            player: fighter(PLAYER, 400, 1000), enemy: fighter('Ashen Dragon', 90_000, 100_000), now: Date.now(),
        });
        await writeSoloPveSession(finished(session, {}));

        const logged = await call(handler, PLAYER, { kind: 'logFight', weekKey: WEEK_KEY, runId: RUN_ID });
        assert.equal(logged.status, 200, JSON.stringify(logged.body));
        assert.equal((await character(PLAYER)).hp, 400);
        assert.equal((await kv.get<Json>(pveOutcomeReceiptKey(RUN_ID)))?.playerName, PLAYER, 'the run marker names the player');

        // Prove the in-save receipt alone holds as well.
        await kv.del(pveOutcomeReceiptKey(RUN_ID));
        await woundElsewhere(PLAYER, 150);
        const late = await reportOutcome(PLAYER, RUN_ID);
        assert.equal(late.status, 200, JSON.stringify(late.body));
        assert.equal(late.body.replayed, true);
        assert.equal((await character(PLAYER)).hp, 150, 'HP is not set back up to the attempt\'s 400');
    });
});

describe('a sealed AI fight settles its HP once', { concurrency: false }, () => {
    it('report-ai-fight\'s HP is not written again by a late generic report', async () => {
        const start = (await import('../missions/ai-fight-start.js')).default as unknown as Handler;
        const report = (await import('../missions/report-ai-fight.js')).default as unknown as Handler;
        const { aiFightTokenKey } = await import('../missions/_ai-fight-token.js');
        await kv.set('save:akirafh', {
            _saveVersion: 1, currentSector: 1, savedBloodlines: [], creatorJutsus: [], acceptedMissionIds: [], missionProgress: {},
            character: {
                name: 'akirafh', village: 'Stormveil Village', level: 25, specialty: 'Ninjutsu', rankTitle: 'Genin',
                hp: 600, maxHp: 600, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300, ryo: 500,
                inventory: [], itemStacks: [], pets: [], equippedJutsuIds: ['starter-universal-flicker'],
                petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
                stats: { strength: 100, speed: 100, intelligence: 140, willpower: 120, ninjutsuOffense: 300, ninjutsuDefense: 250, taijutsuOffense: 100, taijutsuDefense: 100, bukijutsuOffense: 100, bukijutsuDefense: 100, genjutsuOffense: 100, genjutsuDefense: 100 },
            },
        });
        const started = await call(start, 'akirafh', { playerName: 'akirafh', battleKind: 'practice', opponentId: 'builtin-ai-exam-proctor', opponentLevel: 25 });
        assert.equal(started.status, 200, JSON.stringify(started.body));

        // Turn the sealed bout into a real (non-spar) defence the player lost
        // standing at 200 HP: the token and session as the server would seal one.
        const tokenKey = aiFightTokenKey('akirafh', started.body.token);
        await kv.set(tokenKey, { ...(await kv.get<Json>(tokenKey)), battleKind: 'defense' });
        const sealed = (await readSoloPveSession(started.body.sessionId))!;
        await writeSoloPveSession(finished({ ...sealed, encounter: { ...sealed.encounter, metadata: {} } }, { player: { ...sealed.player, hp: 200 } }));

        const settled = await call(report, 'akirafh', { playerName: 'akirafh', aiFightToken: started.body.token });
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal((await character('akirafh')).hp, 200);

        await woundElsewhere('akirafh', 60);
        const late = await reportOutcome('akirafh', started.body.sessionId);
        assert.equal(late.status, 200, JSON.stringify(late.body));
        assert.equal((await character('akirafh')).hp, 60, 'HP is not set back up to the fight\'s 200');
    });
});

describe('a Sunscar caravan ambush settles its HP once', { concurrency: false }, () => {
    it('the ambush finish is not written again by a late generic report', async () => {
        const { departCaravan } = await import('../festival/_caravan.js');
        const { caravanDaily } = await import('../../shared/sunscar/caravan-contracts.js');
        const { festivalDay } = await import('../festival/_rally.js');
        const { finishCaravanCombat } = await import('../festival/_caravan-combat.js');
        const player = 'caravanfh';
        const now = Date.now();
        const empty = { reputation: 0, deliveries: 0, lastEntryDay: null, current: null, chains: {}, discoveries: [], history: [] };
        const contract = caravanDaily(player, festivalDay(now), empty).contracts.find(c => c.reputationRequired <= 0)!;
        const departed = departCaravan({ name: player, level: 30, hp: 800, maxHp: 1000, pets: [] }, player, { contractId: contract.id, tools: ['water', 'repair', 'smoke'] }, now);
        const progress = departed.sunscarCaravan as { current: Json };
        const sessionId = 'caravan-tower:freeheal:node-1';
        progress.current.status = 'combat';
        progress.current.combat = { sessionId, enemy: 'raider', nodeId: 'node-1', settled: false };
        await seedSave(player, { ...departed, hp: 800, maxHp: 1000 });

        const ambush = makePveEngineTestSession({ enemyLevel: 10, runId: sessionId, playerMaxHp: 1000 });
        ambush.actors[0] = { ...ambush.actors[0], ownerSlug: player, hp: 300 };
        await writeSession({ ...ambush, status: 'done', winner: 'enemy', caravanAmbush: { runId: String(progress.current.id), playerSlug: player, nodeId: 'node-1' } } as TowerSession);

        const finishedAmbush = await finishCaravanCombat(player, String(progress.current.id));
        assert.equal(finishedAmbush.ok, true);
        assert.equal((await character(player)).hp, 300, 'the ambush was seeded from the save, so its 300 is the real cost');

        await woundElsewhere(player, 90);
        const late = await reportOutcome(player, sessionId);
        assert.equal(late.status, 200, JSON.stringify(late.body));
        assert.equal((await character(player)).hp, 90, 'HP is not set back up to the ambush\'s 300');
    });
});
