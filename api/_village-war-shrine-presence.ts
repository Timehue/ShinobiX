import { onlineStore, checkpointOnlinePresence, refreshOnlinePresence } from './_realtime/online-store.js';
import { safeName } from './_utils.js';
import { SHRINE_ROOM_PRESENCE_TTL_MS } from '../shared/village-war-campaign.js';
import type { CampaignWarRow } from './_village-war-campaign.js';
import { strongholdLocation, touchStrongholdPresence, leaveStrongholdPresence } from './_stronghold-presence.js';
import type { PvpSession } from './pvp/session.js';

/** A shrine room is distinct from a normal stronghold in the same world sector. */
const rooms = new Map<string, { warId: string; generation: number; objectiveId: string; sector: number; tile: number; seenAt: number; eligibleVillage?: string; battleId?: string }>();
export function shrineRoomLocation(name: string, war: CampaignWarRow, sector: number, now = Date.now()) {
    const room = rooms.get(safeName(name)), player = onlineStore.get(name, now);
    const objective = war.campaign?.shrine.find(o => o.id === room?.objectiveId);
    if (!room || room.warId !== war.id || room.generation !== war.declarationGeneration || room.sector !== sector
        || !objective || now < objective.opensAt || now >= objective.closesAt
        || strongholdLocation(name, sector, now)?.room !== `shrine:${war.id}:g${war.declarationGeneration}`
        || !player || player.locationUnverified || player.sector !== sector || (player.travelingUntil ?? 0) > now
        || (now - room.seenAt > SHRINE_ROOM_PRESENCE_TTL_MS && !player.inBattle)) return null;
    return room;
}
export function touchShrineRoom(name: string, war: CampaignWarRow, sector: number, objectiveId: string, tile = 126, now = Date.now(), eligibleVillage = rooms.get(safeName(name))?.eligibleVillage) {
    checkpointOnlinePresence();
    const prior = rooms.get(safeName(name));
    rooms.set(safeName(name), { warId: war.id, generation: war.declarationGeneration!, objectiveId, sector, tile, seenAt: now, eligibleVillage,
        ...(prior?.objectiveId === objectiveId && prior.warId === war.id && prior.generation === war.declarationGeneration ? { battleId: prior.battleId } : {}) });
    touchStrongholdPresence(name, sector, tile, now, `shrine:${war.id}:g${war.declarationGeneration}`,
        { ttlMs: SHRINE_ROOM_PRESENCE_TTL_MS, closesAt: war.campaign!.shrine.find(o => o.id === objectiveId)!.closesAt });
    refreshOnlinePresence();
}
/** Eligibility comes from the real save read performed by shrineRoster, never the client. */
export function confirmShrineRoomVillage(name: string, village: string | undefined) {
    checkpointOnlinePresence();
    const room = rooms.get(safeName(name));
    if (room) room.eligibleVillage = village;
    refreshOnlinePresence();
}
export function eligibleShrineRoomVillage(name: string) { return rooms.get(safeName(name))?.eligibleVillage; }
/** Only an admitted shrine battle may renew the lease after the fight host advances its epoch. */
export function renewShrineCombatPresence(name: string, war: CampaignWarRow, objectiveId: string, battleId: string) {
    const room = rooms.get(safeName(name)), player = onlineStore.get(name), objective = war.campaign?.shrine.find(o => o.id === objectiveId);
    if (room?.warId !== war.id || room.generation !== war.declarationGeneration || room.objectiveId !== objectiveId
        || !objective || Date.now() >= objective.closesAt || player?.sector !== objective.sector || !player.inBattle
        || (player.travelingUntil ?? 0) > Date.now()) return;
    touchShrineRoom(name, war, objective.sector, objectiveId, room.tile);
    rooms.get(safeName(name))!.battleId = battleId;
    refreshOnlinePresence();
}
/** A committed defeat removes that exact fighter visit; retries cannot eject a later visit. */
export function releaseDefeatedShrinePlayer(session: PvpSession): void {
    const binding = session.villageWarObjective;
    if (session.status !== 'done' || !binding || !['p1', 'p2'].includes(session.winner ?? '')) return;
    const loser = session[session.winner === 'p1' ? 'p2' : 'p1'].name, room = rooms.get(safeName(loser));
    if (room?.warId === binding.warId && room.generation === binding.generation
        && room.objectiveId === binding.objectiveId && room.battleId === session.battleId) leaveShrineRoom(loser);
}
export function leaveShrineRoom(name: string) {
    checkpointOnlinePresence();
    const room = rooms.get(safeName(name));
    if (room && strongholdLocation(name, room.sector)?.room === `shrine:${room.warId}:g${room.generation}`) leaveStrongholdPresence(name);
    rooms.delete(safeName(name));
    refreshOnlinePresence();
}
export function shrineRoomPlayers(war: CampaignWarRow, sector: number, now = Date.now()) {
    return onlineStore.listSector(sector, now).flatMap(player => {
        const room = shrineRoomLocation(player.name, war, sector, now);
        return room ? [{ player, tile: room.tile, seenAt: room.seenAt }] : [];
    });
}
