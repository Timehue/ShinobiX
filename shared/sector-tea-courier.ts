import { sectorWalkMask, pathInMask } from './sector-walk-mask.js';
import { lifeActivityAt, type LifePhase } from './sector-life-motion.js';
import type { LifeActor } from './sector-life.js';

/** A letter run from the harbor into the deepwood and back, using only real
 * reciprocal roads. Heartwood is a staffed rest stop on both legs. */
export const TETSU_ROUTE = [1,8,2,62,61,16,14,15,9,10,11,15,14,16,61,62,2,8] as const;
export const TEA_COURIER_SECTOR = 15;
export const TEA_COURIER_SEAT = 105;
// The lower mat is reached around the kettle and the seller, never across them.
export const TEA_TABLE_CLEARANCE = [92,93,104] as const;
export const TEA_COURIER_LINES = {
    arriving: "I'm stopping at the tea table before I take these letters onward.",
    resting: "I'm taking a short break by the tea table before I go on with the letters.",
    covered: "I'm keeping my letters covered while I rest by the tea table.",
    leaving: "I've finished my break. I'm taking the letters to the next stop.",
};
export function teaCourierPath(from:number,to:number) {
    const mask=sectorWalkMask(TEA_COURIER_SECTOR)!.map((row,y)=>[...row].map((cell,x)=>
        (TEA_TABLE_CLEARANCE as readonly number[]).includes(y*12+x)?'#':cell).join(''));
    return pathInMask(mask,from,to);
}
/** Phases travel with the cached actor so an offline Talk cannot claim that an
 * arriving or departing courier is still resting at the table. */
export function teaCourierVisit(actor:LifeActor,arrival:number,departure:number,now:number,wet:boolean):LifeActor {
    const start=actor.motion!.start;
    const phase=(at:number,activity:string,line:string):LifePhase=>({at,activity,line,returnGreeting:`Good to see you again. ${line}`});
    const phases=[phase(start,'Walking to the tea stop',TEA_COURIER_LINES.arriving),
        {...phase(start+arrival,wet?'Keeping the letters covered':'Resting at the tea table',wet?TEA_COURIER_LINES.covered:TEA_COURIER_LINES.resting),workTile:actor.restTile,approach:{activity:'Walking to the tea stop',line:TEA_COURIER_LINES.arriving}},
        phase(start+departure,'Continuing along the road',TEA_COURIER_LINES.leaving)];
    return {...actor,...lifeActivityAt({...actor,phases},now),phases,
        // The portrait leaves through the actual road even if the next poll is
        // lost. The resting place stays the mat, distinct from the road exit.
        clearance:TEA_TABLE_CLEARANCE,hideTile:actor.motion!.frames.at(-1)![1],hideAt:start+300_000};
}
