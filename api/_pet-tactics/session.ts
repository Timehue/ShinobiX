import { PET_TACTICS_RULESET, TACTICS_PLAN_MS, TACTICS_PLAYBACK_MS, type TacticsBuild, type TacticsOrder, type TacticsSeat, type TacticsView } from '../../shared/pet-tactics-contract.js';
import { cinematicView, createTacticsBattle, defaultOrders, opposite, petSheets, resolveTacticsRound, sealTeam, seatEvents, setLeads, TacticsError, validateOrders, type TacticsBattle } from './engine.js';
import type { ShowdownCommand, ShowdownEvent, ShowdownStateView } from '../../shared/pet-showdown-contract.js';
import { showdownStateView, type ShowdownPet, type ShowdownSession } from '../_pet-showdown/engine.js';
import {
    ARENA_ENGINE, arenaPreviewTeam, arenaSeatEvents, arenaSeatView, createArenaBattle, mirrorArenaView, parseArenaCommands,
    resolveArenaRound, setArenaLeads, type ArenaResult,
} from './arena-showdown.js';

export const TACTICS_SESSION_TTL_SECONDS = 24 * 60 * 60;
export const tacticsRoomKey = (id: string) => `pet:tactics:room:${id}`;
export const tacticsPlayerKey = (name: string) => `pet:tactics:player:${name}`;
export type TacticsSession = {
    ruleset: typeof PET_TACTICS_RULESET; roomId: string; revision: number; createdAt: number; names: { a: string; b: string | null };
    builds: { a: TacticsBuild[]; b: TacticsBuild[] | null }; phase: TacticsView['phase']; deadline: number;
    leads: Record<TacticsSeat, number[] | null>; orders: Record<TacticsSeat, TacticsOrder[] | null>;
    accepted: Record<TacticsSeat, { round: number; orders: TacticsOrder[] } | null>;
    acknowledgements: Record<TacticsSeat, number>; missed: Record<TacticsSeat, number>; battle: TacticsBattle | null;
    seed: number; transcript: { round: number; before: TacticsBattle; after: TacticsBattle; events: ShowdownEvent[]; notes: string[] }[];
    ranked?: { matchToken: string; pairId: string; aRating: number; bRating: number; settled: boolean };
    /** Present on every room created since 2026-10-26: the fight runs on the
     *  Coliseum engine with each player's real companions (arena-showdown.ts).
     *  Rooms without it are older Pet Tactics rooms and finish on that engine. */
    engine?: typeof ARENA_ENGINE;
    /** Each seat's team, sealed from its own save when it entered the room. */
    arenaTeams?: { a: ShowdownPet[]; b: ShowdownPet[] | null };
    arena?: ShowdownSession | null;
    commands?: Record<TacticsSeat, ShowdownCommand[] | null>;
    acceptedCommands?: Record<TacticsSeat, { round: number; commands: ShowdownCommand[] } | null>;
    /** Each round as seat A saw it (`showdownStateView`), plus seat B's own
     *  feedback; seat B's view is mirrored when projected. Views, not engine
     *  states, so a long fight stays a small record. */
    arenaTranscript?: { round: number; before: ShowdownStateView; after: ShowdownStateView; events: ShowdownEvent[]; feedbackB: string[] }[];
    arenaResult?: ArenaResult | null;
    arenaReason?: string | null;
};
const isArena = (session: TacticsSession) => session.engine === ARENA_ENGINE;
const emptySeats = <T,>(): Record<TacticsSeat, T | null> => ({ a: null, b: null });

/** The room's result for either engine: a seat, a draw, or null while it runs. */
export function roomResult(session: TacticsSession): TacticsSeat | 'draw' | null {
    return isArena(session) ? session.arenaResult ?? null : session.battle?.result ?? null;
}
function roomRound(session: TacticsSession): number {
    return isArena(session) ? session.arena?.round ?? 0 : session.battle?.round ?? 0;
}

export function createTacticsSession(roomId: string, name: string, builds: TacticsBuild[], seed: number, now: number): TacticsSession {
    // Validate again at the authority boundary even if the caller checked the payload.
    sealTeam(builds, 'a');
    return { ruleset: PET_TACTICS_RULESET, roomId, revision: 0, createdAt: now, names: { a: name, b: null }, builds: { a: structuredClone(builds), b: null },
        phase: 'waiting', deadline: now + 10 * 60_000, leads: { a: null, b: null }, orders: { a: null, b: null }, accepted: { a: null, b: null },
        acknowledgements: { a: -1, b: -1 }, missed: { a: 0, b: 0 }, battle: null, seed, transcript: [] };
}
/** A room on the Coliseum engine. `team` was sealed from the creator's save. */
export function createArenaSession(roomId: string, name: string, team: ShowdownPet[], seed: number, now: number): TacticsSession {
    return { ruleset: PET_TACTICS_RULESET, engine: ARENA_ENGINE, roomId, revision: 0, createdAt: now, names: { a: name, b: null },
        builds: { a: [], b: null }, arenaTeams: { a: structuredClone(team), b: null }, arena: null,
        phase: 'waiting', deadline: now + 10 * 60_000, leads: { a: null, b: null }, orders: { a: null, b: null }, accepted: { a: null, b: null },
        commands: emptySeats(), acceptedCommands: emptySeats(), arenaTranscript: [], arenaResult: null, arenaReason: null,
        acknowledgements: { a: -1, b: -1 }, missed: { a: 0, b: 0 }, battle: null, seed, transcript: [] };
}
export function sessionSeat(session: TacticsSession, name: string): TacticsSeat {
    if (session.names.a === name) return 'a';
    if (session.names.b === name) return 'b';
    throw new TacticsError('This room belongs to its two participants.', 403);
}
function admitSecondSeat(session: TacticsSession, name: string, now: number): boolean {
    if (session.names.a === name) throw new TacticsError('Use another player account for the second seat.');
    if (session.names.b === name) return false; // Recover a response lost after admission.
    if (session.phase !== 'waiting' || session.names.b || now >= session.deadline) throw new TacticsError('This room is full or has expired.', 409);
    return true;
}
export function joinTacticsSession(session: TacticsSession, name: string, builds: TacticsBuild[], now: number): void {
    if (isArena(session)) throw new TacticsError('This arena room fights with real companions. Update the game and join again.', 409);
    if (!admitSecondSeat(session, name, now)) return;
    session.builds.b = structuredClone(builds);
    session.battle = createTacticsBattle(session.roomId, session.builds.a, builds, session.seed);
    session.names.b = name; session.phase = 'preview'; session.deadline = now + TACTICS_PLAN_MS;
}
/** The second seat enters with its own sealed team, and the fight is built. */
export function joinArenaSession(session: TacticsSession, name: string, team: ShowdownPet[], now: number): void {
    if (!isArena(session)) throw new TacticsError('That room is from an older version of the Pet Arena. Create a new room.', 409);
    if (!admitSecondSeat(session, name, now)) return;
    session.arenaTeams!.b = structuredClone(team);
    session.arena = createArenaBattle(session.roomId, { a: session.names.a, b: name }, { a: session.arenaTeams!.a, b: team }, session.seed);
    session.names.b = name; session.phase = 'preview'; session.deadline = now + TACTICS_PLAN_MS;
}
function finish(session: TacticsSession, winner: TacticsSeat | 'draw', reason: string): void {
    if (isArena(session)) {
        session.arenaResult = winner; session.arenaReason = reason;
        if (session.arena) session.arena.finished = true;
        session.commands = emptySeats();
    } else if (session.battle) { session.battle.result = winner; session.battle.reason = reason; }
    session.phase = 'finished'; session.orders = { a: null, b: null }; session.deadline = 0;
}
function startPlanning(session: TacticsSession, now: number): void {
    session.phase = 'planning'; session.deadline = now + TACTICS_PLAN_MS; session.orders = { a: null, b: null };
    if (isArena(session)) session.commands = emptySeats();
}
const seatReady = (session: TacticsSession, seat: TacticsSeat) => isArena(session) ? !!session.commands?.[seat] : !!session.orders[seat];

/** Advance once under the room's distributed lock. No timer callback or process memory owns a match. */
export function advanceTacticsSession(session: TacticsSession, now: number): void {
    if (session.phase === 'finished') return;
    if (session.phase === 'waiting') {
        if (now >= session.deadline) finish(session, 'draw', 'room expired');
        return;
    }
    const round = roomRound(session);
    if (session.phase === 'preview' && (session.leads.a && session.leads.b || now >= session.deadline)) {
        for (const seat of ['a', 'b'] as const) {
            if (isArena(session)) setArenaLeads(session.arena!, seat, session.leads[seat] ?? [0, 1]);
            else setLeads(session.battle!, seat, session.leads[seat] ?? [0, 1]);
        }
        startPlanning(session, now); return;
    }
    if (session.phase === 'playback') {
        if (session.acknowledgements.a >= round && session.acknowledgements.b >= round || now >= session.deadline) startPlanning(session, now);
        return;
    }
    if (session.phase !== 'planning' || !(seatReady(session, 'a') && seatReady(session, 'b')) && now < session.deadline) return;
    for (const seat of ['a', 'b'] as const) {
        session.missed[seat] = seatReady(session, seat) ? 0 : session.missed[seat] + 1;
    }
    if (session.missed.a >= 3 || session.missed.b >= 3) {
        finish(session, session.missed.a >= 3 && session.missed.b >= 3 ? 'draw' : session.missed.a >= 3 ? 'b' : 'a', 'three consecutive missed rounds');
        return;
    }
    if (isArena(session)) {
        const arena = session.arena!;
        const before = showdownStateView(arena);
        // A seat with no orders fields Guard for each pet (the engine's default).
        const { events, result } = resolveArenaRound(arena, session.commands?.a ?? [], session.commands?.b ?? []);
        session.arenaTranscript!.push({ round: arena.round, before, after: showdownStateView(arena), events,
            feedbackB: [...(arena.enemyCommandFeedback ?? [])] });
        session.commands = emptySeats();
        if (result) { session.arenaResult = result; session.arenaReason = 'battle'; session.phase = 'finished'; session.deadline = 0; }
        else { session.phase = 'playback'; session.deadline = now + TACTICS_PLAYBACK_MS; }
        return;
    }
    const battle = session.battle!;
    const before = structuredClone(battle);
    const { events, notes } = resolveTacticsRound(battle, session.orders.a ?? defaultOrders(battle, 'a'), session.orders.b ?? defaultOrders(battle, 'b'));
    session.transcript.push({ round: battle.round, before, after: structuredClone(battle), events, notes });
    session.orders = { a: null, b: null };
    if (battle.result) { session.phase = 'finished'; session.deadline = 0; }
    else { session.phase = 'playback'; session.deadline = now + TACTICS_PLAYBACK_MS; }
}
export function lockTacticsLeads(session: TacticsSession, seat: TacticsSeat, value: unknown, now: number): void {
    if (session.leads[seat]) {
        if (JSON.stringify(session.leads[seat]) === JSON.stringify(value)) return;
        throw new TacticsError('Your lead selection is already locked.', 409);
    }
    if (session.phase !== 'preview' || now >= session.deadline) throw new TacticsError('Lead selection is closed.', 409);
    if (!Array.isArray(value) || value.length !== 2 || value.some(v => !Number.isSafeInteger(v) || v < 0 || v > 3) || new Set(value).size !== 2) throw new TacticsError('Choose two distinct leads.');
    session.leads[seat] = [...value];
    advanceTacticsSession(session, now);
}
export function lockTacticsOrders(session: TacticsSession, seat: TacticsSeat, expectedRound: unknown, value: unknown, now: number): void {
    if (isArena(session)) { lockArenaCommands(session, seat, expectedRound, value, now); return; }
    const previous = session.accepted[seat];
    if (previous && previous.round === expectedRound) {
        // A retry may recover the last accepted batch after resolution or after a restart.
        // Never replace an immutable lock with another command under the same round.
        if (orderFingerprint(previous.orders) === orderFingerprint(value)) return;
        throw new TacticsError('That round’s orders are already locked.', 409);
    }
    if (!session.battle || session.phase !== 'planning' || expectedRound !== session.battle.round + 1 || now >= session.deadline) throw new TacticsError('The planning round changed. Refresh your orders.', 409);
    const orders = validateOrders(session.battle, seat, value);
    session.orders[seat] = orders;
    session.accepted[seat] = { round: session.battle.round + 1, orders: structuredClone(orders) };
    advanceTacticsSession(session, now);
}
function lockArenaCommands(session: TacticsSession, seat: TacticsSeat, expectedRound: unknown, value: unknown, now: number): void {
    const previous = session.acceptedCommands?.[seat];
    if (previous && previous.round === expectedRound) {
        if (commandFingerprint(previous.commands) === commandFingerprint(value)) return;
        throw new TacticsError('That round’s orders are already locked.', 409);
    }
    const arena = session.arena;
    if (!arena || session.phase !== 'planning' || expectedRound !== arena.round + 1 || now >= session.deadline) throw new TacticsError('The planning round changed. Refresh your orders.', 409);
    const commands = parseArenaCommands(arena, seat, value);
    session.commands![seat] = commands;
    session.acceptedCommands![seat] = { round: arena.round + 1, commands: structuredClone(commands) };
    advanceTacticsSession(session, now);
}
/** A retry of the same commands matches regardless of key order, and without
 *  reading the battle (a pet may have been knocked out since the lock). */
function commandFingerprint(value: unknown): string | null {
    if (!Array.isArray(value)) return null;
    const canonical = (value as Record<string, unknown>[]).map(command => command && typeof command === 'object'
        ? [command.petId, command.kind, command.moveIndex ?? null, command.targetId ?? null, command.benchPetId ?? null, command.abilityId ?? null]
        : [null]);
    return JSON.stringify(canonical.sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
function orderFingerprint(value: unknown): string | null {
    if (!Array.isArray(value)) return null;
    const canonical: unknown[][] = [];
    for (const order of value) {
        if (!order || typeof order.actorId !== 'string') return null;
        if (order.kind === 'move') canonical.push([order.actorId, order.kind, order.moveId, order.targetSlot]);
        else if (order.kind === 'basic' || order.kind === 'signature') canonical.push([order.actorId, order.kind, order.targetSlot]);
        else if (order.kind === 'switch') canonical.push([order.actorId, order.kind, order.reserveId]);
        else if (order.kind === 'guard' || order.kind === 'rest') canonical.push([order.actorId, order.kind]);
        else return null;
    }
    return JSON.stringify(canonical.sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
export function acknowledgeTacticsRound(session: TacticsSession, seat: TacticsSeat, round: unknown, now: number): void {
    const started = isArena(session) ? !!session.arena : !!session.battle;
    if (!started || round !== roomRound(session) || !Number.isSafeInteger(round)) throw new TacticsError('Playback acknowledgement does not match the current round.', 409);
    session.acknowledgements[seat] = Number(round);
    advanceTacticsSession(session, now);
}
export function concedeTacticsSession(session: TacticsSession, seat: TacticsSeat): void {
    if (session.phase !== 'finished') finish(session, opposite(seat), 'concession');
}
/** Public projection is an allowlist. Commands, leads, seed and RNG never cross seats. */
export function tacticsView(session: TacticsSession, seat: TacticsSeat, now: number, afterRound = -1): TacticsView {
    if (isArena(session)) return arenaView(session, seat, now, afterRound);
    const opponent = session.names[opposite(seat)];
    const battle = session.battle ?? { roomId: session.roomId, round: 0, rng: 0, teams: { a: sealTeam(session.builds.a, 'a'), b: [] }, result: session.phase === 'finished' ? 'draw' : null, reason: session.phase === 'finished' ? 'room closed' : null, weather: null } as TacticsBattle;
    const preview = structuredClone(battle);
    // Leads stay private even after one participant locks them.
    if (session.phase === 'preview') for (const pet of [...preview.teams.a, ...preview.teams.b]) pet.slot = null;
    const ready = session.phase === 'preview' ? session.leads : session.orders;
    return { ruleset: session.ruleset, roomId: session.roomId, revision: session.revision, seat, opponent, phase: session.phase, round: battle.round,
        serverNow: now, deadline: session.deadline, ready: { own: !!ready[seat], opponent: !!ready[opposite(seat)] },
        ownOrders: structuredClone(session.orders[seat]), ownLeads: structuredClone(session.leads[seat]),
        own: petSheets(preview, seat), enemy: petSheets(preview, opposite(seat)), missed: { own: session.missed[seat], opponent: session.missed[opposite(seat)] },
        result: battle.result === null ? null : battle.result === 'draw' ? 'draw' : battle.result === seat ? 'win' : 'loss', reason: battle.reason,
        battle: cinematicView(preview, seat, opponent ?? 'Waiting for a challenger'),
        ...rankedView(session, seat),
        transcript: session.transcript.filter(t => t.round > afterRound).map(t => ({ round: t.round,
            initialState: cinematicView(t.before, seat, opponent ?? ''), state: cinematicView(t.after, seat, opponent ?? ''), events: seatEvents(t.events, seat, t.after.result), notes: [...t.notes] })),
    };
}
function rankedView(session: TacticsSession, seat: TacticsSeat): Pick<TacticsView, 'ranked'> {
    return session.ranked ? { ranked: { matchToken: session.ranked.matchToken, ownRating: seat === 'a' ? session.ranked.aRating : session.ranked.bRating,
        opponentRating: seat === 'a' ? session.ranked.bRating : session.ranked.aRating, settled: session.ranked.settled } } : {};
}
/** The Coliseum-engine room, from one seat. */
function arenaView(session: TacticsSession, seat: TacticsSeat, now: number, afterRound: number): TacticsView {
    const opponent = session.names[opposite(seat)];
    const result = session.arenaResult ?? null;
    const draw = result === 'draw';
    // Before the fight exists (waiting) or while leads are private (preview),
    // both teams are shown with nobody fielded.
    const base = session.arena && session.phase !== 'preview' ? session.arena : (() => {
        const teams = session.arenaTeams!;
        const shell = session.arena ? structuredClone(session.arena)
            : createArenaBattle(session.roomId, { a: session.names.a, b: session.names.b ?? '' }, { a: teams.a, b: teams.b ?? [] }, session.seed);
        shell.player = arenaPreviewTeam(teams.a);
        shell.enemy = arenaPreviewTeam(teams.b ?? []);
        return shell;
    })();
    const ready = session.phase === 'preview' ? session.leads : session.commands ?? emptySeats();
    const accepted = session.acceptedCommands?.[seat];
    return { ruleset: session.ruleset, engine: ARENA_ENGINE, roomId: session.roomId, revision: session.revision, seat, opponent, phase: session.phase,
        round: base.round, serverNow: now, deadline: session.deadline, ready: { own: !!ready[seat], opponent: !!ready[opposite(seat)] },
        ownOrders: null, ownCommands: accepted && accepted.round === base.round + 1 ? structuredClone(accepted.commands) : null,
        ownLeads: structuredClone(session.leads[seat]), own: [], enemy: [],
        missed: { own: session.missed[seat], opponent: session.missed[opposite(seat)] },
        result: result === null ? null : draw ? 'draw' : result === seat ? 'win' : 'loss', reason: session.arenaReason ?? null,
        battle: arenaSeatView(base, seat, opponent ?? 'Waiting for a challenger', draw, session.phase === 'planning' ? session.deadline : undefined),
        ...rankedView(session, seat),
        transcript: (session.arenaTranscript ?? []).filter(t => t.round > afterRound).map(t => {
            const roundDraw = draw && t.after.finished;
            return { round: t.round, initialState: mirrorArenaView(t.before, seat, opponent ?? '', false, []),
                state: mirrorArenaView(t.after, seat, opponent ?? '', roundDraw, t.feedbackB), events: arenaSeatEvents(t.events, seat, roundDraw), notes: [] };
        }),
    };
}
