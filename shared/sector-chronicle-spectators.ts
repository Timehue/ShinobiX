import type {LifeActor} from './sector-life.js';
import {lifeActivityAt,type LifePhase} from './sector-life-motion.js';
import {roadVisit} from './sector-road-visit.js';
import {chronicleStopPath,chronicleStopPlan,CHRONICLE_WATCH_TILES,WALK_CLEARANCE,type ChronicleStopState,type StopGameView} from './sector-chronicle-stop.js';

export const CHRONICLE_WATCH_LINES={
    approach:"I'm going to watch from beside the tea table.",
    waiting:"I'm waiting for the travelers to get the table ready.",
    interrupted:"They stopped the match early. They're putting the cards away.",
    unfinished:"They've stopped playing and are putting the cards away.",
    leaving:"They've packed their cards. I'm leaving room for them to reach the road.",
    returning:"The travelers have left the table. I'm going back to the tea mat.",
    resting:"I'm stopping here for a rest before I carry on.",
};
function watching(tile:number,state:ChronicleStopState,game:StopGameView,goneAt:number):LifePhase[]{
    const p=chronicleStopPlan(state,game),approach={activity:'Walking to watch the match',line:CHRONICLE_WATCH_LINES.approach};
    const phase=(at:number,activity:string,line:string):LifePhase=>({at,activity,line,workTile:tile,approach});
    return [phase(p.start,'Waiting to watch Chronicle',CHRONICLE_WATCH_LINES.waiting),
        ...game.turns.flatMap((turn,i)=>p.matchAt+i*p.turnMs<p.packAt?[phase(p.matchAt+i*p.turnMs,'Watching Chronicle',`${turn.player} is taking turn ${turn.turn}. Their life points are ${turn.life[0]} and ${turn.life[1]}.`)]:[]),
        phase(p.packAt,'Watching the travelers pack',state.closedAt!==undefined?CHRONICLE_WATCH_LINES.interrupted:game.winner?`${game.winner} won the match. They're putting the cards away.`:game.finished?"The match ended in a draw. They're putting the cards away.":CHRONICLE_WATCH_LINES.unfinished),
        phase(p.cardsUntil,'Leaving room for the travelers',CHRONICLE_WATCH_LINES.leaving),
        phase(goneAt,'Resting beside the road',CHRONICLE_WATCH_LINES.resting)];
}
/** Retarget existing people only. Both positions leave the south road open and
 * have a clear view of the actual table, outside the planted beds. */
export function chronicleSpectator(actor:LifeActor,state:ChronicleStopState,game:StopGameView,goneAt:number,now:number,createdAt:number):LifeActor{
    const {start,packAt}=chronicleStopPlan(state,game),tile=CHRONICLE_WATCH_TILES[actor.id==='gen'?1:0];
    let next:LifeActor;
    if(actor.id==='visitor:42'){
        const seat=110,out=createdAt>start?[tile]:chronicleStopPath(seat,tile,seat)!,back=chronicleStopPath(tile,seat,seat)!,returned=goneAt+(back.length-1)*2500;
        const approach={activity:'Returning to the tea mat',line:CHRONICLE_WATCH_LINES.returning};
        const phases=[...watching(tile,state,game,goneAt).filter(p=>p.at<goneAt),{at:goneAt,...approach},
            {at:returned,activity:'Resting at the stop',line:CHRONICLE_WATCH_LINES.resting,workTile:seat,approach}];
        next={...actor,workTile:tile,restTile:seat,clearance:WALK_CLEARANCE.filter(t=>t!==tile&&t!==seat),phases,motion:{start,frames:[...out.map((t,i)=>[i*2500,t] as const),...back.map((t,i)=>[goneAt-start+i*2500,t] as const)]}};
    }else{
        const entry=actor.motion!.frames[0][1],exit=actor.motion!.frames.at(-1)![1],arriving=chronicleStopPath(entry,tile,tile)!,leaving=chronicleStopPath(tile,exit,tile)!;
        const arrival=(arriving.length-1)*3000,departure=300_000-(leaving.length-1)*3000,original=actor.phases!.find(p=>p.workTile!==undefined)!;
        if(actor.motion!.start+arrival>=packAt)return actor;
        next=roadVisit({...actor,tile,restTile:tile,workTile:tile,clearance:WALK_CLEARANCE.filter(t=>t!==tile),motion:{start:actor.motion!.start,frames:[...arriving.map((t,i)=>[i*3000,t] as const),...leaving.map((t,i)=>[departure+i*3000,t] as const)]}},arrival,departure,now,original);
        const watch=watching(tile,state,game,goneAt).map(p=>({...p,returnGreeting:`Good to see you again. ${p.line}`})),arrived=next.motion!.start+arrival;
        next.phases=[...next.phases!.filter(p=>p.at!==arrived),...watch.filter(p=>p.at>=arrived&&p.at<next.motion!.start+departure),
            {...lifeActivityAt({activity:'Waiting to watch Chronicle',line:CHRONICLE_WATCH_LINES.waiting,phases:watch},arrived),at:arrived}].sort((a,b)=>a.at-b.at);
    }
    return{...next,...lifeActivityAt(next,now)};
}
