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

/** Only a server-sealed, unstarted casual duel can finish without settlement. */
export function isCancelledUnstartedPvpDuel(session: CancellableDuel): boolean {
    if (session.status !== 'done' || session.winner !== 'draw' || !hasUnstartedCasualDuelState(session)) return false;
    if (session.terminalReason === 'cancelled-unjoined') return true;
    // Recover cancellations written before the explicit reason existed. Other
    // round-one draws (including timeouts) still require ordinary settlement.
    return session.terminalReason === undefined && [session.p1.name, session.p2.name]
        .some(name => session.log.at(-1) === `${name} cancelled the unstarted duel.`);
}
