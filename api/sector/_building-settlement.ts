import type { KvLike, KvCasOp } from '../_storage.js';
import type { OnlinePlayer } from '../_realtime/types.js';
import { carriedRegenCursor, settleIdleRecovery, writeVersionedPlayerSaveWithStore } from '../save/_mutate-player-save.js';
import { worldPositionModel } from '../../shared/continuous-world-layout.js';
import { buildingSharedKey, sectorBuilding } from '../../shared/sector-buildings.js';
import { readBuildingProgress } from '../../shared/sector-building-state.js';
import type { BuildingAction, BuildingReceipt } from '../../shared/sector-building-types.js';
import { buildingActionTarget, reduceBuildingAction } from './_building-actions.js';
import { battleLockKey } from '../_elapsed-state.js';
import { buildingConditions } from '../../shared/sector-building-content.js';
import { isWalkableTile, pathInMask, sectorWalkMask } from '../../shared/sector-walk-mask.js';

type BuildingStore=Pick<KvLike,'get'|'compareSet'> & Partial<Pick<KvLike,'compareSetMany'>>;
export type BuildingSettlement = {ok:true;character:Record<string,unknown>;_saveVersion:number;receipt:BuildingReceipt;replayed:boolean}|{ok:false;status:number;error:string};
/** Caller holds the communal building lease AND the save lease, fail closed.
 * The adapter appends a shared CAS to the sanctioned save/ledger transaction.
 * A missing multi-key primitive refuses before any material or reward write. */
export async function settleBuildingAction(store:BuildingStore,player:string,action:BuildingAction,options:{now:number;orderId:string;presence:OnlinePlayer|null}):Promise<BuildingSettlement>{
    const building=sectorBuilding(action.buildingId);if(!building)return{ok:false,status:400,error:'This building is not in the road register.'};
    const record=await store.get<Record<string,unknown>>(`save:${player}`);
    if(!record?.character)return{ok:false,status:404,error:'Your character save was not found.'};
    const previous=record.character as Record<string,unknown>;
    const prior=readBuildingProgress(previous.sectorBuildings,options.now).receipts.find(r=>r.requestId===action.requestId);
    if(prior){
        if(prior.buildingId!==building.id||prior.action!==action.action)return{ok:false,status:409,error:'This request belongs to another counter action.'};
        return{ok:true,character:previous,_saveVersion:Number(record._saveVersion??0),receipt:prior,replayed:true};
    }
    const presence=options.presence;
    if(!presence||presence.locationUnverified||options.now-presence.lastSeenAt>30_000)return{ok:false,status:409,error:'Connect to the world before working at a building.'};
    if(presence.inBattle||(presence.travelingUntil??0)>options.now||previous.hospitalized)return{ok:false,status:409,error:'Finish your battle, hospital stay or travel before using this counter.'};
    if(await store.get(battleLockKey(player)))return{ok:false,status:409,error:'Finish your current battle before using this counter.'};
    if((previous.resourceGathering as {active?:unknown}|undefined)?.active)return{ok:false,status:409,error:'Finish or cancel gathering before taking building work.'};
    const target=buildingActionTarget(previous,action,options.now);
    if(!target||presence.sector!==target.sector)return{ok:false,status:409,error:'Walk to the named building or work point first.'};
    let close=false;
    if(target.sector===99){
        // Death's Gate deliberately has no connected-road cursor. Its existing
        // arena movement reports a server-clamped tile on verified presence.
        const tile=presence.tile;
        if(Number.isInteger(tile)&&isWalkableTile(99,tile!)){
            const path=pathInMask(sectorWalkMask(99),tile!,target.tile);
            close=!!path&&path.length<=2;
        }
    }else{
        const model=worldPositionModel(),cursor=model.read(presence.worldPosition)??model.fallback(presence.sector,presence.tile??-1),destination=model.fallback(target.sector,target.tile);
        close=!!cursor&&!!destination&&model.distanceWithin(cursor,destination,1.65)!==null;
    }
    if(!close)return{ok:false,status:409,error:'Move closer to the marked public threshold before acting.'};
    const settled=await settleIdleRecovery(store,player,record),key=buildingSharedKey(building.id),rawShared=await store.get(key);
    const territory=await store.get<Record<string,unknown>>(`world:territory:${building.sector}`);
    const result=reduceBuildingAction(settled.character,action,rawShared,{now:options.now,orderId:options.orderId,displayName:presence.displayName,conditions:buildingConditions(building,options.now,territory),territory:territory??undefined});
    if(!result.ok)return{ok:false,status:409,error:result.error};
    if(result.sharedChanged&&!store.compareSetMany)return{ok:false,status:503,error:'Shared restoration settlement is unavailable. Your materials and reward have not changed.'};
    const sharedOps:KvCasOp[]=result.sharedChanged?[{op:'cas',key,expected:rawShared,value:result.shared}]:[];
    const atomicStore:BuildingStore={
        get:<T>(name:string)=>store.get<T>(name),
        compareSet:async(name,expected,value,opts)=>sharedOps.length
            ?store.compareSetMany!([{op:'cas',key:name,expected,value,...(opts?.ex?{ex:opts.ex}:{})},...sharedOps])
            :store.compareSet(name,expected,value,opts),
        ...(store.compareSetMany?{compareSetMany:(ops:readonly KvCasOp[])=>store.compareSetMany!([...ops,...sharedOps])}:{}),
    };
    const committed=await writeVersionedPlayerSaveWithStore(atomicStore,`save:${player}`,record,result.character,{},
        {regenAt:carriedRegenCursor(settled.character,result.character,settled.regen)});
    return{ok:true,character:committed.record.character as Record<string,unknown>,_saveVersion:committed._saveVersion,receipt:result.receipt,replayed:result.replayed};
}
