import { sectorExits } from './sector-links.js';
import { walkPath,sectorWalkMask,tileNeighbors } from './sector-walk-mask.js';
import {lifeActivityAt,type LifePhase} from './sector-life-motion.js';
import type { LifeActor,LifeEventView } from './sector-life.js';

export const COURIER_STEP_MS=3000,COURIER_REST_MS=90_000;
export const LIFE_COURIER_LINES={
    stranded:"I twisted my ankle when I left the road. Could you give me a hand getting up?",
    returning:"I can walk slowly from here. Meet me back at the roadside stop.",
    resting:"Thanks for getting me back. I'll rest my ankle before I carry on with the letters.",
    leaving:"I'm carrying on with the letters now.",
    arrived:"I made it back. Thank you for your help. I'll rest my ankle here.",
    waitingAtStop:"I made it back. I'll rest my ankle here.",
    unhelpedRest:"I'm resting my ankle before I go on with the letters.",
    alone:"I've rested my ankle. I'm making my way back to the road slowly.",
    waiting:'The courier is still making their way back. Wait for them at the stop.',
};
const routes=new Map<string,ReturnType<typeof buildRoute>>();
function buildRoute(sector:number,stop:number,reserved:readonly number[]) {
    const exits=sectorExits(sector).filter(exit=>walkPath(sector,stop,exit.tile)),mask=sectorWalkMask(sector);
    const candidates=Array.from({length:144},(_,tile)=>({tile,path:walkPath(sector,tile,stop)}))
        .filter(({tile,path})=>path&&path.length>=5&&!reserved.includes(tile)&&!exits.some(exit=>exit.tile===tile));
    candidates.sort((a,b)=>Number(mask?.[Math.floor(b.tile/12)]?.[b.tile%12]==='.')-Number(mask?.[Math.floor(a.tile/12)]?.[a.tile%12]==='.')
        ||Math.abs(a.path!.length-8)-Math.abs(b.path!.length-8)||a.tile-b.tile);
    const stranded=candidates[0]?.tile??stop,incoming=exits[0]?.tile??stop,outgoing=exits[1]?.tile??incoming;
    const trail=walkPath(sector,incoming,stranded)??[stranded],back=walkPath(sector,stranded,stop)??[stranded],onward=walkPath(sector,stop,outgoing)??[stop];
    const search=trail[Math.max(0,trail.length-4)];
    const adjacent=tileNeighbors(stop).filter(tile=>walkPath(sector,stop,tile)?.length===2),meet=adjacent.find(tile=>!reserved.includes(tile))??adjacent[0]??stop;
    return {stranded,aid:trail.at(-2)??stranded,stop,meet,search,trail,back,onward,returnMs:1500+(back.length-1)*COURIER_STEP_MS};
}
/** The same reserved resting places are used in every event stage and cast. */
export function courierRoute(sector:number,stop:number,reserved:readonly number[]) {
    const key=`${sector}:${stop}`;let route=routes.get(key);
    if(!route){route=buildRoute(sector,stop,reserved);routes.set(key,route);}return route;
}
export type CourierRoute=ReturnType<typeof courierRoute>;
/** Optional third coordinate is a server-sealed expiry for persistent worked ground. */
export type GroundTrail=readonly (readonly [number,number?,number?])[];
/** Sparse pairs of actual boot prints, pointing along the walkable search path. */
export function courierGroundTrail(route:CourierRoute):GroundTrail {
    const start=Math.max(0,route.trail.length-9);
    return route.trail.slice(start,-1).map((tile,i)=>{const next=route.trail[start+i+1];return [tile,Math.atan2(Math.floor(next/12)-Math.floor(tile/12),next%12-tile%12)-Math.PI/2] as const;});
}
export function courierLife(sector:number,event:LifeEventView,route:CourierRoute,now:number,activeEnds:number,viewer?:string) {
    let motion:LifeActor['motion'],activity='Resting an injured ankle',line:string=LIFE_COURIER_LINES.stranded,rest=route.stranded,description=event.description,hideAt:number|undefined;
    const phases:LifePhase[]=[],frames=(tiles:number[],offset=0)=>tiles.map((tile,i)=>[offset+i*COURIER_STEP_MS,tile] as const);
    const helper=!!viewer&&event.contributors.some(name=>name.toLowerCase()===viewer.toLowerCase());
    const waiting=(at:number,activity:string,line:string,approachLine:string):LifePhase=>({at,activity,line,workTile:route.stop,approach:{activity:'Returning to the roadside stop',line:approachLine}});
    const onward=(depart:number)=>{hideAt=depart+(route.onward.length-1)*COURIER_STEP_MS+1500;phases.push({at:depart,activity:'Continuing the delivery route',line:LIFE_COURIER_LINES.leaving});};
    if(event.phase==='unattended'||event.step===0) {
        const returnStart=activeEnds+1500,arrive=returnStart+(route.back.length-1)*COURIER_STEP_MS,depart=arrive+COURIER_REST_MS;
        rest=route.stop;motion={start:returnStart,frames:[...frames(route.back),...frames(route.onward,depart-returnStart)]};
        phases.push({at:returnStart,activity:'Making their own way back',line:LIFE_COURIER_LINES.alone},waiting(arrive,'Resting at the roadside stop',LIFE_COURIER_LINES.unhelpedRest,LIFE_COURIER_LINES.alone));onward(depart);
        if(now>=returnStart)description=now<arrive?'The search ended without help. The courier is making their own way back.':now<depart?'The courier has returned without help and is resting at the stop.':'The courier is carrying on with the delivery route.';
        if(now>hideAt!)return {actors:[] as LifeActor[],description:'The courier made it back without help and continued along the road.'};
    } else if(event.step===2) {
        rest=route.stop;motion={start:event.updatedAt+1500,frames:frames(route.back)};
        phases.push({at:event.updatedAt,activity:'Returning to the roadside stop',line:LIFE_COURIER_LINES.returning},waiting(event.updatedAt+route.returnMs,'Waiting at the roadside stop',helper?LIFE_COURIER_LINES.arrived:LIFE_COURIER_LINES.waitingAtStop,LIFE_COURIER_LINES.returning));
    } else if(event.phase==='aftermath') {
        const depart=event.updatedAt+COURIER_REST_MS;
        rest=route.stop;motion={start:depart,frames:frames(route.onward)};
        phases.push(waiting(event.updatedAt,'Resting before the next delivery',helper?LIFE_COURIER_LINES.resting:LIFE_COURIER_LINES.unhelpedRest,LIFE_COURIER_LINES.returning));onward(depart);
        if(now>hideAt!)return {actors:[] as LifeActor[],description:'The courier has rested and continued along the delivery route.'};
        description=now<depart?'The courier is back at the stop and resting before the next delivery.':'The courier is carrying on along the delivery route.';
    }
    const actor:LifeActor={id:`courier:${sector}`,name:'Road Courier',art:'courier',tile:rest,restTile:rest,workTile:rest,atRest:true,activity,line,motion,phases,hideAt,hideTile:route.onward.at(-1)};
    return {actors:[{...actor,...lifeActivityAt(actor,now)}],description};
}
