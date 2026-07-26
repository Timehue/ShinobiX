/**
 * pet-duel-session.ts — server state for TWO-PLAYER lockstep pet duels
 * (docs/pet-coliseum-player-control-plan.md §10).
 *
 * PvP pet fights are LIVE ONLY: both players must be present, there is no async
 * path. This module owns the authoritative half of the lockstep protocol and is
 * deliberately PURE and in-memory — no sockets, no kv — so every rule below is
 * unit-testable. `socket.ts` is thin glue over it.
 *
 * What the server is authoritative for:
 *   • the SEED (a client must never choose the fight it is about to play),
 *   • the ORDER commands are applied in (`seq`), which breaks ties when both
 *     players land on the same tick,
 *   • the WATERMARK, `min(active players' progress) + INPUT_DELAY_TICKS`, below
 *     which no further command may be inserted,
 *   • OWNERSHIP — a player may only command their own pets,
 *   • and ultimately the RESULT, by replaying the merged log.
 *
 * Single-instance, like `onlineStore`: correct because Railway runs one process.
 * Multi-instance later needs the same shared-store treatment that store needs.
 */

/**
 * MUST NOT EXCEED the client's INPUT_DELAY_TICKS
 * (shinobij.client/src/lib/pet-duel-lockstep.ts). The client schedules its orders
 * at `progress + ITS delay + 1`; the server declares everything at or below
 * `progress + THIS delay` settled. If the server's value were larger it would
 * mark a tick settled that a client is still allowed to schedule into, which is
 * precisely the divergence lockstep exists to prevent. Equal is correct; smaller
 * is merely conservative. `pet-duel-session.test.ts` guards the relationship.
 */
export const DUEL_INPUT_DELAY_TICKS = 12;

/** A player silent this long is treated as dropped: their pet reverts to its own
 *  AI and the fight plays on, so the other player always gets a result rather
 *  than a match that hangs forever waiting on someone who closed their laptop. */
export const DUEL_STALL_MS = 15_000;

/** How long a challenge waits for the other player to accept before it lapses. */
export const DUEL_INVITE_TTL_MS = 30_000;

export type DuelSide = 'p1' | 'p2';
export type DuelSessionStatus = 'pending' | 'running' | 'finished' | 'abandoned';

export interface DuelCommandLike {
    kind: 'ability' | 'break' | 'stance' | 'auto' | 'clash';
    actorId: string;
    idx?: number;
    stance?: number;
    on?: boolean;
    /** Clash read: 0 strike | 1 guard | 2 dodge. */
    pick?: number;
}

export interface DuelSessionInput {
    tick: number;
    seq: number;
    cmd: DuelCommandLike;
    from: DuelSide;
}

export interface DuelSessionPlayer {
    name: string;
    progress: number;      // furthest tick this client reports having played
    lastBeatAt: number;
    dropped: boolean;
    ready: boolean;
    /** Tick from which this side's pets fight to STANDING ORDERS because their
     *  player went silent. Null while they are still playing. Server-computed and
     *  broadcast so both clients hand over at the identical tick — a disagreement
     *  here would desynchronise the fight exactly like a mis-scheduled command. */
    autonomousFrom: number | null;
}

export interface PetDuelSession {
    id: string;
    mode: '1v1' | '2v2';
    seed: number;
    status: DuelSessionStatus;
    createdAt: number;
    startedAt: number | null;
    p1: DuelSessionPlayer;
    p2: DuelSessionPlayer;
    inputs: DuelSessionInput[];
    nextSeq: number;
}

/** Fighter ids are assigned by team in the engine: the challenger's pets are the
 *  "player" team and the opponent's are the "enemy" team. Ownership is therefore
 *  a prefix test, and it is the check that stops a client commanding the pet it
 *  is fighting AGAINST. */
export function sideOwnsActor(side: DuelSide, actorId: string): boolean {
    return side === 'p1' ? actorId.startsWith('player-') : actorId.startsWith('enemy-');
}

export function makeSession(args: {
    id: string; mode: '1v1' | '2v2'; seed: number;
    challenger: string; opponent: string; now: number;
}): PetDuelSession {
    const player = (name: string): DuelSessionPlayer => ({ name, progress: -1, lastBeatAt: args.now, dropped: false, ready: false, autonomousFrom: null });
    return {
        id: args.id, mode: args.mode, seed: args.seed,
        status: 'pending', createdAt: args.now, startedAt: null,
        p1: player(args.challenger), p2: player(args.opponent),
        inputs: [], nextSeq: 0,
    };
}

export const sideOf = (s: PetDuelSession, name: string): DuelSide | null =>
    s.p1.name === name ? 'p1' : s.p2.name === name ? 'p2' : null;

const playerFor = (s: PetDuelSession, side: DuelSide) => (side === 'p1' ? s.p1 : s.p2);

/** Players still expected to contribute inputs. A dropped player is excluded so
 *  the watermark keeps advancing without them. */
function activePlayers(s: PetDuelSession): DuelSessionPlayer[] {
    return [s.p1, s.p2].filter((p) => !p.dropped);
}

/**
 * The tick below which the timeline is settled for everyone still playing.
 * Returns -1 before anyone has reported, which correctly blocks all simulation
 * until both clients have checked in at least once.
 */
export function safeTick(s: PetDuelSession): number {
    const active = activePlayers(s);
    if (active.length === 0) return -1;
    let min = Infinity;
    for (const p of active) min = Math.min(min, p.progress);
    return min + DUEL_INPUT_DELAY_TICKS;
}

/** Mark a player present at `now` and record how far they have played. Progress
 *  only ever moves forward, so a stale or reordered report cannot rewind it. */
export function reportProgress(s: PetDuelSession, side: DuelSide, tick: number, now: number): void {
    const p = playerFor(s, side);
    p.lastBeatAt = now;
    // A player who reconnects and reports again is no longer dropped. Their pets
    // stay on standing orders for the stretch they were away, though: those ticks
    // are already simulated on the peer, so un-applying them would desynchronise.
    p.dropped = false;
    if (Number.isFinite(tick) && tick > p.progress) p.progress = Math.floor(tick);
}

export type AcceptInputResult =
    | { ok: true; input: DuelSessionInput }
    | { ok: false; reason: 'not-running' | 'not-a-player' | 'not-your-pet' | 'too-late' | 'bad-command' };

/**
 * Validate and sequence one proposed command.
 *
 * The tick is ACCEPTED AS PROPOSED or rejected — never restamped. The proposing
 * client has already applied it locally at that tick, so moving it would leave
 * that client one step out of phase with its peer. A correct client only ever
 * proposes ticks past the watermark, so a restamp is never needed.
 */
export function acceptInput(
    s: PetDuelSession, name: string, tick: number, cmd: DuelCommandLike, now: number,
): AcceptInputResult {
    if (s.status !== 'running') return { ok: false, reason: 'not-running' };
    const side = sideOf(s, name);
    if (!side) return { ok: false, reason: 'not-a-player' };
    if (!cmd || typeof cmd !== 'object') return { ok: false, reason: 'bad-command' };
    if (cmd.kind !== 'ability' && cmd.kind !== 'break' && cmd.kind !== 'stance'
        && cmd.kind !== 'auto' && cmd.kind !== 'clash') {
        return { ok: false, reason: 'bad-command' };
    }
    // A clash read is one of exactly three calls. Everything else about the bind —
    // that one is open, that this fighter is in it, that they have not already
    // called — is enforced by the engine on BOTH clients identically, so it does
    // not need re-checking here; a malformed pick, however, would be relayed to the
    // peer and refused there, silently costing that player their read.
    if (cmd.kind === 'clash' && cmd.pick !== 0 && cmd.pick !== 1 && cmd.pick !== 2) {
        return { ok: false, reason: 'bad-command' };
    }
    if (typeof cmd.actorId !== 'string' || !sideOwnsActor(side, cmd.actorId)) return { ok: false, reason: 'not-your-pet' };
    if (!Number.isFinite(tick)) return { ok: false, reason: 'bad-command' };
    const at = Math.floor(tick);
    // Strictly past the watermark: a command landing ON it would be simulated by
    // whichever client had already stepped that tick and skipped by the other.
    if (at <= safeTick(s)) return { ok: false, reason: 'too-late' };
    playerFor(s, side).lastBeatAt = now;
    const input: DuelSessionInput = { tick: at, seq: s.nextSeq++, cmd, from: side };
    s.inputs.push(input);
    return { ok: true, input };
}

/** Drop anyone who has gone quiet, so the survivor's fight can finish. Returns
 *  the sides newly dropped (for a "your opponent disconnected" notice). */
export function sweepStalled(s: PetDuelSession, now: number, stallMs = DUEL_STALL_MS): DuelSide[] {
    if (s.status !== 'running') return [];
    const dropped: DuelSide[] = [];
    for (const side of ['p1', 'p2'] as const) {
        const p = playerFor(s, side);
        if (p.dropped || now - p.lastBeatAt < stallMs) continue;
        p.dropped = true;
        // The hand-over tick must be strictly beyond anything EITHER client can
        // already have simulated. Simulation is gated at min(progress) + DELAY, so
        // max(progress) + DELAY + 1 clears both heads with room to spare — and
        // being server-computed, both clients get the same number.
        p.autonomousFrom = Math.max(s.p1.progress, s.p2.progress) + DUEL_INPUT_DELAY_TICKS + 1;
        dropped.push(side);
    }
    // Both gone: nobody is left to finish or report, so the session is dead.
    if (s.p1.dropped && s.p2.dropped) s.status = 'abandoned';
    return dropped;
}

/** Both players have confirmed their rosters — mint the running fight. */
export function startIfReady(s: PetDuelSession, now: number): boolean {
    if (s.status !== 'pending' || !s.p1.ready || !s.p2.ready) return false;
    s.status = 'running';
    s.startedAt = now;
    s.p1.lastBeatAt = now;
    s.p2.lastBeatAt = now;
    return true;
}

/** An unaccepted challenge lapses rather than lingering as a phantom invite. */
export function inviteExpired(s: PetDuelSession, now: number, ttlMs = DUEL_INVITE_TTL_MS): boolean {
    return s.status === 'pending' && now - s.createdAt >= ttlMs;
}

/** What a client needs to advance: the watermark plus every sequenced command.
 *  Both are cumulative, so a dropped update costs nothing but a round trip. */
export function syncPayload(s: PetDuelSession): { safeTick: number; inputs: Array<{ tick: number; seq: number; cmd: DuelCommandLike }> } {
    return {
        safeTick: safeTick(s),
        inputs: s.inputs.map((i) => ({ tick: i.tick, seq: i.seq, cmd: i.cmd })),
    };
}

// ── The in-memory registry ─────────────────────────────────────────────────────
const sessions = new Map<string, PetDuelSession>();
/** One live duel per player: starting a second would let someone farm two fights
 *  with one pet, and there is no UI for being in two at once anyway. */
const byPlayer = new Map<string, string>();

export function putSession(s: PetDuelSession): void {
    sessions.set(s.id, s);
    byPlayer.set(s.p1.name, s.id);
    byPlayer.set(s.p2.name, s.id);
}
export function getSession(id: string): PetDuelSession | null {
    return sessions.get(id) ?? null;
}
export function sessionForPlayer(name: string): PetDuelSession | null {
    const id = byPlayer.get(name);
    return id ? sessions.get(id) ?? null : null;
}
export function endSession(id: string, status: 'finished' | 'abandoned'): void {
    const s = sessions.get(id);
    if (!s) return;
    s.status = status;
    sessions.delete(id);
    if (byPlayer.get(s.p1.name) === id) byPlayer.delete(s.p1.name);
    if (byPlayer.get(s.p2.name) === id) byPlayer.delete(s.p2.name);
}
/** Expire lapsed invites and abandoned fights. Called from the 1 s game loop.
 *  `onDrop` fires for a session where someone went silent but the fight lives on,
 *  so the transport can tell the survivor and push the unblocked watermark. */
export function sweepSessions(
    now: number,
    onDrop?: (session: PetDuelSession, dropped: DuelSide[]) => void,
): void {
    for (const s of [...sessions.values()]) {
        if (inviteExpired(s, now)) { endSession(s.id, 'abandoned'); continue; }
        const dropped = sweepStalled(s, now);
        if (s.status === 'abandoned') { endSession(s.id, 'abandoned'); continue; }
        if (dropped.length && onDrop) {
            try { onDrop(s, dropped); } catch { /* a listener must never break the sweep */ }
        }
    }
}
/** Test-only: drop every session so cases cannot leak into one another. */
export function _resetSessions(): void {
    sessions.clear();
    byPlayer.clear();
}
