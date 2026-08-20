// Tests for the server half of the lockstep pet duel
// (docs/pet-coliseum-player-control-plan.md §10).
//
// These rules are the anti-cheat and anti-desync surface: ownership, the
// watermark, and the accept-or-reject-never-restamp contract. Each one, if wrong,
// either lets a player command their opponent's pet or silently desynchronises
// the two clients.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    makeSession, putSession, getSession, sessionForPlayer, endSession, sweepSessions,
    acceptInput, reportProgress, safeTick, sweepStalled, startIfReady, inviteExpired,
    syncPayload, sideOf, sideOwnsActor, _resetSessions,
    DUEL_INPUT_DELAY_TICKS, DUEL_STALL_MS, DUEL_INVITE_TTL_MS,
} from './pet-duel-session.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The client's scheduling constant, READ AS TEXT rather than imported: the
 *  server build must not reach into `shinobij.client/src` (different module
 *  system, and it would drag the client graph into the API compile). Parsing the
 *  literal still catches drift, which is the only thing that matters here.
 *  Resolved from the repo root — this suite always runs from there. */
function clientInputDelayTicks(): number {
    const src = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'pet-duel-lockstep.ts'), 'utf8');
    const m = /export const INPUT_DELAY_TICKS\s*=\s*(\d+)\s*;/.exec(src);
    assert.ok(m, 'could not find INPUT_DELAY_TICKS in pet-duel-lockstep.ts — did it get renamed?');
    return Number(m![1]);
}

const NOW = 1_000_000;
const fresh = (now = NOW) => {
    const s = makeSession({ id: 'd1', mode: '1v1', seed: 12345, challenger: 'Ayame', opponent: 'Kenji', now });
    putSession(s);
    s.p1.ready = true; s.p2.ready = true;
    startIfReady(s, now);
    return s;
};

beforeEach(() => _resetSessions());

test('the server delay never exceeds the client delay', () => {
    // If the server declared MORE settled than the client guarantees, it would
    // mark a tick final that a client is still allowed to schedule into.
    const client = clientInputDelayTicks();
    assert.ok(DUEL_INPUT_DELAY_TICKS <= client,
        `server ${DUEL_INPUT_DELAY_TICKS} must be <= client ${client}`);
});

test('a player can only command their own side', () => {
    assert.equal(sideOwnsActor('p1', 'player-0'), true);
    assert.equal(sideOwnsActor('p1', 'enemy-0'), false);
    assert.equal(sideOwnsActor('p2', 'enemy-1'), true);
    assert.equal(sideOwnsActor('p2', 'player-1'), false);

    const s = fresh();
    reportProgress(s, 'p1', 100, NOW);
    reportProgress(s, 'p2', 100, NOW);
    const stolen = acceptInput(s, 'Ayame', 200, { kind: 'ability', actorId: 'enemy-0', idx: 1 }, NOW);
    assert.deepEqual(stolen, { ok: false, reason: 'not-your-pet' }, 'commanding the pet you are FIGHTING must be refused');
    const own = acceptInput(s, 'Ayame', 200, { kind: 'ability', actorId: 'player-0', idx: 1 }, NOW);
    assert.equal(own.ok, true);
});

test('the watermark is the slower player, and blocks everything until both report', () => {
    const s = fresh();
    assert.equal(safeTick(s), -1 + DUEL_INPUT_DELAY_TICKS, 'nobody has reported yet');
    reportProgress(s, 'p1', 300, NOW);
    assert.equal(safeTick(s), -1 + DUEL_INPUT_DELAY_TICKS, 'one fast player must not advance it alone');
    reportProgress(s, 'p2', 40, NOW);
    assert.equal(safeTick(s), 40 + DUEL_INPUT_DELAY_TICKS, 'the SLOWER player sets the watermark');
});

test('progress only moves forward', () => {
    const s = fresh();
    reportProgress(s, 'p1', 90, NOW);
    reportProgress(s, 'p1', 20, NOW);
    assert.equal(s.p1.progress, 90, 'a stale or reordered report must not rewind progress');
});

test('a command at or below the watermark is refused', () => {
    const s = fresh();
    reportProgress(s, 'p1', 100, NOW);
    reportProgress(s, 'p2', 100, NOW);
    const at = safeTick(s);
    assert.equal(acceptInput(s, 'Ayame', at, { kind: 'ability', actorId: 'player-0', idx: 0 }, NOW).ok, false,
        'landing exactly ON the watermark is the desync case');
    assert.equal(acceptInput(s, 'Ayame', at - 5, { kind: 'ability', actorId: 'player-0', idx: 0 }, NOW).ok, false);
    assert.equal(acceptInput(s, 'Ayame', at + 1, { kind: 'ability', actorId: 'player-0', idx: 0 }, NOW).ok, true);
});

test('an accepted tick is never restamped, and seq is the global accept order', () => {
    const s = fresh();
    reportProgress(s, 'p1', 50, NOW);
    reportProgress(s, 'p2', 50, NOW);
    const a = acceptInput(s, 'Ayame', 400, { kind: 'ability', actorId: 'player-0', idx: 1 }, NOW);
    const b = acceptInput(s, 'Kenji', 400, { kind: 'ability', actorId: 'enemy-0', idx: 2 }, NOW);
    assert.ok(a.ok && b.ok);
    assert.equal(a.input.tick, 400, 'the proposer already applied this locally at 400');
    assert.equal(b.input.tick, 400);
    assert.equal(a.input.seq, 0);
    assert.equal(b.input.seq, 1, 'same tick, so seq is what makes both clients order them identically');
});

test('a malformed or unknown command is refused', () => {
    const s = fresh();
    reportProgress(s, 'p1', 10, NOW); reportProgress(s, 'p2', 10, NOW);
    const bad = (cmd: unknown) => acceptInput(s, 'Ayame', 500, cmd as never, NOW);
    assert.equal(bad(null).ok, false);
    assert.equal(bad({ kind: 'explode', actorId: 'player-0' }).ok, false);
    assert.equal(bad({ kind: 'ability' }).ok, false, 'a missing actorId cannot be owned by anyone');
    // A clash read is one of exactly three calls. A malformed pick would be relayed
    // to the peer and refused there, silently costing that player their read.
    assert.equal(bad({ kind: 'clash', actorId: 'player-0', pick: 3 }).ok, false);
    assert.equal(bad({ kind: 'clash', actorId: 'player-0' }).ok, false);
});

test('a clash read is relayed like any other command', () => {
    const s = fresh();
    reportProgress(s, 'p1', 10, NOW); reportProgress(s, 'p2', 10, NOW);
    for (const pick of [0, 1, 2]) {
        assert.equal(acceptInput(s, 'Ayame', 500 + pick, { kind: 'clash', actorId: 'player-0', pick }, NOW).ok, true,
            `pick ${pick} should be accepted`);
    }
    assert.equal(acceptInput(s, 'Ayame', 520, { kind: 'clash', actorId: 'enemy-0', pick: 1 }, NOW).ok, false,
        'a player cannot call the clash for their opponent');
});

test('a non-participant cannot inject commands', () => {
    const s = fresh();
    reportProgress(s, 'p1', 10, NOW); reportProgress(s, 'p2', 10, NOW);
    assert.deepEqual(acceptInput(s, 'Rill', 500, { kind: 'ability', actorId: 'player-0', idx: 0 }, NOW),
        { ok: false, reason: 'not-a-player' });
    assert.equal(sideOf(s, 'Rill'), null);
});

test('commands are refused before the fight starts and after it ends', () => {
    const s = makeSession({ id: 'd2', mode: '1v1', seed: 7, challenger: 'Ayame', opponent: 'Kenji', now: NOW });
    putSession(s);
    assert.equal(acceptInput(s, 'Ayame', 500, { kind: 'ability', actorId: 'player-0', idx: 0 }, NOW).ok, false);
    s.p1.ready = true; s.p2.ready = true;
    assert.equal(startIfReady(s, NOW), true);
    assert.equal(acceptInput(s, 'Ayame', 500, { kind: 'ability', actorId: 'player-0', idx: 0 }, NOW).ok, true);
    s.status = 'finished';
    assert.equal(acceptInput(s, 'Ayame', 600, { kind: 'ability', actorId: 'player-0', idx: 0 }, NOW).ok, false);
});

test('a dropped player stops gating the watermark so the survivor can finish', () => {
    const s = fresh();
    reportProgress(s, 'p1', 200, NOW);
    reportProgress(s, 'p2', 40, NOW);
    assert.equal(safeTick(s), 40 + DUEL_INPUT_DELAY_TICKS);
    // p2 goes quiet while p1 keeps playing — so p1 must still be beating when the
    // sweep runs, or this would be the both-sides-gone case instead.
    const later = NOW + DUEL_STALL_MS + 1;
    reportProgress(s, 'p1', 260, later);
    const dropped = sweepStalled(s, later);
    assert.deepEqual(dropped, ['p2'], 'only the silent side is dropped');
    assert.equal(s.p2.dropped, true);
    assert.equal(safeTick(s), 260 + DUEL_INPUT_DELAY_TICKS, 'the remaining player alone now sets it');
    assert.equal(s.status, 'running', 'the fight plays on rather than hanging');
});

test('a reconnecting player rejoins instead of staying dropped', () => {
    const s = fresh();
    reportProgress(s, 'p1', 10, NOW);
    reportProgress(s, 'p2', 10, NOW);
    sweepStalled(s, NOW + DUEL_STALL_MS + 1);
    assert.equal(s.p2.dropped, true);
    reportProgress(s, 'p2', 12, NOW + DUEL_STALL_MS + 2);
    assert.equal(s.p2.dropped, false, 'a client that comes back must gate the watermark again');
});

test('both players going silent abandons the session', () => {
    const s = fresh();
    reportProgress(s, 'p1', 10, NOW);
    reportProgress(s, 'p2', 10, NOW);
    sweepStalled(s, NOW + DUEL_STALL_MS + 1);
    assert.equal(s.status, 'abandoned');
});

test('an unaccepted invite lapses', () => {
    const s = makeSession({ id: 'd3', mode: '1v1', seed: 1, challenger: 'Ayame', opponent: 'Kenji', now: NOW });
    assert.equal(inviteExpired(s, NOW + 1), false);
    assert.equal(inviteExpired(s, NOW + DUEL_INVITE_TTL_MS), true);
    s.p1.ready = true; s.p2.ready = true; startIfReady(s, NOW);
    assert.equal(inviteExpired(s, NOW + DUEL_INVITE_TTL_MS), false, 'a started fight is not an invite');
});

test('the registry indexes a session by both players and releases them on end', () => {
    const s = fresh();
    assert.equal(sessionForPlayer('Ayame')?.id, 'd1');
    assert.equal(sessionForPlayer('Kenji')?.id, 'd1');
    endSession('d1', 'finished');
    assert.equal(getSession('d1'), null);
    assert.equal(sessionForPlayer('Ayame'), null, 'so a finished duel does not block the next one');
    assert.equal(sessionForPlayer('Kenji'), null);
});

test('the sweep clears lapsed invites and dead fights', () => {
    const invite = makeSession({ id: 'inv', mode: '1v1', seed: 1, challenger: 'A', opponent: 'B', now: NOW });
    putSession(invite);
    const dead = makeSession({ id: 'dead', mode: '1v1', seed: 2, challenger: 'C', opponent: 'D', now: NOW });
    putSession(dead);
    dead.p1.ready = true; dead.p2.ready = true; startIfReady(dead, NOW);
    sweepSessions(NOW + Math.max(DUEL_INVITE_TTL_MS, DUEL_STALL_MS) + 1);
    assert.equal(getSession('inv'), null, 'the invite lapsed');
    assert.equal(getSession('dead'), null, 'both sides went silent');
});

test('the sweep reports a lapsed invite so the challenger can be told', () => {
    // Without the callback the invite expires SILENTLY: the challenger's
    // "waiting to accept" panel never clears and they stay duel-busy forever.
    const invite = makeSession({ id: 'inv', mode: '1v1', seed: 1, challenger: 'A', opponent: 'B', now: NOW });
    putSession(invite);
    const running = fresh();
    // Keep the running fight's players fresh, or the same sweep stall-drops them.
    reportProgress(running, 'p1', 10, NOW + DUEL_INVITE_TTL_MS);
    reportProgress(running, 'p2', 10, NOW + DUEL_INVITE_TTL_MS);
    const expired: string[] = [];
    sweepSessions(NOW + DUEL_INVITE_TTL_MS + 1, undefined, (s) => expired.push(s.id));
    assert.deepEqual(expired, ['inv'], 'only the lapsed invite is reported — never a running fight');
    assert.equal(getSession('inv'), null, 'the invite is still cleared');
    assert.equal(getSession(running.id)?.status, 'running');

    // A callback that throws must not break the sweep or leak the session.
    const invite2 = makeSession({ id: 'inv2', mode: '1v1', seed: 1, challenger: 'A', opponent: 'B', now: NOW });
    putSession(invite2);
    sweepSessions(NOW + DUEL_INVITE_TTL_MS + 1, undefined, () => { throw new Error('boom'); });
    assert.equal(getSession('inv2'), null);
    assert.equal(sessionForPlayer('A'), null, 'the challenger is released to duel again');
});

test('the sync payload carries the watermark and every command so far', () => {
    const s = fresh();
    reportProgress(s, 'p1', 20, NOW);
    reportProgress(s, 'p2', 20, NOW);
    acceptInput(s, 'Ayame', 300, { kind: 'ability', actorId: 'player-0', idx: 1 }, NOW);
    acceptInput(s, 'Kenji', 320, { kind: 'stance', actorId: 'enemy-0', stance: 2 }, NOW);
    const payload = syncPayload(s);
    assert.equal(payload.safeTick, 20 + DUEL_INPUT_DELAY_TICKS);
    assert.equal(payload.inputs.length, 2);
    assert.deepEqual(payload.inputs.map((i) => i.seq), [0, 1]);
    assert.ok(!('from' in payload.inputs[0]), 'the wire form carries no side field the client would ignore');
});
