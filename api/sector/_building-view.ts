import { countOwned } from '../craft/_forge.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { SUPPLY_CRAFT_RECIPES, craftMaterialName, type CraftIngredient } from '../../shared/crafting-recipes.js';
import { buildingConditions, buildingGreeting, buildingOnTetsuCircuit, buildingRecipeTrust, buildingRegisterEntries, buildingRelationship, buildingTeaClosure, buildingWorkView, buildingWorkshopRecipes, BUILDING_REPAIR_INGREDIENTS } from '../../shared/sector-building-content.js';
import { BUILDING_INVESTIGATIONS, buildingFestivalTasks } from '../../shared/sector-building-stories.js';
import { buildingStanding, readBuildingProgress, readSharedBuilding, BUILDING_DELIVERY_DAILY_CAP } from '../../shared/sector-building-state.js';
import { SECTOR_BUILDINGS, buildingsInSector, buildingSharedKey, sectorBuilding } from '../../shared/sector-buildings.js';
import { isWorldNight } from '../../shared/world-phase.js';
import type { BuildingDetailView, BuildingMaterialRow, BuildingService, BuildingServiceView, BuildingWorldView, SectorBuilding } from '../../shared/sector-building-types.js';
import type { KvLike } from '../_storage.js';

const serviceCopy:Record<BuildingService,readonly[string,string]>={
    reception:['Public counter','Speak to the duty keeper, read the local orders and ask about the guarded interior.'],
    tea:['Tea and rest','For 30 ryo, settle beside the kettle while the host pours. A quiet rest restores HP, chakra and stamina as a small meal would. The guest book remembers returning travelers.'],
    survey:['Chronicle field investigation','Examine three reachable evidence points, then record the supported account with the keeper.'],
    repair:['Public shelter repairs','Supply ore, hunting materials, fish and harvested materials, then complete three work steps. Materials are reserved until completion or cancellation.'],
    courier:['Sealed relay delivery','Carry an entrusted pouch through two named relay counters using the connected roads.'],
    watch:['Public watch round','Inspect the footing and marker, then return a signal report for the next travelers.'],
    workshop:['Regional workshop','Ask the keeper to craft a regional recipe. Choose your materials, meet the required level and leave room for the finished item.'],
    intelligence:['Entrusted handoff','Observe the contact and respect the seal and speaking-window instructions. Exposing the handoff raises suspicion.'],
    register:['Keeper’s witness register','Read the local account and sign the deeds the keeper can confirm in the road and work rolls.'],
    festival:['Festival rehearsal','Learn bow, left, right, bow, then rehearse the sequence with the guide. The keeper records one paid participation per day.'],
};
function rows(character:Record<string,unknown>,ingredients:readonly CraftIngredient[]):BuildingMaterialRow[]{
    return ingredients.map(row=>({...row,owned:row.ids.map(id=>({id,name:craftMaterialName(id),count:countOwned(character,id)}))}));
}
export function buildingDetailView(building:SectorBuilding,character:Record<string,unknown>,rawShared:unknown,now:number,territory?:Record<string,unknown>|null):BuildingDetailView{
    const progress=readBuildingProgress(character.sectorBuildings,now),standing=buildingStanding(progress,building.id),shared=readSharedBuilding(rawShared);
    const services:BuildingServiceView[]=building.services.map(service=>{
        const [title,baseDescription]=serviceCopy[service];let reason:string|undefined;
        const description=service==='festival'?`${buildingFestivalTasks(building.id).map(task=>task.label).join(' → ')}. The keeper records one paid participation per premises per UTC day.`:
            service==='watch'?`${baseDescription} ${shared.stage===3?(building.restoredWatchPoint?'Restoration has reopened the long signal sightline: check it from the marked bridge position.':'The restored public window supports the full return-signal round on the marked road approaches.'):shared.stage===2?'The sheltered report board is now in use.':shared.stage===1?'New braces support the doorway watch.':'The unrepaired post works from its doorway and the nearby ground markers.'}`:
            service==='courier'&&buildingOnTetsuCircuit(building)?`${baseDescription} This counter hands letters along Tetsu’s established harbor–deepwood circuit.`:baseDescription;
        if(progress.active&&!['register','reception','survey'].includes(service))reason='Finish or cancel your current building work first.';
        else if(service==='courier'&&progress.deliveriesToday>=BUILDING_DELIVERY_DAILY_CAP)reason='All three paid deliveries are complete for today.';
        else if(service==='intelligence'&&(standing.suspicionUntil??0)>now)reason='The contact will reopen after the five-minute suspicion period.';
        else if(service==='intelligence'&&standing.intelDay===progress.day)reason='Your handoff is settled for today.';
        else if(service==='watch'&&standing.watchDay===progress.day)reason='Your paid watch round is complete for today.';
        else if(service==='festival'&&standing.festivalDay===progress.day)reason='Your participation is recorded for today.';
        else if(service==='tea'&&(standing.teaUntil??0)>now)reason='The next kettle round is not ready yet.';
        else if(service==='tea')reason=buildingTeaClosure(building,now,territory??undefined);
        return{service,title,description,available:!reason,...(reason?{reason}:{})};
    });
    const survey=standing.survey;
    const investigation=BUILDING_INVESTIGATIONS[building.id];
    const owner=building.kind==='stronghold'?territory?.ownerVillage??building.village:building.village;
    return{building,greeting:buildingGreeting(building,progress,character.village,isWorldNight(now),owner),standing,services,shared,
        relationship:buildingRelationship(building,progress,character),conditions:buildingConditions(building,now,territory),
        materials:building.services.includes('repair')?rows(character,BUILDING_REPAIR_INGREDIENTS):[],
        ...(progress.active?{work:buildingWorkView(progress.active)}:{}),
        ...(building.evidence&&investigation?{survey:{step:survey?.step??0,target:building.evidence[survey?.step??0],complete:(survey?.step??0)>=building.evidence.length,recorded:!!survey?.recordedAt,
            title:investigation.title,testimony:investigation.testimony,evidence:building.evidence.slice(0,survey?.step??0),
            ...(survey?.recordedAt?{account:investigation.account,...(survey.interpretation==='open-question'?{question:investigation.question}:{})}:{})}}:{}),
        register:building.services.includes('register')?buildingRegisterEntries(building,progress):[],
        recipes:building.services.includes('workshop')?buildingWorkshopRecipes(building).flatMap(id=>{
            const recipe=SUPPLY_CRAFT_RECIPES[id],trust=buildingRecipeTrust(building,id);return recipe?[{id,name:ITEM_CATALOG[id]?.name??id,ingredients:rows(character,recipe.ingredients),level:recipe.levelReq??1,trust,available:standing.trust>=trust}]:[];
        }):[],
        leads:SECTOR_BUILDINGS.filter(b=>b.id!==building.id&&(b.region===building.region||b.services.includes('courier')))
            .sort((a,b)=>Math.abs(a.sector-building.sector)-Math.abs(b.sector-building.sector)||a.id.localeCompare(b.id)).slice(0,standing.trust>=5?4:2)
            .map(b=>({buildingId:b.id,sector:b.sector,approach:b.approach,name:b.name,reason:b.services.includes('survey')?'The keeper can show you a place with evidence still to record.':b.services.includes('courier')?'This counter receives sealed relay deliveries.':'A staffed public counter stands on this road.'})),
    };
}
export async function readBuildingWorld(store:Pick<KvLike,'get'>,player:string,sector:number,now:number,includeBuildingIds:readonly string[]=[]):Promise<BuildingWorldView|undefined>{
    const save=await store.get<{character?:Record<string,unknown>;_saveVersion?:number}>(`save:${player}`);if(!save?.character)return;
    const definitions=new Map(buildingsInSector(sector).map(building=>[building.id,building]));
    for(const id of includeBuildingIds){const building=sectorBuilding(id);if(building)definitions.set(id,building);}
    const buildings=await Promise.all([...definitions.values()].map(async building=>{
        const [shared,territory]=await Promise.all([store.get(buildingSharedKey(building.id)),store.get<Record<string,unknown>>(`world:territory:${building.sector}`)]);
        return buildingDetailView(building,save.character!,shared,now,territory);
    }));
    const progress=readBuildingProgress(save.character.sectorBuildings,now);
    return{sector,buildings,progress,saveVersion:Number(save._saveVersion??0),serverNow:now,
        ...(progress.active?{work:buildingWorkView(progress.active),activeBuilding:sectorBuilding(progress.active.buildingId)}:{})};
}
