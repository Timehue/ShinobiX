import type {LifeActor} from './sector-life.js';
import {walkPath} from './sector-walk-mask.js';
import {lifeActivityAt,type LifePhase} from './sector-life-motion.js';
import {isWorldNight} from './world-phase.js';

/** Reviewed against s38: two edges of the existing upper fern patch and the
 * painted Ashen Leaf gate. Reuses the resident and foliage, no new props. */
export const FORAGER_SITE=Object.freeze({sector:9,door:102,patches:[40,28] as const,period:300_000,stepMs:3000,inspectMs:26_000});
export const FORAGER_LINES={
    outgoing:"I'm going to check the leaves beside the upper path.",
    inspect:"I'm checking these leaves. I leave plants I don't recognize.",
    next:"I'll check the other edge of this patch before I head back.",
    packing:"I'm putting my notes away before I go back to the village.",
    returning:"I'm heading back to the village gate. Keep the path clear.",
    wet:"I'll wait in the village until I can see the leaves clearly.",
    night:"I'm going into the village. I'll check the plants when it's light.",
    inside:"I'm finished with this round. I'll wait in the village before I go out again.",
} as const;

const path=(a:number,b:number)=>walkPath(FORAGER_SITE.sector,a,b)!;
const out=path(FORAGER_SITE.door,FORAGER_SITE.patches[0]);
const across=path(...FORAGER_SITE.patches),back=path(FORAGER_SITE.patches[1],FORAGER_SITE.door);

/** Finite morning rounds finish inside even if the life API becomes unavailable.
 * A later poll starts the next shared five-minute round. Weather chooses the
 * gate as the destination; SectorWanderer's existing navigator retains its pose
 * and walks home before hiding. No additional state row, poll or animation loop. */
export function foragerWork(actor:LifeActor,sector:number,now:number,weather:string):LifeActor{
    if(sector!==FORAGER_SITE.sector||actor.id!==`resident:${sector}`)return actor;
    const start=Math.floor(now/FORAGER_SITE.period)*FORAGER_SITE.period;
    const wet=['rain','thunderstorm','tornado','ashfall'].includes(weather),night=isWorldNight(now);
    const base={...actor,restTile:FORAGER_SITE.door,workTile:FORAGER_SITE.patches[0],tile:FORAGER_SITE.door,bark:'Mind the plants.'};
    if(wet||night)return {...base,atRest:true,activity:'Returning to the village',line:wet?FORAGER_LINES.wet:FORAGER_LINES.night,
        motion:{start,frames:[[0,FORAGER_SITE.door]]},hideTile:FORAGER_SITE.door,hideAt:start+1500,
        phases:[{at:start+1500,activity:'Waiting inside the village',line:wet?FORAGER_LINES.wet:FORAGER_LINES.night}]};
    const frames:(readonly[number,number])[]=out.map((tile,i)=>[i*FORAGER_SITE.stepMs,tile]);
    const first=frames.at(-1)![0],second=first+FORAGER_SITE.inspectMs+(across.length-1)*FORAGER_SITE.stepMs;
    frames.push(...across.map((tile,i)=>[first+FORAGER_SITE.inspectMs+i*FORAGER_SITE.stepMs,tile] as const));
    const packing=second+FORAGER_SITE.inspectMs,returning=packing+4000;
    frames.push([packing,FORAGER_SITE.patches[1]],...back.map((tile,i)=>[returning+i*FORAGER_SITE.stepMs,tile] as const));
    const hideAt=start+frames.at(-1)![0]+1500;
    const phases:LifePhase[]=[
        {at:start+first,activity:'Examining the fern patch',line:FORAGER_LINES.inspect,workTile:FORAGER_SITE.patches[0],approach:{activity:'Walking to the fern patch',line:FORAGER_LINES.outgoing}},
        {at:start+first+FORAGER_SITE.inspectMs,activity:'Walking to the next patch edge',line:FORAGER_LINES.next},
        {at:start+second,activity:'Examining the upper leaves',line:FORAGER_LINES.inspect,workTile:FORAGER_SITE.patches[1],approach:{activity:'Walking to the next patch edge',line:FORAGER_LINES.next}},
        {at:start+packing,activity:'Putting away field notes',line:FORAGER_LINES.packing,workTile:FORAGER_SITE.patches[1],approach:{activity:'Walking to the next patch edge',line:FORAGER_LINES.next}},
        {at:start+returning,activity:'Returning to the village',line:FORAGER_LINES.returning},
        {at:hideAt,activity:'Waiting inside the village',line:FORAGER_LINES.inside},
    ];
    const routine={...base,atRest:false,activity:'Walking to the fern patch',line:FORAGER_LINES.outgoing,
        motion:{start,frames},phases,hideTile:FORAGER_SITE.door,hideAt};
    const current=lifeActivityAt(routine,now);
    return {...routine,activity:current.activity,line:current.line};
}
