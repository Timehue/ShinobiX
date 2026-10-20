import type {LifeActor} from './sector-life.js';
import {lifeActivityAt,type LifePhase} from './sector-life-motion.js';
import {sectorWalkMask,pathInMask} from './sector-walk-mask.js';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from './world-clock.js';

export const MIDLANDS_FIELD={sector:42,work:[127,115] as const,meeting:[89,90] as const,south:137,paintings:['midlands-herb-tea-stop-v2','midlands-herb-chronicle-table-v2']} as const;
// Actual tea table, staff point, mats and barrel; the clear vertical public road
// remains usable. These are actor-only paths, never a public/resource mask edit.
export const MIDLANDS_CROP_TILES=[104,105,106,116,117,118,128,129,130];
export const MIDLANDS_WORK_CLEARANCE=[98,99,100,110,111,112,...MIDLANDS_CROP_TILES];
export const MIDLANDS_FIELD_LINES={
    work:"I'm loosening the soil along these herb rows. I leave the plants in place.",
    approach:"I'm heading back to the work patch beside the road.",
    return:"The soil round is finished. I'm going back to my road post.",
    south:"I'm checking the southern road before I go back to the eastern one.",
    southApproach:"I'm heading down to check the southern road.",
    east:"I've checked the southern road. I'm going back to the eastern road post.",
    weather:"I'm waiting here until the weather eases before I work the soil again.",
    courierWeather:"I'm waiting here until I can check the next road clearly.",
    fallback:"I'm checking the verge while I wait for the next work round.",
};
const mask=sectorWalkMask(42)!.map((row,y)=>[...row].map((cell,x)=>MIDLANDS_WORK_CLEARANCE.includes(y*12+x)?'#':cell).join(''));
export function midlandsWorkPath(from:number,to:number){
    const ends=[from,to].filter(tile=>MIDLANDS_WORK_CLEARANCE.includes(tile));
    const local=ends.length?mask.map((row,y)=>[...row].map((cell,x)=>ends.includes(y*12+x)?sectorWalkMask(42)![y][x]:cell).join('')):mask;
    return pathInMask(local,from,to);
}
const path=(from:number,to:number)=>{const route=midlandsWorkPath(from,to);if(!route)throw Error(`Disconnected Midlands work route ${from}:${to}`);return route;};
type Crew={names:readonly[string,string];roles:readonly[LifeActor['art'],LifeActor['art']];jobs:readonly[string,string];lines:readonly[string,string]};
type Frame=readonly[number,number];
const cache=new Map<string,{homes:number[];paths:number[][];meetingAt:number;workAt:number;period:number;frames:Frame[][];phases:LifePhase[][]}>();
function routes(posts:readonly[number,number],crew:Crew){
    const key=posts.join(':');const cached=cache.get(key);if(cached)return cached;
    const paths=posts.map((post,i)=>path(post,MIDLANDS_FIELD.meeting[i]).slice(1)),homes=paths.map(route=>route[0]);
    const meetingAt=60_000+Math.max(...paths.map(route=>(route.length-1)*3000)),workAt=meetingAt+30_000;
    const frames:Frame[][]=[],phases:LifePhase[][]=[],ends:number[]=[];
    for(let i=0;i<2;i++){
        const rest=MIDLANDS_FIELD.meeting[i],list:Frame[]=[[0,homes[i]],[60_000,homes[i]]];let at=60_000,tile=homes[i];
        const hold=(until:number)=>{if(until>at){at=until;list.push([at,tile]);}};
        const walk=(to:number)=>{for(const next of path(tile,to).slice(1)){at+=3000;tile=next;list.push([at,tile]);}};
        walk(rest);const arrived=at;hold(meetingAt);hold(workAt);
        const approach={activity:'Walking to the handover',line:`I'm heading to meet ${crew.names[1-i]} before the next round.`};
        const cycle:LifePhase[]=[{at:0,activity:crew.jobs[i],line:crew.lines[i]},{at:60_000,...approach},
            {at:arrived,activity:'Waiting for the other worker',line:`I'm waiting for ${crew.names[1-i]} to finish the other approach.`},
            {at:meetingAt,activity:'Exchanging road news',line:`I'm comparing the approaches with ${crew.names[1-i]} before the next round.`,workTile:rest,approach}];
        if(i===0){
            const going={activity:'Walking to the herb patch',line:MIDLANDS_FIELD_LINES.approach};cycle.push({at:workAt,...going});
            for(const target of MIDLANDS_FIELD.work){walk(target);cycle.push({at,activity:'Tending the roadside herb rows',line:MIDLANDS_FIELD_LINES.work,working:true,workTile:target,approach:going});hold(at+20_000);if(target!==MIDLANDS_FIELD.work[1])cycle.push({at,...going});}
            cycle.push({at,activity:'Returning to the road post',line:MIDLANDS_FIELD_LINES.return});walk(homes[i]);
        }else{
            const going={activity:'Walking to the southern road',line:MIDLANDS_FIELD_LINES.southApproach};cycle.push({at:workAt,...going});walk(MIDLANDS_FIELD.south);
            cycle.push({at,activity:'Checking the southern road',line:MIDLANDS_FIELD_LINES.south,workTile:MIDLANDS_FIELD.south,approach:going});hold(at+20_000);
            cycle.push({at,activity:'Returning to the road post',line:MIDLANDS_FIELD_LINES.east});walk(homes[i]);
        }
        cycle.push({at,activity:crew.jobs[i],line:crew.lines[i]});frames.push(list);phases.push(cycle);ends.push(at);
    }
    const period=Math.max(...ends)+60_000;frames.forEach((list,i)=>list.push([period,homes[i]]));
    const result={homes,paths,meetingAt,workAt,period,frames,phases};cache.set(key,result);return result;
}

/** Two existing workers split after a real handover: soil work on the painted
 * aisle and a south/east courier circuit, then both return to their road posts. */
export function midlandsCrewActors(now:number,weather:string,posts:readonly[number,number],occupied:readonly number[],crew:Crew):LifeActor[]{
    if(MIDLANDS_FIELD.meeting.some(tile=>occupied.includes(tile)))return [];
    const plan=routes(posts,crew),start=Math.floor(now/WORLD_DAY_MS)*WORLD_DAY_MS+5*WORLD_HOUR_MS,duration=15*WORLD_HOUR_MS;
    const home=MIDLANDS_FIELD.meeting.map((tile,i)=>path(tile,posts[i]));
    const closingAt=Math.floor((duration-Math.max(...home.map(route=>(route.length-1)*3000))-10_000)/plan.period)*plan.period;
    const closing=now>=start+closingAt,wet=!closing&&['rain','thunderstorm','tornado','ashfall'].includes(weather);
    return plan.homes.map((workTile,i)=>{
        const rest=MIDLANDS_FIELD.meeting[i],ending={at:start+closingAt,frames:[[0,workTile],[3000,posts[i]]] as const};
        const phases:LifePhase[]=[...(wet?[{at:start,activity:'Waiting out the weather',line:i===0?MIDLANDS_FIELD_LINES.weather:MIDLANDS_FIELD_LINES.courierWeather,workTile:rest,approach:{activity:'Walking back to the road',line:"I'm going back to the handover point until the weather eases."}}]:[]),
            {at:start+closingAt,activity:'Finishing the road round',line:"We're finishing the round. I'll wait at the road entrance before I leave."},
            {at:start+duration,activity:'Continuing along the road',line:"I've finished the round. I'm continuing along the road."}];
        const actor:LifeActor={id:`crew:42:${i}`,name:crew.names[i],art:crew.roles[i],tile:closing?posts[i]:rest,restTile:closing?posts[i]:rest,workTile,
            activity:crew.jobs[i],line:crew.lines[i],atRest:wet||closing,clearance:MIDLANDS_WORK_CLEARANCE,hideAt:start+duration,hideTile:posts[i],
            ...(i===0?{workTool:!wet&&!closing?'hoe' as const:undefined,surfaceWork:{sector:42,paintings:MIDLANDS_FIELD.paintings,fallback:{activity:'Checking the roadside verge',line:MIDLANDS_FIELD_LINES.fallback}}}:{}),
            motion:closing?{start:ending.at,frames:ending.frames}:wet?{start,frames:[[0,rest],[closingAt,rest],...home[i].slice(1).map((tile,index)=>[closingAt+(index+1)*3000,tile] as const)]}:{start,repeat:plan.period,frames:plan.frames[i],ending},
            phases,cyclePhases:wet||closing?undefined:plan.phases[i]};
        const current=lifeActivityAt(actor,now);return{...actor,activity:current.activity,line:current.line};
    });
}
