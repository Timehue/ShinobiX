/** Server-issued interior locations. Same single-process lifetime as onlineStore. */
import { onlineStore, OFFLINE_AFTER_MS } from './_realtime/online-store.js';
const locations = new Map<string, { sector: number; tile: number; seenAt: number; room?:string;closesAt?:number;epoch?:number }>();
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

function isPresent(name: string, location: { sector: number; seenAt: number;closesAt?:number;epoch?:number }, now: number): boolean {
    if(location.closesAt!==undefined&&now>=location.closesAt)return false;
    // The exploration poll stops while the Arena owns the screen. Keep combatants
    // inside for as long as their authoritative battle and normal heartbeat live.
    const player = onlineStore.get(name);
    if(location.epoch!==undefined&&(!player||player.locationUnverified||player.sector!==location.sector
        ||(player.travelingUntil??0)>now||(player.resourceEpoch??0)!==location.epoch))return false;
    return now - location.seenAt <= STRONGHOLD_PRESENCE_TTL || !!(player?.inBattle && player.sector === location.sector);
}

export function touchStrongholdPresence(name: string, sector: number, tile: number, now = Date.now(),room?:string,closesAt?:number): void {
    for (const [slug, location] of locations) if (!isPresent(slug, location, now)) locations.delete(slug);
    const slug = key(name);
    const previous=locations.get(slug);
    const wasInside = previous?.sector === sector&&previous.room===room;
    locations.set(slug, { sector, tile, seenAt: now,room,closesAt,...(room?{epoch:onlineStore.get(name)?.resourceEpoch??0}:{}) });
    if (!wasInside) announce(slug, sector);
}
export function leaveStrongholdPresence(name: string): void {
    const slug = key(name);
    const location = locations.get(slug);
    locations.delete(slug);
    if (location) announce(slug, location.sector);
}
export function strongholdLocation(name: string, sector: number, now = Date.now()): { sector: number; tile: number;room?:string } | undefined {
    const location = locations.get(key(name));
    return location && location.sector === sector && isPresent(name, location, now)
        ? { sector: location.sector, tile: location.tile,...(location.room?{room:location.room}:{}) } : undefined;
}
export function sameStrongholdLocation(actor: { name: string; sector: number }, target: { name: string; sector: number }, now = Date.now()): boolean {
    const a=strongholdLocation(actor.name,actor.sector,now),b=strongholdLocation(target.name,target.sector,now);
    return (a?a.room??'stronghold':'field')===(b?b.room??'stronghold':'field');
}
