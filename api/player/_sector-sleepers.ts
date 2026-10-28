import { kv } from '../_storage.js';
import { readKvProjection } from '../_storage-projection.js';
import { onlineStore } from '../_realtime/online-store.js';
import { listSleeperCamps } from '../_realtime/sleeper-camps.js';
import { cachedFor, invalidateProcCache } from '../_proc-cache.js';

const profileMembership = new Map<number, string>();

/** Sector discovery must not wait for the cached all-player directory. Read
 * only public display fields of camps here; the KO handler rechecks authority. */
async function readSectorSleepers(sector: number) {
    const camps = [...(await listSleeperCamps()).values()]
        .filter(camp => camp.sector === sector && !onlineStore.get(camp.name))
        .sort((a, b) => a.name.localeCompare(b.name));
    if (!camps.length) return [];
    // Public display fields can be shared across polls. Membership cannot: a
    // new camp (including a fresh camp from the same account) invalidates this
    // bounded per-sector profile cache, and removals are checked again below.
    const profileKey = `player:sector-sleeper-profiles:${sector}`;
    const membership = JSON.stringify(camps.map(camp => [camp.name, camp.createdAt]));
    if (profileMembership.get(sector) !== membership) {
        invalidateProcCache(profileKey);
        profileMembership.set(sector, membership);
    }
    const saves = await cachedFor(profileKey, 5_000, () => readKvProjection(kv, camps.map(camp => `save:${camp.name}`), {
        name: ['character', 'name'], level: ['character', 'level'],
        village: ['character', 'village'], specialty: ['character', 'specialty'],
        hospitalized: ['character', 'hospitalized'],
    }));
    // A reconnect, KO, or relocation during the projection read wins over the
    // first camp snapshot. No process/HTTP cache freezes membership for a minute.
    const current = await listSleeperCamps();
    return camps.flatMap((camp, i) => {
        const save = saves[i], latest = current.get(camp.name);
        if (!save || save.hospitalized === true || onlineStore.get(camp.name)
            || latest?.sector !== sector || latest.createdAt !== camp.createdAt) return [];
        const name = String(save.name || camp.displayName);
        const level = Number(save.level) || 1;
        const village = String(save.village || '');
        const specialty = String(save.specialty || '');
        return [{ name, level, village, specialty, currentSector: sector,
            lastSeenAt: camp.createdAt, sleeping: true,
            character: { name, level, village, specialty, avatarImage: '' } }];
    });
}

export function sectorSleepers(sector: number) {
    // Share concurrent reads in a crowd, without caching completed membership.
    return cachedFor(`player:sector-sleepers:${sector}`, 0, () => readSectorSleepers(sector));
}
