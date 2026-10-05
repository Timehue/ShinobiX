import { createHash, randomInt } from 'node:crypto';
import { tournamentEntryReady, type Tournament, type TournamentMatch } from '../../shared/tournaments.js';

export function shuffled<T>(values: readonly T[], pick = randomInt): T[] {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) { const j = pick(i + 1); [result[i], result[j]] = [result[j]!, result[i]!]; }
    return result;
}
export const matchSeed = (id: string) => createHash('sha256').update(id).digest().readUInt32BE(0) & 0x7fffffff;
export function addRound(event: Tournament, slots: (string | null)[], now: number) {
    event.round++;
    const endsAt = event.signupEndsAt + Math.floor((event.endsAt - event.signupEndsAt) * event.round / event.rounds);
    for (let i = 0; i < slots.length; i += 2) {
        const id = `${event.id}:${event.round}:${i / 2}`;
        const a = slots[i] ?? null, b = slots[i + 1] ?? null;
        const match: TournamentMatch = {
            id, round: event.round, a, b, ready: [], endsAt,
            readyEndsAt: Math.min(now + event.readySeconds * 1000, endsAt),
            battleId: `tpvp-${createHash('sha256').update(id).digest('hex').slice(0, 32)}`,
            status: a && b ? 'waiting' : 'done', winner: a && b ? null : a ?? b,
            ...(!a || !b ? { reason: a || b ? 'Bye' : 'No advancing entrant' } : {}),
        };
        event.matches.push(match);
    }
}
export function openBracket(event: Tournament, now: number, pick = randomInt) {
    if (event.status !== 'signup' || now < event.signupEndsAt) return;
    const entrants = shuffled(event.entries.filter(e => tournamentEntryReady(e, event.mode)).map(e => e.id), pick);
    if (entrants.length < 2) {
        event.status = 'cancelled'; event.message = 'Not enough confirmed entrants at signup close.'; return;
    }
    event.rounds = Math.ceil(Math.log2(entrants.length));
    event.status = 'live';
    // Distribute byes across different matches so no empty branch earns a second bye.
    const byes = 2 ** event.rounds - entrants.length;
    const slots: (string | null)[] = [];
    for (let i = 0; i < byes; i++) slots.push(entrants.shift()!, null);
    slots.push(...entrants);
    addRound(event, slots, event.signupEndsAt);
}
export function advanceBracket(event: Tournament, now: number) {
    const round = event.matches.filter(m => m.round === event.round);
    if (event.status !== 'live' || !round.length || round.some(m => m.status !== 'done')) return false;
    if (round.length === 1) {
        event.status = 'complete'; event.champion = round[0]!.winner;
        event.message = event.champion ? 'Champion crowned.' : 'Tournament ended without a champion.';
    } else addRound(event, round.map(m => m.winner), now);
    return true;
}
export function resolveNoShow(event: Tournament, match: TournamentMatch) {
    const ready = (id: string | null) => !!id && event.entries.find(e => e.id === id)!.members.every(m => match.ready.includes(m.id));
    const a = ready(match.a), b = ready(match.b);
    match.winner = a !== b ? a ? match.a : match.b : null;
    match.status = 'done'; match.reason = a !== b ? 'Opponent did not ready' : 'Both sides absent';
}
