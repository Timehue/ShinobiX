import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createTowerSession, type TowerActor, type TowerSession } from './_tower-session.js';
import { humanHasTowerAction } from './_engine.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'tower-auto-turn-test-admin';
delete process.env.SESSION_SECRET;

let handler: (req: never, res: never) => Promise<unknown>;
let store: typeof import('./_tower-store.js');
before(async () => {
    store = await import('./_tower-store.js');
    handler = (await import('./action.js')).default as unknown as typeof handler;
});

function fighter(id: string, side: TowerActor['side'], pos: number, ai: boolean): TowerActor {
    return {
        id, name: id, side, ai, ownerSlug: ai ? null : 'rill', pos,
        hp: 100_000, maxHp: 100_000, chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100, shield: 0, statuses: [], cooldowns: {},
        character: { level: 100, specialty: 'Ninjutsu', stats: {} },
    };
}

function sessionFor(runId: string, cheapItem = false, playerName = 'Rill'): TowerSession {
    const player = fighter('sq', 'squad', 34, false);
    player.name = playerName;
    player.ownerSlug = playerName.toLowerCase();
    player.character.jutsu = [{ id: 'heavy', name: 'Heavy', type: 'Ninjutsu', target: 'OPPONENT', effectPower: 1, ap: 80, range: 1, tags: [] }];
    if (cheapItem) {
        player.character.pvpItems = [{ id: 'pill', name: 'Pill', slot: 'item', apCost: 20, restoreChakra: 5 }];
        player.character.equipment = { item: 'pill' };
        player.itemCharges = { pill: 1 };
    }
    const session = createTowerSession({
        towerId: 'celestial', runId, floor: 1, seed: 1, partySize: 1, now: Date.now(),
        objectiveKind: 'defeat-all',
        map: { width: 16, height: 10, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [player, fighter('enemy', 'enemy', 35, true)],
    });
    session.turnQueue = ['sq', 'enemy'];
    session.activeIndex = 0;
    session.activeAp = 100;
    Object.assign(session, { actionVersion: 0 });
    return session;
}

async function cast(session: TowerSession, moveToken: string) {
    const output: { status: number; body?: { applied?: boolean; replayed?: boolean; session?: TowerSession } } = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (value: number) => { output.status = value; return res; },
        json: (value: typeof output.body) => { output.body = value; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { runId: session.runId, playerName: session.actors[0]?.name, type: 'jutsu', jutsuId: 'heavy', targetId: 'enemy', moveToken, expectedVersion: 0 },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return output;
}

test('Tower automatically hands off a turn after the last affordable action', async () => {
    const session = sessionFor('auto-turn-no-options');
    await store.writeSession(session);
    const first = await cast(session, 'auto-turn-token-0001');
    assert.equal(first.status, 200);
    assert.equal(first.body?.applied, true);
    assert.equal(first.body?.session?.round, 2, 'the enemy phase ran without an End Turn request');
    assert.equal(first.body?.session?.turnQueue[first.body.session.activeIndex], 'sq');
    const saved = await store.readSession(session.runId);
    assert.equal(saved?.round, 2, 'the automatic handoff was persisted');

    const replay = await cast(session, 'auto-turn-token-0001');
    assert.equal(replay.body?.replayed, true);
    assert.equal(replay.body?.session?.round, 2, 'a lost-response retry does not run another enemy turn');
});

test('Tower keeps the turn while a cheaper charged item remains usable', async () => {
    const session = sessionFor('auto-turn-cheap-item', true, 'RillTwo');
    await store.writeSession(session);
    const result = await cast(session, 'auto-turn-token-0002');
    assert.equal(result.body?.applied, true);
    assert.equal(result.body?.session?.round, 1);
    assert.equal(result.body?.session?.activeAp, 20);
    assert.equal(result.body?.session?.turnQueue[result.body.session.activeIndex], 'sq');
});

test('a free summon keeps an otherwise spent Tower turn available', () => {
    const session = sessionFor('auto-turn-free-summon');
    session.activeAp = 20;
    assert.equal(humanHasTowerAction(session, session.actors[0]!), false);
    session.pendingCompanion = {
        petId: 'pet', name: 'Pet', hp: 100, damage: 10, happiness: 100,
        loyal: true, moves: [], pveGearId: '',
    };
    assert.equal(humanHasTowerAction(session, session.actors[0]!), true);
});
