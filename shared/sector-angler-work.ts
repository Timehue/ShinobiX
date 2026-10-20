import {SECTOR_FLOOR_LAYOUTS} from './sector-floor-layouts.js';
import {sectorArtKey} from './sector-geo.js';
import {isWalkableTile,walkPath,tileNeighbors} from './sector-walk-mask.js';
import {isWorldNight} from './world-phase.js';
import {rollTradeWanderer} from './wanderer-extra-slots.js';
import {wandererDayBucketFromMs,WANDERER_BUCKET_MS,type Wanderer} from './wanderer-roster.js';
import {lifeActorPosition,lifeActivityAt,type LifePhase} from './sector-life-motion.js';
import type {LifeActor} from './sector-life.js';
import {RESOURCE_NODES} from './resource-nodes.js';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from './world-clock.js';

export const ANGLER_WORK_SECTORS=[6,18] as const;
export const ANGLER_PACK_MS=4000,ANGLER_STEP_MS=3000;
export type AnglerState={id:string;site:string;mode:'fishing'|'inside';at:number;origin:number};
export type FishingTackle={bank:number;water:number;startsAt:number;until:number;rod:string;cord:string};
export type AnglerRoutine=LifeActor&{hideAt?:number;fishing?:FishingTackle};
export const ANGLER_WORK_LINES={
    arriving:"I'm heading back to the water. There's room along the bank if you want to fish.",
    preparing:"I'm getting the line ready before I cast.",
    fishing:"I'm watching the float. There's room along the bank if you want to fish.",
    packing:"I'm putting the line away, then I'll go inside the gatehouse.",
    returning:"I'm going inside the gatehouse. I'll come back when I can fish again.",
    inside:"I'm resting inside the gatehouse.",
};
const reservations=new Map<number,readonly number[]>();
/** Keep all potential shoreline work points and the doorway clear even during
 * windows without an angler, so a new roll never moves another worker's post. */
export function anglerReservedTiles(sector:number):readonly number[] {
    if(!(ANGLER_WORK_SECTORS as readonly number[]).includes(sector))return [];
    if(reservations.has(sector))return reservations.get(sector)!;
    const floor=SECTOR_FLOOR_LAYOUTS[sectorArtKey(sector)],door=floor.sites.stronghold!.approach;
    const tiles=[door,...new Set((floor.hydrology?.waterTiles??[]).flatMap(tileNeighbors).filter(tile=>isWalkableTile(sector,tile)))];
    reservations.set(sector,tiles);return tiles;
}
export function anglerWorkSite(sector:number,wanderer:Wanderer) {
    if(!(ANGLER_WORK_SECTORS as readonly number[]).includes(sector)||wanderer.verb!=='angler')return;
    const floor=SECTOR_FLOOR_LAYOUTS[sectorArtKey(sector)],door=floor?.sites.stronghold?.approach,water=floor?.hydrology?.waterTiles;
    if(door===undefined||!water?.length)return;
    const bank=wanderer.homeTile;
    if(!isWalkableTile(sector,bank)||!walkPath(sector,bank,door))return;
    const targets=water.filter(tile=>Math.hypot(tile%12-bank%12,Math.floor(tile/12)-Math.floor(bank/12))<=1.5);
    // Prefer water above/beside the angler, leaving the resource approaches free.
    const markers=RESOURCE_NODES.filter(node=>node.sector===sector&&node.activity==='fishing').map(node=>node.target);
    targets.sort((a,b)=>Number(markers.includes(a))-Number(markers.includes(b))||Number(!tileNeighbors(bank).includes(a))-Number(!tileNeighbors(bank).includes(b))||a-b);
    const target=targets[0];if(target===undefined)return;
    return {bank,water:target,door,key:`${bank}:${target}:${door}`};
}
export function currentWorkingAngler(sector:number,now:number) {
    if(!(ANGLER_WORK_SECTORS as readonly number[]).includes(sector))return;
    const wanderer=rollTradeWanderer(sector,wandererDayBucketFromMs(now));
    if(!wanderer)return;
    const site=anglerWorkSite(sector,wanderer);return site?{wanderer,site}:undefined;
}
export function anglerInside(now:number,weather:string) {
    return isWorldNight(now)||['rain','thunderstorm','tornado','ashfall'].includes(weather)||now%WANDERER_BUCKET_MS>=WANDERER_BUCKET_MS-90_000;
}
function workPlan(sector:number,state:AnglerState,site:NonNullable<ReturnType<typeof anglerWorkSite>>,now:number) {
    const path=walkPath(sector,state.origin,state.mode==='inside'?site.door:site.bank)!;
    const pack=state.mode==='inside'?ANGLER_PACK_MS:0;
    const frames:(readonly[number,number])[]=[...(pack?[[0,path[0]] as const]:[]),...path.map((tile,i)=>[pack+i*ANGLER_STEP_MS,tile] as const)];
    const arrives=state.at+frames.at(-1)![0];
    const day=Math.floor(now/WORLD_DAY_MS)*WORLD_DAY_MS,night=day+(now-day<5*WORLD_HOUR_MS?-WORLD_DAY_MS:0)+20*WORLD_HOUR_MS;
    const finishAt=state.mode==='inside'?state.at:Math.max(arrives+1500,Math.min(night,Math.floor(now/WANDERER_BUCKET_MS)*WANDERER_BUCKET_MS+WANDERER_BUCKET_MS-90_000));
    if(state.mode==='fishing'){
        frames.push([finishAt-state.at,site.bank]);
        for(const [i,tile] of walkPath(sector,site.bank,site.door)!.entries())frames.push([finishAt-state.at+ANGLER_PACK_MS+i*ANGLER_STEP_MS,tile]);
    }
    return {motion:{start:state.at,frames},arrives,finishAt,hideAt:state.at+frames.at(-1)![0]+1500};
}
/** Weather transitions start at the old route's current tile. The browser also
 * retains its actual pose, so a new destination never teleports a visible NPC. */
export function nextAnglerState(sector:number,raw:unknown,now:number,weather:string,work:NonNullable<ReturnType<typeof currentWorkingAngler>>):AnglerState {
    const {wanderer,site}=work,old=raw as AnglerState|undefined,bucket=Math.floor(now/WANDERER_BUCKET_MS)*WANDERER_BUCKET_MS;
    const mode=anglerInside(now,weather)?'inside':'fishing';
    const valid=old&&old.id===wanderer.id&&old.site===site.key&&['inside','fishing'].includes(old.mode)&&Number.isSafeInteger(old.at)&&old.at>=bucket&&old.at<bucket+WANDERER_BUCKET_MS&&Number.isInteger(old.origin)&&isWalkableTile(sector,old.origin)&&walkPath(sector,old.origin,site.bank)&&walkPath(sector,old.origin,site.door);
    const morning=Math.floor(now/WORLD_DAY_MS)*WORLD_DAY_MS+5*WORLD_HOUR_MS;
    if(!valid)return {id:wanderer.id,site:site.key,mode,at:mode==='fishing'?Math.max(bucket,morning):bucket,origin:site.door};
    if(old.at>now)return old;
    if(old.mode==='fishing'&&old.at<morning){
        if(mode==='fishing')return {...old,at:morning,origin:site.door};
        return {...old,mode,at:Math.max(old.at,bucket,morning-9*WORLD_HOUR_MS),origin:site.bank};
    }
    if(old.mode===mode)return old;
    const plan=workPlan(sector,old,site,now);
    if(old.mode==='fishing'&&mode==='inside'&&plan.finishAt<=now)return {...old,mode,at:plan.finishAt,origin:site.bank};
    const pose=lifeActorPosition(sector,{restTile:site.door,motion:plan.motion},now),origin=Math.round(pose.row)*12+Math.round(pose.col);
    return {id:wanderer.id,site:site.key,mode,at:now,origin:isWalkableTile(sector,origin)?origin:old.origin};
}
export function anglerWorkRoutine(sector:number,state:AnglerState,now:number,work:NonNullable<ReturnType<typeof currentWorkingAngler>>):AnglerRoutine {
    const {wanderer,site}=work,{motion,arrives,finishAt,hideAt}=workPlan(sector,state,site,now),startsAt=arrives+1500;
    const closing=state.mode==='inside'||now>=finishAt;
    const phases:LifePhase[]=[...(state.mode==='fishing'?[{at:state.at,activity:'Walking to the fishing spot',line:ANGLER_WORK_LINES.arriving},{at:arrives,activity:'Fishing by the bank',line:ANGLER_WORK_LINES.preparing},{at:startsAt,activity:'Fishing by the bank',line:ANGLER_WORK_LINES.fishing}]:[]),
        {at:finishAt,activity:'Putting the line away',line:ANGLER_WORK_LINES.packing},{at:finishAt+ANGLER_PACK_MS,activity:'Walking into the gatehouse',line:ANGLER_WORK_LINES.returning},{at:hideAt,activity:'Resting indoors',line:ANGLER_WORK_LINES.inside}];
    const {activity,line}=lifeActivityAt({activity:phases[0].activity,line:phases[0].line,phases},now);
    const x=(site.bank%12+.5)*100,y=(Math.floor(site.bank/12)+.5)*100,wx=(site.water%12+.5)*100,wy=(Math.floor(site.water/12)+.5)*100,tx=x+(wx-x)*.48,ty=y+(wy-y)*.48-10;
    return {id:wanderer.id,name:wanderer.name,art:'forager',tile:site.bank,workTile:site.bank,restTile:site.door,activity,line,bark:'Mind the line.',motion,hideAt,phases,
        ...(closing?{}:{fishing:{bank:site.bank,water:site.water,startsAt,until:finishAt,rod:`M${x} ${y}Q${x+(wx-x)*.2} ${y+(wy-y)*.2-12} ${tx} ${ty}`,cord:`M${tx} ${ty}Q${(tx+wx)/2} ${(ty+wy)/2+6} ${wx} ${wy}`}})};
}
