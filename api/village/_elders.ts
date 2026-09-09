import { elderFocusForSeats } from '../../shared/village-elders.js';
import { readElderCouncil } from './_elder-council.js';

export const elderVillageKey = (village: unknown) => `game:village-state:${String(village ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;

export async function readVillageElders(village: unknown, snapshot?: Record<string, unknown>): Promise<[string, string, string]> {
    if (!String(village ?? '').trim()) return ['', '', ''];
    return (await readElderCouncil(String(village), snapshot)).seats;
}

/** Revalidate legacy personal selections before they can grant a reward or discount. */
export async function reconcileElderFocus<T extends Record<string, unknown>>(character: T): Promise<T> {
    if (character.elderFocus == null) return character;
    const seats = await readVillageElders(character.village);
    const focus = elderFocusForSeats(character.elderFocus, seats);
    // Keep an explicit undefined so mergePreservingImages cannot resurrect the old focus.
    return focus === character.elderFocus ? character : { ...character, elderFocus: undefined };
}
