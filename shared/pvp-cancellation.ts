/**
 * How long an unstarted casual duel waits for its missing fighter before the
 * server calls it off. A present fighter joins within a second of the
 * `presence:kick`; a hidden tab is reached by its next beat, at most about 66s
 * (HIDDEN_TAB_MS plus jitter). This matches OFFLINE_AFTER_MS, the point where
 * the server itself stops believing a silent client is there at all.
 */
export const PVP_JOIN_WINDOW_MS = 90_000;

/**
 * How long past the window an absence still counts as a forfeit. The waiting
 * fighter's own stream closes the duel within seconds of the deadline, so a row
 * still open after this means they left too, and a fighter who came back in the
 * meantime must not be sent to the hospital by a duel nobody was watching.
 */
export const PVP_NO_SHOW_CLAIM_MS = 60_000;

/** A create refused because of where the opponent stands: retrying cannot help. */
export const PVP_OPPONENT_UNAVAILABLE = 'pvp-opponent-unavailable';

type CancellableDuel = {
    status: string;
    winner: string | null;
    terminalReason?: string;
    rewardAuthority?: string;
    ranked?: boolean;
    rankedKind?: string;
    playerRankedAuthorityVersion?: number;
    kageDuelAuthority?: unknown;
    clanWarId?: string;
    turnStartedAt?: number;
    round: number;
    actionsThisTurn: number;
    createdAt?: number;
    joined?: { p1: boolean; p2: boolean };
    p1: { name: string };
    p2: { name: string };
    log: string[];
};

function hasUnstartedCasualDuelState(session: CancellableDuel): boolean {
    return !((session.rewardAuthority !== 'world' && session.rewardAuthority !== 'challenge')
        || session.ranked === true || session.rankedKind !== undefined
        || session.playerRankedAuthorityVersion !== undefined
        || session.kageDuelAuthority || session.clanWarId
        || session.turnStartedAt !== undefined || session.round !== 1
        || session.actionsThisTurn !== 0
        || !session.joined || (session.joined.p1 && session.joined.p2));
}

/** Keep the visible cancel action and its server authorization in agreement. */
export function canCancelUnstartedPvpDuel(session: CancellableDuel): boolean {
    return session.status === 'active' && hasUnstartedCasualDuelState(session);
}

/** When a duel that can still be cancelled stops waiting, or null if it cannot. */
export function pvpJoinDeadlineAt(session: CancellableDuel): number | null {
    if (!canCancelUnstartedPvpDuel(session)) return null;
    const createdAt = Number(session.createdAt);
    return Number.isFinite(createdAt) && createdAt > 0 ? createdAt + PVP_JOIN_WINDOW_MS : null;
}

export function pvpJoinWindowLapsed(session: CancellableDuel, now = Date.now()): boolean {
    const deadline = pvpJoinDeadlineAt(session);
    return deadline !== null && now >= deadline;
}

function absentFighterName(session: CancellableDuel): string {
    return session.joined?.p1 === true ? session.p2.name : session.p1.name;
}

/** The battle-log line for a duel the server called off, naming who never came. */
export function pvpJoinWindowLapsedLogLine(session: CancellableDuel): string {
    return `${absentFighterName(session)} did not join in time, so the duel was called off.`;
}

export function pvpNoShowLogLine(session: CancellableDuel): string {
    return `${absentFighterName(session)} did not join in time and forfeits the duel.`;
}

/**
 * The fighter who waits out a lapsed window and wins by forfeit, or null when
 * nobody can: neither side joined, or the waiting fighter left as well.
 */
export function pvpNoShowWinner(session: CancellableDuel, now = Date.now()): 'p1' | 'p2' | null {
    const deadline = pvpJoinDeadlineAt(session);
    if (deadline === null || now < deadline || now >= deadline + PVP_NO_SHOW_CLAIM_MS) return null;
    if (session.joined?.p1 === session.joined?.p2) return null;
    return session.joined?.p1 ? 'p1' : 'p2';
}

/** A duel lost by not turning up. It pays nothing: every payout needs both fighters joined. */
export function isPvpNoShowForfeit(session: CancellableDuel): boolean {
    return session.status === 'done' && session.terminalReason === 'no-show'
        && (session.winner === 'p1' || session.winner === 'p2');
}

/** Only a server-sealed, unstarted casual duel can finish without settlement. */
export function isCancelledUnstartedPvpDuel(session: CancellableDuel): boolean {
    if (session.status !== 'done' || session.winner !== 'draw' || !hasUnstartedCasualDuelState(session)) return false;
    if (session.terminalReason === 'cancelled-unjoined') return true;
    // Recover cancellations written before the explicit reason existed. Other
    // round-one draws (including timeouts) still require ordinary settlement.
    return session.terminalReason === undefined && [session.p1.name, session.p2.name]
        .some(name => session.log.at(-1) === `${name} cancelled the unstarted duel.`);
}
