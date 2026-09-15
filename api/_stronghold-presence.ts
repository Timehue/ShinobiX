/** Server-issued interior locations. Same single-process lifetime as onlineStore. */
import { onlineStore, OFFLINE_AFTER_MS } from './_realtime/online-store.js';
const locations = new Map<string, { sector: number; tile: number; seenAt: number }>();
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
export const STRONGHOLD_PRESENCE_TTL = OFFLINE_AFTER_MS;

function isPresent(name: string, location: { sector: number; seenAt: number }, now: number): boolean {
    // The exploration poll stops while the Arena owns the screen. Keep combatants
    // inside for as long as their authoritative battle and normal heartbeat live.
    const player = onlineStore.get(name);
    return now - location.seenAt <= STRONGHOLD_PRESENCE_TTL || !!(player?.inBattle && player.sector === location.sector);
}

export function touchStrongholdPresence(name: string, sector: number, tile: number, now = Date.now()): void {
    for (const [slug, location] of locations) if (!isPresent(slug, location, now)) locations.delete(slug);
    locations.set(key(name), { sector, tile, seenAt: now });
}
export function leaveStrongholdPresence(name: string): void { locations.delete(key(name)); }
export function strongholdLocation(name: string, sector: number, now = Date.now()): { sector: number; tile: number } | undefined {
    const location = locations.get(key(name));
    return location && location.sector === sector && isPresent(name, location, now)
        ? { sector: location.sector, tile: location.tile } : undefined;
}
export function sameStrongholdLocation(actor: { name: string; sector: number }, target: { name: string; sector: number }, now = Date.now()): boolean {
    return !!strongholdLocation(actor.name, actor.sector, now) === !!strongholdLocation(target.name, target.sector, now);
}
