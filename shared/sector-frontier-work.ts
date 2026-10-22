import type {LifeActor,LifeEventView} from './sector-life.js';
import {lifeActivityAt,type LifePhase} from './sector-life-motion.js';
import {sectorWalkMask,pathInMask,walkPath} from './sector-walk-mask.js';
import {isWorldNight} from './world-phase.js';

/** Full-sector paintings: the pack sits under the lower pines, and the carrying
 * gear rests against the ruin. Existing road jobs and task locations stay put. */
export const FRONTIER_SITES:Readonly<Record<number,{painting:string;inspection:number;stop:number;road:number;clearance:readonly number[]}>>={
    55:{painting:'hollow-road-gear-v1',inspection:89,stop:78,road:59,clearance:[88,100,101]},
    60:{painting:'lavafront-road-gear-v1',inspection:78,stop:78,road:48,clearance:[77]},
};
export const FRONTIER_ROUND_MS=300_000;
export const FRONTIER_LINES={
    roadApproach:"I'm going to check the road approach.",
    hollowRoad:"I'm watching this approach to the temple road. Stay where you can see your footing.",
    lavaRoad:"I'm checking the ash road for loose rock. Keep to the clear ground.",
    gearApproach:"I'm heading over to check the ground beside the road.",
    pack:"I'm checking the pack under this pine. Leave it here.",
    frame:"I'm checking the carrying gear beside this ruin. Leave room to get past it.",
    returning:"I'm heading back to the road stop.",
    rest:"I'm waiting at this stop before my next road check.",
    helperThanks:"Thank you for helping with the road task. I'll rest here before the next round.",
    weather:"I'll wait at this stop until I can see the road clearly.",
    night:"I'm keeping to this stop. I need a clearer view before I check the ground.",
    fallback:"I'm checking the ground here before I go back to the road.",
    courier:["A courier has not reached this stop. Follow the boot prints beside the road.","Follow the boot prints to the courier. I'll stay at this stop.","I'll stay here while you check on the courier."],
    signal:["I need the two road approaches checked. Start with the first marked approach.","Check the onward approach, then report back to me here.","Report what you saw on the two approaches. I'll stay at this stop."],
} as const;

const masks=new Map<number,ReturnType<typeof sectorWalkMask>>();
/** Actor-only clearance, never a change to public gathering or road authority. */
export function frontierWorkPath(sector:number,from:number,to:number){
    const site=FRONTIER_SITES[sector];if(!site)return walkPath(sector,from,to);
    let mask=masks.get(sector);
    if(!mask){mask=sectorWalkMask(sector)?.map((row,y)=>[...row].map((cell,x)=>site.clearance.includes(y*12+x)?'#':cell).join(''));masks.set(sector,mask);}
    return pathInMask(mask,from,to);
}
// Keep quest givers and every courier/task location fixed. Only ambient rest
// slots move: Gen clears the existing Hollow quest-giver's point, and the spare
// Lavafront spot clears the carrying gear. Filtering would shift other slots.
export const frontierRestSpot=(sector:number,tile:number)=>sector===60&&tile===77?91:sector===55&&tile===79?70:tile;

type Frame=readonly[number,number];
const plans=new Map<number,{frames:Frame[];phases:LifePhase[];gearAt:number;endAt:number}>();
export function frontierWorkPlan(sector:number){
    const site=FRONTIER_SITES[sector];if(!site)return;
    const cached=plans.get(sector);if(cached)return cached;
    const frames:Frame[]=[[0,site.stop]],phases:LifePhase[]=[];let at=0,tile=site.stop;
    const hold=(ms:number)=>{at+=ms;frames.push([at,tile]);};
    const walk=(to:number)=>{const route=frontierWorkPath(sector,tile,to);if(!route)throw Error(`Disconnected frontier routine ${sector}:${tile}:${to}`);for(const next of route.slice(1)){at+=3000;tile=next;frames.push([at,tile]);}};
    const returning={activity:'Returning to the road stop',line:FRONTIER_LINES.returning};
    const road={activity:'Walking to the road approach',line:FRONTIER_LINES.roadApproach};
    phases.push({at,activity:'Waiting at the road stop',line:FRONTIER_LINES.rest,workTile:site.stop,approach:returning});hold(8000);
    phases.push({at,...road});walk(site.road);
    phases.push({at,activity:'Checking the road approach',line:sector===55?FRONTIER_LINES.hollowRoad:FRONTIER_LINES.lavaRoad,workTile:site.road,approach:road});hold(20_000);
    const approach={activity:'Walking to the inspection point',line:FRONTIER_LINES.gearApproach};
    phases.push({at,...approach});if(sector===60)walk(79);walk(site.inspection);const gearAt=at;
    phases.push({at,activity:sector===55?'Inspecting the pack by the pines':'Inspecting the gear by the ruin',line:sector===55?FRONTIER_LINES.pack:FRONTIER_LINES.frame,working:true,workTile:site.inspection,approach});hold(28_000);
    phases.push({at,...returning});walk(site.stop);
    phases.push({at,activity:'Waiting at the road stop',line:FRONTIER_LINES.rest,workTile:site.stop,approach:returning});
    const plan={frames,phases,gearAt,endAt:at};if(plan.endAt>=FRONTIER_ROUND_MS)throw Error('Frontier round exceeds its finite window');plans.set(sector,plan);return plan;
}

/** Reuse the original keeper/scout. A cached round ends at the real stop;
 * weather, darkness and an active shared task keep the requester there. A later
 * authoritative poll may start a new round. No extra figure, row or timer. */
export function frontierWork(actor:LifeActor,sector:number,now:number,weather:string,event:LifeEventView,helper=false,activeEnds=event.endsAt):LifeActor{
    const site=FRONTIER_SITES[sector];if(!site)return actor;
    const base={...actor,clearance:site.clearance};
    if(actor.id!==`resident:${sector}`)return base;
    const start=Math.floor(now/FRONTIER_ROUND_MS)*FRONTIER_ROUND_MS;
    const approach={activity:'Returning to the road stop',line:FRONTIER_LINES.returning};
    const wet=['rain','thunderstorm','tornado','ashfall'].includes(weather),night=isWorldNight(now);
    let activity:string|undefined,line:string|undefined;
    if(event.phase==='active'){
        activity=event.kind==='courier'?'Waiting for the road courier':'Waiting for the approach report';
        const replies=event.kind==='courier'?FRONTIER_LINES.courier:FRONTIER_LINES.signal;line=replies[Math.min(2,event.step)];
    }
    if(wet||night){activity=wet?'Waiting out the weather':'Keeping watch at the road stop';line=(wet?FRONTIER_LINES.weather:FRONTIER_LINES.night)+(line?` ${line}`:'');}
    else if(!activity&&event.phase==='aftermath'&&now<event.updatedAt+60_000){activity='Resting after the road task';line=helper?FRONTIER_LINES.helperThanks:FRONTIER_LINES.rest;}
    const surfaceWork={sector,paintings:[site.painting],fallback:{activity:'Checking the roadside ground',line:FRONTIER_LINES.fallback}};
    if(activity&&line){
        const phases:LifePhase[]=[{at:start,activity,line,workTile:site.stop,approach}];
        if(event.phase==='active')phases.push({at:event.kind==='courier'&&event.step>0?event.endsAt:activeEnds,activity:'Waiting at the road stop',line:FRONTIER_LINES.rest,workTile:site.stop,approach});
        return{...base,tile:site.stop,workTile:actor.workTile,restTile:site.stop,atRest:true,hideAt:undefined,hideTile:undefined,surfaceWork,
            activity,line,motion:{start,frames:[[0,site.stop]]},phases,cyclePhases:undefined};
    }
    const plan=frontierWorkPlan(sector)!;
    const next={...base,tile:site.stop,restTile:site.stop,atRest:false,hideAt:undefined,hideTile:undefined,surfaceWork,
        activity:'Waiting at the road stop',line:FRONTIER_LINES.rest,motion:{start,frames:plan.frames},cyclePhases:undefined,phases:plan.phases.map(p=>({...p,at:start+p.at}))};
    return{...next,...lifeActivityAt(next,now),workTile:actor.workTile,restTile:site.stop};
}
