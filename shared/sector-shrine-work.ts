import type {LifeActor,LifeEventView} from './sector-life.js';
import {lifeActivityAt,type LifePhase} from './sector-life-motion.js';
import {isWorldNight} from './world-phase.js';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from './world-clock.js';
import {pathInMask,sectorWalkMask,walkPath,type WalkMask} from './sector-walk-mask.js';

/** Actual paved approach, right of the Heartwood shrine. The lamps, tea mats,
 * shrine doorway and visitor resting points are outside this short work leg. */
export const SHRINE_SWEEP={sector:15,post:111,sections:[112,100] as const,period:180_000};
export const SHRINE_SWEEP_CLEARANCE=[SHRINE_SWEEP.post,...SHRINE_SWEEP.sections];
let visitorMask:WalkMask|undefined;
/** Visitors take the open approach around the working keeper instead of
 * passing through the broom. This affects only their authored/native routes,
 * never the public walk mask, resource admission or the player's movement. */
export function shrineVisitorPath(sector:number,from:number,to:number) {
    if(sector!==SHRINE_SWEEP.sector)return walkPath(sector,from,to);
    visitorMask??=sectorWalkMask(sector)!.map((row,y)=>[...row].map((cell,x)=>SHRINE_SWEEP_CLEARANCE.includes(y*12+x)?'#':cell).join(''));
    return pathInMask(visitorMask,from,to);
}
export const SHRINE_WORK_LINES={
    sweep:"I'm sweeping leaves off this part of the shrine approach. Please leave room for the broom.",
    approach:"I'm going to sweep the next part of the shrine approach.",
    returning:"I'm putting the broom away and going back to the shrine lamps.",
};

/** One existing keeper, one short round between lamp checks. Cached timelines
 * finish at the original post before night; the navigator handles live weather
 * or a new help request without resetting the actual person's position. */
export function shrineWork(actor:LifeActor,sector:number,event:LifeEventView,now:number,weather:string):LifeActor {
    if(sector!==SHRINE_SWEEP.sector||actor.id!=='keeper:15'||isWorldNight(now)
        ||['rain','thunderstorm','tornado','ashfall'].includes(weather)
        ||event.kind==='shrine'&&event.phase==='active')return actor;
    const start=Math.floor(now/WORLD_DAY_MS)*WORLD_DAY_MS+5*WORLD_HOUR_MS;
    const duration=15*WORLD_HOUR_MS,closingAt=Math.floor((duration-8000)/SHRINE_SWEEP.period)*SHRINE_SWEEP.period;
    const rest={activity:actor.activity,line:actor.line};
    const line=(text:string)=>`${actor.line} ${text}`;
    const walking={activity:'Walking to the next sweep section',line:line(SHRINE_WORK_LINES.approach)};
    const work=(at:number,tile:number):LifePhase=>({at,activity:'Sweeping the shrine approach',line:line(SHRINE_WORK_LINES.sweep),working:true,workTile:tile,approach:walking});
    const result:LifeActor={...actor,workTool:'broom',motion:{start,repeat:SHRINE_SWEEP.period,
        frames:[[0,111],[20_000,111],[23_000,112],[43_000,112],[46_000,100],[66_000,100],[69_000,112],[72_000,111],[SHRINE_SWEEP.period,111]],
        ending:{at:start+closingAt,frames:[[0,111]]}},
        cyclePhases:[{at:0,...rest},{at:20_000,...walking},work(23_000,112),{at:43_000,...walking},work(46_000,100),
            {at:66_000,activity:'Returning to the shrine lamps',line:line(SHRINE_WORK_LINES.returning)},{at:72_000,...rest}],
        phases:[{at:start+closingAt,...rest}]};
    const current=lifeActivityAt(result,now);return {...result,activity:current.activity,line:current.line};
}
