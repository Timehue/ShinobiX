import { kv } from './_storage.js';
import { safeName } from './_utils.js';
import { readVillageElders } from './village/_elders.js';
import { readVillageShadowguard } from './village/_shadowguard.js';

export type VillageOrderRole = 'Kage' | 'Shadowguard' | 'Village Elder';

/** Only current village members in current appointed or elected seats can issue orders. */
export async function villageOrderRole(
    callerName: string,
    village: string,
    state: { shadowguardAppointees?: unknown; elderAppointees?: unknown },
    kageState: { seatedKage?: string } | null,
): Promise<VillageOrderRole | null> {
    const caller = safeName(callerName);
    if (!caller) return null;
    const matches = (name: unknown) => typeof name === 'string' && safeName(name) === caller;
    const role = matches(kageState?.seatedKage) ? 'Kage'
        : (await readVillageElders(village, state)).some(matches) ? 'Village Elder'
        : (await readVillageShadowguard(village, state)).members.some(matches) ? 'Shadowguard' : null;
    if (!role) return null;
    const save = await kv.get<{ character?: { village?: string } }>(`save:${caller}`);
    return save?.character?.village?.trim().toLowerCase() === village.trim().toLowerCase() ? role : null;
}
