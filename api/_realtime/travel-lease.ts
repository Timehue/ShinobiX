import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { footfallKey, FOOTFALL_TTL_SEC } from '../sector/_traces.js';
import { isWildSector } from '../../shared/sector-geo.js';
import { SECTOR_TILE_COUNT } from '../../shared/sector-links.js';

const TRAVEL_LEASE_PREFIX = 'world:travel-lease:';
const TRAVEL_LEASE_TTL_SEC = 7 * 24 * 60 * 60;

export type TravelLease = {
    originSector: number;
    destinationSector: number;
    arrivalAt: number;
    arrivalTile?: number;
    /** Identity of the exact movement that minted this lease. Cleanup compares
     *  it, so an older attempt's failure path can never delete a newer journey's
     *  lease (leases minted before the field existed simply have none). */
    moveId?: string;
};

/** Thrown by setTravelLease when a DIFFERENT journey's lease is still in flight. */
export class TravelLeaseHeldError extends Error {
    constructor(public readonly lease: TravelLease) {
        super('A travel lease is already in flight for this player.');
        this.name = 'TravelLeaseHeldError';
    }
}

const MOVE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

// Read the sector bound from shared/sector-geo (isWildSector) — never hardcode
// it. This validator kept its own `<= 60` through the 61-66 expansion, so
// setTravelLease threw on every crossing that touched one of the new sectors and
// api/player/travel.ts turned that into a 503 "Travel could not be secured" —
// the six sectors were unreachable, and any hunt trail, rift quest or roaming
// boss that routed a player through them dead-ended on the same toast.
function sector(value: unknown, allowSafeZone: boolean): number | null {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return null;
    if (allowSafeZone && parsed === 0) return 0;
    return parsed === 99 || isWildSector(parsed) ? parsed : null;
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
    // Bound tiles by the board (SECTOR_TILE_COUNT), not a hardcoded 143 — same
    // drift class as the sector bound above.
    const rawTile = Math.floor(Number(input.arrivalTile));
    const arrivalTile = Number.isFinite(rawTile) && rawTile >= 0 && rawTile < SECTOR_TILE_COUNT ? rawTile : undefined;
    const moveId = typeof input.moveId === 'string' && MOVE_ID_PATTERN.test(input.moveId) ? input.moveId : undefined;
    return {
        originSector,
        destinationSector,
        arrivalAt,
        ...(arrivalTile === undefined ? {} : { arrivalTile }),
        ...(moveId === undefined ? {} : { moveId }),
    };
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

/**
 * Retry budget for CLAIMING the lease lock on the player-facing travel path.
 *
 * The default 5 attempts (~375-850ms of backoff) is too short here, and the
 * contention is self-inflicted: `settleTravelLease` holds this same lock across
 * `mutatePlayerSave`, which takes a NESTED `lock:save:<name>` — so the holder
 * can sit on the key for two KV round-trips plus a second lock acquisition.
 * Because an edge crossing is INSTANT, the settle for the crossing you just made
 * (fired by the next ~1s heartbeat) is often still holding the lock when you
 * walk into the next one. `setTravelLease` is failClosed, so losing that race
 * threw LockContendedError → api/player/travel.ts 503 → the player got
 * "ROAD BLOCKED / Travel could not be secured" and simply did not move.
 *
 * The two sides are asymmetric and the budget should match: the settle is
 * fire-and-forget (`void ... .catch()`, retried on the next beat, harmless to
 * lose) but owns the SLOW critical section, while this one is a single `kv.set`
 * that a player is actively waiting on. Waiting costs nothing; failing costs
 * the player their move.
 *
 * ⚠ The backoff is EXPONENTIAL (25ms * 2^attempt) and `withLockCore` sleeps
 * once more after the FINAL failed attempt, so the ceiling climbs fast — do the
 * arithmetic before changing this number:
 *     attempts=5 (default) → last try  375ms, worst-case  775ms
 *     attempts=8           → last try 3175ms, worst-case 6375ms
 *     attempts=9           → last try 6375ms, worst-case 12775ms  ← TOO LONG
 * 8 is the ceiling worth having: the last acquire lands ~3.2s in, which covers a
 * settle holding the key across two KV round-trips, and the ~6.4s worst case
 * still fits inside the client's 12s AbortSignal — 9 would blow past it and
 * turn a recoverable wait into "Could not reach the travel server."
 *
 * Mutual exclusion is UNCHANGED: this only affects how long we wait to ACQUIRE,
 * never whether the critical section is locked.
 */
const TRAVEL_LEASE_CLAIM_ATTEMPTS = 8;
const TRAVEL_ACTION_SETTLE_ATTEMPTS = 8;

/**
 * Persist a journey's lease. This is the DURABLE admission of the move — the
 * player-travel handler secures it BEFORE it publishes the move to live memory,
 * so a persistence failure leaves nothing moved.
 *
 * Refuses (TravelLeaseHeldError) while a DIFFERENT journey's lease is still in
 * flight: two requests from two tabs used to both overwrite the key, and the
 * loser's cleanup then deleted the winner's lease. A matured lease is not held
 * — its arrival is already subsumed by the new lease's originSector, and the
 * settler that reads it back finds the newer journey instead.
 */
export async function setTravelLease(name: string, lease: TravelLease, now: number = Date.now()): Promise<void> {
    const normalized = parseTravelLease(lease);
    const key = travelLeaseKey(name);
    if (!safeName(name) || !normalized) throw new Error('Invalid travel lease.');
    await withKvLock(key, async () => {
        const current = parseTravelLease(await kv.get(key));
        if (current && now < current.arrivalAt && !sameLease(current, normalized)) {
            throw new TravelLeaseHeldError(current);
        }
        await kv.set(key, normalized, { ex: TRAVEL_LEASE_TTL_SEC });
    }, { failClosed: true, maxAttempts: TRAVEL_LEASE_CLAIM_ATTEMPTS });
}

function sameLease(a: TravelLease, b: TravelLease): boolean {
    return a.originSector === b.originSector
        && a.destinationSector === b.destinationSector
        && a.arrivalAt === b.arrivalAt
        && a.arrivalTile === b.arrivalTile
        && (a.moveId ?? '') === (b.moveId ?? '');
}

/**
 * Delete EXACTLY this lease — an atomic compare-and-delete on the stored value.
 * Returns false (and deletes nothing) when the key now holds a different
 * journey, so a stale failure path cannot erase a newer move.
 */
export async function clearTravelLeaseIfSame(name: string, lease: TravelLease): Promise<boolean> {
    const normalized = parseTravelLease(lease);
    if (!safeName(name) || !normalized) return false;
    return kv.delIfEqual(travelLeaseKey(name), normalized);
}

/** Commit a matured destination to the versioned save before deleting its lease. */
export async function settleTravelLease(
    name: string,
    expectedLease?: TravelLease,
    now: number = Date.now(),
    maxAttempts?: number,
): Promise<boolean> {
    const key = travelLeaseKey(name);
    if (!safeName(name)) return false;
    return await withKvLock(key, async () => {
        const lease = parseTravelLease(await kv.get(key));
        if (!lease || now < lease.arrivalAt || (expectedLease && !sameLease(lease, expectedLease))) return false;
        // The arrival TILE is persisted with the sector: a reconnect that finds
        // no live presence used to know only the sector, so the player came
        // back on the board's default tile instead of the road they arrived by.
        const result = await mutatePlayerSave(name, ({ character }) => ({
            ok: true,
            character,
            value: true,
            recordPatch: {
                currentSector: lease.destinationSector,
                pendingTravel: null,
                ...(lease.arrivalTile === undefined ? {} : { currentTile: lease.arrivalTile }),
            },
        }));
        if (!result.ok) return false;
        await kv.del(key);
        // Footfall trace ("N shinobi passed through today") — fire-and-forget so a
        // counter hiccup can never fail an arrival. Exactly once per settled lease.
        void kv.incr(footfallKey(lease.destinationSector, now), { ex: FOOTFALL_TTL_SEC }).catch(() => undefined);
        return true;
    }, { failClosed: true, ...(maxAttempts === undefined ? {} : { maxAttempts }) });
}

/**
 * Resolve a server-minted arrival before an action validates the player's sector.
 * The longer action retry budget outwaits the normal presence settler. A
 * destination is returned only after this call proves the save commit completed;
 * if another worker won the race, the caller's following save read sees its commit.
 */
export async function settleMaturedTravelForAction(
    name: string,
    now: number = Date.now(),
): Promise<number | null> {
    const lease = await getTravelLease(name);
    if (!lease || now < lease.arrivalAt) return null;
    return await settleTravelLease(name, lease, now, TRAVEL_ACTION_SETTLE_ATTEMPTS).catch(() => false)
        ? lease.destinationSector
        : null;
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
