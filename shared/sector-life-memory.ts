import { WORLD_DAY_MS } from './world-clock.js';
import { shrineForSector } from './shrines.js';
import { SECTOR_FLOOR_LAYOUTS } from './sector-floor-layouts.js';
import { sectorArtKey } from './sector-geo.js';
import { sectorExits } from './sector-links.js';
import { walkPath } from './sector-walk-mask.js';
import type { LifeActor,LifeEventView } from './sector-life.js';
import { LIFE_EVENTS } from './sector-life-content.js';
import { shrineStandingSpots } from './sector-shrine-scenes.js';
import {shrineWork,shrineVisitorPath,SHRINE_SWEEP_CLEARANCE} from './sector-shrine-work.js';

export const SHRINE_CARE_MS=WORLD_DAY_MS;
export const HEARTWOOD_SHRINE_ROUND={keeper:111,steps:[123,110,112] as const};
export type LifeShrineCare={maintainedAt:number;by:string;visitorSince?:number};
export type LifeShrineMemory=LifeShrineCare&{tier:number;supportStartedAt?:number};
export const LIFE_SHRINE_LINES={
    keeperHelp:"I could use a hand with the lamps. Please start with the left one.",
    keeperStand:"I look after this shrine. Please leave the approach clear for visitors.",
    arriving:"I'm going to spend a moment at the shrine.",leaving:"I'm carrying on along the road now.",visiting:"I've stopped to visit the shrine before I go on.",
};
export const shrineKeeperThanks=(name:string)=>`${name} helped with the last round. I'm keeping an eye on the shrine.`;
export function parseShrineCare(raw:unknown,now:number):LifeShrineCare {
    const value=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
    const at=Number(value.maintainedAt);
    const since=Number(value.visitorSince);
    return {maintainedAt:Number.isFinite(at)&&at>0&&at<=now?at:0,by:typeof value.by==='string'?value.by.trim().slice(0,40):'',
        ...(Number.isFinite(since)&&since>0&&since<=at&&at<=now?{visitorSince:since}:{})};
}

/** Renew the oil without restarting visitors who are already on their route. */
export function renewShrineCare(previous:LifeShrineCare|undefined,by:string,now:number,supportStartedAt?:number):LifeShrineCare {
    const care=parseShrineCare(previous,now);
    const continuing=care.maintainedAt>0&&(now-care.maintainedAt<SHRINE_CARE_MS||supportStartedAt!==undefined&&(supportStartedAt===0||supportStartedAt<care.maintainedAt+SHRINE_CARE_MS));
    return {maintainedAt:now,by:by.trim().slice(0,40),visitorSince:continuing?care.visitorSince??care.maintainedAt:now};
}

/** Fixed lamps are part of the floor in every state. Upkeep changes their
 * light, and supported shrines attract real road visitors rather than icons. */
export function shrineLife(sector:number,memory:LifeShrineMemory|undefined,event:LifeEventView,now:number,occupied:readonly number[],weather='clear') {
    const care=memory??{tier:0,maintainedAt:0,by:''},completed=event.kind==='shrine'&&event.phase==='aftermath';
    const maintainedAt=completed?Math.max(care.maintainedAt,event.updatedAt):care.maintainedAt;
    const supported=care.tier>0||maintainedAt>0&&now-maintainedAt<SHRINE_CARE_MS||completed;
    const shrine=shrineForSector(sector);
    const painting=shrine?`${shrine.id}-${care.tier>=2?'radiant-shrine':supported?'supported-shrine':sector===15&&event.kind==='shrine'&&event.step>=2?'left-lamp':'dormant-shrine'}${sector===31?'-supply-v2':'-v1'}`:undefined;
    const site=SECTOR_FLOOR_LAYOUTS[sectorArtKey(sector)]?.sites.shrine;
    const actors:LifeActor[]=[];
    if(!site||!shrine||!supported&&sector!==15)return {painting,actors};
    const used=new Set([...occupied,...(sector===15?SHRINE_SWEEP_CLEARANCE:[])]),choose=(target:number)=>{
        const candidates=Array.from({length:144},(_,tile)=>({tile,path:walkPath(sector,site.approach,tile)}))
            .filter(item=>item.path&&!used.has(item.tile));
        const chosen=candidates.sort((a,b)=>Math.abs(a.tile%12-target%12)+Math.abs(Math.floor(a.tile/12)-Math.floor(target/12))-(Math.abs(b.tile%12-target%12)+Math.abs(Math.floor(b.tile/12)-Math.floor(target/12)))||a.path!.length-b.path!.length)[0]?.tile??site.approach;
        used.add(chosen);return chosen;
    };
    const stops=shrineStandingSpots(sector);
    const keeper=sector===15?HEARTWOOD_SHRINE_ROUND.keeper:choose(stops[0]??site.approach);used.add(keeper);
    actors.push(shrineWork({id:`keeper:${sector}`,name:'Shrine Keeper',art:'caretaker',tile:keeper,workTile:keeper,restTile:keeper,atRest:true,
        activity:sector===15?'Looking after the shrine lamps':'Looking after the shrine entrance',
        line:sector===15&&event.kind==='shrine'&&event.phase==='active'?(event.step?LIFE_EVENTS.shrine.replies[event.step-1]:LIFE_SHRINE_LINES.keeperHelp):care.by&&supported?shrineKeeperThanks(care.by):LIFE_SHRINE_LINES.keeperStand},sector,event,now,weather));
    if(!supported)return {painting,actors};
    const careStart=care.visitorSince??maintainedAt,fundedStart=care.supportStartedAt??0;
    // Legacy funded shrines use the established global waves. A new funding
    // threshold starts a real arrival; later gifts never restart those waves.
    const since=care.tier>0?fundedStart>0?careStart>0&&maintainedAt+SHRINE_CARE_MS>fundedStart?Math.min(careStart,fundedStart):fundedStart:0:careStart;
    const period=600_000,anchor=since>0?since+2000:0;
    const wave=anchor+Math.max(0,Math.floor((now-anchor+20_000)/period))*period;
    for(let index=0;index<(care.tier>=2?2:1);index++) {
        const start=wave+index*60_000;
        if(now<start-20_000)continue;
        const rest=choose(stops[index+1]??site.approach+12+index),exits=sectorExits(sector).filter(exit=>shrineVisitorPath(sector,exit.tile,rest));
        const incoming=exits[index%exits.length],outgoing=exits[(index+1)%exits.length];
        if(!incoming||!outgoing)continue;
        const enter=shrineVisitorPath(sector,incoming.tile,rest)!,leave=shrineVisitorPath(sector,rest,outgoing.tile)!;
        const arrival=(enter.length-1)*3000,departure=arrival+120_000,end=start+departure+(leave.length-1)*3000;
        if(now>end+1500)continue;
        const arriving=now<start+arrival,leaving=now>=start+departure;
        actors.push({id:`pilgrim:${sector}:${index}`,name:'Shrine Visitor',art:index===0?'courier':'forager',tile:rest,workTile:rest,restTile:rest,atRest:true,
            activity:arriving?'Walking to the shrine':leaving?'Continuing along the road':'Visiting the shrine',
            line:arriving?LIFE_SHRINE_LINES.arriving:leaving?LIFE_SHRINE_LINES.leaving:LIFE_SHRINE_LINES.visiting,
            hideAt:end,hideTile:outgoing.tile,
            phases:[{at:start,activity:'Walking to the shrine',line:LIFE_SHRINE_LINES.arriving},
                {at:start+arrival,activity:'Visiting the shrine',line:LIFE_SHRINE_LINES.visiting,workTile:rest,approach:{activity:'Walking to the shrine',line:LIFE_SHRINE_LINES.arriving}},
                {at:start+departure,activity:'Continuing along the road',line:LIFE_SHRINE_LINES.leaving}],
            clearance:sector===15?SHRINE_SWEEP_CLEARANCE:undefined,motion:{start,frames:[...enter.map((tile,i)=>[i*3000,tile] as const),...leave.map((tile,i)=>[departure+i*3000,tile] as const)]}});
    }
    return {painting,actors};
}
