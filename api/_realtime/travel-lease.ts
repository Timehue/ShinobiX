import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { footfallKey, FOOTFALL_TTL_SEC } from '../sector/_traces.js';

const TRAVEL_LEASE_PREFIX = 'world:travel-lease:';
const TRAVEL_LEASE_TTL_SEC = 7 * 24 * 60 * 60;

export type TravelLease = {
    originSector: number;
    destinationSector: number;
    arrivalAt: number;
    arrivalTile?: number;
};

function sector(value: unknown, allowSafeZone: boolean): number | null {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return null;
    if (allowSafeZone && parsed === 0) return 0;
    return parsed === 99 || (parsed >= 1 && parsed <= 60) ? parsed : null;
}

export function parseTravelLease(value: unknown): TravelLease | null {
    const raw = typeof value === 'string'
        ? (() => { try { return JSON.parse(value) as unknown; } catch { return null; } })()
        : value;
    if (!raw || typeof raw !== 'object') return null;
    const input = raw as Partial<TravelLease>;
    const originSector = sector(input.originSector, true);
    const destinationSector = sector(input.destinationSector, false);
    const arrivalAt = Math.floor(Number(input.arrivalAt));
    if (originSector === null || destinationSector === null || !Number.isFinite(arrivalAt) || arrivalAt <= 0) return null;
    const rawTile = Math.floor(Number(input.arrivalTile));
    const arrivalTile = Number.isFinite(rawTile) && rawTile >= 0 && rawTile <= 143 ? rawTile : undefined;
    return { originSector, destinationSector, arrivalAt, ...(arrivalTile === undefined ? {} : { arrivalTile }) };
}

export function travelLeaseKey(name: string): string {
    return `${TRAVEL_LEASE_PREFIX}${safeName(name)}`;
}

/** Authoritative sector while the lease is active, and after it has matured. */
export function travelLeaseSectorAt(lease: TravelLease, now: number): number {
    return now < lease.arrivalAt ? lease.originSector : lease.destinationSector;
}

/** A traveling disconnect is hidden; after arrival it may sleep at the destination. */
export function sleeperSectorForTravelLease(lease: TravelLease, now: number): number | null {
    return now < lease.arrivalAt ? null : lease.destinationSector;
}

export async function getTravelLease(name: string): Promise<TravelLease | null> {
    return parseTravelLease(await kv.get(travelLeaseKey(name)));
}

export async function setTravelLease(name: string, lease: TravelLease): Promise<void> {
    const normalized = parseTravelLease(lease);
    const key = travelLeaseKey(name);
    if (!safeName(name) || !normalized) throw new Error('Invalid travel lease.');
    await withKvLock(key, async () => {
        await kv.set(key, normalized, { ex: TRAVEL_LEASE_TTL_SEC });
    }, { failClosed: true });
}

function sameLease(a: TravelLease, b: TravelLease): boolean {
    return a.originSector === b.originSector
        && a.destinationSector === b.destinationSector
        && a.arrivalAt === b.arrivalAt
        && a.arrivalTile === b.arrivalTile;
}

/** Commit a matured destination to the versioned save before deleting its lease. */
export async function settleTravelLease(
    name: string,
    expectedLease?: TravelLease,
    now: number = Date.now(),
): Promise<boolean> {
    const key = travelLeaseKey(name);
    if (!safeName(name)) return false;
    return await withKvLock(key, async () => {
        const lease = parseTravelLease(await kv.get(key));
        if (!lease || now < lease.arrivalAt || (expectedLease && !sameLease(lease, expectedLease))) return false;
        const result = await mutatePlayerSave(name, ({ character }) => ({
            ok: true,
            character,
            value: true,
            recordPatch: { currentSector: lease.destinationSector, pendingTravel: null },
        }));
        if (!result.ok) return false;
        await kv.del(key);
        // Footfall trace ("N shinobi passed through today") — fire-and-forget so a
        // counter hiccup can never fail an arrival. Exactly once per settled lease.
        void kv.incr(footfallKey(lease.destinationSector, now), { ex: FOOTFALL_TTL_SEC }).catch(() => undefined);
        return true;
    }, { failClosed: true });
}

export async function settleTravelLeases(...names: string[]): Promise<void> {
    await Promise.all([...new Set(names.map(safeName).filter(Boolean))].map(async (name) => {
        await settleTravelLease(name).catch(() => false);
    }));
}

export async function clearTravelLeases(...names: string[]): Promise<void> {
    const keys = [...new Set(names.map(travelLeaseKey).filter((key) => key !== TRAVEL_LEASE_PREFIX))];
    if (keys.length) await kv.del(...keys);
}

export async function clearTravelLease(name: string): Promise<void> {
    await clearTravelLeases(name);
}
