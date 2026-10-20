import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { lifeStorageKey,parseLifeState,lifeEventView,type LifeEventState } from '../../shared/sector-life.js';
import { lifeNaturalTracker } from '../../shared/sector-life-tracking.js';
import { cleanTrackerTrail,TRACKER_TRAIL_TTL_MS } from '../../shared/tracker-trail.js';
import { cleanPetAttemptReceipt,petEncounterRequestKey } from '../pet/_encounter-pointer.js';
import { loadTrackerTrail } from './_tracker-trail.js';

/** A cosmetic continuation of an already committed natural tracker service.
 * This never issues a trail, changes its cooldown, or grants an encounter. */
export async function linkLifeTracking(player:string,rawTrail:unknown,trackerId:string,now=Date.now()) {
    const trail=cleanTrackerTrail(rawTrail);if(!trail)return false;
    const sector=trail.originSector,key=lifeStorageKey(sector);
    try{return await withKvLock(key,async()=>{
        const raw=await kv.get(key),state=parseLifeState(raw,now),view=lifeEventView(sector,state,now),tracker=lifeNaturalTracker(sector,now),sealed=await loadTrackerTrail(player);
        if(view.kind!=='tracks'||state.step!==1||view.phase!=='active'||state.hunt&&!state.hunt.result||tracker?.id!==trackerId||sealed?.id!==trail.id||sealed.requestId!==trail.requestId||trail.giver!==tracker.name||trail.expiresAt<=now||trail.expiresAt-TRACKER_TRAIL_TTL_MS<state.updatedAt)return false;
        const hunt={window:state.window,owner:player,trackerId,giver:tracker.name,homeTile:tracker.homeTile,trailId:trail.id,requestId:trail.requestId,sectors:trail.sectors,startedAt:now,expiresAt:trail.expiresAt};
        return kv.compareSet(key,raw,{...state,step:2,updatedAt:now,hunt,contributors:[...new Set([...state.contributors,player])].slice(-8)});
    },{failClosed:true});}catch{return false;}
}

/** Reads the pet system's durable result, never an outcome supplied by a client.
 * Its own CAS row carries the remembered result across subsequent event rounds. */
export async function refreshLifeTracking(sector:number,now=Date.now(),player?:string):Promise<LifeEventState> {
    const key=lifeStorageKey(sector),raw=await kv.get(key),initial=parseLifeState(raw,now);
    if(!initial.hunt){
        if(player&&initial.step===1&&lifeEventView(sector,initial,now).kind==='tracks'){const trail=await loadTrackerTrail(player),tracker=lifeNaturalTracker(sector,now);if(trail?.originSector===sector&&tracker&&await linkLifeTracking(player,trail,tracker.id,now))return parseLifeState(await kv.get(key),now);}
        return initial;
    }
    if(initial.hunt.result)return initial;
    try{return await withKvLock(key,async()=>{
        const current=await kv.get(key),state=parseLifeState(current,now),hunt=state.hunt;if(!hunt||hunt.result)return state;
        const receipt=cleanPetAttemptReceipt(await kv.get(petEncounterRequestKey(hunt.owner,hunt.requestId)));
        const valid=receipt&&receipt.playerName===hunt.owner&&receipt.requestId===hunt.requestId&&receipt.trackerTrailId===hunt.trailId&&receipt.sector===hunt.sectors[1]&&receipt.mintedAt>=hunt.startedAt&&receipt.resolvedAt&&receipt.resolvedAt>=hunt.startedAt&&receipt.resolvedAt<=now&&receipt.token&&receipt.pet;
        const trail=await loadTrackerTrail(hunt.owner);
        const result=valid?(receipt.resolution==='befriended'?'bound':receipt.resolution==='declined'?'unbound':'cold'):now>=hunt.expiresAt||!trail||trail.id!==hunt.trailId?'cold':undefined;
        if(!result)return state;
        const resolvedAt=valid?Math.min(now,receipt.resolvedAt!):Math.min(now,hunt.expiresAt);
        const same=state.window===hunt.window,next={...state,...(same?{step:3,updatedAt:resolvedAt}:{}),hunt:{...hunt,result,resolvedAt}} as LifeEventState;
        return await kv.compareSet(key,current,next)?next:parseLifeState(await kv.get(key),now);
    },{failClosed:true});}catch{return initial;}
}
