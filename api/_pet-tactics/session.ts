import { PET_TACTICS_RULESET, TACTICS_PLAN_MS, TACTICS_PLAYBACK_MS, type TacticsBuild, type TacticsOrder, type TacticsSeat, type TacticsView } from '../../shared/pet-tactics-contract.js';
import { cinematicView, createTacticsBattle, defaultOrders, opposite, petSheets, resolveTacticsRound, sealTeam, seatEvents, setLeads, TacticsError, validateOrders, type TacticsBattle } from './engine.js';
import type { ShowdownEvent } from '../../shared/pet-showdown-contract.js';

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
};
export function createTacticsSession(roomId: string, name: string, builds: TacticsBuild[], seed: number, now: number): TacticsSession {
    // Validate again at the authority boundary even if the caller checked the payload.
    sealTeam(builds, 'a');
    return { ruleset: PET_TACTICS_RULESET, roomId, revision: 0, createdAt: now, names: { a: name, b: null }, builds: { a: structuredClone(builds), b: null },
        phase: 'waiting', deadline: now + 10 * 60_000, leads: { a: null, b: null }, orders: { a: null, b: null }, accepted: { a: null, b: null },
        acknowledgements: { a: -1, b: -1 }, missed: { a: 0, b: 0 }, battle: null, seed, transcript: [] };
}
export function sessionSeat(session: TacticsSession, name: string): TacticsSeat {
    if (session.names.a === name) return 'a';
    if (session.names.b === name) return 'b';
    throw new TacticsError('This room belongs to its two participants.', 403);
}
export function joinTacticsSession(session: TacticsSession, name: string, builds: TacticsBuild[], now: number): void {
    if (session.names.a === name) throw new TacticsError('Use another player account for the second seat.');
    if (session.names.b === name) return; // Recover a response lost after admission.
    if (session.phase !== 'waiting' || session.names.b || now >= session.deadline) throw new TacticsError('This room is full or has expired.', 409);
    session.builds.b = structuredClone(builds);
    session.battle = createTacticsBattle(session.roomId, session.builds.a, builds, session.seed);
    session.names.b = name; session.phase = 'preview'; session.deadline = now + TACTICS_PLAN_MS;
}
function finish(session: TacticsSession, winner: TacticsBattle['result'], reason: string): void {
    if (session.battle) { session.battle.result = winner; session.battle.reason = reason; }
    session.phase = 'finished'; session.orders = { a: null, b: null }; session.deadline = 0;
}
function startPlanning(session: TacticsSession, now: number): void {
    session.phase = 'planning'; session.deadline = now + TACTICS_PLAN_MS; session.orders = { a: null, b: null };
}
/** Advance once under the room's distributed lock. No timer callback or process memory owns a match. */
export function advanceTacticsSession(session: TacticsSession, now: number): void {
    if (session.phase === 'finished') return;
    if (session.phase === 'waiting') {
        if (now >= session.deadline) finish(session, 'draw', 'room expired');
        return;
    }
    const battle = session.battle!;
    if (session.phase === 'preview' && (session.leads.a && session.leads.b || now >= session.deadline)) {
        for (const seat of ['a', 'b'] as const) setLeads(battle, seat, session.leads[seat] ?? [0, 1]);
        startPlanning(session, now); return;
    }
    if (session.phase === 'playback') {
        if (session.acknowledgements.a >= battle.round && session.acknowledgements.b >= battle.round || now >= session.deadline) startPlanning(session, now);
        return;
    }
    if (session.phase !== 'planning' || !(session.orders.a && session.orders.b) && now < session.deadline) return;
    for (const seat of ['a', 'b'] as const) {
        session.missed[seat] = session.orders[seat] ? 0 : session.missed[seat] + 1;
    }
    if (session.missed.a >= 3 || session.missed.b >= 3) {
        finish(session, session.missed.a >= 3 && session.missed.b >= 3 ? 'draw' : session.missed.a >= 3 ? 'b' : 'a', 'three consecutive missed rounds');
        return;
    }
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
    if (!session.battle || round !== session.battle.round || !Number.isSafeInteger(round)) throw new TacticsError('Playback acknowledgement does not match the current round.', 409);
    session.acknowledgements[seat] = Number(round);
    advanceTacticsSession(session, now);
}
export function concedeTacticsSession(session: TacticsSession, seat: TacticsSeat): void {
    if (session.phase !== 'finished') finish(session, opposite(seat), 'concession');
}
/** Public projection is an allowlist. Commands, leads, seed and RNG never cross seats. */
export function tacticsView(session: TacticsSession, seat: TacticsSeat, now: number, afterRound = -1): TacticsView {
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
        ...(session.ranked ? { ranked: { matchToken: session.ranked.matchToken, ownRating: seat === 'a' ? session.ranked.aRating : session.ranked.bRating,
            opponentRating: seat === 'a' ? session.ranked.bRating : session.ranked.aRating, settled: session.ranked.settled } } : {}),
        transcript: session.transcript.filter(t => t.round > afterRound).map(t => ({ round: t.round,
            initialState: cinematicView(t.before, seat, opponent ?? ''), state: cinematicView(t.after, seat, opponent ?? ''), events: seatEvents(t.events, seat, t.after.result), notes: [...t.notes] })),
    };
}
