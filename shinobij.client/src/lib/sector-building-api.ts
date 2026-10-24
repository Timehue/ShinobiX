import type { BuildingAction, BuildingReceipt, BuildingWorldView } from '../../../shared/sector-building-types';
import type { Character } from '../types/character';
import { noteServerTime } from './server-clock';

export type BuildingReply={ok:boolean;view?:BuildingWorldView;character?:Character;_saveVersion?:number;receipt?:BuildingReceipt;replayed?:boolean;error?:string;retryable?:boolean};
export async function requestBuildings(playerName:string,sector:number,signal?:AbortSignal,action?:BuildingAction):Promise<BuildingReply>{
    const sentAt=Date.now();
    try{
        const response=await fetch(action?'/api/sector/buildings':`/api/sector/buildings?${new URLSearchParams({playerName,sector:String(sector)})}`,
            action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerName,...action}),signal}:{signal});
        const data=await response.json();noteServerTime(data.serverNow,sentAt);
        if(!response.ok)return{ok:false,error:typeof data.error==='string'?data.error:'The keeper could not update the counter book.',retryable:response.status>=500};
        if(data.ok!==true||(!action&&(!data.view||data.view.sector!==sector||!Array.isArray(data.view.buildings))))return{ok:false,error:'The counter book could not be read.',retryable:true};
        if(action&&(!data.character||!Number.isSafeInteger(data._saveVersion)||!data.receipt))return{ok:false,error:'The work response was incomplete. Retry the same request to recover it.',retryable:true};
        return data;
    }catch(error){if(signal?.aborted)throw error;return{ok:false,error:'The connection was interrupted. Retry the same request to check whether it was recorded.',retryable:true};}
}
