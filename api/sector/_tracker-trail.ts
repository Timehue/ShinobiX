/**
 * Server authority for the Tracker wanderer's trail (shared/tracker-trail.ts).
 *
 * The KV row is the only authority. `character.activeTrackerTrail` is a display
 * mirror the client may hold stale, exactly like `activeWandererFavor`.
 *
 * Lifecycle:
 *   tracker-trail-start (api/sector/wanderer-service.ts) writes the row, step 0.
 *   tracker-trail-step  advances it to step 1 in the tracks sector.
 *   /api/pet/encounter-start with `trackerTrailId` mints the guaranteed wild pet
 *     in the final sector and stamps `flushedAt`, extending the row's life to
 *     the wild encounter's own TTL so the battle can prove where it came from.
 *   /api/pet/wild-binding accepts that flushed row as its discovery proof.
 */
import { kv } from '../_storage.js';
import { cleanTrackerTrail, type TrackerTrail } from '../../shared/tracker-trail.js';
import { cleanPetEncounterPointer, petEncounterActiveKey, PET_ENCOUNTER_POINTER_TTL_SECONDS } from '../pet/_encounter-pointer.js';

export const trackerTrailKey = (playerName: string) => `tracker-trail:${playerName}`;

export async function loadTrackerTrail(playerName: string): Promise<TrackerTrail | null> {
    return cleanTrackerTrail(await kv.get(trackerTrailKey(playerName)));
}

export async function saveTrackerTrail(playerName: string, trail: TrackerTrail, now = Date.now()): Promise<void> {
    const ttlSeconds = trail.flushedAt
        ? PET_ENCOUNTER_POINTER_TTL_SECONDS
        : Math.max(60, Math.ceil((trail.expiresAt - now) / 1000));
    await kv.set(trackerTrailKey(playerName), trail, { ex: ttlSeconds });
}

/** Whether the row may still mint its wild pet in `sector` under `requestId`. */
export function trackerTrailCanFlush(trail: TrackerTrail | null, trailId: string, requestId: string, sector: number, now = Date.now()): trail is TrackerTrail {
    return !!trail && trail.id === trailId && trail.requestId === requestId
        && trail.step === 1 && trail.sectors[1] === sector
        && (!!trail.flushedAt || trail.expiresAt > now);
}

/** True while the trail's own wild encounter is minted and still unresolved. */
export async function trackerTrailEncounterLive(playerName: string, trail: TrackerTrail): Promise<boolean> {
    if (!trail.flushedAt) return false;
    const active = cleanPetEncounterPointer(await kv.get(petEncounterActiveKey(playerName)));
    return !!active && active.requestId === trail.requestId;
}

/** True when a trail still blocks taking a new one: unexpired and unflushed, or
 *  flushed with its wild encounter still open. A flushed trail whose encounter
 *  has resolved is spent, even if its row lingers as a proof. */
export async function trackerTrailInProgress(playerName: string, trail: TrackerTrail | null, now = Date.now()): Promise<boolean> {
    if (!trail) return false;
    return trail.flushedAt ? trackerTrailEncounterLive(playerName, trail) : trail.expiresAt > now;
}

/** Discovery proof for a wild-binding battle minted from a trail. */
export async function trackerTrailDiscovery(playerName: string, trailId: unknown, requestId: unknown): Promise<boolean> {
    if (typeof trailId !== 'string' || !trailId || typeof requestId !== 'string') return false;
    const trail = await loadTrackerTrail(playerName);
    return !!trail && trail.id === trailId && trail.requestId === requestId && !!trail.flushedAt;
}
