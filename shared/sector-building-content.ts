import { RESOURCE_ITEMS } from './resource-items.js';
import type { CraftIngredient } from './crafting-recipes.js';
import { SECTOR_BUILDINGS, sectorBuilding } from './sector-buildings.js';
import { SECTOR_ROAD_PAIRS } from './sector-links.js';
import type { BuildingPoint, BuildingWorkOrder, BuildingWorkView, SectorBuilding, SectorBuildingProgress } from './sector-building-types.js';
import { BUILDING_WORK_STEP_MS, buildingStanding } from './sector-building-state.js';
import { buildingFestivalTasks, CONTACT_PROTOCOLS } from './sector-building-stories.js';
import { sectorBiomeOf } from './sector-geo.js';
import { resolveSectorWeather } from './sector-weather.js';
import { isWorldNight } from './world-phase.js';
import { TETSU_ROUTE } from './sector-tea-courier.js';
import { FESTIVAL_SITE, festivalStallPainting, festivalStallPlan } from './sector-festival-work.js';

/** Four required rows: fittings, shelter lining, crew food, and lashings/packing. The
 * player chooses exact item grades through the existing crafting selector. */
export const BUILDING_REPAIR_INGREDIENTS: readonly CraftIngredient[] = [
    { label:'Ore and mineral fittings', count:3, ids:RESOURCE_ITEMS.filter(item=>item.activity==='mining').sort((a,b)=>a.grade-b.grade).map(item=>item.id) },
    { label:'Hunting materials for shelter lining', count:2, ids:['hunt-torn-hide','hunt-wild-feather','hunt-frost-pelt','hunt-shadow-pelt'] },
    { label:'Fish for the working crew', count:2, ids:RESOURCE_ITEMS.filter(item=>item.activity==='fishing').map(item=>item.id) },
    { label:'Harvested lashings and packing', count:4, ids:['gather-binding-fiber','gather-heartwood-bark','gather-field-herb','gather-shadow-thread'] },
];
export const BUILDING_WORKSHOP_RECIPES: Readonly<Record<string, readonly string[]>> = {
    stormveil:['consum-smoke-pellet','pet-treat','village-supply-bundle'], ashenleaf:['pet-treat','consum-cleansing-incense','beast-seal-master'],
    moonshadow:['beast-seal-master','consum-phantom-charm','village-supply-bundle'], frostfang:['consum-lifeline-elixir','pet-treat','elemental-pet-treat'],
    midlands:['consum-cleansing-incense','pet-treat','village-supply-bundle'], festival:['consum-smoke-pellet','pet-treat','village-supply-bundle'],
    lavafront:['consum-cleansing-incense','elemental-pet-treat'], deathsgate:['consum-cleansing-incense','elemental-pet-treat'],
};
export const buildingWorkshopRecipes = (building: SectorBuilding): readonly string[] => BUILDING_WORKSHOP_RECIPES[building.region] ?? ['consum-cleansing-incense','pet-treat'];
export const buildingRecipeTrust = (building:SectorBuilding,id:string):number => buildingWorkshopRecipes(building).indexOf(id)>=2?5:0;
const point = (building: SectorBuilding, label: string, description: string): BuildingPoint => ({ sector:building.sector,tile:building.approach,label,description });
export const buildingOnTetsuCircuit=(building:SectorBuilding)=>(TETSU_ROUTE as readonly number[]).includes(building.sector);
/** Eda serves at the existing outdoor ledge, so its actual packed/open state
 * also owns new paid orders. Accepted cups can still finish after it closes. */
export function buildingTeaClosure(building:SectorBuilding,now:number,territory?:Record<string,unknown>):string|undefined{
    if(building.id!=='festival-tea-counter')return;
    const weather=resolveSectorWeather(sectorBiomeOf(building.sector),building.sector,now,territory);
    const plan=festivalStallPlan(now);
    return now>=plan.openAt&&now<plan.packAt&&festivalStallPainting(now,weather).painting===FESTIVAL_SITE.open?undefined:
        'Eda’s serving ledge is covered while the counter prepares, packs up or waits out the weather. The public book remains open. Return when the kettle counter reopens.';
}
export const INTELLIGENCE_SIGNS = ['Observe the speaking window','Read the entrusted seal','Make the agreed handoff'] as const;
export function buildingConditions(building:SectorBuilding,now:number,territory?:Record<string,unknown>|null):string{
    const weather=resolveSectorWeather(sectorBiomeOf(building.sector),building.sector,now,territory);
    const sky={clear:'clear sky',rain:'rain',ashfall:'ashfall',thunderstorm:'a thunderstorm',tornado:'a windstorm',desertHaze:'desert haze'}[weather];
    return `S${building.sector}: ${sky}; ${isWorldNight(now)?'night watch by the public threshold lights':'day watch from the public approach'}.`;
}

/** Relay targets are reached through the canonical connected road graph, not
 * teleport links. Routes are deterministic and sealed into the work order. */
export function buildingCourierRoute(source: SectorBuilding): string[] {
    const neighbors = new Map<number,number[]>();
    for (const [a,b] of SECTOR_ROAD_PAIRS) { neighbors.set(a,[...neighbors.get(a)??[],b]); neighbors.set(b,[...neighbors.get(b)??[],a]); }
    const distances = new Map<number,number>([[source.sector,0]]), queue=[source.sector];
    for(let i=0;i<queue.length;i++)for(const next of neighbors.get(queue[i])??[])if(!distances.has(next)){distances.set(next,distances.get(queue[i])!+1);queue.push(next);}
    const relays = SECTOR_BUILDINGS.filter(b=>b.id!==source.id && b.sector!==source.sector && b.services.includes('courier') && distances.has(b.sector))
        .sort((a,b)=>distances.get(a.sector)!-distances.get(b.sector)! || a.id.localeCompare(b.id));
    const circuit=TETSU_ROUTE as readonly number[],start=circuit.indexOf(source.sector);
    if(start>=0){
        const ordered:SectorBuilding[]=[];
        for(let offset=1;offset<=circuit.length;offset++){
            const sector=circuit[(start+offset)%circuit.length];
            if(sector===source.sector||ordered.some(stop=>stop.sector===sector))continue;
            const stop=relays.filter(b=>b.sector===sector).sort((a,b)=>Number(b.id==='heartwood-tea-counter')-Number(a.id==='heartwood-tea-counter')||a.id.localeCompare(b.id))[0];
            if(stop)ordered.push(stop);
            if(ordered.length===2)return ordered.map(stop=>stop.id);
        }
    }
    const first=relays[0], second=relays.find(b=>b.sector!==first?.sector && distances.get(b.sector)!>=2);
    return [first?.id,second?.id].filter((id):id is string=>!!id);
}
export function buildingWorkView(order: BuildingWorkOrder): BuildingWorkView | undefined {
    const building=sectorBuilding(order.buildingId); if(!building)return;
    const readyAt=order.stepAt+BUILDING_WORK_STEP_MS;
    if(order.kind==='courier'){
        const recipient=sectorBuilding(order.route?.[order.step]); if(!recipient)return;
        const final=order.step===(order.route?.length??0)-1;
        return {order,target:point(recipient,final?'Deliver the sealed pouch':'Stamp the relay ledger',recipient.description),
            instruction:`${recipient.keeper} receives you at ${recipient.name}, Sector ${recipient.sector}. ${final?'Give the sealed pouch to the named recipient. The relay stamps prove the route.':'Carry the sealed pouch to this relay. The clerk records receipt without opening it.'}`,
            itinerary:order.route!.flatMap((id,index)=>{const relay=sectorBuilding(id);return relay?[{name:relay.name,sector:relay.sector,stamped:index<order.step}]:[];}),
            actionLabel:final?'Deliver the pouch':'Record the relay stamp',readyAt,final};
    }
    if(order.kind==='watch'){
        const stage=order.watchStage??0;
        const base=stage===3&&order.step===1&&building.restoredWatchPoint?building.restoredWatchPoint:building.watchPoints?.[order.step];if(!base)return;
        const target=order.step===0&&stage>0?{...base,label:stage===1?'Inspect the braced signal post':stage===2?'Inspect the sheltered signal board':'Inspect the restored signal fittings',
            description:stage===1?'Check the new braces from the public threshold before making the ground round. The signal remains a doorway watch.':stage===2?'Check the weatherproof lining and the sheltered report board. Keep to the public approach while the upper signal fittings are finished.':building.restoredWatchPoint?'Check the restored post’s signal fittings from its public threshold, then read the return signal from the marked bridge position.':'Check the restored post’s signal fittings from its public threshold, then inspect the marked return-route observation point.'}:base;
        return {order,target,instruction:target.description,actionLabel:order.step===2?'File the crossing report':stage===3&&order.step===1?'Confirm the lookout signal':'Inspect the watch point',readyAt,final:order.step===2};
    }
    if(order.kind==='repair'){
        const tasks=[['Brace the frontage','Set the mineral fittings into the prepared sockets. Keep the public road clear.'],
            ['Bind the shelter lining','Fit the hunting-material lining and harvested lashings to the work frame.'],
            ['Finish the crew handover','The fish supplies the crew meal. Check the braces and hand the completed work to the keeper.']];
        const task=tasks[order.step];if(!task)return;
        return {order,target:point(building,task[0],task[1]),instruction:task[1],actionLabel:task[0],readyAt,final:order.step===2};
    }
    if(order.kind==='intelligence'){
        const title=INTELLIGENCE_SIGNS[order.step];if(!title)return;
        const protocol=order.protocol?CONTACT_PROTOCOLS[order.protocol]:undefined;
        return {order,target:building.contactPoints?.[order.step]??point(building,title,building.description),instruction:order.step===0?
            `Observe from the public sightline before approaching. ${protocol?`The agreed marker is ${protocol.mark}. ${protocol.label} when the seal is checked.`:'The contact is using the speaking window.'}`:
            order.step===1?'The seal must remain intact. Read its exterior mark; opening the pouch breaks the trust.':
            protocol?`The observed marker was ${protocol.mark}. Match the agreed handoff. Calling the contact into the road exposes the message.`:'Deliver only through the speaking window. Displaying the pouch in the road exposes the contact.',
            actionLabel:title,readyAt,final:order.step===2,
            choices:order.step===1?[{id:'read-mark',label:'Read the exterior mark'},{id:'break-seal',label:'Break the seal'}]:order.step===2?
                [...(protocol?Object.entries(CONTACT_PROTOCOLS).map(([id,p])=>({id:`handoff-${id}`,label:p.label})):[{id:'quiet-handoff',label:'Use the speaking window'}]),{id:'public-handoff',label:'Call the contact into the road'}]:[{id:'observe',label:'Observe the contact marker'}]};
    }
    if(order.kind==='festival'){
        const tasks=buildingFestivalTasks(building.id),task=tasks[order.step];if(!task)return;
        return {order,target:point(building,building.id==='festival-welcome'?'Festival arrival duty':building.id==='festival-lantern-house'?'Lantern preparation':'Festival rehearsal',task.instruction),
            instruction:`Step ${order.step+1} of ${tasks.length}. ${task.instruction}`,actionLabel:task.label,readyAt,final:order.step===tasks.length-1,
            choices:[...new Map(tasks.map(t=>[t.choice,{id:t.choice,label:t.label}])).values()]};
    }
    return {order,target:point(building,'A cup at the tea stop','Sit beside the kettle while the host tends the tea.'),instruction:'Take a short rest while the host finishes pouring. The warmth and a quiet mat restore HP, chakra and stamina as a small meal would.',actionLabel:'Thank the host and finish your rest',readyAt:order.startedAt+15_000,final:true};
}
export function buildingRegisterEntries(building: SectorBuilding, progress: SectorBuildingProgress) {
    const local:Record<string,readonly[string,string]>={
        tide:['The returning crews','Crews ring Tidecaller’s bell before departure and answer for the names they took out when they return.'],
        heartwood:['The kept promise','The council leaves a copy of its first kept promise beneath the eaves of the cedar shrine.'],
        frostveil:['The winter roll','Winter wardens recut weathered names so the rescue roll can still be answered at the next fire.'],
        moonwell:['The entrusted tablet','A keeper breaks the blank tablet only after both parties confirm that the trust was returned intact.'],
        hollowgate:['The return ledger','The muster ledger records those who went below, those who returned, and those who freely turned back.'],
        ancients:['The hundred patterns','The Withheld refused the Sunken Court’s cession. A Legacy is a freely repeated pattern of action, not a soul or an ancestor inside a shinobi.'],
    };
    const entry=local[building.shrineId??'']??['The local witness roll','The Chronicle preserves people, places and choices in portable records. A card is a record; no living being is contained in it.'];
    return [{id:'local-record',title:entry[0],text:entry[1],eligible:true},
        {id:'repair-witness',title:'A public shelter kept',text:`The work roll confirms ${progress.repairs} completed repair orders. Record the work that the keeper actually witnessed.`,eligible:progress.repairs>=3,reason:'Complete three repair orders before signing this account.'},
        {id:'courier-witness',title:'An entrusted message returned',text:`The relay roll confirms ${progress.deliveries} sealed deliveries. Record the handling that the receiving clerk witnessed.`,eligible:progress.deliveries>=2,reason:'Complete two sealed deliveries before signing this account.'},
        {id:'survey-witness',title:'A place recorded with care',text:`The field roll confirms ${progress.surveys} completed investigations. Record what the evidence supports.`,eligible:progress.surveys>=1,reason:'Finish and record a ruin investigation first.'}];
}
export function buildingGreeting(building:SectorBuilding,progress:SectorBuildingProgress,village:unknown,night:boolean,owner:unknown=building.village):string{
    const standing=buildingStanding(progress,building.id);
    const welcome=standing.trust>=10?'You have kept your word here. I remember your work.':standing.metAt?'Good to see you on this road again.':`I’m ${building.keeper}. I keep this ${building.kind==='ruin'?'public frontage':'stop'}.`;
    const allegiance=typeof owner==='string'&&owner?`${owner} currently holds this ${building.kind==='village'?'gate':'post'}. ${owner===village?'Your village’s travelers are welcome at the public counter.':'Travelers may speak at the public counter.'} The guarded interior follows its own admission rules.`:'This public stop receives travelers from every village.';
    return `${welcome} ${allegiance}${night?' The outer speaking window stays attended after dark.':''}`;
}

export function buildingCompanion(character:Record<string,unknown>):string{
    const pets=Array.isArray(character.pets)?character.pets as Record<string,unknown>[]:[];
    const pet=pets.find(p=>p.id===character.activePetId);
    return pet?`${String(pet.name||pet.species||'Your companion').slice(0,60)} settles with you beside the public rest mat.`:'A quiet rest mat stands beside the kettle.';
}
export function buildingRelationship(building:SectorBuilding,progress:SectorBuildingProgress,character:Record<string,unknown>){
    const standing=buildingStanding(progress,building.id),regular=standing.trust>=5;
    const topics:Record<string,string>={
        stormveil:'The harbor clerks distinguish a receiving stamp from proof of a safe crossing. Ask the next relay to record what it actually received.',
        ashenleaf:'The shelter crews use harvested lashings with mineral fittings. A permanent repair is counted only after the keeper checks the crew handover.',
        frostfang:'The winter keepers preserve the return roll before setting another party on the lower road. A blank entry means the report has not returned.',
        moonshadow:'A contact’s marker names the agreed handoff. Read the exterior of a seal and remember the marker before approaching the shutter.',
        midlands:'A Chronicle field account can leave an unanswered question. The keeper will preserve that boundary alongside the collected evidence.',
        festival:'Nao receives arrivals, Fumi teaches lantern preparation, and Mina keeps the rehearsal steps. Cactus Flats holds the established Sunscar entrance.',
        lavafront:'The ash-road watch records the sky and checked public approaches. No report can certify every stretch beyond the last observation.',
    };
    const benefits=[`Daily conversation builds local trust once per UTC day. Work and careful records also build trust.`];
    if(building.services.includes('workshop')&&buildingWorkshopRecipes(building).length>2)benefits.push(regular?'The keeper’s third regional recipe is available here. Its ordinary level and material rules still apply.':'At 5 local trust, the keeper opens a third regional recipe at this counter.');
    benefits.push(regular?'The host shares four nearby staffed stops in the road book.':'At 5 local trust, the road book expands from two nearby staffed stops to four.');
    return{title:standing.trust>=10?'A familiar face':regular?'A trusted regular':standing.metAt?'An answered greeting':'A first introduction',
        text:`${topics[building.region]??'The road keepers record what a person did and what a witness can confirm.'}${building.services.includes('tea')?` ${buildingCompanion(character)}`:''}`,benefits};
}
