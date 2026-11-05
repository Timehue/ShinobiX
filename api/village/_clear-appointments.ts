import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { elderVillageKey } from './_elders.js';
import { elderCouncilKey } from './_elder-council.js';
import { invalidateProcCache } from '../_proc-cache.js';

/**
 * Empty every Elder and ANBU seat `playerName` (a slug) holds in `village`:
 * the elected council term (`village:elder-council:<v>` seats) and the
 * leadership row's `elderAppointees` / `anbuAppointees`.
 *
 * Two callers. A village transfer (api/village/transfer.ts) runs it so
 * returning later does not restore an abandoned seat. Account deletion
 * (api/_delete-player-account.ts) runs it for every village, because names are
 * reusable and a seat left behind would pass to whoever registers the name next.
 *
 * Returns whether any seat was emptied. A row that names nobody is not
 * rewritten.
 */
export async function clearAppointments(village: string, playerName: string): Promise<boolean> {
    const holds = (seats: unknown) => Array.isArray(seats) && seats.some(name => safeName(String(name ?? '')) === playerName);
    const clear = (seats: unknown) => Array.isArray(seats)
        ? seats.map(name => safeName(String(name ?? '')) === playerName ? '' : name) : seats;
    let changed = false;
    await withKvLock(elderCouncilKey(village), async () => {
        const council = await kv.get<Record<string, unknown>>(elderCouncilKey(village));
        if (!council || !holds(council.seats)) return;
        await kv.set(elderCouncilKey(village), { ...council, seats: clear(council.seats) });
        changed = true;
    }, { failClosed: true });
    await withKvLock(elderVillageKey(village), async () => {
        const state = await kv.get<Record<string, unknown>>(elderVillageKey(village));
        if (!state || (!holds(state.elderAppointees) && !holds(state.anbuAppointees))) return;
        await kv.set(elderVillageKey(village), {
            ...state, elderAppointees: clear(state.elderAppointees), anbuAppointees: clear(state.anbuAppointees),
        });
        changed = true;
    }, { failClosed: true });
    invalidateProcCache('game-state:frame');
    return changed;
}
