import type {LifeActor} from './sector-life.js';
import {lifeActivityAt,type LifePhase} from './sector-life-motion.js';

export const ROAD_VISIT_LINES={arriving:"I'm coming in from the road for a short stop.",leaving:"I'm heading for the next stop. Safe travels."};
/** One real visit, rather than a repeating cached person left at an exit.
 * Existing routes, recognition and weather conversation are retained. */
export function roadVisit(actor:LifeActor,arrival:number,departure:number,now:number,resting:{activity:string;line:string;returnGreeting?:string}):LifeActor{
    const start=actor.motion!.start,approach={activity:'Arriving along the road',line:ROAD_VISIT_LINES.arriving};
    const phases:LifePhase[]=[{at:start,...approach},
        {...resting,at:start+arrival,workTile:actor.restTile,approach},
        {at:start+departure,activity:'Continuing along the road',line:ROAD_VISIT_LINES.leaving}];
    const next={...actor,phases,hideAt:start+300_000,hideTile:actor.motion!.frames.at(-1)![1]};
    return{...next,...lifeActivityAt(next,now)};
}
