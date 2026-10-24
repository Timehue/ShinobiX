import { randomUUID } from 'node:crypto';
import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { onlineStore } from '../_realtime/online-store.js';
import { buildingSharedKey, sectorBuilding } from '../../shared/sector-buildings.js';
import { isPlayableWildSector } from '../../shared/sector-geo.js';
import type { BuildingAction } from '../../shared/sector-building-types.js';
import { isPlayerSaveVersionConflict, SAVE_VERSION_CONFLICT_REPLY } from '../save/_projected-write.js';
import { readBuildingWorld } from './_building-view.js';
import { settleBuildingAction } from './_building-settlement.js';

const actions=new Set(['visit','survey','record','begin','step','cancel','craft','register','tea']);
export function parseBuildingAction(body:Record<string,unknown>):BuildingAction|undefined{
    if(!actions.has(String(body.action))||!sectorBuilding(body.buildingId)||typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId))return;
    if(body.orderId!==undefined&&(typeof body.orderId!=='string'||body.orderId.length>100))return;
    if(body.step!==undefined&&(!Number.isInteger(body.step)||Number(body.step)<0||Number(body.step)>12))return;
    if(body.choice!==undefined&&(typeof body.choice!=='string'||body.choice.length>80))return;
    if(body.recipeId!==undefined&&(typeof body.recipeId!=='string'||body.recipeId.length>80))return;
    if(body.service!==undefined&&!['repair','courier','watch','intelligence','festival','tea'].includes(body.service as string))return;
    if(body.materials!==undefined&&(!Array.isArray(body.materials)||body.materials.length>12||body.materials.some(row=>!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length>24)))return;
    return{action:body.action as BuildingAction['action'],requestId:body.requestId,buildingId:String(body.buildingId),
        ...(body.orderId!==undefined?{orderId:String(body.orderId)}:{}),...(body.step!==undefined?{step:Number(body.step)}:{}),
        ...(body.choice!==undefined?{choice:String(body.choice)}:{}),...(body.recipeId!==undefined?{recipeId:String(body.recipeId)}:{}),
        ...(body.materials!==undefined?{materials:body.materials as BuildingAction['materials']}:{}),
        ...(body.service!==undefined?{service:body.service as BuildingAction['service']}:{})};
}
export default async function handler(req:ApiRequest,res:ApiResponse){
    cors(res,req);if(req.method==='OPTIONS')return res.status(200).end();
    if(req.method!=='GET'&&req.method!=='POST')return res.status(405).end();
    if(process.env.DISABLE_SECTOR_BUILDINGS==='1')return res.status(503).json({error:'The building counter books are temporarily unavailable.'});
    try{
        const body=(req.method==='GET'?req.query:typeof req.body==='string'?JSON.parse(req.body):req.body)??{};
        const player=safeName(String(body.playerName??''));if(!player)return res.status(400).json({error:'A player name is required.'});
        const identity=await authedPlayerOrAdmin(req,player);if(!identity)return res.status(401).json({error:'Sign in before using a building counter.'});
        if(!identity.admin&&identity.name!==player)return res.status(403).json({error:'You can only act for your own character.'});
        if(!(await enforceRateLimitKv(req,res,'sector-buildings',req.method==='GET'?45:30,60_000,player,{strict:true})))return;
        if(req.method==='GET'){
            const sector=Number(body.sector);if(!Number.isInteger(sector)||(!isPlayableWildSector(sector)&&sector!==99))return res.status(400).json({error:'This sector is not on the public road register.'});
            const view=await readBuildingWorld(kv,player,sector,Date.now());if(!view)return res.status(404).json({error:'Your character save was not found.'});
            return res.status(200).json({ok:true,view,serverNow:view.serverNow});
        }
        const action=parseBuildingAction(body);if(!action)return res.status(400).json({error:'Choose a valid building action and request identity.'});
        const orderId=randomUUID();
        // Consistent communal -> player lock order. The exact transaction still
        // checks both predecessors if a lease expires while storage is slow.
        const result=await withKvLock(buildingSharedKey(action.buildingId),()=>withKvLock(`save:${player}`,()=>settleBuildingAction(kv,player,action,
            {now:Date.now(),orderId,presence:onlineStore.get(player)}),{failClosed:true}),{failClosed:true});
        if(!result.ok)return res.status(result.status).json({error:result.error});
        const sector=onlineStore.get(player)?.sector??sectorBuilding(action.buildingId)!.sector;
        const view=await readBuildingWorld(kv,player,sector,Date.now(),[action.buildingId]);
        return res.status(200).json({...result,view,serverNow:Date.now()});
    }catch(error){
        if(error instanceof SyntaxError)return res.status(400).json({error:'The building request could not be read.'});
        if(isPlayerSaveVersionConflict(error))return res.status(503).json(SAVE_VERSION_CONFLICT_REPLY);
        return res.status(503).json({error:error instanceof LockContendedError?'The keeper is recording another order. Retry the same request in a moment.':'The counter book could not be updated. Reopen it before trying the same request again.'});
    }
}
