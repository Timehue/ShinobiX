import { onlineStore, OFFLINE_AFTER_MS } from '../../_realtime/online-store.js';
import { safeName } from '../../_utils.js';
import type { ClanWar } from './_storage.js';
import {touchStrongholdPresence,leaveStrongholdPresence,strongholdLocation} from '../../_stronghold-presence.js';

/** Server-issued interior visits, bound to the same live presence epoch as travel. */
const visits = new Map<string, { instanceId: string; windowIndex: number; sector: number; epoch: number; seenAt: number;tile:number }>();
const roomKey=(instanceId:string,index:number)=>`clan-shrine:${instanceId}:${index}`;
export function clanShrinePresenceError(name: string, war: ClanWar, windowIndex: number, now = Date.now()): string | null {
    const window = war.campaign?.shrines.find(entry => entry.index === windowIndex);
    const player = onlineStore.get(name), visit = visits.get(safeName(name));
    if (!window || now < window.opensAt || now >= window.closesAt || war.endedAt) return 'This shrine is closed.';
    if (!player || player.locationUnverified || player.sector !== window.sector || (player.travelingUntil ?? 0) > now) {
        return 'Travel to the announced shrine sector before entering.';
    }
    if (!visit || visit.instanceId !== war.campaign!.instanceId || visit.windowIndex !== windowIndex
        || visit.sector !== window.sector || visit.epoch !== (player.resourceEpoch ?? 0)
        || now - visit.seenAt > OFFLINE_AFTER_MS
        || strongholdLocation(name,window.sector,now)?.room!==roomKey(war.campaign!.instanceId,windowIndex)) return 'Enter the golden shrine before joining its bonus queue.';
    return null;
}
export function enterClanShrine(name: string, war: ClanWar, windowIndex: number, now = Date.now()): string | null {
    const window = war.campaign?.shrines.find(entry => entry.index === windowIndex);
    const player = onlineStore.get(name);
    if (!window || now < window.opensAt || now >= window.closesAt || war.endedAt) return 'This shrine is closed.';
    if (!player || player.locationUnverified || player.sector !== window.sector || (player.travelingUntil ?? 0) > now) {
        return 'Travel to the announced shrine sector before entering.';
    }
    if (player.inBattle) return 'Finish your current battle before entering the shrine.';
    const interior=strongholdLocation(name,window.sector,now);
    if(interior&&interior.room!==roomKey(war.campaign!.instanceId,windowIndex))return 'Leave your current interior before entering this shrine.';
    // Refreshing an expired visit still requires the real world location.
    const previous=visits.get(safeName(name));
    const tile=previous?.instanceId===war.campaign!.instanceId&&previous.windowIndex===windowIndex?previous.tile:126;
    visits.set(safeName(name), { instanceId: war.campaign!.instanceId, windowIndex, sector: window.sector,
        epoch: player.resourceEpoch ?? 0, seenAt: now,tile });
    touchStrongholdPresence(name,window.sector,tile,now,roomKey(war.campaign!.instanceId,windowIndex),{ttlMs:OFFLINE_AFTER_MS,closesAt:window.closesAt});
    for (const [key, visit] of visits) if (now - visit.seenAt > OFFLINE_AFTER_MS) visits.delete(key);
    return null;
}
export function leaveClanShrine(name: string,war?:ClanWar,windowIndex?:number): void {
    const visit=visits.get(safeName(name));
    if(war?.campaign&&visit&&(visit.instanceId!==war.campaign.instanceId||(windowIndex!==undefined&&visit.windowIndex!==windowIndex)))return;
    // An admitted match owns its visit during the battle screen handoff.
    // Travel still invalidates it through the presence epoch/sector checks.
    if(war?.campaign&&Object.values(war.campaign.matches).some(match=>match.scope==='shrine'&&match.status==='active'
        &&[...match.fromPlayers,...match.toPlayers].includes(safeName(name))))return;
    if(visit&&strongholdLocation(name,visit.sector)?.room===roomKey(visit.instanceId,visit.windowIndex))leaveStrongholdPresence(name);
    visits.delete(safeName(name));
}
export function clanShrineRoster(war: ClanWar, windowIndex: number, now = Date.now()): string[] {
    return [...visits.keys()].filter(name => !clanShrinePresenceError(name, war, windowIndex, now));
}
export function clanShrineRoom(war:ClanWar,windowIndex:number,now=Date.now()) {
    return {serverNow:now,players:clanShrineRoster(war,windowIndex,now).flatMap(name=>{
        const visit=visits.get(name)!,player=onlineStore.get(name),roster=war.campaign!.rosters.find(side=>side.members.some(member=>member.name===name));
        return player&&roster?[{name,displayName:player.displayName,clan:roster.clan,tile:visit.tile,inBattle:!!player.inBattle}]:[];
    })};
}
export function refreshClanShrine(name:string,war:ClanWar,windowIndex:number,tile?:number,now=Date.now()):string|null {
    const error=clanShrinePresenceError(name,war,windowIndex,now);if(error)return error;
    const visit=visits.get(safeName(name))!;
    if(tile!==undefined){
        const x=tile%12,y=Math.floor(tile/12);
        if(!Number.isSafeInteger(tile)||x<1||x>10||y<1||y>10
            ||Math.abs(x-visit.tile%12)+Math.abs(y-Math.floor(visit.tile/12))>1)return 'Choose an adjacent tile inside the shrine courtyard.';
        if(onlineStore.get(name)?.inBattle)return 'Finish your battle before moving.';
        visit.tile=tile;
    }
    visit.seenAt=now;
    touchStrongholdPresence(name,visit.sector,visit.tile,now,roomKey(visit.instanceId,windowIndex),{ttlMs:OFFLINE_AFTER_MS,closesAt:war.campaign!.shrines[windowIndex].closesAt});
    return null;
}
