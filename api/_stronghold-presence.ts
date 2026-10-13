/** Server-issued interior locations. Same single-process lifetime as onlineStore. */
import { onlineStore, OFFLINE_AFTER_MS, checkpointOnlinePresence, refreshOnlinePresence } from './_realtime/online-store.js';
type InteriorLocation = { sector: number; tile: number; seenAt: number; room?: string; visitId?: string;
    fieldContext?: { epoch: number; movementSequence: number; connectedAt: number };
    lease?: { ttlMs: number; closesAt: number; epoch: number; movementSequence: number } };
const locations = new Map<string, InteriorLocation>();
const entryListeners = new Set<(name: string) => void>();
export function subscribeStrongholdEntryChange(listener: (name: string) => void): void { entryListeners.add(listener); }
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
export const STRONGHOLD_PRESENCE_TTL = OFFLINE_AFTER_MS;

// Sector-mates outside hide a player who is inside (the `stronghold` field of
// their presence record), so entering and leaving must reach them. Set by
// api/_realtime/presence-broadcast.ts; a lapsed location is left to the
// periodic roster.
type StrongholdPresenceListener = (name: string, sector: number) => void;
let listener: StrongholdPresenceListener | null = null;
export function setStrongholdPresenceListener(next: StrongholdPresenceListener | null): void { listener = next; }
function announce(name: string, sector: number): void {
    try {
        listener?.(name, sector);
    } catch (error) {
        console.error('[stronghold-presence] listener failed:', (error as Error)?.message ?? error);
    }
}

function isPresent(name: string, location: InteriorLocation, now: number): boolean {
    // The exploration poll stops while the Arena owns the screen. Keep combatants
    // inside for as long as their authoritative battle and normal heartbeat live.
    const player = onlineStore.get(name, location.lease ? now : undefined);
    if (location.fieldContext && (!player || player.locationUnverified || player.sector !== location.sector
        || (player.travelingUntil ?? 0) > now || player.connectedAt !== location.fieldContext.connectedAt
        || (player.movementSeq ?? 0) !== location.fieldContext.movementSequence
        || (!player.inBattle && (player.resourceEpoch ?? 0) !== location.fieldContext.epoch))) return false;
    if (location.lease && (!player || player.sector !== location.sector || (player.travelingUntil ?? 0) > now
        || (player.resourceEpoch ?? 0) !== location.lease.epoch || (player.movementSeq ?? 0) !== location.lease.movementSequence
        || now >= location.lease.closesAt)) return false;
    return now - location.seenAt <= (location.lease?.ttlMs ?? STRONGHOLD_PRESENCE_TTL) || !!(player?.inBattle && player.sector === location.sector);
}

export function touchStrongholdPresence(name: string, sector: number, tile: number, now = Date.now(), room?: string,
    lease?: { ttlMs: number; closesAt: number }, visitId?: string): void {
    checkpointOnlinePresence();
    for (const [slug, location] of locations) if (!isPresent(slug, location, now)) locations.delete(slug);
    const slug = key(name);
    for (const callback of entryListeners) callback(slug);
    const wasInside = locations.get(slug)?.sector === sector;
    const player = visitId ? onlineStore.get(name) : undefined;
    locations.set(slug, { sector, tile, seenAt: now, ...(room ? { room } : {}), ...(visitId ? { visitId } : {}),
        ...(player ? { fieldContext: { epoch: player.resourceEpoch ?? 0, movementSequence: player.movementSeq ?? 0, connectedAt: player.connectedAt } } : {}),
        ...(lease ? { lease: { ...lease, epoch: onlineStore.get(name)?.resourceEpoch ?? 0,
            movementSequence: onlineStore.get(name)?.movementSeq ?? 0 } } : {}) });
    if (!wasInside) announce(slug, sector);
    refreshOnlinePresence();
}
export function leaveStrongholdPresence(name: string): void {
    checkpointOnlinePresence();
    const slug = key(name);
    for (const callback of entryListeners) callback(slug);
    const location = locations.get(slug);
    locations.delete(slug);
    if (location) announce(slug, location.sector);
    refreshOnlinePresence();
}
export function strongholdLocation(name: string, sector: number, now = Date.now()): { sector: number; tile: number; room?: string; visitId?: string } | undefined {
    const location = locations.get(key(name));
    return location && location.sector === sector && isPresent(name, location, now)
        ? { sector: location.sector, tile: location.tile, ...(location.room ? { room: location.room } : {}), ...(location.visitId ? { visitId: location.visitId } : {}) } : undefined;
}
export function sameStrongholdLocation(actor: { name: string; sector: number }, target: { name: string; sector: number }, now = Date.now()): boolean {
    const a = strongholdLocation(actor.name, actor.sector, now), b = strongholdLocation(target.name, target.sector, now);
    return !!a === !!b && a?.room === b?.room;
}
