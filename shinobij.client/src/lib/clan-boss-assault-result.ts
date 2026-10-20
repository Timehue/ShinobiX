type AssaultSession = {
    status: string;
    winner: string | null;
    round: number;
    roundCap?: number;
    phaseState: { bossId?: string };
    actors: readonly { id: string; side: string; hp: number; name: string }[];
};

/** The Clan Boss host owns settlement and the Clan Hall return callback, including
 * recovered assaults. Never relabel a generic Tower host from a floor or run id. */
export function clanBossAssaultResult(session: AssaultSession, variant?: string) {
    if (variant !== 'clan-boss') return null;
    const squad = session.actors.filter(actor => actor.side === 'squad');
    const wiped = squad.length > 0 && squad.every(actor => actor.hp <= 0);
    const victory = session.winner === 'squad';
    const cap = session.roundCap ?? 0;
    const capped = Number.isFinite(cap) && cap > 0;
    const limitReached = !victory && !wiped && capped && session.round >= cap;
    return {
        chapter: 'Clan Boss',
        title: victory ? 'Assault victory' : wiped ? 'Assault defeated' : limitReached ? 'Assault limit reached' : 'Assault ended',
        encounter: session.actors.find(actor => actor.id === session.phaseState.bossId)?.name
            ?? session.actors.find(actor => actor.side === 'enemy')?.name ?? 'Clan Boss assault',
        objective: victory ? 'Assault objective complete' : wiped ? 'Squad defeated'
            : limitReached ? 'Round limit reached; boss still standing' : 'Assault objective incomplete',
        returnLabel: 'Return to Clan Hall',
        roundsLabel: session.status === 'done' && capped ? `${Math.min(session.round, cap)} / ${cap}` : undefined,
    };
}

/** A returned 4xx body is a refusal, not confirmation that contribution banked. */
export function clanBossSettlementError(response: unknown): string | null {
    if (response && typeof response === 'object') {
        const body = response as { ok?: unknown; error?: unknown };
        if (body.ok === true && !body.error) return null;
        if (typeof body.error === 'string' && body.error) return body.error;
    }
    return 'The server did not confirm your Clan Boss contribution. Try again.';
}
