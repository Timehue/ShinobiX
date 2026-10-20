import { createHash } from 'node:crypto';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { worldPositionModel } from '../../shared/continuous-world-layout.js';
import { HARVEST_GROUND_MS,harvestGroundTile,validHarvestGround,type HarvestGround } from '../../shared/sector-harvest.js';
import type { OnlinePlayer } from '../_realtime/types.js';
import type { GroundTrail } from '../../shared/sector-life-courier.js';
import { economyTxKey,type EconomyTxRecord } from '../_economy-tx.js';
import { resourceNode } from '../../shared/resource-nodes.js';
import type { ResourceReceipt } from '../../shared/resource-gathering.js';
import type { ResourceSeal } from './_resource-gathering.js';

type HarvestRecord=HarvestGround&{id:string};
export const harvestGroundKey=(sector:number)=>`world:harvest-ground:${sector}`;
const records=(raw:unknown,sector:number,now:number):HarvestRecord[]=>Array.isArray(raw)?raw.filter((r):r is HarvestRecord=>!!r&&typeof r.id==='string'&&validHarvestGround(sector,r,now)).slice(0,48):[];
/** Only the accepted cursor may locate a new find. Legacy presence stays text-only. */
export function gatherGroundOrigin(player:OnlinePlayer|null,sector:number,now:number):number|undefined {
    if(!player||player.sector!==sector||player.locationUnverified||player.inBattle||(player.travelingUntil??0)>now||!Number.isFinite(player.lastSeenAt)||now<player.lastSeenAt||now-player.lastSeenAt>30_000)return;
    const model=worldPositionModel(),cursor=model.read(player.worldPosition);
    if(cursor){const site=model.location(cursor);if(site.sector===sector)return site.tile;}
}
/** Reward settlement has already committed. A cosmetic failure never fails it;
 * a same-find retry repairs the mark with its original time, never freshens it. */
export async function rememberHarvestGround(player:string,findId:string,sector:number,ground:HarvestGround|undefined,now=Date.now()) {
    if(!validHarvestGround(sector,ground,now))return;
    const key=harvestGroundKey(sector),id=createHash('sha256').update(`${player.toLowerCase()}:${findId}`).digest('hex');
    try {await withKvLock(key,async()=>{
        const raw=await kv.get(key),prior=records(raw,sector,now);
        if(prior.some(r=>r.id===id))return;
        await kv.compareSet(key,raw,[{...ground,id},...prior].slice(0,48),{ex:Math.ceil(HARVEST_GROUND_MS/1000)*2});
    },{failClosed:true});}catch{/* Cosmetic memory can be repaired by an exact claim retry. */}
}
export async function readHarvestGround(sector:number,now=Date.now()):Promise<GroundTrail> {
    try {const seen=new Set<number>();return records(await kv.get(harvestGroundKey(sector)),sector,now).sort((a,b)=>b.at-a.at).filter(r=>!seen.has(r.tile)&&!!seen.add(r.tile)).slice(0,4)
        .map(r=>[r.tile,undefined,r.at+HARVEST_GROUND_MS] as const);}catch{return [];}
}
/** The request's nodeId is never a source of world memory. Even a lost-ACK
 * replay resolves the location from the original server admission journal. */
export async function rememberMinedGround(player:string,receipt:ResourceReceipt|undefined,now=Date.now()) {
    if(!receipt||!['success','failed'].includes(receipt.outcome)||!Number.isSafeInteger(receipt.settledAt)||receipt.settledAt!>now)return;
    try {
        const hash=createHash('sha256').update(`${player}:${receipt.id}`).digest('hex');
        const tx=await kv.get<EconomyTxRecord>(economyTxKey(`resource-gathering:${hash}`)),seal=tx?.meta?.seal as ResourceSeal|undefined;
        const node=seal&&resourceNode(seal.nodeId);
        if(tx?.kind!=='resource-gathering'||tx.meta?.playerName!==player||seal?.id!==receipt.id||!node||node.activity!=='mining'||node.worldBossCrystal||receipt.settledAt!<seal.startedAt)return;
        const tile=harvestGroundTile(node.sector,node.approach);
        if(tile!==undefined)await rememberHarvestGround(player,`resource:${receipt.id}`,node.sector,{tile,at:seal.startedAt},now);
    }catch{/* Cosmetic work never fails or changes a successful settlement. */}
}
