import { leadershipNameKey } from './village-anbu.js';
export const ELDER_FOCI = ['war', 'trade', 'training'] as const;
export type ElderFocus = typeof ELDER_FOCI[number];

/** Fixed seat order: Kage appointment, PvP winner, PvE winner. Blank seats are AI. */
export function normalizeElderAppointees(value: unknown): [string, string, string] {
    const raw = Array.isArray(value) ? value : [];
    const seen = new Set<string>();
    return ELDER_FOCI.map((_, index) => {
        const name = typeof raw[index] === 'string' ? raw[index].trim().slice(0, 40) : '';
        const key = leadershipNameKey(name);
        if (!name || seen.has(key)) return '';
        seen.add(key);
        return name;
    }) as [string, string, string];
}

export function elderFocusForSeats(focus: unknown, appointees: unknown): ElderFocus | undefined {
    const index = ELDER_FOCI.findIndex(key => key === focus);
    return index >= 0 && normalizeElderAppointees(appointees)[index] ? ELDER_FOCI[index] : undefined;
}

/** Browser projections expire with the term even when the next poll is offline. */
export function elderSeatsForTerm(appointees: unknown, nextSelectionAt: unknown, now = Date.now()): [string, string, string] {
    return typeof nextSelectionAt === 'number' && Number.isFinite(nextSelectionAt) && nextSelectionAt > now
        ? normalizeElderAppointees(appointees) : ['', '', ''];
}
