// Connection-liveness contracts for live pet duels (2026-08-20 stuck-UI audit).
//
// Two ways a client used to get stuck forever:
//   1. an unanswered challenge expired SILENTLY — the challenger was never told;
//   2. duel-room membership is per-socket, so a reconnect landed on a socket the
//      room had never seen and no further `sync` (or the final `over`) arrived.
// These tests pin the fixes: the expiry notice, the rejoin-and-catch-up on a
// fresh connection, and the `petduel:result` query for a fight the server
// settled while the asker was unreachable.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Server as IOServer, Socket } from 'socket.io';
import {
    makeSession, putSession, getSession, startIfReady, _resetSessions,
} from './pet-duel-session.js';
import { wirePetDuel, finishDuel, notifyInviteExpired } from './pet-duel-socket.js';

type Emitted = { room: string | null; event: string; payload: unknown };

function fakeIo(log: Emitted[]): IOServer {
    return {
        to: (room: string) => ({
            emit: (event: string, payload: unknown) => { log.push({ room, event, payload }); },
        }),
    } as unknown as IOServer;
}

function fakeSocket(name: string, log: Emitted[]) {
    const handlers = new Map<string, (payload: unknown) => void>();
    const joined: string[] = [];
    const socket = {
        data: { name },
        join: (room: string) => { joined.push(room); },
        emit: (event: string, payload: unknown) => { log.push({ room: null, event, payload }); },
        on: (event: string, fn: (payload: unknown) => void) => { handlers.set(event, fn); },
    } as unknown as Socket;
    return { socket, handlers, joined };
}

const NOW = 2_000_000;
const running = (id: string, p1: string, p2: string) => {
    const s = makeSession({ id, mode: '1v1', seed: 7, challenger: p1, opponent: p2, now: NOW });
    putSession(s);
    s.p1.ready = true; s.p2.ready = true;
    startIfReady(s, NOW);
    return s;
};

beforeEach(() => _resetSessions());

test('a lapsed invite tells the challenger, mirroring the explicit-decline path', () => {
    const s = makeSession({ id: 'exp1', mode: '1v1', seed: 7, challenger: 'ayame', opponent: 'kenji', now: NOW });
    putSession(s);
    const log: Emitted[] = [];
    notifyInviteExpired(fakeIo(log), s);
    assert.deepEqual(log, [{ room: 'user:ayame', event: 'petduel:declined', payload: { id: 'exp1', by: '' } }],
        'the challenger hears the same event an explicit decline sends, so the waiting panel clears either way');
});

test('a fresh socket for a player with a live session rejoins the room and is caught up', () => {
    const s = running('rejoin1', 'ayame', 'kenji');
    // A hand-over broadcast while the socket was away must be replayed too.
    s.p2.autonomousFrom = 40;
    const log: Emitted[] = [];
    const { socket, joined } = fakeSocket('ayame', log);
    wirePetDuel(fakeIo(log), socket);
    assert.ok(joined.includes('petduel:rejoin1'), 'reconnect must re-enter the duel room, or no sync can ever arrive');
    const gone = log.find((e) => e.event === 'petduel:peerGone');
    assert.equal((gone?.payload as { side?: string })?.side, 'p2', 'the missed doctrine hand-over is replayed');
    const sync = log.find((e) => e.event === 'petduel:sync');
    assert.equal((sync?.payload as { id?: string })?.id, 'rejoin1', 'the current watermark and log are pushed at once');
});

test('a socket for a player with no session joins nothing', () => {
    const log: Emitted[] = [];
    const { socket, joined } = fakeSocket('drifter', log);
    wirePetDuel(fakeIo(log), socket);
    assert.deepEqual(joined, []);
    assert.deepEqual(log, []);
});

test('petduel:result re-delivers the verdict of a fight settled while the asker was away', () => {
    const s = running('done1', 'ayame', 'kenji');
    const log: Emitted[] = [];
    finishDuel(fakeIo(log), s, 'p1', 'ko');
    assert.equal(getSession('done1'), null, 'the session itself is gone — only the remembered result remains');

    const askerLog: Emitted[] = [];
    const asker = fakeSocket('ayame', askerLog);
    wirePetDuel(fakeIo(askerLog), asker.socket);
    asker.handlers.get('petduel:result')!({ id: 'done1' });
    const over = askerLog.find((e) => e.event === 'petduel:over');
    assert.deepEqual(over?.payload, { id: 'done1', winner: 'p1', reason: 'ko' },
        'the reconnecting winner gets the win the room broadcast they missed');

    // A stranger asking about someone else's fight hears nothing.
    const nosyLog: Emitted[] = [];
    const nosy = fakeSocket('mallory', nosyLog);
    wirePetDuel(fakeIo(nosyLog), nosy.socket);
    nosy.handlers.get('petduel:result')!({ id: 'done1' });
    assert.equal(nosyLog.find((e) => e.event === 'petduel:over'), undefined);
});

test('petduel:result on a still-live session catches the asker up instead', () => {
    running('alive1', 'ayame', 'kenji');
    const log: Emitted[] = [];
    const asker = fakeSocket('kenji', log);
    wirePetDuel(fakeIo(log), asker.socket);
    log.length = 0; // discard the connect-time catch-up; the query must stand alone
    asker.handlers.get('petduel:result')!({ id: 'alive1' });
    assert.ok(log.some((e) => e.event === 'petduel:sync'), 'a running fight answers with sync, never a verdict');
    assert.equal(log.find((e) => e.event === 'petduel:over'), undefined);
});
