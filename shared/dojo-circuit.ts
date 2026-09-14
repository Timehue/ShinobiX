/** Circuit records are owned by the event API, never by the generic player save. */
export const CIRCUIT_DISCIPLINES = ['combat', 'cards', 'pets'] as const;
export type CircuitDiscipline = typeof CIRCUIT_DISCIPLINES[number];
export const CIRCUIT_VILLAGES = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'] as const;
export type CircuitPhase = 'offline' | 'upcoming' | 'live' | 'results' | 'unscheduled';
export type CircuitSeal = { discipline: CircuitDiscipline; earnedAt: number };
export type CircuitEntrant = { id: string; name: string; village: string; joinedAt: number; seals: CircuitSeal[] };
export type CircuitVictory = { matchId: string; startedAt: number; finishedAt: number };
export type CircuitAttempt = { discipline: CircuitDiscipline; openedAt: number; verifiedVictory?: CircuitVictory };
export type CircuitEvent = {
    id: string; name: string; startsAt: number; endsAt: number; createdAt: number;
    featured: CircuitDiscipline; entrants: CircuitEntrant[]; championId?: string; endedAt?: number;
};
export type CircuitHistory = Pick<CircuitEvent, 'id' | 'name' | 'startsAt' | 'endsAt'> & { participants: number; finishers: number; champion?: string };
export type CircuitResponse = {
    enabled: boolean; event: CircuitEvent | null; history: CircuitHistory[]; serverNow: number;
    attempt: CircuitAttempt | null; message?: string;
};
export function circuitPhase(enabled: boolean, event: CircuitEvent | null, now: number): CircuitPhase {
    if (!enabled) return 'offline';
    if (!event) return 'unscheduled';
    if (event.endedAt !== undefined || now >= event.endsAt) return 'results';
    return now < event.startsAt ? 'upcoming' : 'live';
}
export function isCircuitDiscipline(value: unknown): value is CircuitDiscipline {
    return CIRCUIT_DISCIPLINES.includes(value as CircuitDiscipline);
}
export function circuitFeatured(event: CircuitEvent, now: number): CircuitDiscipline {
    const day = Math.floor(Math.max(0, Math.min(now, (event.endedAt ?? event.endsAt) - 1) - event.startsAt) / 86400_000);
    return CIRCUIT_DISCIPLINES[(CIRCUIT_DISCIPLINES.indexOf(event.featured) + day) % CIRCUIT_DISCIPLINES.length];
}
export function circuitHistory(event: CircuitEvent): CircuitHistory {
    return { id: event.id, name: event.name, startsAt: event.startsAt, endsAt: event.endedAt ?? event.endsAt,
        participants: event.entrants.length, finishers: event.entrants.filter(e => e.seals.length === 3).length,
        champion: event.entrants.find(e => e.id === event.championId)?.name };
}
