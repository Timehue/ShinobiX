import { walkPath,pathInMask,type WalkMask,nearestWalkableTile,sectorWalkMask } from './sector-walk-mask.js';
import { isWorldNight } from './world-phase.js';
import { WORLD_DAY_MS,WORLD_HOUR_MS } from './world-clock.js';
import type { LifeActor } from './sector-life.js';
import {lifeActivityAt,type LifeMotion,type LifePhase} from './sector-life-motion.js';
import {midlandsCrewActors} from './sector-midlands-work.js';
import {festivalCrewActors} from './sector-festival-work.js';

/** Workers meet on real ground; Ashen Leaf's pair then practise native footwork
 * in a reviewed grass clearing beside the road. No props or combat rewards. */
export const LIFE_TRAINING_LINES={practice:"We step forward and back together, then return to our road posts.",approach:"I'm heading to the practice patch. Leave us room for the steps."} as const;
export const LIFE_ROAD_CREWS:Readonly<Record<number,{names:readonly[string,string];roles:readonly[LifeActor['art'],LifeActor['art']];jobs:readonly[string,string];lines:readonly[string,string];meeting:readonly[number,number];handover?:{activity:string;lines:readonly[string,string]};clearance?:readonly number[];training?:readonly[number,number];night?:boolean;pavedOnly?:boolean}>>={
    2:{names:['Dock Runner Yori','Dock Runner Hana'],roles:['courier','courier'],jobs:['Watching the incoming dock road','Checking the outgoing dock road'],lines:["I'm watching for people coming down to the docks.","I check the outgoing road before the next dock run."],meeting:[54,42],pavedOnly:true},
    9:{names:['Scout Riku','Pathfinder Aya'],roles:['forager','forager'],jobs:['Watching the forest approach','Checking the outward path'],lines:["I watch this approach while Aya checks the other path.","Riku and I meet to compare the paths before the next round."],meeting:[74,73],training:[62,61]},
    24:{names:['Keeper Yui','Keeper Sho'],roles:['caretaker','caretaker'],jobs:['Walking the evening round','Watching the other crossing'],lines:["Sho and I check opposite approaches, then meet to compare what we've seen.","I meet Yui between rounds. It's easier to miss a turn after dark."],meeting:[77,78],night:true},
    31:{names:['Trail Watch Emi','Trail Watch Ryo'],roles:['guard','guard'],jobs:['Watching the snow approach','Checking the outward snow path'],lines:["I come back to the brazier between road checks.","Emi and I compare the paths before we go back out."],meeting:[125,126],clearance:[101,102,113,114],handover:{activity:'Warming up between road rounds',lines:["I'm warming up by the brazier and comparing the snow paths with Trail Watch Ryo.","I'm warming up by the brazier and comparing the snow paths with Trail Watch Emi."]}},
    42:{names:['Field Runner Suzu','Road Courier Kota'],roles:['forager','courier'],jobs:['Watching the field road','Checking the eastern road'],lines:["I tend the ground beside the road between crossing checks.","I check the southern road, then return to the eastern road between our handovers."],meeting:[124,125]},
    46:{names:['Gate Watch Jiro','Gate Watch Noe'],roles:['guard','guard'],jobs:['Watching the north approach','Watching the other approach'],lines:["Noe and I meet between rounds, then go back to our approaches.","I compare the approaches with Jiro before the next round."],meeting:[77,78]},
    50:{names:['City Runner Toru','City Runner Mio'],roles:['courier','courier'],jobs:['Checking the incoming city road','Watching the onward city road'],lines:["Mio and I meet here to compare the city approaches.","I check the onward road while Toru watches the other approach."],meeting:[77,78]},
    52:{names:['Festival Guide Nene','Festival Runner Ko'],roles:['caretaker','courier'],jobs:['Watching for festival arrivals','Checking the festival approach'],lines:["I meet Ko between groups, then go back to watch for arrivals.","Nene watches for arrivals while I check the road."],meeting:[88,89]},
};

const routeCache=new Map<string,{paths:number[][];meetingAt:number;trainingAt:number;leavingAt:number;period:number;drills?:readonly[number,number]}>();
const crewMasks=new Map<number,WalkMask>();
function crewPath(sector:number,from:number,to:number){
    const clearance=LIFE_ROAD_CREWS[sector]?.clearance;if(!clearance)return walkPath(sector,from,to);
    let mask=crewMasks.get(sector);if(!mask){mask=sectorWalkMask(sector)!.map((row,y)=>[...row].map((cell,x)=>clearance.includes(y*12+x)?'#':cell).join(''));crewMasks.set(sector,mask);}
    return pathInMask(mask,from,to);
}
function crewRoute(sector:number,posts:readonly[number,number],occupied:readonly number[]) {
    const key=[sector,...posts,...occupied].join(':'),cached=routeCache.get(key);if(cached)return cached;
    const crew=LIFE_ROAD_CREWS[sector],taken=new Set([...occupied,...posts]),meetings:number[]=[];
    const free=Array.from({length:144},(_,t)=>t).filter(t=>!taken.has(t)&&crewPath(sector,posts[0],t)&&(!crew.pavedOnly||sectorWalkMask(sector)?.[Math.floor(t/12)]?.[t%12]==='='));
    const adjacent=(a:number,b:number)=>Math.abs(a%12-b%12)+Math.abs(Math.floor(a/12)-Math.floor(b/12))===1;
    const sideBySide=(a:number,b:number)=>Math.floor(a/12)===Math.floor(b/12)&&Math.abs(a%12-b%12)===1;
    crew.meeting.forEach((tile,index)=>{
        // Authored gathering points may overlap a sign or workplace after an art
        // change. Pick the closest connected free tile, never the same tile twice.
        const candidates=free.filter(t=>!taken.has(t)&&(index?adjacent(t,meetings[0]):free.some(other=>adjacent(t,other))));
        // Side-by-side meetings keep the two portrait/name stacks separate on
        // narrow screens. Retain a vertical meeting on a narrow vertical path.
        const horizontal=candidates.filter(t=>index?sideBySide(t,meetings[0]):free.some(other=>sideBySide(t,other)));
        const nearest=nearestWalkableTile(sector,tile);
        const picked=(horizontal.length?horizontal:candidates).sort((a,b)=>Math.hypot(a%12-nearest%12,Math.floor(a/12)-Math.floor(nearest/12))-Math.hypot(b%12-nearest%12,Math.floor(b/12)-Math.floor(nearest/12)))[0];
        taken.add(picked);meetings.push(picked);
    });
    // The resident already uses the road mouth. Put each additional worker one
    // step inward, so the two roles don't stand on top of one another at work.
    const paths=posts.map((post,index)=>{
        const path=crewPath(sector,post,meetings[index])!;return path.length>2?path.slice(1):path;
    });
    const drills=crew.training?.every((tile,i)=>free.includes(tile)&&sectorWalkMask(sector)?.[Math.floor(tile/12)]?.[tile%12]==='.'&&walkPath(sector,paths[i].at(-1)!,tile)?.length===2)?crew.training:undefined;
    const travel=Math.max(...paths.map(path=>(path.length-1)*3000)),meetingAt=60_000+travel,trainingAt=meetingAt+30_000,leavingAt=trainingAt+(drills?24_000:0),period=leavingAt+travel+60_000;
    const result={paths,meetingAt,trainingAt,leavingAt,period,drills};routeCache.set(key,result);return result;
}

export function roadCrewActors(sector:number,now:number,weather:string,posts:readonly[number,number],occupied:readonly number[]):LifeActor[] {
    const crew=LIFE_ROAD_CREWS[sector],night=isWorldNight(now);
    if(!crew||night!==!!crew.night)return [];
    if(sector===42)return midlandsCrewActors(now,weather,posts,occupied,crew);
    if(sector===52)return festivalCrewActors(now,weather,posts,occupied,crew);
    const {paths,meetingAt,trainingAt,leavingAt,period,drills}=crewRoute(sector,posts,occupied);
    const opening=(crew.night?20:5)*WORLD_HOUR_MS,duration=(crew.night?9:15)*WORLD_HOUR_MS;
    let start=Math.floor(now/WORLD_DAY_MS)*WORLD_DAY_MS+opening;if(start>now)start-=WORLD_DAY_MS;
    const elapsed=now-start,travel=Math.max(...paths.map(path=>(path.length-1)*3000));
    // End full cycles before the shift closes. During the remaining time the
    // workers return to their road-mouth posts, including in bad weather, so
    // the next day/night transition removes them at an exit rather than mid-map.
    const closingAt=Math.floor((duration-travel-10_000)/period)*period,closing=elapsed>=closingAt;
    const phase=elapsed%period,wet=!closing&&['rain','thunderstorm','tornado','ashfall'].includes(weather),finish=start+duration;
    return paths.map((path,index)=>{
        const rest=closing?posts[index]:path.at(-1)!,travel=(path.length-1)*3000;
        const ending={at:start+closingAt,frames:[[0,path[0]],[3000,posts[index]]] as const};
        const home=crewPath(sector,rest,posts[index])!;
        const practice:readonly(readonly[number,number])[]=drills?[[trainingAt,rest],[trainingAt+3000,drills[index]],[trainingAt+6000,drills[index]],[trainingAt+9000,rest],[trainingAt+12000,rest],[trainingAt+15000,drills[index]],[trainingAt+18000,drills[index]],[trainingAt+21000,rest]]:[];
        const motion:LifeMotion=closing?{start:ending.at,frames:ending.frames}:wet?{start,frames:[[0,rest],[closingAt,rest],...home.slice(1).map((tile,i)=>[closingAt+(i+1)*3000,tile] as const)]}
            :{start,repeat:period,ending,frames:[[0,path[0]],...path.map((tile,i)=>[60_000+i*3000,tile] as const),...practice,...[...path].reverse().map((tile,i)=>[leavingAt+i*3000,tile] as const),[period,path[0]]]};
        const phases:LifePhase[]=[{at:start+closingAt,activity:'Finishing the road round',line:"We're finishing the round. I'll wait at the road entrance before I leave."},{at:finish,activity:'Continuing along the road',line:"I've finished the round. I'm continuing along the road."}];
        const walking={activity:'Walking to the handover',line:`I'm heading to meet ${crew.names[1-index]} before the next round.`};
        const cyclePhases:LifePhase[]|undefined=closing||wet?undefined:[
            {at:0,activity:crew.jobs[index],line:crew.lines[index]},
            {at:60_000,...walking},
            {at:60_000+travel,activity:'Waiting for the other worker',line:`I'm waiting for ${crew.names[1-index]} to finish the other approach.`},
            {at:meetingAt,activity:crew.handover?.activity??'Exchanging road news',line:crew.handover?.lines[index]??`I'm comparing the approaches with ${crew.names[1-index]}. We check different parts of the road.`,workTile:rest,approach:walking},
            ...(drills?[{at:trainingAt,activity:'Practising footwork',line:LIFE_TRAINING_LINES.practice,workArea:{col:rest%12,row:Math.floor(drills[index]/12),columns:1,rows:2},approach:{activity:'Walking to the practice patch',line:LIFE_TRAINING_LINES.approach}}]:[]),
            {at:leavingAt,activity:'Returning to the road post',line:"I'm going back to my road post."},
            {at:leavingAt+travel,activity:crew.jobs[index],line:crew.lines[index]},
        ];
        const actor:LifeActor={id:`crew:${sector}:${index}`,name:crew.names[index],art:crew.roles[index],tile:rest,workTile:path[0],restTile:rest,
            activity:wet?'Waiting out the weather':crew.jobs[index],line:wet?"We've stopped here while the view of the road is poor.":crew.lines[index],
            bark:!closing&&phase>=meetingAt&&phase<trainingAt?'Your turn on the road.':undefined,atRest:wet||closing,motion,phases,cyclePhases,clearance:crew.clearance,hideAt:finish,hideTile:posts[index]};
        const current=lifeActivityAt(actor,now);return {...actor,activity:current.activity,line:current.line};
    });
}
