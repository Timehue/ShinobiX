import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server as IOServer, Socket } from 'socket.io';
import type { Pet } from '../_pet-sim/pet-types.js';

const previousMode = process.env.NODE_ENV;
const previousMemory = process.env.SHINOBIX_QA_MEMORY_KV;
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('./online-store.js').onlineStore;
let wirePetDuel: typeof import('./pet-duel-socket.js').wirePetDuel;
let notifyPeerGone: typeof import('./pet-duel-socket.js').notifyPeerGone;
let sessions: typeof import('./pet-duel-session.js');
let engine: typeof import('../_pet-sim/pet-duel-cinematic.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('./online-store.js'));
    ({ wirePetDuel, notifyPeerGone } = await import('./pet-duel-socket.js'));
    sessions = await import('./pet-duel-session.js');
    engine = await import('../_pet-sim/pet-duel-cinematic.js');
});

after(() => {
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    if (previousMemory === undefined) delete process.env.SHINOBIX_QA_MEMORY_KV;
    else process.env.SHINOBIX_QA_MEMORY_KV = previousMemory;
});

function pet(id: string, element: string): Pet {
    return {
        id, name: id, species: id, level: 20, hp: 180, attack: 140,
        defense: 20, speed: 96, element, trait: 'Swift',
        jutsus: [{ name: 'Fang Strike', kind: 'damage', power: 104, cooldown: 1 }],
    } as unknown as Pet;
}

type Emitted = { room: string; event: string; payload: any };
let serial = 0;

async function startDuel() {
    const names = [`completion${++serial}a`, `completion${serial}b`];
    const pets = [pet(`${names[0]}-pet`, 'Fire'), pet(`${names[1]}-pet`, 'Water')];
    const log: Emitted[] = [];
    const io = {
        to: (room: string) => ({ emit: (event: string, payload: unknown) => log.push({ room, event, payload }) }),
    } as unknown as IOServer;
    const sockets = names.map((name) => {
        const handlers = new Map<string, (payload: unknown) => unknown>();
        const socket = {
            data: { name }, join: () => undefined,
            emit: (event: string, payload: unknown) => log.push({ room: name, event, payload }),
            on: (event: string, fn: (payload: unknown) => unknown) => handlers.set(event, fn),
        } as unknown as Socket;
        wirePetDuel(io, socket);
        return { call: (event: string, payload: unknown) => handlers.get(event)!(payload) };
    });
    for (let i = 0; i < names.length; i++) {
        const character = { name: names[i], pets: [pets[i]], activePetId: pets[i].id };
        await kv.set(`save:${names[i]}`, { character });
        onlineStore.upsert({ name: names[i], sector: 40, character });
    }
    await sockets[0].call('petduel:challenge', { to: names[1], mode: '1v1', pets: [{ id: pets[0].id }] });
    const session = sessions.sessionForPlayer(names[0]);
    assert.ok(session);
    await sockets[1].call('petduel:accept', { id: session.id, pets: [{ id: pets[1].id }] });
    assert.equal(session.status, 'running');
    log.length = 0;
    return { names, pets, log, sockets, session, io };
}

test('a completion hint before play cannot end a live duel or bypass the slower participant', async () => {
    const f = await startDuel();
    assert.deepEqual([f.session.p1.progress, f.session.p2.progress], [-1, -1]);
    assert.equal(f.session.inputs.length, 0);
    await f.sockets[0].call('petduel:finished', { id: f.session.id });
    assert.equal(sessions.getSession(f.session.id)?.status, 'running');
    assert.equal(f.log.some(({ event }) => event === 'petduel:over'), false);

    // A fast or fabricated progress report from one participant must not take
    // away the other's remaining command window.
    await f.sockets[0].call('petduel:progress', { id: f.session.id, tick: 6000 });
    await f.sockets[0].call('petduel:finished', { id: f.session.id });
    assert.equal(sessions.getSession(f.session.id)?.status, 'running');
    assert.equal(f.log.some(({ event }) => event === 'petduel:over'), false);
    sessions.endSession(f.session.id, 'abandoned');
});

test('completion requires the actual terminal tick and still settles a legitimately completed duel once', async () => {
    const f = await startDuel();
    const sim = engine.createLiveCinematicDuel(f.pets[0], f.pets[1], f.session.seed, 1, 1, false, true, true, null, false);
    for (const fighter of sim.fighters) fighter.controlled = true;
    let terminalTick = -1;
    for (let guard = 0; guard < 6000 && !sim.done; guard++) {
        terminalTick = sim.t;
        engine.stepCinematicDuel(sim);
    }
    assert.equal(sim.done, true);
    assert.ok(terminalTick > sessions.DUEL_INPUT_DELAY_TICKS);
    const expected = engine.finishCinematicDuel(sim).result;
    const beforeTerminal = terminalTick - sessions.DUEL_INPUT_DELAY_TICKS - 1;
    for (const socket of f.sockets) await socket.call('petduel:progress', { id: f.session.id, tick: beforeTerminal });
    await f.sockets[0].call('petduel:finished', { id: f.session.id });
    assert.equal(sessions.getSession(f.session.id)?.status, 'running', 'no KO before its actual tick');

    for (const socket of f.sockets) await socket.call('petduel:progress', { id: f.session.id, tick: beforeTerminal + 1 });
    await f.sockets[1].call('petduel:finished', { id: f.session.id });
    const results = f.log.filter(({ event }) => event === 'petduel:over');
    assert.equal(results.length, 1);
    assert.equal(results[0].payload.winner, expected === 'win' ? 'p1' : expected === 'loss' ? 'p2' : null);
    assert.equal(sessions.getSession(f.session.id), null);
    for (const name of f.names) assert.equal(sessions.sessionForPlayer(name), null);
    await f.sockets[0].call('petduel:finished', { id: f.session.id });
    assert.equal(f.log.filter(({ event }) => event === 'petduel:over').length, 1);
});

test('a survivor can complete a duel after the server hands the silent peer to standing orders', async () => {
    const f = await startDuel();
    const later = Date.now() + sessions.DUEL_STALL_MS + 1;
    sessions.reportProgress(f.session, 'p1', 0, later);
    assert.deepEqual(sessions.sweepStalled(f.session, later), ['p2']);
    assert.notEqual(f.session.p2.autonomousFrom, null);
    await f.sockets[0].call('petduel:progress', { id: f.session.id, tick: 6000 });
    await f.sockets[0].call('petduel:finished', { id: f.session.id });
    assert.equal(f.log.filter(({ event }) => event === 'petduel:over').length, 1);
    assert.equal(sessions.getSession(f.session.id), null);
});

for (const trigger of ['progress', 'drop'] as const) {
    test(`a one-shot completion hint survives a reconnect and settles once after peer ${trigger}`, async t => {
        let now = Date.now();
        t.mock.method(Date, 'now', () => now);
        const f = await startDuel();
        const id = f.session.id;
        const overEvents = () => f.log.filter(({ event }) => event === 'petduel:over');

        now += sessions.DUEL_STALL_MS + 1;
        await f.sockets[0].call('petduel:progress', { id, tick: 0 });
        assert.deepEqual(sessions.sweepStalled(f.session, now), ['p2']);
        notifyPeerGone(f.io, f.session, 'p2');
        await f.sockets[0].call('petduel:progress', { id, tick: 6000 });
        const publishedWatermark = sessions.safeTick(f.session);
        assert.equal(publishedWatermark, 6000 + sessions.DUEL_INPUT_DELAY_TICKS);

        // This is a completed simulation under an already published watermark,
        // not a client inventing a terminal result or extending its tick limit.
        const { replayLockstepPetDuel } = await import('../pet/_duel-replay.js');
        const { parseDoctrine } = await import('../_pet-sim/pet-duel-doctrine.js');
        const terminal = replayLockstepPetDuel([f.pets[0]], [f.pets[1]], {
            mode: '1v1', seed: f.session.seed, damageMult: 1, hpMult: 1,
            revive: false, applyItems: true, accuracy: true, terrain: null,
        }, [], [{ actorIds: ['enemy-0'], doctrine: parseDoctrine(null),
            from: f.session.p2.autonomousFrom! }], publishedWatermark);
        assert.ok(terminal);

        // The peer returns between local completion and the survivor's sole
        // hint. Its old progress temporarily lowers the server watermark.
        await f.sockets[1].call('petduel:progress', { id, tick: 0 });
        assert.equal(sessions.safeTick(f.session), sessions.DUEL_INPUT_DELAY_TICKS);
        await f.sockets[0].call('petduel:finished', { id });
        assert.equal(overEvents().length, 0, 'the reduced watermark cannot decide the fight');
        assert.equal(sessions.getSession(id)?.status, 'running');

        // bindDuel marks toldFinished after its first hint. Neither recovery
        // path below sends another hint, so the server must remember that one.
        if (trigger === 'progress') {
            await f.sockets[1].call('petduel:progress', { id, tick: 6000 });
        } else {
            now += sessions.DUEL_STALL_MS + 1;
            await f.sockets[0].call('petduel:progress', { id, tick: 6000 });
            assert.equal(overEvents().length, 0, 'a survivor report cannot bypass the returning peer');
            assert.deepEqual(sessions.sweepStalled(f.session, now), ['p2']);
            notifyPeerGone(f.io, f.session, 'p2');
        }

        assert.equal(overEvents().length, 1);
        assert.equal(overEvents()[0].payload.reason, 'ko');
        assert.equal(sessions.getSession(id), null);
        for (const name of f.names) assert.equal(sessions.sessionForPlayer(name), null);
        await f.sockets[0].call('petduel:progress', { id, tick: 6000 });
        await f.sockets[1].call('petduel:finished', { id });
        assert.equal(overEvents().length, 1, 'late retries cannot emit a second final result');
    });
}
