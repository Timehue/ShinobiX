import {festivalStallActor,festivalStallPainting,festivalWalkPath,FESTIVAL_CLEARANCE} from './sector-festival-work.js';
import {roadVisit} from './sector-road-visit.js';
import {FRONTIER_SITES,frontierWork,frontierWorkPath,frontierRestSpot} from './sector-frontier-work.js';
import { isPlayableWildSector, sectorArtKey } from './sector-geo.js';
import { SECTOR_FLOOR_LAYOUTS } from './sector-floor-layouts.js';
import { SECTOR_ROAD_PAIRS, sectorExits } from './sector-links.js';
import { nearestWalkableTile, walkPath, isWalkableTile } from './sector-walk-mask.js';
import { isWorldNight } from './world-phase.js';
import { lifeRegionFor, lifeResidentName, LIFE_TRAVELERS, LIFE_EVENTS, type LifeArt } from './sector-life-content.js';
import type { Wanderer, WandererArchetypeId } from './wanderer-roster.js';
import type { LifeMotion,LifePhase } from './sector-life-motion.js';
import { localVillageReaction } from './sector-life-villages.js';
import { roadCrewActors } from './sector-life-routines.js';
import {MIDLANDS_CROP_TILES,MIDLANDS_WORK_CLEARANCE,midlandsWorkPath} from './sector-midlands-work.js';
import { foragerWork,FORAGER_SITE } from './sector-forager-work.js';
import { travelerConversation } from './sector-life-conversations.js';
import { rememberLifeWitness } from './sector-life-witness.js';
import { shrineStandingSpots,clearOfShrinePosts } from './sector-shrine-scenes.js';
import type { SectorScar } from './sector-scars.js';
import type { WildlifeDiscovery } from './sector-life-discovery.js';
import {anglerReservedTiles,type AnglerRoutine,type FishingTackle} from './sector-angler-work.js';
import {CHRONICLE_STOP_RESERVED,CHRONICLE_STOP_SECTOR} from './sector-chronicle-stop.js';
import {TETSU_ROUTE,TEA_COURIER_SECTOR,TEA_COURIER_SEAT,TEA_TABLE_CLEARANCE,teaCourierPath,teaCourierVisit} from './sector-tea-courier.js';
import { shrineLife,parseShrineCare,renewShrineCare,HEARTWOOD_SHRINE_ROUND,type LifeShrineMemory,type LifeShrineCare } from './sector-life-memory.js';
import { courierRoute,courierLife,courierGroundTrail } from './sector-life-courier.js';
import { parseLifeHunt,lifeNaturalTracker,lifeTrackingParty,lifeTrackSites,LIFE_HUNT_LINES,type LifeHunt } from './sector-life-tracking.js';
import {DOCK_SHIPMENT_SECTOR,DOCK_SHIPMENT_SCENARIO,DOCK_SHIPMENT_SITES,DOCK_TRAVELER_REST_TILES,DOCK_SHIPMENT_MEET_MS,normalizeDockShipmentState,dockShipmentEvent,dockShipmentScene,type LifePaintingNext} from './sector-dock-shipment.js';
export { lifeActorPosition } from './sector-life-motion.js';

export const LIFE_WINDOW_MS = 45 * 60_000;
export const LIFE_ACTIVE_MS = 18 * 60_000;
export type LifeEventState = { window: number; step: number; updatedAt: number; contributors: string[]; care?:LifeShrineCare; hunt?:LifeHunt;scenario?:typeof DOCK_SHIPMENT_SCENARIO;shipmentAt?:number };
/** One bounded row per sector keeps a round and its remembered upkeep atomic. */
export const lifeStorageKey=(sector:number)=>`sector-life:${Math.floor(sector)}`;
export type LifePoint = { col: number; row: number };
export type LifeActor = { id: string; name: string; art: LifeArt; tile: number; workTile: number; restTile: number; activity: string; line: string; bark?: string; traveler?: string; returnGreeting?: string; atRest?: boolean; motion?: LifeMotion;hideAt?:number;hideTile?:number;clearance?:readonly number[];fishing?:FishingTackle;workTool?:'broom'|'hoe';surfaceWork?:{sector:number;paintings:readonly string[];fallback:{activity:string;line:string}};phases?:readonly LifePhase[];cyclePhases?:readonly LifePhase[] };
export const lifeWindowAt = (now: number) => Math.floor(now / LIFE_WINDOW_MS);
export const lifeWindowEnds = (now: number) => (lifeWindowAt(now) + 1) * LIFE_WINDOW_MS;
export const lifeEnabledSector = (sector: number) => isPlayableWildSector(sector);
/** Work/rest points authored beside the admitted painted dressing, not arbitrary map centers. */
export const LIFE_WORK_SITES: Readonly<Record<number,{camp:number;work:number;approaches?:readonly[number,number]}>> = {
    2:{camp:113,work:100},15:{camp:115,work:104},31:{camp:114,work:102},42:{camp:112,work:99,approaches:[65,125]},
};

/** Keep every staged action in the same connected walk component as the camp. */
const anchorCache = new Map<number, [number, number, number]>();
export function lifeAnchors(sector: number): [number, number, number] {
    const cached = anchorCache.get(sector); if (cached) return cached;
    const layout = SECTOR_FLOOR_LAYOUTS[sectorArtKey(sector)];
    const home = nearestWalkableTile(sector, LIFE_WORK_SITES[sector]?.camp ?? layout?.sites.shrine?.approach ?? layout?.village?.approach ?? layout?.sites.cairn?.approach ?? layout?.sites.stronghold?.approach ?? 78);
    const reachable = Array.from({ length: 144 }, (_, tile) => tile).filter(tile => isWalkableTile(sector, tile) && walkPath(sector, home, tile));
    const choose = (target: number, excluded: number[]) => reachable.filter(t => !excluded.includes(t)).sort((a,b) =>
        (Math.abs(a % 12 - target % 12) + Math.abs(Math.floor(a / 12) - Math.floor(target / 12))) -
        (Math.abs(b % 12 - target % 12) + Math.abs(Math.floor(b / 12) - Math.floor(target / 12))))[0] ?? home;
    const approaches=LIFE_WORK_SITES[sector]?.approaches??sectorExits(sector).filter(exit=>reachable.includes(exit.tile)).slice(0,2).map(exit=>exit.tile);
    const first = choose(approaches?.[0]??40, [home]);
    const result: [number, number, number] = [first, choose(approaches?.[1]??103, [home, first]), home];
    anchorCache.set(sector, result); return result;
}
const restTileCache = new Map<string,number>();
const lifeStopPath=(sector:number,from:number,to:number)=>sector===42?midlandsWorkPath(from,to):sector===52?festivalWalkPath(from,to):frontierWorkPath(sector,from,to);
export function lifeRestTile(sector: number, index: number): number {
    if(sector===DOCK_SHIPMENT_SECTOR)return DOCK_TRAVELER_REST_TILES[index%DOCK_TRAVELER_REST_TILES.length];
    if(sector===TEA_COURIER_SECTOR&&index===1)return TEA_COURIER_SEAT;
    const key=`${sector}:${index}`; if(restTileCache.has(key))return restTileCache.get(key)!;
    const home=lifeAnchors(sector)[2];
    const nearby=Array.from({length:144},(_,tile)=>({tile,path:walkPath(sector,home,tile)}))
        .filter(entry=>entry.path&&entry.path.length<=(shrineStandingSpots(sector).length?8:sector===CHRONICLE_STOP_SECTOR?6:4)&&entry.tile!==LIFE_WORK_SITES[sector]?.work&&!(sector===DOCK_SHIPMENT_SECTOR&&(Object.values(DOCK_SHIPMENT_SITES) as number[]).includes(entry.tile))&&!(sector===TEA_COURIER_SECTOR&&([TEA_COURIER_SEAT,...TEA_TABLE_CLEARANCE] as readonly number[]).includes(entry.tile))&&!(sector===CHRONICLE_STOP_SECTOR&&(CHRONICLE_STOP_RESERVED as readonly number[]).includes(entry.tile))&&!(sector===42&&MIDLANDS_CROP_TILES.includes(entry.tile))&&!(sector===52&&FESTIVAL_CLEARANCE.includes(entry.tile))&&!anglerReservedTiles(sector).includes(entry.tile)&&clearOfShrinePosts(sector,entry.tile)).sort((a,b)=>a.path!.length-b.path!.length||a.tile-b.tile);
    const tile=frontierRestSpot(sector,nearby[index % nearby.length]?.tile ?? home);restTileCache.set(key,tile);return tile;
}
export const lifeCourierRoute=(sector:number)=>courierRoute(sector,lifeRestTile(sector,6),[LIFE_WORK_SITES[sector]?.work??lifeAnchors(sector)[0],...Array.from({length:6},(_,i)=>lifeRestTile(sector,i+1)),...shrineStandingSpots(sector),...anglerReservedTiles(sector)]);
const huntStops=new Map<number,{scout:number;tracker:number}>();
/** A returned pair needs a clearing beside the road, clear of roof labels and
 * recurring travelers. Prefer side-by-side positions over stacked portraits. */
export function lifeHuntSites(sector:number) {
    const cached=huntStops.get(sector);if(cached)return cached;
    const home=lifeAnchors(sector)[2],reserved=[...Array.from({length:6},(_,i)=>lifeRestTile(sector,i+1)),...shrineStandingSpots(sector),...anglerReservedTiles(sector)];
    const sites=Object.values(SECTOR_FLOOR_LAYOUTS[sectorArtKey(sector)]?.sites??{}).filter(Boolean).map(site=>site!.approach);
    const distance=(a:number,b:number)=>Math.abs(a%12-b%12)+Math.abs(Math.floor(a/12)-Math.floor(b/12));
    const candidates=Array.from({length:144},(_,tile)=>({tile,path:walkPath(sector,home,tile)}))
        .filter(({tile,path})=>path&&path.length<=11&&!(sector===42&&[...MIDLANDS_CROP_TILES,115,127].includes(tile))&&!reserved.some(other=>distance(tile,other)<2)&&sites.every(site=>distance(tile,site)>=3));
    const pairs=candidates.flatMap(a=>candidates.filter(b=>b.tile>a.tile&&Math.floor(a.tile/12)===Math.floor(b.tile/12)&&distance(a.tile,b.tile)>=2&&distance(a.tile,b.tile)<=3&&walkPath(sector,a.tile,b.tile)!.length<=5)
        .map(b=>({a,b,score:a.path!.length+b.path!.length+(3-distance(a.tile,b.tile))*3}))).sort((a,b)=>a.score-b.score);
    const pair=pairs[0],result=pair?{scout:pair.a.path!.length<pair.b.path!.length?pair.a.tile:pair.b.tile,tracker:pair.a.path!.length<pair.b.path!.length?pair.b.tile:pair.a.tile}:{scout:home,tracker:lifeRestTile(sector,6)};
    huntStops.set(sector,result);return result;
}

export function parseLifeState(raw: unknown, now: number): LifeEventState {
    const r = raw && typeof raw === 'object' ? raw as Partial<LifeEventState> : {};
    const care=parseShrineCare(r.care,now),hunt=parseLifeHunt(r.hunt,now),memory={...(care.maintainedAt?{care}:{}),...(hunt?{hunt}:{})};
    const shipment=r.scenario===DOCK_SHIPMENT_SCENARIO&&r.window===lifeWindowAt(now)?{scenario:DOCK_SHIPMENT_SCENARIO,...(Number.isSafeInteger(r.shipmentAt)&&r.step!>=2&&r.shipmentAt!>=r.window*LIFE_WINDOW_MS+DOCK_SHIPMENT_MEET_MS&&r.shipmentAt!<=now?{shipmentAt:r.shipmentAt}:{})}:{};
    return r.window === lifeWindowAt(now) && Number.isInteger(r.step) && r.step! >= 0 && r.step! <= 3
        ? { window: r.window, step: r.step!, updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
            contributors: Array.isArray(r.contributors) ? r.contributors.filter((v): v is string => typeof v === 'string').slice(0, 8) : [],...memory,...shipment }
        : { window: lifeWindowAt(now), step: 0, updatedAt: 0, contributors: [],...memory };
}

export function lifeEventView(sector: number, state: LifeEventState, now: number) {
    if(sector===DOCK_SHIPMENT_SECTOR)state=normalizeDockShipmentState(state);
    const shipment=sector===DOCK_SHIPMENT_SECTOR?dockShipmentEvent(state,now,LIFE_WINDOW_MS,LIFE_ACTIVE_MS):undefined;
    const primary = lifeRegionFor(sector).event;
    const pool = [...new Set([primary, 'courier'] as const)];
    const rolled=sector===15&&state.window%2===1?'shrine':LIFE_WORK_SITES[sector]?primary:pool[(state.window+sector)%pool.length];
    const natural=rolled==='tracks'&&!state.hunt?lifeNaturalTracker(sector,now):undefined,pending=!!state.hunt&&!state.hunt.result;
    const kind=pending||state.hunt?.window===state.window?'tracks':rolled==='tracks'&&!natural?'signal':rolled,content=LIFE_EVENTS[kind];
    if(pending)state={...state,step:2};else if(state.hunt?.result&&state.hunt.window===state.window)state={...state,step:3};
    const complete = state.step === 3, expired = !complete && now % LIFE_WINDOW_MS >= LIFE_ACTIVE_MS && !pending && !((kind==='courier'||kind==='tracks')&&state.step>0);
    const courier=kind==='courier'?lifeCourierRoute(sector):undefined;
    const waiting=pending||!!courier&&state.step===2&&now<state.updatedAt+courier.returnMs;
    const tracker=kind==='tracks'&&!pending&&state.step<2?natural:undefined;
    const trackPoint=tracker?lifeTrackSites(sector,tracker).approach:undefined;
    return { ...state, sector, kind, title: content.title, phase: complete ? 'aftermath' as const : expired ? 'unattended' as const : 'active' as const,
        tile: (tracker?[trackPoint!,trackPoint!,lifeAnchors(sector)[2]]:courier?[courier.search,courier.aid,courier.meet]:kind==='shrine'?HEARTWOOD_SHRINE_ROUND.steps:lifeAnchors(sector))[Math.min(2, state.step)], waiting,tracker,
        action: pending?'Follow the animal trail':waiting?'Wait for the courier':tracker&&state.step===1?LIFE_HUNT_LINES.ask:content.actions[Math.min(2, state.step)],
        description: pending?LIFE_HUNT_LINES.pending:complete ? content.aftermath : expired ? content.unattended : state.step === 0 ? content.intro : content.replies[state.step - 1],
        task: complete || expired ? '' : content.tasks[state.step], art: complete ? lifeRegionFor(sector).prop : content.art,
        endsAt: lifeWindowEnds(now),...shipment };
}
export type LifeEventView = ReturnType<typeof lifeEventView>;
const appearance: Partial<Record<LifeArt,WandererArchetypeId>>={courier:'courier',caretaker:'pilgrim',cook:'merchant',forager:'tracker',scribe:'sage',guard:'patrol'};
export function lifeWanderer(sector:number,actor:LifeActor):Wanderer {
    const archetype=appearance[actor.art]??'pilgrim';
    return {id:`life-${sector}-${actor.id}`,name:actor.name,archetype,verb:'watch',level:1,homeTile:actor.restTile,
        waypoints:[actor.restTile,actor.workTile],movement:'stationary',greeting:actor.line,tellTint:'#c9b37a',avatarKey:archetype};
}
/** The server supplies only this sector's current cast and dialogue. */
export function lifeSceneView(sector: number, state: LifeEventState, now: number, weather: string, playerVillage?: unknown, scar?:SectorScar, memory?:LifeShrineMemory,groundScars?:readonly SectorScar[],playerName?:string) {
    if(sector===DOCK_SHIPMENT_SECTOR)state=normalizeDockShipmentState(state);
    const view=lifeEventView(sector,state,now),actors=lifeActorsAt(sector,now,weather,[],view,scar);
    const shipment=sector===DOCK_SHIPMENT_SECTOR?dockShipmentScene(state,now,LIFE_WINDOW_MS,LIFE_ACTIVE_MS,playerName):undefined;
    const festival=sector===52?festivalStallPainting(now,weather):undefined;
    if(shipment){
        const resident=actors.findIndex(actor=>actor.id===`resident:${sector}`);
        if(resident>=0){const old=actors[resident];actors[resident]={...old,...shipment.worker,...(now<shipment.plan.start?{activity:old.activity,line:old.line}:{})};}
        if(shipment.actors.length)for(let i=actors.length-1;i>=0;i--)if(actors[i].id.startsWith('crew:'))actors.splice(i,1);
        actors.splice(resident>=0?resident+1:0,0,...shipment.actors);
    }
    const awayTracker=state.hunt?.trackerId;
    if(state.hunt&&actors[0]){const party=lifeTrackingParty(sector,state.hunt,actors[0],lifeHuntSites(sector),now);if(party.resident)actors[0]=party.resident;else actors.shift();if(party.tracker)actors.push(party.tracker);}
    if(!shipment&&!state.hunt&&view.phase==='aftermath'&&view.kind!=='shrine'&&view.kind!=='courier'&&actors[0]) {
        const resume=!!LIFE_WORK_SITES[sector]||view.kind==='tracks'&&!['Waiting out the weather','Resting at the stop'].includes(actors[0].activity);
        const helper=!!playerName&&state.contributors.some(name=>name.toLowerCase()===playerName.toLowerCase());
        actors[0]={...actors[0],activity:resume?actors[0].activity:'Resting after the work',atRest:actors[0].atRest||!resume,motion:resume?actors[0].motion:undefined,line:helper?LIFE_EVENTS[view.kind].replies[2]:actors[0].line};
        const rest=sector===42?110:lifeRestTile(sector,5);
        actors.push({id:`visitor:${sector}`,name:'Passing traveler',art:'caretaker',tile:rest,restTile:rest,workTile:lifeAnchors(sector)[1],activity:'Resting at the stop',atRest:true,line:"I'm stopping here for a rest before I carry on.",phases:[{at:state.updatedAt,activity:'Resting at the stop',line:"I'm stopping here for a rest before I carry on.",workTile:rest,approach:{activity:'Walking to the roadside stop',line:"I'm heading to a spot beside the road for a rest."}}]});
    }
    let description=view.kind==='tracks'&&view.phase==='aftermath'&&actors[0]?.atRest
        ? 'The gathering route has been checked. The gatherer and a traveler are resting at the stop.' : view.description;
    if(view.kind==='courier') {const courier=courierLife(sector,view,lifeCourierRoute(sector),now,state.window*LIFE_WINDOW_MS+LIFE_ACTIVE_MS,playerName);actors.push(...courier.actors);description=courier.description;}
    // A handover is a pair. Omit both workers if an event and travelers already
    // fill the mobile cast; never leave somebody talking to an absent partner.
    const shrine=shrineLife(sector,memory??{tier:0,...parseShrineCare(state.care,now)},view,now,[...actors.filter(actor=>!actor.id.startsWith('crew:')).flatMap(actor=>[actor.restTile,actor.workTile]),...Array.from({length:6},(_,i)=>lifeRestTile(sector,i+1))],weather);
    const base=actors.length+shrine.actors.length>5?actors.filter(actor=>!actor.id.startsWith('crew:')):actors;
    const cast=[...base,...shrine.actors.slice(0,Math.max(0,5-base.length))].slice(0,5);
    if(view.kind==='shrine'&&view.phase==='aftermath') {
        const visitor=cast.find(actor=>actor.id.startsWith('pilgrim:'));
        description=visitor?.activity==='Visiting the shrine'?'The shrine lamps have been tended. A visitor is spending a moment at the entrance.':visitor?.activity==='Walking to the shrine'?LIFE_EVENTS.shrine.aftermath:'The shrine lamps have been tended. The visitor has continued along the road.';
    }
    if(view.kind==='tracks'&&state.hunt?.result){const hunter=cast.find(a=>a.id===`hunter:${sector}`);description=hunter?.activity==='Resting after the animal trail'?LIFE_HUNT_LINES.restingReport:hunter&&hunter.activity!=='Continuing along the road'?LIFE_HUNT_LINES[state.hunt.result]:LIFE_HUNT_LINES.returnReport;}
    return {...view,hunt:undefined,awayTracker,groundScars,service:undefined as AnglerRoutine|undefined,wildlife:undefined as WildlifeDiscovery|undefined,groundTrail:view.tracker?lifeTrackSites(sector,view.tracker).marks:state.hunt?lifeTrackSites(sector,state.hunt).marks:view.kind==='courier'?courierGroundTrail(lifeCourierRoute(sector)):undefined,painting:shipment?.painting??festival?.painting??shrine.painting??FRONTIER_SITES[sector]?.painting,paintingUntil:shipment?.paintingUntil??festival?.paintingUntil,paintingNext:(shipment?.paintingNext??festival?.paintingNext) as LifePaintingNext|undefined,eventPhases:shipment?.eventPhases,description,label:`${view.title}: ${view.phase==='active'?view.task:description}`,actors:cast.map(actor=>frontierWork(actor,sector,now,weather,view,!!playerName&&state.contributors.some(name=>name.toLowerCase()===playerName.toLowerCase()),state.window*LIFE_WINDOW_MS+LIFE_ACTIVE_MS)).map(actor=>rememberLifeWitness(actor,groundScars??(scar?[scar]:[]),now)).map(actor=>localVillageReaction(sector,actor,playerVillage)).map(actor=>({...actor,...(!actor.clearance&&[42,52].includes(sector)?{clearance:(sector===42?MIDLANDS_WORK_CLEARANCE:FESTIVAL_CLEARANCE).filter(tile=>tile!==actor.restTile&&tile!==actor.workTile)}:{}),motion:actor.motion??residentMotion(sector,actor),wanderer:lifeWanderer(sector,actor)})),campTile:lifeAnchors(sector)[2]};
}
export type LifeSceneView = ReturnType<typeof lifeSceneView>;

/** Expected stage makes duplicate requests and concurrent clicks incapable of advancing twice. */
export function advanceLifeEvent(sector: number, raw: unknown, expectedWindow: number, expectedStep: number, player: string, now: number,supportStartedAt?:number) {
    const parsed=parseLifeState(raw, now),state=sector===DOCK_SHIPMENT_SECTOR?normalizeDockShipmentState(parsed):parsed, view = lifeEventView(sector, state, now);
    if (expectedWindow !== state.window || expectedStep !== state.step || view.phase !== 'active'||view.waiting||view.kind==='tracks'&&state.step>=1) return { changed: false, state, view };
    const next = { ...state, step: state.step + 1, updatedAt: now, contributors: [...new Set([...state.contributors, player])].slice(-8),
        ...(sector===DOCK_SHIPMENT_SECTOR&&state.step===1?{shipmentAt:now}:{}),
        ...(state.step===2&&view.kind==='shrine'?{care:renewShrineCare(state.care,player,now,supportStartedAt)}:{}) };
    return { changed: true, state: next, view: lifeEventView(sector, next, now) };
}

// Each traveler's itinerary is a reciprocal, connected road walk. They rest in a
// place for five minutes; their name and route survive sector and day changes.
export function travelerRoute(index: number): number[] {
    if(index===0)return [...TETSU_ROUTE];
    const starts = [1, 15, 42, 26];
    const route = [starts[index % starts.length]];
    for (let i = 0; i < 5; i++) {
        const last = route.at(-1)!;
        const neighbors = SECTOR_ROAD_PAIRS.flatMap(([a,b]) => a === last ? [b] : b === last ? [a] : []).filter(lifeEnabledSector).sort((a,b)=>a-b);
        const next = neighbors.filter(n => !route.includes(n))[index % Math.max(1, neighbors.filter(n => !route.includes(n)).length)] ?? neighbors[0];
        if (next === undefined) break;
        route.push(next);
    }
    return [...route, ...route.slice(1,-1).reverse()];
}
export function lifeActorsAt(sector: number, now: number, weather: string, met: readonly string[] = [], event?:LifeEventView, scar?:SectorScar): LifeActor[] {
    const region = lifeRegionFor(sector), [first, , camp] = lifeAnchors(sector);
    const work=nearestWalkableTile(sector,LIFE_WORK_SITES[sector]?.work??(sector===FORAGER_SITE.sector?FORAGER_SITE.patches[0]:first));
    // Painted workplaces remain staffed independently of an optional errand.
    // The figure stands at the working edge of the actual table/cargo/brazier.
    const rest=LIFE_WORK_SITES[sector]?work:shrineStandingSpots(sector).length||anglerReservedTiles(sector).length?lifeRestTile(sector,0):camp;
    const shelter = ['rain','thunderstorm','tornado','ashfall'].includes(weather), night = isWorldNight(now);
    const actors: LifeActor[] = [{ id: `resident:${sector}`, name: lifeResidentName(sector), art: region.role, tile: rest, workTile: work, restTile: rest,
        activity: shelter ? 'Waiting out the weather' : night ? 'Resting at the stop' : region.work, atRest: shelter || night,
        line: shelter ? region.shelter : night ? region.night : region.greeting }];
    LIFE_TRAVELERS.forEach((traveler, index) => {
        const route = travelerRoute(index), slot=Math.floor(now/300_000), stop=(slot+index*2)%route.length,here=route[stop];
        if (here === sector) {
            const restTile=lifeRestTile(sector,index+1),start=slot*300_000;
            const entry=sectorExits(sector).find(exit=>exit.destinationSector===route[(stop+route.length-1)%route.length])!;
            const exit=sectorExits(sector).find(exit=>exit.destinationSector===route[(stop+1)%route.length])!;
            const tea=sector===TEA_COURIER_SECTOR&&traveler.id==='tetsu',path=tea?teaCourierPath:(from:number,to:number)=>lifeStopPath(sector,from,to);
            const arriving=path(entry.tile,restTile)!,leaving=path(restTile,exit.tile)!;
            const arrival=(arriving.length-1)*3000,departure=300_000-(leaving.length-1)*3000;
            const inTransit=now-start<arrival||now-start>=departure;
            const conversation=travelerConversation(traveler,weather,night,event,scar);
            const actor:LifeActor={ id: traveler.id, name: traveler.name, art: traveler.role, tile: restTile, workTile: restTile, restTile,
                activity: now-start<arrival?'Arriving along the road':now-start>=departure?'Continuing along the road':shelter?'Waiting out the weather':night?'Resting at the stop':traveler.job,
                line:inTransit?"I'm heading for the next stop. Safe travels.":met.includes(traveler.id)?conversation.returnGreeting:conversation.line,
                returnGreeting:inTransit?undefined:conversation.returnGreeting,traveler:traveler.id,
                motion:{start,frames:[...arriving.map((tile,i)=>[i*3000,tile] as const),...leaving.map((tile,i)=>[departure+i*3000,tile] as const)]} };
            actors.push(tea?teaCourierVisit(actor,arrival,departure,now,shelter):roadVisit(actor,arrival,departure,now,{activity:shelter?'Waiting out the weather':night?'Resting at the stop':traveler.job,line:met.includes(traveler.id)?conversation.returnGreeting:conversation.line,returnGreeting:conversation.returnGreeting}));
        }
    });
    // Reserve all recurring/event resting places, even while their owners are
    // away. A visitor's arrival must not change a crew's route or handover clock.
    const exits=sectorExits(sector).filter(exit=>walkPath(sector,camp,exit.tile)).slice(0,2);
    const hunting=region.event==='tracks'&&!LIFE_WORK_SITES[sector]?Object.values(lifeHuntSites(sector)):[];
    const crew=exits.length<2?[]:roadCrewActors(sector,now,weather,[exits[0].tile,exits[1].tile],[rest,...Array.from({length:6},(_,i)=>lifeRestTile(sector,i+1)),...hunting,...shrineStandingSpots(sector),...(sector===DOCK_SHIPMENT_SECTOR?Object.values(DOCK_SHIPMENT_SITES):[]),sector===42?110:-1]);
    return [...actors.map(actor=>actor.traveler?actor:sector===52?festivalStallActor(actor,now,weather):foragerWork({...actor,motion:residentMotion(sector,actor)},sector,now,weather)),...crew];
}

/** Build paths on the server, leaving the browser only a small timeline reader. */
function residentMotion(sector:number,actor:LifeActor):LifeMotion|undefined {
    if(actor.atRest||actor.restTile===actor.workTile)return;
    const path=lifeStopPath(sector,actor.restTile,actor.workTile)??[actor.restTile],travel=(path.length-1)*3000;
    return {start:-actor.id.length*7000,repeat:travel*2+44_000,frames:[
        ...path.map((tile,i)=>[i*3000,tile] as const),
        ...[...path].reverse().map((tile,i)=>[travel+26_000+i*3000,tile] as const),
        [travel*2+44_000,actor.restTile],
    ]};
}

/** Flee along the ground graph, keeping wildlife out of walls and painted water. */
export function wildlifeRetreat(sector: number, tile: number, player: LifePoint): number {
    return Array.from({length:144},(_,t)=>t).filter(t => { const path = walkPath(sector,tile,t); return path && path.length <= 5; })
        .sort((a,b)=> Math.hypot(b%12-player.col,Math.floor(b/12)-player.row)-Math.hypot(a%12-player.col,Math.floor(a/12)-player.row))[0] ?? tile;
}
