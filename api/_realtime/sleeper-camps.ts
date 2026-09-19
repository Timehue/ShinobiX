import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import type { OnlinePlayer } from './types.js';
import { onlineStore } from './online-store.js';
import { getTravelLease, settleTravelLease, sleeperSectorForTravelLease } from './travel-lease.js';
import { battleAuthorityKeys, battleEvidenceFrom, resolveBattleAuthority } from './battle-authority.js';

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

/*
 * Heartbeats clear the caller's camp so a reconnected player is not left
 * attackable. kv_hdel rewrites the whole shared camps row even when the field is
 * absent, and every online player beats every 15–20s, so the beat path skips the
 * write for a player this process cleared recently. Any camp this process writes
 * forgets the name first (setSleeperCamp / materializeSleeperCamps), so only a
 * camp written by another process — a deploy overlap — can outlive a skipped
 * beat, and the periodic recheck bounds that. Until then it is inert: sleeper
 * KOs and merc raids refuse online targets (settleSleeperKoLocked) and the
 * roster ignores camps of online players. It stops being inert when its owner
 * logs off, so the sweep clears the camp of every departing player it does
 * not camp (materializeSleeperCamps): a player who logs off in town is never
 * left with a stale camp in the wild.
 */
export const BEAT_CLEAR_RECHECK_MS = 2 * 60_000;
const BEAT_CLEARED_PRUNE_AT = 10_000;
const beatCleared = new Map<string, number>();

function forgetBeatCleared(names: readonly string[]): void {
    for (const name of names) beatCleared.delete(name);
}

export async function setSleeperCamp(camp: SleeperCamp): Promise<void> {
    const name = safeName(camp.name);
    if (!name || camp.sector < 1) return;
    forgetBeatCleared([name]);
    await kv.hset(SLEEPER_CAMPS_KEY, { [name]: { ...camp, name } });
    // A beat that raced the write may have recorded a clear; drop it so the
    // next beat removes the camp again.
    forgetBeatCleared([name]);
}

async function clearSleeperCampAt(key: string, now: number): Promise<void> {
    await kv.hdel(SLEEPER_CAMPS_KEY, key);
    if (beatCleared.size >= BEAT_CLEARED_PRUNE_AT) {
        for (const [entry, at] of beatCleared) if (now - at >= BEAT_CLEAR_RECHECK_MS) beatCleared.delete(entry);
    }
    beatCleared.set(key, now);
}

// Single-argument on purpose: callers pass it straight to Array#map.
export async function clearSleeperCamp(name: string): Promise<void> {
    const key = safeName(name);
    if (key) await clearSleeperCampAt(key, Date.now());
}

/** Heartbeat path: skip the shared-row rewrite when this player was cleared recently. */
export async function clearSleeperCampOnBeat(name: string, now = Date.now()): Promise<void> {
    const key = safeName(name);
    if (!key) return;
    const clearedAt = beatCleared.get(key);
    if (clearedAt !== undefined && now - clearedAt < BEAT_CLEAR_RECHECK_MS) return;
    await clearSleeperCampAt(key, now);
}

/** Test-only: forget every recorded clear. */
export function __resetBeatClearedForTest(): void {
    beatCleared.clear();
}

export function sleeperCampForPresence(player: OnlinePlayer, now: number): SleeperCamp | null {
    if (player.locationUnverified || player.sector < 1 || player.inBattle || (player.travelingUntil ?? 0) > now) return null;
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
    // Departing players who get no camp. An older camp of theirs (another
    // process's, from a deploy overlap) must not outlive them either.
    const uncamped: string[] = [];
    const now = Date.now();
    for (let player of players) {
        if (onlineStore.get(player.name)) continue;
        const lease = await getTravelLease(player.name);
        if (lease) {
            const sector = sleeperSectorForTravelLease(lease, now);
            if (sector === null || !(await settleTravelLease(player.name, lease, now))) {
                uncamped.push(player.name);
                continue;
            }
            player = { ...player, sector, travelingUntil: undefined };
        }
        if (player.locationUnverified) {
            const [saved, evidence] = await Promise.all([
                kv.get<{ currentSector?: number; character?: { hospitalized?: boolean } }>(`save:${safeName(player.name)}`),
                kv.mget(...battleAuthorityKeys(player.name)),
            ]);
            if (!saved || saved.character?.hospitalized) {
                uncamped.push(player.name);
                continue;
            }
            const battle = await resolveBattleAuthority(player.name, battleEvidenceFrom(evidence));
            player = { ...player, sector: Number(saved.currentSector) || 0,
                inBattle: battle.inBattle, locationUnverified: false };
        }
        const camp = sleeperCampForPresence(player, now);
        if (!camp) {
            uncamped.push(player.name);
            continue;
        }
        if (onlineStore.get(player.name)) continue;
        patch[player.name] = camp;
    }
    // One write for the whole sweep. Clearing an absent field is a no-op, and
    // clearing the camp of a player who has just reconnected is what their own
    // beat would do. A failure here must not cost anyone else their new camp.
    const stale = uncamped.map(safeName).filter(Boolean);
    if (stale.length) {
        await kv.hdel(SLEEPER_CAMPS_KEY, ...stale).catch((error) => {
            console.warn('[sleeper-camps] stale camp clear failed:', (error as Error)?.message ?? error);
        });
    }
    if (!Object.keys(patch).length) return;
    const campNames = Object.keys(patch).map(safeName);
    forgetBeatCleared(campNames);
    await kv.hset(SLEEPER_CAMPS_KEY, patch);
    forgetBeatCleared(campNames);
    // Close the reconnect race: a heartbeat that landed while the hash write was
    // in flight wins, and its camp is removed again immediately.
    await Promise.all(Object.keys(patch).map(async (name) => {
        if (onlineStore.get(name)) await clearSleeperCamp(name);
    }));
}
