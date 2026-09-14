import { elderFocusForSeats, elderSeatsForTerm, normalizeElderAppointees } from '../../../shared/village-elders';

const seatsByVillage = new Map<string, { seats: [string, string, string]; nextSelectionAt: unknown }>();
const key = (village: unknown) => String(village ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function resetVillageElders(): void { seatsByVillage.clear(); }

export function cacheVillageElders(village: string, seats: unknown, nextSelectionAt?: unknown): void {
    seatsByVillage.set(key(village), { seats: normalizeElderAppointees(seats), nextSelectionAt });
}

/** A legacy personal choice alone never establishes a player-held elder seat. */
export function activeElderFocus(character: { village?: unknown; elderFocus?: unknown }) {
    const council = seatsByVillage.get(key(character.village));
    return elderFocusForSeats(character.elderFocus, elderSeatsForTerm(council?.seats, council?.nextSelectionAt));
}

export function isSeatedVillageElder(character: { village: string; name: string }): boolean {
    const council = seatsByVillage.get(key(character.village));
    return elderSeatsForTerm(council?.seats, council?.nextSelectionAt).some(name => name.toLowerCase() === character.name.toLowerCase());
}
