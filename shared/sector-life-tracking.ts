import { wandererCastAt,WANDERER_BUCKET_MS,type Wanderer } from './wanderer-roster.js';
import { isPlayableWildSector } from './sector-geo.js';
import { WORLD_DAY_MS } from './world-clock.js';
import { sectorExits } from './sector-links.js';
import { walkPath,nearestWalkableTile,tileNeighbors } from './sector-walk-mask.js';
import type { LifeActor } from './sector-life.js';

export type LifeHunt={window:number;owner:string;trackerId:string;giver:string;homeTile:number;trailId:string;requestId:string;sectors:[number,number];startedAt:number;expiresAt:number;result?:'bound'|'unbound'|'cold';resolvedAt?:number};
export const LIFE_HUNT_LINES={
    intro:'Fresh marks leave the road. Examine them, then ask the tracker to follow the trail.',
    examine:'Examine the disturbed ground',ask:'Ask the tracker to follow the trail',
    pending:'The tracker is following the animal trail. Finish the trail encounter to bring the party back.',
    bound:'The animal was bound. We are heading back to the roadside stop.',
    unbound:'The encounter ended without a binding. We are heading back to the roadside stop.',
    cold:'We stopped following the trail. We are heading back to the roadside stop.',
    resting:'We are back at the stop after following the animal trail.',
    moving:'We are following the tracks to the next sector.',
    busy:'The tracker is already following this trail.',
    unavailable:'The tracker has moved on after this trail.',
    returnReport:'The trail party has returned to the roadside stop.',
    restingReport:'The trail party is resting at the roadside stop.',
    onward:'I am carrying on along the road.',
};
export function lifeNaturalTracker(sector:number,now:number):Wanderer|undefined {
    const exits=sectorExits(sector);
    return wandererCastAt(sector,Math.floor(now/WANDERER_BUCKET_MS),now).find(w=>w.verb==='tracker'&&exits.length>0&&exits.every(exit=>walkPath(sector,w.homeTile,exit.tile)));
}
export function lifeTrackSites(sector:number,tracker:Pick<Wanderer,'homeTile'>) {
    const approach=tileNeighbors(tracker.homeTile).find(tile=>walkPath(sector,tile,tracker.homeTile)?.length===2)??tracker.homeTile;
    const exit=sectorExits(sector).find(e=>walkPath(sector,e.tile,approach)),path=walkPath(sector,exit?.tile??approach,approach)??[approach];
    return {approach,marks:path.slice(-4).map(tile=>[tile] as const)};
}
export function parseLifeHunt(raw:unknown,now:number):LifeHunt|undefined {
    if(!raw||typeof raw!=='object')return;
    const v=raw as LifeHunt;
    if(!Number.isInteger(v.window)||v.window<0||typeof v.owner!=='string'||!v.owner||typeof v.trackerId!=='string'||typeof v.giver!=='string'
        ||typeof v.trailId!=='string'||!/^trail-[A-Za-z0-9_-]{8,120}$/.test(v.trailId)||typeof v.requestId!=='string'||!/^[A-Za-z0-9_-]{8,96}$/.test(v.requestId)
        ||!Array.isArray(v.sectors)||v.sectors.length!==2||!v.sectors.every(isPlayableWildSector)||!Number.isInteger(v.homeTile)||v.homeTile<0||v.homeTile>143
        ||!Number.isSafeInteger(v.startedAt)||v.startedAt<=0||v.startedAt>now||!Number.isSafeInteger(v.expiresAt)||v.expiresAt<=v.startedAt)return;
    const result=['bound','unbound','cold'].includes(v.result??'')&&Number.isSafeInteger(v.resolvedAt)&&v.resolvedAt!>=v.startedAt&&v.resolvedAt!<=now?v.result:undefined;
    if(now>(result?v.resolvedAt!:v.expiresAt)+WORLD_DAY_MS)return;
    return {window:v.window,owner:v.owner.slice(0,40),trackerId:v.trackerId,giver:v.giver.slice(0,48),homeTile:v.homeTile,trailId:v.trailId,requestId:v.requestId,sectors:[...v.sectors],startedAt:v.startedAt,expiresAt:v.expiresAt,...(result?{result,resolvedAt:v.resolvedAt}:{})};
}
/** Both people leave through the trail's actual first road, then return to
 * separate resting places. Their outbound timeline remains intact on return. */
export function lifeTrackingParty(sector:number,hunt:LifeHunt,resident:LifeActor,stops:{scout:number;tracker:number},now:number) {
    const exit=sectorExits(sector).find(e=>e.destinationSector===hunt.sectors[0])??sectorExits(sector)[0];
    if(!exit)return {resident,tracker:undefined,trackerAway:false};
    let trackerGoneAt=Infinity;
    const make=(actor:LifeActor,startTile:number,stop:number,index:number):LifeActor|undefined=>{
        const out=walkPath(sector,startTile,exit.tile),back=walkPath(sector,exit.tile,stop);if(!out||!back)return actor;
        const pause=20_000+index*2000,away=pause+(out.length-1)*3000;
        const returning=hunt.result?Math.max(away+3000,hunt.resolvedAt!-hunt.startedAt)+index*1500:undefined;
        if(!returning&&now>hunt.startedAt+away+1500)return;
        const returned=returning===undefined?undefined:returning+(back.length-1)*3000,arrived=returned!==undefined&&now>=hunt.startedAt+returned;
        const onward=walkPath(sector,stop,(sectorExits(sector).find(e=>e.tile!==exit.tile)??exit).tile)??[stop],depart=returned===undefined?undefined:returned+180_000;
        if(index===0&&returned!==undefined&&now>=hunt.startedAt+returned+120_000)return actor;
        if(index===1&&depart!==undefined){trackerGoneAt=hunt.startedAt+depart+(onward.length-1)*3000+1500;if(now>trackerGoneAt)return;}
        const leaving=index===1&&depart!==undefined&&now>=hunt.startedAt+depart;
        return {...actor,hideAt:undefined,hideTile:undefined,phases:undefined,cyclePhases:undefined,restTile:stop,workTile:stop,atRest:true,activity:leaving?'Continuing along the road':arrived?'Resting after the animal trail':returning!==undefined&&now>=hunt.startedAt+returning?'Returning from the animal trail':'Following the animal trail',
            line:leaving?LIFE_HUNT_LINES.onward:arrived?LIFE_HUNT_LINES.resting:returning!==undefined&&now>=hunt.startedAt+returning?LIFE_HUNT_LINES[hunt.result!]:LIFE_HUNT_LINES.moving,
            motion:{start:hunt.startedAt,frames:[[0,startTile],...out.map((tile,i)=>[pause+i*3000,tile] as const),...(returning===undefined?[]:back.map((tile,i)=>[returning+i*3000,tile] as const)),...(index!==1||depart===undefined?[]:onward.map((tile,i)=>[depart+i*3000,tile] as const))]}};
    };
    const tracker:LifeActor={id:`hunter:${sector}`,name:hunt.giver,art:'forager',tile:stops.tracker,restTile:stops.tracker,workTile:stops.tracker,activity:'Following the animal trail',line:LIFE_HUNT_LINES.moving,atRest:true};
    const scout=make(resident,resident.restTile,stops.scout,0),hunter=make(tracker,nearestWalkableTile(sector,hunt.homeTile),stops.tracker,1);
    return {resident:scout,tracker:hunter,trackerAway:now<=trackerGoneAt};
}
