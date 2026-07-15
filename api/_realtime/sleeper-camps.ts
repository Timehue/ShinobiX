import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import type { OnlinePlayer } from './types.js';
import { onlineStore } from './online-store.js';
import { settleTravelLeases } from './travel-lease.js';

export const SLEEPER_CAMPS_KEY = 'world:sleeper-camps';

export type SleeperCamp = {
    name: string;
    displayName: string;
    sector: number;
    createdAt: number;
};

function parseCamp(value: unknown): SleeperCamp | null {
    try {
        const raw = typeof value === 'string' ? JSON.parse(value) : value;
        if (!raw || typeof raw !== 'object') return null;
        const camp = raw as Partial<SleeperCamp>;
        const sector = Math.floor(Number(camp.sector));
        const name = safeName(String(camp.name ?? ''));
        if (!name || !Number.isFinite(sector) || sector < 1) return null;
        return {
            name,
            displayName: String(camp.displayName ?? camp.name ?? name),
            sector,
            createdAt: Math.max(0, Math.floor(Number(camp.createdAt ?? Date.now()))),
        };
    } catch {
        return null;
    }
}

export async function listSleeperCamps(): Promise<Map<string, SleeperCamp>> {
    const raw = await kv.hgetall<Record<string, unknown>>(SLEEPER_CAMPS_KEY) ?? {};
    const camps = new Map<string, SleeperCamp>();
    for (const [field, value] of Object.entries(raw)) {
        const camp = parseCamp(value);
        if (camp) camps.set(safeName(field), camp);
    }
    return camps;
}

export async function getSleeperCamp(name: string): Promise<SleeperCamp | null> {
    return (await listSleeperCamps()).get(safeName(name)) ?? null;
}

export async function setSleeperCamp(camp: SleeperCamp): Promise<void> {
    const name = safeName(camp.name);
    if (!name || camp.sector < 1) return;
    await kv.hset(SLEEPER_CAMPS_KEY, { [name]: { ...camp, name } });
}

export async function clearSleeperCamp(name: string): Promise<void> {
    const key = safeName(name);
    if (key) await kv.hdel(SLEEPER_CAMPS_KEY, key);
}

export function sleeperCampForPresence(player: OnlinePlayer, now: number): SleeperCamp | null {
    if (player.sector < 1 || player.inBattle || (player.travelingUntil ?? 0) > now) return null;
    return {
        name: player.name,
        displayName: player.displayName,
        sector: player.sector,
        createdAt: now,
    };
}

/**
 * Convert timed-out live records into explicit offline camp entities. Ambient
 * disconnects become attackable sleepers; travel/fight disconnects do not mint
 * a camp until their authoritative state is safe to expose.
 */
export async function materializeSleeperCamps(players: OnlinePlayer[]): Promise<void> {
    const patch: Record<string, SleeperCamp> = {};
    const now = Date.now();
    for (const player of players) {
        const camp = sleeperCampForPresence(player, now);
        if (!camp) continue;
        if (onlineStore.get(player.name)) continue;
        patch[player.name] = camp;
    }
    if (!Object.keys(patch).length) return;
    await kv.hset(SLEEPER_CAMPS_KEY, patch);
    // A stale traveler is settled to the destination by onlineStore before it
    // reaches this function. Commit that sector to the versioned save before
    // deleting the restart-recovery lease.
    await settleTravelLeases(...Object.keys(patch));
    // Close the reconnect race: a heartbeat that landed while the hash write was
    // in flight wins, and its camp is removed again immediately.
    await Promise.all(Object.keys(patch).map(async (name) => {
        if (onlineStore.get(name)) await clearSleeperCamp(name);
    }));
}
