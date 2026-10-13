/** Field orders are admitted and settled under the campaign CAS lock. Timers
 * are process-local evidence, never persisted elapsed time or client claims. */
import { randomUUID, randomInt } from 'node:crypto';
import { campaignSupportTiers } from './_war-preparations.js';
import { kv } from './_storage.js';
import { onlineStore, subscribeBeforeOnlinePresenceMutation } from './_realtime/online-store.js';
import { toPlayerRecord } from './_realtime/presence-input.js';
import { HOME_SECTORS, WAR_VILLAGES, isWarVillage } from './_war-map-sectors.js';
import { getSectorOwnerVillage } from './_sector-war-store.js';
import { strongholdLocation, touchStrongholdPresence, leaveStrongholdPresence, subscribeStrongholdEntryChange } from './_stronghold-presence.js';
import { campaignWarPlayable, mutateCampaignWar, awardCampaignBattle, type CampaignWarRow } from './_village-war-campaign.js';
import { reserveCampaignOperation, WAR_OPERATIONS, type CampaignFieldMission, type CampaignFieldMissionView } from '../shared/village-war-campaign.js';

type Hold = { player: string; since: number; seenAt: number; sector: number; tile?: number; epoch: number; movement: number; connectedAt: number; pickup: boolean };
const holds = new Map<string, Hold>();
const HOLD_LEASE_MS = 10_000;
const allSectors = WAR_VILLAGES.flatMap(v => [...HOME_SECTORS[v]]);
subscribeBeforeOnlinePresenceMutation(() => { for (const [id, hold] of holds) if (!holdValid(hold.player, hold, Date.now())) holds.delete(id); });
subscribeStrongholdEntryChange(player => { for (const [id, hold] of holds) if (hold.player === player) holds.delete(id); });
function fail(message: string): never { throw new Error(message); }
export function fieldMissionFor(war: CampaignWarRow, player: string): CampaignFieldMission | undefined {
    return Object.values(war.campaign?.admissions ?? {}).filter(a => a.player === player && a.field)
        .map(a => a.field!).reverse().sort((a, b) => b.createdAt - a.createdAt)[0];
}
function holdValid(player: string, hold: Hold, now: number): boolean {
    const p = onlineStore.get(player, now);
    return !!p && !p.locationUnverified && !p.inBattle && (p.travelingUntil ?? 0) <= now && p.sector === hold.sector
        && (p.resourceEpoch ?? 0) === hold.epoch && (p.movementSeq ?? 0) === hold.movement
        && p.tile === hold.tile
        && p.connectedAt === hold.connectedAt && now - hold.seenAt <= HOLD_LEASE_MS
        && !strongholdLocation(player, p.sector, now);
}
export function projectFieldMission(war: CampaignWarRow, player: string, now = Date.now(), selected?: CampaignFieldMission): CampaignFieldMissionView | null {
    const mission = selected ?? fieldMissionFor(war, player);
    if (!mission) return null;
    const hold = holds.get(mission.id);
    return { ...mission, holdSeconds: mission.status === 'active' && hold && holdValid(player, hold, now) ? Math.floor((now - hold.since) / 1000) : 0,
        ...(war.campaign?.receipts[`field:${mission.id}`] ? { earnedPoints: war.campaign.receipts[`field:${mission.id}`].points,
            earnedIntel: war.campaign.receipts[`field:${mission.id}`].intel ?? 0 } : {}),
        holdRequired: mission.kind === 'supply' && !mission.pickedUp ? 10 : mission.kind === 'espionage' ? 0 : 20,
        insideStronghold: mission.kind === 'espionage' && !!strongholdLocation(player, mission.sectors[0], now)
            && !strongholdLocation(player, mission.sectors[0], now)?.room, serverNow: now };
}
async function owned(village: string): Promise<number[]> {
    // Ownership reads fail closed. Unseeded rows are not a licence to farm land.
    const owners = await Promise.all(allSectors.map(getSectorOwnerVillage));
    return allSectors.filter((_, i) => owners[i] === village);
}
export function completeFieldMission<T extends CampaignWarRow>(war: T, player: string, mission: CampaignFieldMission, at: number): T {
    if (mission.status !== 'active' || war.campaign!.admissions[mission.id]?.finished) return war;
    mission.status = 'complete'; mission.finishedAt = at;
    war.campaign!.admissions[mission.id].finished = true;
    holds.delete(mission.id);
    return awardCampaignBattle(war, { receipt: `field:${mission.id}`, village: mission.village, player,
        createdAt: mission.createdAt, at, operation: mission.kind, pve: true }, player).row;
}
export async function fieldOperationAction(warId: string, generation: number, player: string, village: string,
    action: string, operation?: unknown, missionId?: unknown) {
    return mutateCampaignWar<{ mission: CampaignFieldMissionView | null; peers?: ReturnType<typeof toPlayerRecord>[] }>(warId, async war => {
        const now = Date.now();
        if (!['operation-start', 'operation-progress', 'operation-enter', 'operation-leave', 'operation-abandon'].includes(action)) fail('Unknown field order action.');
        if (war.declarationGeneration !== generation || !war.villages.includes(village)) fail('This order belongs to another war.');
        let mission = fieldMissionFor(war, player);
        if (missionId && action !== 'operation-start') {
            const admitted = war.campaign!.admissions[String(missionId)];
            if (!admitted?.field || admitted.player !== player) fail('This field order does not belong to you.');
            mission = admitted.field;
        }
        if (mission?.status === 'active' && mission.village !== village) {
            mission.status = 'abandoned'; mission.finishedAt = now; war.campaign!.admissions[mission.id].finished = true; holds.delete(mission.id);
        }
        if (action === 'operation-start') {
            if (!campaignWarPlayable(war, now)) fail('This war is not active.');
            if (mission?.status === 'active') return { row: war, value: { mission: projectFieldMission(war, player, now, mission) } };
            const unfinished = Object.values(war.campaign!.admissions).some(a => a.player === player && !a.finished && !a.field);
            if (unfinished) fail('Finish your assigned battle before accepting a field order.');
            const kind = WAR_OPERATIONS.find(k => k === operation);
            if (!kind) fail('Choose Supply, Sabotage or Espionage.');
            const enemy = war.villages.find(v => v !== village)!;
            const candidates = await owned(kind === 'supply' ? village : enemy);
            if (!isWarVillage(village)) fail('Your village has no supply station.');
            const gate = HOME_SECTORS[village][0], enemyGate = isWarVillage(enemy) ? HOME_SECTORS[enemy][0] : undefined;
            const eligible = kind === 'supply' ? candidates.filter(s => s !== gate)
                : kind === 'espionage' ? candidates.filter(s => s !== enemyGate && !war.campaign!.strongholds.some(o => o.sector === s)) : candidates;
            if (eligible.length < (kind === 'sabotage' ? 3 : 1)) fail('There are not enough controlled sectors for this order.');
            if (!reserveCampaignOperation(war.campaign!, village, player, kind, now)) fail('Your personal daily mission allowance is exhausted.');
            const id = `vwm${randomUUID().replace(/-/g, '')}`;
            mission = { id, kind, village, enemy, createdAt: now, sectors: kind === 'sabotage' ? eligible : [eligible[randomInt(eligible.length)]],
                ...(kind === 'supply' ? { pickupSector: gate, pickedUp: false } : {}), completedSectors: [], status: 'active' };
            war.campaign!.admissions[id] = { player, operation: kind, createdAt: now, npc: true, field: mission,
                supportTiers: await campaignSupportTiers(war, village, now) };
        } else {
            if (!mission) fail('Accept a field order from Town Hall first.');
            if (action === 'operation-leave') {
                if (onlineStore.get(player)?.inBattle) fail('Finish your battle before leaving the stronghold.');
                if (mission.kind === 'espionage' && strongholdLocation(player, mission.sectors[0]) && !strongholdLocation(player, mission.sectors[0])?.room) leaveStrongholdPresence(player);
                return { row: war, value: { mission: projectFieldMission(war, player, now, mission) } };
            }
            if (mission.status !== 'active') return { row: war, value: { mission: projectFieldMission(war, player, now, mission) } };
            if (mission.battleRunId && !war.campaign!.admissions[mission.battleRunId]?.finished) fail('Finish your stronghold battle before changing this order.');
            if (action === 'operation-abandon' || !campaignWarPlayable(war, now)) {
                mission.status = 'abandoned'; mission.finishedAt = now; war.campaign!.admissions[mission.id].finished = true; holds.delete(mission.id);
                if (mission.kind === 'espionage' && strongholdLocation(player, mission.sectors[0])) leaveStrongholdPresence(player);
            } else {
                const p = onlineStore.get(player, now);
                if (!p || p.locationUnverified || p.inBattle || (p.travelingUntil ?? 0) > now) {
                    holds.delete(mission.id);
                    if (action === 'operation-enter') fail('Arrive at your assigned enemy stronghold before entering.');
                } else if (mission.kind === 'espionage') {
                    const sector = mission.sectors[0];
                    if (action === 'operation-leave') leaveStrongholdPresence(player);
                    else if (p.sector === sector && await getSectorOwnerVillage(sector) === mission.enemy) {
                        if (action === 'operation-enter') touchStrongholdPresence(player, sector, 0, now, undefined, undefined, mission.id);
                        else if (strongholdLocation(player, sector) && !strongholdLocation(player, sector)?.room) touchStrongholdPresence(player, sector, 0, now, undefined, undefined, mission.id);
                    } else if (action === 'operation-enter') fail('Travel to the assigned enemy-controlled sector first.');
                } else {
                    const pickup = mission.kind === 'supply' && !mission.pickedUp;
                    const permitted = pickup ? p.sector === mission.pickupSector : mission.sectors.includes(p.sector) && !mission.completedSectors.includes(p.sector);
                    const owner = permitted ? await getSectorOwnerVillage(p.sector) : '';
                    if (!permitted || owner !== (mission.kind === 'supply' ? village : mission.enemy) || strongholdLocation(player, p.sector)) holds.delete(mission.id);
                    else {
                        let hold = holds.get(mission.id);
                        if (!hold || !holdValid(player, hold, now) || hold.pickup !== pickup) {
                            hold = { player, sector: p.sector, tile: p.tile, since: now, seenAt: now, epoch: p.resourceEpoch ?? 0, movement: p.movementSeq ?? 0, connectedAt: p.connectedAt, pickup };
                            holds.set(mission.id, hold);
                        }
                        hold.seenAt = now;
                        if (now - hold.since >= (pickup ? 10_000 : 20_000)) {
                            holds.delete(mission.id);
                            if (pickup) mission.pickedUp = true;
                            else {
                                mission.completedSectors.push(p.sector);
                                if (mission.completedSectors.length >= (mission.kind === 'sabotage' ? 3 : 1)) war = completeFieldMission(war, player, mission, now);
                            }
                        }
                    }
                }
            }
        }
        war.updatedAt = now;
        const view = projectFieldMission(war, player, now, mission);
        const peers = view?.insideStronghold ? onlineStore.listSector(view.sectors[0]).filter(p => p.name !== player
            && strongholdLocation(p.name, p.sector, now) && !strongholdLocation(p.name, p.sector, now)?.room).map(toPlayerRecord) : [];
        return { row: war, value: { mission: view, peers } };
    });
}
export type EspionageBattleEvidence = { warId: string; generation: number; missionId: string; player: string; village: string; sector: number };
/** War guard duty is an interior admission, not a low-level infiltration or reward route. */
export async function guardStrongholdAction(warId: string, generation: number, player: string, village: string,
    action: string, sector: unknown, visitId: unknown) {
    if (!['guard-enter', 'guard-state', 'guard-leave'].includes(action) || !Number.isInteger(sector)
        || !allSectors.includes(Number(sector)) || typeof visitId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(visitId)) fail('Choose a valid guard post and visit.');
    const target = Number(sector);
    return mutateCampaignWar(warId, async war => {
        const now = Date.now(), p = onlineStore.get(player, now);
        const location = strongholdLocation(player, target, now);
        const ownsVisit = !!location && location.visitId === visitId && !location.room;
        if (war.declarationGeneration !== generation || !war.villages.includes(village)) fail('This guard post belongs to another war.');
        if (action === 'guard-leave') {
            if (ownsVisit && p?.inBattle) fail('Finish your battle before leaving the stronghold.');
            if (ownsVisit) leaveStrongholdPresence(player);
            return { row: war, value: { guard: { sector: target, inside: false }, peers: [] } };
        }
        if (!campaignWarPlayable(war, now) || await getSectorOwnerVillage(target) !== village
            || (isWarVillage(village) && target === HOME_SECTORS[village][0])
            || war.campaign!.strongholds.some(o => o.sector === target)) {
            if (ownsVisit && !p?.inBattle) leaveStrongholdPresence(player);
            fail('Guard duty requires an ordinary allied stronghold during an active war.');
        }
        if (!p || p.locationUnverified || p.sector !== target || (p.travelingUntil ?? 0) > now) fail('Travel to your owned stronghold before taking guard duty.');
        if (action === 'guard-enter' && (p.inBattle || p.pendingAttacker)) fail('Finish your battle before entering the guard post.');
        if (action === 'guard-state' && !ownsVisit) fail('Your guard visit ended. Enter the stronghold again.');
        touchStrongholdPresence(player, target, 0, now, undefined, undefined, visitId);
        const enemy = war.villages.find(v => v !== village);
        const peers = onlineStore.listSector(target).filter(peer => peer.name !== player
            && strongholdLocation(peer.name, target, now) && !strongholdLocation(peer.name, target, now)?.room).map(toPlayerRecord).filter(peer => peer.village === enemy);
        return { row: war, value: { guard: { sector: target, inside: true }, peers } };
    });
}
/** Seal at real PvP creation; entering after a kill cannot manufacture proof. */
export async function sealEspionageBattleEvidence(player: string, enemyVillage: string, opponent: string): Promise<EspionageBattleEvidence | null> {
    const p = onlineStore.get(player);
    if (!p || p.locationUnverified || p.inBattle || (p.travelingUntil ?? 0) > Date.now()
        || !strongholdLocation(player, p.sector) || strongholdLocation(player, p.sector)?.room) return null;
    const enemy = onlineStore.get(opponent);
    if (!enemy || enemy.sector !== p.sector || enemy.locationUnverified || !strongholdLocation(opponent, p.sector)
        || strongholdLocation(opponent, p.sector)?.room) return null;
    const keys = await kv.keys('world:war:*');
    const wars = keys.length ? await kv.mget<CampaignWarRow[]>(...keys) : [];
    for (const war of wars) {
        if (!war || !campaignWarPlayable(war)) continue;
        const m = fieldMissionFor(war, player);
        if (m?.kind === 'espionage' && m.status === 'active' && !m.battleRunId && m.enemy === enemyVillage && m.sectors[0] === p.sector
            && await getSectorOwnerVillage(p.sector) === enemyVillage)
            return { warId: war.id, generation: war.declarationGeneration!, missionId: m.id, player, village: m.village, sector: p.sector };
    }
    return null;
}
export function applyEspionageBattleEvidence<T extends CampaignWarRow>(war: T, evidence: EspionageBattleEvidence | undefined,
    winner: string, createdAt: number, at: number): T {
    if (!evidence || evidence.warId !== war.id || evidence.generation !== war.declarationGeneration || evidence.player !== winner) return war;
    const a = war.campaign!.admissions[evidence.missionId], m = a?.field;
    if (!m || a.player !== winner || m.kind !== 'espionage' || m.village !== evidence.village || m.sectors[0] !== evidence.sector
        || m.createdAt > createdAt || at < createdAt || at >= war.campaign!.endsAt || war.endedAt) return war;
    return completeFieldMission(war, winner, m, at);
}
