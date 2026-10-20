import type {LifeActor} from './sector-life.js';
import {lifeActivityAt,type LifePhase} from './sector-life-motion.js';
import {pathInMask,sectorWalkMask} from './sector-walk-mask.js';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from './world-clock.js';

export const FESTIVAL_SITE={sector:52,counter:104,rest:92,meeting:[88,89] as const,square:[88,89,101,100] as const,
    open:'festival-tea-counter-open-v1',packed:'festival-tea-counter-packed-v1'};
export const FESTIVAL_STAGE=[88,89,100,101];
export const FESTIVAL_CLEARANCE=[...FESTIVAL_STAGE,92,104];
export const FESTIVAL_LINES={
    approach:"I'm going back to the working side of the building.",
    preparing:"I'm getting the bowls and kettle ready for the next festival group.",
    collecting:"I'm bringing out the last bowls before I open the counter.",
    serving:"The kettle and bowls are ready. I'm watching the counter for arriving groups.",
    packing:"I'm putting the bowls away and covering the serving ledge.",
    securing:"The bowls are away. I'm checking the cover before I stop for the night.",
    resting:"I've finished for tonight. I'll wait beside the building for late arrivals.",
    weather:"I'll wait beside the building until the weather eases.",
    fallback:"I'm waiting for the next festival group. I can point them toward the road.",
    steps:"These are the festival steps. I go round the square, then return to the entrance.",
    otherSteps:"I follow the same square from the other corner, then go back to the road.",
    takingPlace:"I'm taking my place in the clearing for the festival steps.",
    returning:"The steps are finished. I'm going back to watch for arrivals.",
};
const masks=[FESTIVAL_CLEARANCE,[92,104]].map(clearance=>sectorWalkMask(52)!.map((row,y)=>[...row].map((cell,x)=>clearance.includes(y*12+x)?'#':cell).join('')));
export function festivalWalkPath(from:number,to:number,performer=false){
    const clearance=performer?[92,104]:FESTIVAL_CLEARANCE;
    const ends=[from,to].filter(tile=>clearance.includes(tile));
    const mask=ends.length?masks[Number(performer)].map((row,y)=>[...row].map((cell,x)=>ends.includes(y*12+x)?sectorWalkMask(52)![y][x]:cell).join('')):masks[Number(performer)];
    return pathInMask(mask,from,to);
}
function path(from:number,to:number,performer=false){const result=festivalWalkPath(from,to,performer);if(!result)throw Error(`Disconnected festival route ${from}:${to}`);return result;}
export function festivalStallPlan(now:number){
    let start=Math.floor(now/WORLD_DAY_MS)*WORLD_DAY_MS+5*WORLD_HOUR_MS;if(start>now)start-=WORLD_DAY_MS;
    const closeAt=start+15*WORLD_HOUR_MS,packAt=closeAt-30_000,coveredAt=packAt+12_000;
    return{start,openAt:start+24_000,packAt,coveredAt,returnAt:coveredAt+4000,restAt:coveredAt+7000,closeAt};
}
const wet=(weather:string)=>['rain','thunderstorm','tornado','ashfall'].includes(weather);
export function festivalStallPainting(now:number,weather:string){
    const p=festivalStallPlan(now);
    if(wet(weather)||now>=p.coveredAt)return{painting:FESTIVAL_SITE.packed,paintingUntil:undefined,paintingNext:undefined};
    if(now<p.openAt)return{painting:FESTIVAL_SITE.packed,paintingUntil:undefined,paintingNext:{at:p.openAt,key:FESTIVAL_SITE.open,until:p.coveredAt}};
    return{painting:FESTIVAL_SITE.open,paintingUntil:p.coveredAt,paintingNext:undefined};
}
/** The original cook and original courier errand remain. Only the cook's work
 * route/presentation changes; overnight and rain leave a visible requester. */
export function festivalStallActor(actor:LifeActor,now:number,weather:string):LifeActor{
    const p=festivalStallPlan(now),{rest,counter,open,packed}=FESTIVAL_SITE;
    const approach={activity:'Walking beside the festival building',line:FESTIVAL_LINES.approach};
    const work=(at:number,activity:string,line:string,tile=counter,surfacePaintings:readonly string[]=[open,packed]):LifePhase=>({at,activity,line,working:true,workTile:tile,approach,surfacePaintings});
    const phases:LifePhase[]=wet(weather)?[{at:p.start,activity:'Waiting out the weather',line:FESTIVAL_LINES.weather,workTile:rest,approach}]:[
        work(p.start,'Preparing the festival counter',FESTIVAL_LINES.preparing),
        work(p.start+10_000,'Collecting the festival bowls',FESTIVAL_LINES.collecting,rest),
        work(p.start+17_000,'Preparing the festival counter',FESTIVAL_LINES.preparing),
        work(p.openAt,'Serving at the festival counter',FESTIVAL_LINES.serving,counter,[open]),
        work(p.packAt,'Packing the festival counter',FESTIVAL_LINES.packing),
        work(p.coveredAt,'Securing the covered counter',FESTIVAL_LINES.securing),
        {at:p.returnAt,...approach},
        {at:p.restAt,activity:'Waiting beside the festival building',line:FESTIVAL_LINES.resting,workTile:rest,approach},
    ];
    const frames:readonly(readonly[number,number])[]=wet(weather)?[[0,rest]]:[[0,rest],[3000,counter],[10_000,counter],[13_000,rest],[17_000,rest],[20_000,counter],[24_000,counter],
        [p.packAt-p.start,counter],[p.coveredAt-p.start,counter],[p.returnAt-p.start,counter],[p.restAt-p.start,rest],[p.closeAt-p.start,rest]];
    const next:LifeActor={...actor,tile:counter,workTile:counter,restTile:rest,atRest:wet(weather)||now>=p.restAt,
        motion:{start:p.start,frames},phases,clearance:FESTIVAL_STAGE,
        surfaceWork:{sector:52,paintings:[open,packed],fallback:{activity:'Waiting for festival arrivals',line:FESTIVAL_LINES.fallback}}};
    const current=lifeActivityAt(next,now);return{...next,activity:current.activity,line:current.line};
}

type Crew={names:readonly[string,string];roles:readonly[LifeActor['art'],LifeActor['art']];jobs:readonly[string,string];lines:readonly[string,string]};
type Frame=readonly[number,number];
const plans=new Map<string,{homes:number[];period:number;frames:Frame[][];phases:LifePhase[][]}>();
function festivalPerformancePlan(posts:readonly[number,number],crew:Crew){
    const key=posts.join(':');const cached=plans.get(key);if(cached)return cached;
    const inbound=posts.map((post,i)=>path(post,FESTIVAL_SITE.meeting[i],true).slice(1)),homes=inbound.map(route=>route[0]);
    const meetAt=60_000+Math.max(...inbound.map(route=>(route.length-1)*3000)),stageAt=meetAt+30_000,danceAt=stageAt+3000,endAt=danceAt+32_000,leaveAt=endAt+3000;
    const frames:Frame[][]=[],phases:LifePhase[][]=[];let finishAt=0;
    for(let i=0;i<2;i++){
        const meeting=FESTIVAL_SITE.meeting[i],list:Frame[]=[[0,homes[i]],[60_000,homes[i]]];let at=60_000,tile=homes[i];
        const hold=(until:number)=>{if(until>at){at=until;list.push([at,tile]);}};
        const walk=(to:number)=>{for(const next of path(tile,to,true).slice(1)){at+=3000;tile=next;list.push([at,tile]);}};
        walk(meeting);hold(meetAt);hold(stageAt);if(i)walk(101);hold(danceAt);
        const corner=i?2:0;
        for(let beat=1;beat<=8;beat++){walk(FESTIVAL_SITE.square[(corner+beat)%4]);hold(at+1000);}
        hold(endAt);if(i)walk(meeting);hold(leaveAt);walk(homes[i]);finishAt=Math.max(finishAt,at);
        const going={activity:'Walking to the handover',line:`I'm going to meet ${crew.names[1-i]} before the next group arrives.`};
        phases.push([{at:0,activity:crew.jobs[i],line:crew.lines[i]},
            {at:60_000,...going},{at:meetAt,activity:'Exchanging road news',line:`I'm comparing the festival approaches with ${crew.names[1-i]}.`,workTile:meeting,approach:going},
            {at:stageAt,activity:'Taking a place in the festival clearing',line:FESTIVAL_LINES.takingPlace},
            {at:danceAt,activity:'Demonstrating the festival steps',line:i?FESTIVAL_LINES.otherSteps:FESTIVAL_LINES.steps,workArea:{col:4,row:7,columns:2,rows:2},approach:{activity:'Walking to the festival clearing',line:FESTIVAL_LINES.takingPlace}},
            {at:endAt,activity:'Returning to the road post',line:FESTIVAL_LINES.returning},{at,activity:crew.jobs[i],line:crew.lines[i]}]);
        frames.push(list);
    }
    const period=finishAt+60_000;frames.forEach((list,i)=>list.push([period,homes[i]]));
    const result={homes,period,frames,phases};plans.set(key,result);return result;
}
/** Opposite corners keep the two native figures separated while they show two
 * clockwise laps. No extra actor, prop, particle, sound, endpoint or timer. */
export function festivalCrewActors(now:number,weather:string,posts:readonly[number,number],occupied:readonly number[],crew:Crew):LifeActor[]{
    if(FESTIVAL_STAGE.some(tile=>occupied.includes(tile)))return [];
    const plan=festivalPerformancePlan(posts,crew),start=Math.floor(now/WORLD_DAY_MS)*WORLD_DAY_MS+5*WORLD_HOUR_MS,duration=15*WORLD_HOUR_MS;
    const home=FESTIVAL_SITE.meeting.map((tile,i)=>path(tile,posts[i],true));
    const closingAt=Math.floor((duration-Math.max(...home.map(route=>(route.length-1)*3000))-10_000)/plan.period)*plan.period;
    const closing=now>=start+closingAt,rain=wet(weather)&&!closing;
    return plan.homes.map((workTile,i)=>{
        const rest=FESTIVAL_SITE.meeting[i],ending={at:start+closingAt,frames:[[0,workTile],[3000,posts[i]]] as const};
        const phases:LifePhase[]=[...(rain?[{at:start,activity:'Waiting out the weather',line:"I'll wait beside the road until I can see the approaches clearly.",workTile:rest,approach:{activity:'Returning to the festival approach',line:"I'm going back to wait beside the road."}}]:[]),
            {at:start+closingAt,activity:'Finishing the road round',line:"We're finishing the round. I'll wait at the road entrance before I leave."},
            {at:start+duration,activity:'Continuing along the road',line:"I've finished the round. I'm continuing along the road."}];
        const actor:LifeActor={id:`crew:52:${i}`,name:crew.names[i],art:crew.roles[i],tile:closing?posts[i]:rest,restTile:closing?posts[i]:rest,workTile,
            activity:crew.jobs[i],line:crew.lines[i],atRest:rain||closing,clearance:[92,104],hideAt:start+duration,hideTile:posts[i],phases,cyclePhases:rain||closing?undefined:plan.phases[i],
            motion:closing?{start:ending.at,frames:ending.frames}:rain?{start,frames:[[0,rest],[closingAt,rest],...home[i].slice(1).map((tile,index)=>[closingAt+(index+1)*3000,tile] as const)]}:{start,repeat:plan.period,frames:plan.frames[i],ending}};
        const current=lifeActivityAt(actor,now);return{...actor,activity:current.activity,line:current.line};
    });
}
