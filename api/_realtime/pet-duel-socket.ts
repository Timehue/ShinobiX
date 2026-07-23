/**
 * pet-duel-socket.ts — the Socket.IO protocol for LIVE two-player pet duels
 * (docs/pet-coliseum-player-control-plan.md §10).
 *
 * Thin glue: every rule lives in `pet-duel-session.ts`, which is pure and tested.
 * This file only moves messages and decides who may hear them.
 *
 * PvP pet fights are live-only — there is no async path — so a challenge to
 * someone who is not connected is refused outright rather than queued.
 *
 * Protocol, all events namespaced `petduel:`
 *
 *   client → server           server → client
 *   ───────────────────       ─────────────────────────────────────────────
 *   challenge {to,mode,pets}  invite   {id,from,mode}          (to the target)
 *   accept    {id,pets}       start    {id,seed,mode,side,…}   (to both)
 *   decline   {id}            declined {id}                    (to the challenger)
 *   input     {id,tick,cmd}   sync     {id,safeTick,inputs}    (to both)
 *   progress  {id,tick}       peerGone {id,side}               (to the survivor)
 *   resign    {id}            over     {id,winner,reason}      (to both)
 *
 * `sync` is cumulative and idempotent on the client, so a dropped frame costs a
 * round trip and nothing else — which is why there is no per-message ack.
 */
import type { Server as IOServer, Socket } from 'socket.io';
import { randomUUID, randomInt } from 'node:crypto';
import { onlineStore } from './online-store.js';
import {
    makeSession, putSession, getSession, sessionForPlayer, endSession,
    acceptInput, reportProgress, syncPayload, sideOf, startIfReady,
    type PetDuelSession, type DuelSide, type DuelCommandLike,
} from './pet-duel-session.js';
import { replayLockstepPetDuel, type LockstepAutonomy } from '../pet/_duel-replay.js';
import { parseDoctrine, type PetDoctrine } from '../_pet-sim/pet-duel-doctrine.js';
import type { Pet } from '../_pet-sim/pet-types.js';

/** Cap on inbound commands per player per fight. A legitimate player issues a
 *  handful; this only stops a scripted client flooding the session's input list,
 *  which every client must then replay. */
const MAX_INPUTS_PER_PLAYER = 400;

const duelRoom = (id: string) => `petduel:${id}`;
const userRoom = (name: string) => `user:${name}`;

/** Pets are sealed at accept time and never re-read from the client afterwards,
 *  so a mid-fight save edit cannot change the combatants. */
export interface SealedRoster { side: DuelSide; pets: unknown[] }
/** Pets AND standing orders, both sealed at accept. The doctrine is what a
 *  dropped player's pets fall back to, so it has to be fixed before the fight
 *  rather than fetched after someone disconnects. */
interface Seat { pets: unknown[] | null; doctrine: PetDoctrine }
/** Standing orders ride on the pet itself, so they are sealed with the roster and
 *  cannot disagree with it. Reading them from a separate payload field would be a
 *  second source of truth for the same thing. */
const doctrineOf = (pets: unknown[]): PetDoctrine =>
    parseDoctrine((pets[0] as { doctrine?: unknown } | undefined)?.doctrine);
const rosters = new Map<string, { p1: Seat; p2: Seat }>();

function countInputs(s: PetDuelSession, side: DuelSide): number {
    let n = 0;
    for (const i of s.inputs) if (i.from === side) n++;
    return n;
}

/** Broadcast the authoritative watermark + command list to both players. */
function pushSync(io: IOServer, s: PetDuelSession): void {
    io.to(duelRoom(s.id)).emit('petduel:sync', { id: s.id, ...syncPayload(s) });
}

/** Tear a session down and tell whoever is still listening. */
export function finishDuel(io: IOServer, s: PetDuelSession, winner: DuelSide | null, reason: 'ko' | 'resign' | 'abandoned'): void {
    io.to(duelRoom(s.id)).emit('petduel:over', { id: s.id, winner, reason });
    rosters.delete(s.id);
    endSession(s.id, reason === 'abandoned' ? 'abandoned' : 'finished');
}

/** Fighter ids belonging to a side, for the mode this session is running. */
const actorIdsFor = (s: PetDuelSession, side: DuelSide): string[] => {
    const prefix = side === 'p1' ? 'player' : 'enemy';
    return s.mode === '2v2' ? [`${prefix}-0`, `${prefix}-1`] : [`${prefix}-0`];
};

/** The sides currently on standing orders, in the shape the replay wants. */
function autonomyOf(s: PetDuelSession): LockstepAutonomy[] {
    const seat = rosters.get(s.id);
    if (!seat) return [];
    const out: LockstepAutonomy[] = [];
    for (const side of ['p1', 'p2'] as const) {
        const from = (side === 'p1' ? s.p1 : s.p2).autonomousFrom;
        if (from == null) continue;
        out.push({ actorIds: actorIdsFor(s, side), doctrine: seat[side].doctrine, from });
    }
    return out;
}

/** Called by the game-loop sweep when a player goes silent mid-fight. */
export function notifyPeerGone(io: IOServer, s: PetDuelSession, gone: DuelSide): void {
    const seat = rosters.get(s.id);
    // The hand-over tick is SERVER-computed and sent to both clients, so they put
    // the pet on standing orders at the identical tick. Deriving it locally on
    // each side would be a desync waiting to happen.
    io.to(duelRoom(s.id)).emit('petduel:peerGone', {
        id: s.id, side: gone,
        fromTick: (gone === 'p1' ? s.p1 : s.p2).autonomousFrom,
        actorIds: actorIdsFor(s, gone),
        doctrine: seat ? seat[gone].doctrine : undefined,
    });
    // The watermark is no longer gated by the dropped player, so the survivor can
    // immediately keep simulating — push the new one rather than making them wait
    // for their next progress report.
    pushSync(io, s);
}

export function wirePetDuel(io: IOServer, socket: Socket): void {
    const name: string = socket.data.name;

    const sessionFor = (raw: unknown): PetDuelSession | null => {
        const id = typeof raw === 'string' ? raw : '';
        const s = id ? getSession(id) : null;
        return s && sideOf(s, name) ? s : null;
    };

    socket.on('petduel:challenge', (payload: unknown) => {
        const p = (payload ?? {}) as { to?: unknown; mode?: unknown; pets?: unknown };
        const to = typeof p.to === 'string' ? p.to.trim().toLowerCase() : '';
        const mode = p.mode === '2v2' ? '2v2' : '1v1';
        const pets = Array.isArray(p.pets) ? p.pets : [];
        if (!to || to === name) return socket.emit('petduel:error', { error: 'Pick an opponent.' });
        if (pets.length === 0) return socket.emit('petduel:error', { error: 'Bring at least one pet.' });
        // LIVE ONLY: no invite is queued for someone who is not connected.
        if (!onlineStore.get(to)) return socket.emit('petduel:error', { error: 'That player is not online.' });
        if (sessionForPlayer(name)) return socket.emit('petduel:error', { error: 'You are already in a duel.' });
        if (sessionForPlayer(to)) return socket.emit('petduel:error', { error: 'That player is already in a duel.' });

        const s = makeSession({
            id: randomUUID().replace(/-/g, ''),
            mode,
            // Server-minted: a client must never choose the fight it is about to play.
            seed: randomInt(1, 0x7fffffff),
            challenger: name, opponent: to, now: Date.now(),
        });
        s.p1.ready = true;
        putSession(s);
        rosters.set(s.id, {
            p1: { pets, doctrine: doctrineOf(pets) },
            p2: { pets: null, doctrine: parseDoctrine(null) },
        });
        socket.join(duelRoom(s.id));
        io.to(userRoom(to)).emit('petduel:invite', { id: s.id, from: name, mode });
    });

    socket.on('petduel:accept', (payload: unknown) => {
        const p = (payload ?? {}) as { id?: unknown; pets?: unknown };
        const s = sessionFor(p.id);
        if (!s || s.status !== 'pending') return socket.emit('petduel:error', { error: 'That challenge is no longer open.' });
        if (sideOf(s, name) !== 'p2') return;
        const pets = Array.isArray(p.pets) ? p.pets : [];
        if (pets.length === 0) return socket.emit('petduel:error', { error: 'Bring at least one pet.' });
        const seat = rosters.get(s.id);
        if (!seat) return socket.emit('petduel:error', { error: 'That challenge is no longer open.' });
        seat.p2 = { pets, doctrine: doctrineOf(pets) };
        s.p2.ready = true;
        socket.join(duelRoom(s.id));
        if (!startIfReady(s, Date.now())) return;
        // Both sides get the SAME sealed rosters and seed. `side` is the only
        // per-recipient field, and it decides which pets that client may command.
        io.to(userRoom(s.p1.name)).emit('petduel:start', {
            id: s.id, seed: s.seed, mode: s.mode, side: 'p1',
            player: seat.p1.pets, enemy: seat.p2.pets, opponent: s.p2.name,
        });
        io.to(userRoom(s.p2.name)).emit('petduel:start', {
            id: s.id, seed: s.seed, mode: s.mode, side: 'p2',
            player: seat.p1.pets, enemy: seat.p2.pets, opponent: s.p1.name,
        });
    });

    socket.on('petduel:decline', (payload: unknown) => {
        const s = sessionFor((payload as { id?: unknown })?.id);
        if (!s || s.status !== 'pending') return;
        io.to(userRoom(s.p1.name)).emit('petduel:declined', { id: s.id, by: name });
        rosters.delete(s.id);
        endSession(s.id, 'abandoned');
    });

    socket.on('petduel:input', (payload: unknown) => {
        const p = (payload ?? {}) as { id?: unknown; tick?: unknown; cmd?: unknown };
        const s = sessionFor(p.id);
        if (!s) return;
        const side = sideOf(s, name)!;
        if (countInputs(s, side) >= MAX_INPUTS_PER_PLAYER) {
            return socket.emit('petduel:error', { error: 'Too many commands in one duel.' });
        }
        const result = acceptInput(s, name, Number(p.tick), p.cmd as DuelCommandLike, Date.now());
        if (!result.ok) {
            // `too-late` is the one a correct client can hit on a bad connection:
            // its order aged past the watermark in flight. Tell it so it can say
            // "that order didn't make it" rather than silently dropping input.
            socket.emit('petduel:rejected', { id: s.id, reason: result.reason });
            return;
        }
        pushSync(io, s);
    });

    socket.on('petduel:progress', (payload: unknown) => {
        const p = (payload ?? {}) as { id?: unknown; tick?: unknown };
        const s = sessionFor(p.id);
        if (!s || s.status !== 'running') return;
        reportProgress(s, sideOf(s, name)!, Number(p.tick), Date.now());
        pushSync(io, s);
    });

    // A client believing the fight is over is only a HINT. The server replays the
    // merged log itself and declares the winner; a premature or invented
    // `finished` simply yields a replay that has not ended, and is ignored.
    socket.on('petduel:finished', (payload: unknown) => {
        const s = sessionFor((payload as { id?: unknown })?.id);
        if (!s || s.status !== 'running') return;
        const seat = rosters.get(s.id);
        if (!seat?.p1.pets || !seat.p2.pets) return;
        try {
            const replay = replayLockstepPetDuel(
                seat.p1.pets as unknown as Pet[],
                seat.p2.pets as unknown as Pet[],
                {
                    mode: s.mode, seed: s.seed,
                    // PvP carries no PvE multipliers, items are on for both, and
                    // accuracy is PINNED to match the client's
                    // CONTROLLED_DUEL_ACCURACY — the server cannot see a browser's
                    // localStorage, so an unpinned flag would desynchronise this.
                    damageMult: 1, hpMult: 1, revive: false,
                    applyItems: true, accuracy: true, terrain: null,
                },
                s.inputs.map((i) => ({ t: i.tick, cmd: i.cmd as unknown as DuelCommandLike })) as never,
                // Replaying WITHOUT this would score a fight nobody played: a
                // dropped pet fought to its owner's standing orders, and those
                // orders never crossed the wire.
                autonomyOf(s),
            );
            finishDuel(io, s, replay.winner, 'ko');
        } catch (err) {
            console.error('[petduel] replay failed', (err as Error).message);
        }
    });

    socket.on('petduel:resign', (payload: unknown) => {
        const s = sessionFor((payload as { id?: unknown })?.id);
        if (!s) return;
        const side = sideOf(s, name)!;
        finishDuel(io, s, side === 'p1' ? 'p2' : 'p1', 'resign');
    });

    // A closed tab is NOT an instant forfeit: the sweep's stall window gives a
    // refresh or a flaky connection time to come back, and if it does not, the
    // opponent's fight still finishes rather than hanging.
    socket.on('disconnect', () => {
        const s = sessionForPlayer(name);
        if (s && s.status === 'pending' && sideOf(s, name) === 'p1') {
            io.to(userRoom(s.p2.name)).emit('petduel:declined', { id: s.id, by: name });
            rosters.delete(s.id);
            endSession(s.id, 'abandoned');
        }
    });
}
