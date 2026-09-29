export const TOURNAMENT_MODES = ['pet', '2v2', 'ranked', 'standard'] as const;
export type TournamentMode = typeof TOURNAMENT_MODES[number];
export const TOURNAMENT_LABELS: Record<TournamentMode, string> = {
    pet: 'Pet Colosseum PvP', '2v2': '2v2 PvP', ranked: 'Ranked PvP', standard: 'Standard PvP',
};
export const TOURNAMENT_WINDOW_MS = 60 * 60_000;
export type TournamentMember = { id: string; name: string; accepted: boolean };
export type TournamentEntry = { id: string; members: TournamentMember[] };
export type TournamentMatch = {
    id: string; round: number; a: string | null; b: string | null;
    ready: string[]; readyEndsAt: number; endsAt: number;
    battleId: string; status: 'waiting' | 'active' | 'done';
    winner: string | null; reason?: string;
};
export type Tournament = {
    id: string; name: string; mode: TournamentMode; notes: string;
    createdAt: number; signupEndsAt: number; endsAt: number;
    status: 'signup' | 'live' | 'complete' | 'cancelled';
    maxEntries: number; readySeconds: number; petFormat: '1v1' | '2v2';
    entries: TournamentEntry[]; matches: TournamentMatch[]; round: number; rounds: number;
    champion: string | null; message?: string; cancelRequested?: boolean;
};
export type TournamentResponse = { event: Tournament | null; serverNow: number; playerId: string };
export function tournamentEntryReady(entry: TournamentEntry, mode: TournamentMode): boolean {
    return entry.members.length === (mode === '2v2' ? 2 : 1) && entry.members.every(m => m.accepted);
}
export function tournamentRules(event: Pick<Tournament, 'mode' | 'petFormat' | 'readySeconds'>): string {
    const mode = event.mode === 'pet' ? `${event.petFormat === '2v2' ? 'Two pets' : 'One pet'} per owner; Colosseum auto-battles with capped pet stats and equipped gear.`
        : event.mode === 'standard' ? '1v1 with your own stats, gear and equipped techniques.'
            : `${event.mode === '2v2' ? 'Pre-made pairs, both players must accept. 2v2' : '1v1'} with Ranked Format stats and neutral gear.`;
    return `${mode} Loadouts lock when you sign up. No consumable spending or ladder rating changes. Random single-elimination bracket; byes advance automatically. Each round has a deadline within the one-hour window. Ready within ${event.readySeconds} seconds: a fully ready side advances over a missing side; two missing sides are eliminated. At the round deadline, remaining health percentage decides; exact ties use the original random bracket seed.`;
}
