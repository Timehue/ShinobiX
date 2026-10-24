import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_BUILDINGS, sectorBuilding } from '../../shared/sector-buildings.js';
import { BUILDING_INVESTIGATIONS, buildingContactProtocol, buildingFestivalTasks } from '../../shared/sector-building-stories.js';
import { buildingCompanion, buildingConditions, buildingWorkView } from '../../shared/sector-building-content.js';
import { readBuildingProgress } from '../../shared/sector-building-state.js';
import { buildingDetailView } from './_building-view.js';
import { reduceBuildingAction } from './_building-actions.js';
import type { BuildingAction } from '../../shared/sector-building-types.js';
import { festivalStallPlan } from '../../shared/sector-festival-work.js';
import { WORLD_HOUR_MS } from '../../shared/world-clock.js';

const NOW=Date.parse('2026-10-23T12:00:00Z');
test('repair counters remain available beyond six daily repairs and still require finishing active work',()=>{
    const building=sectorBuilding('gorgewatch')!,progress={...readBuildingProgress(undefined,NOW),repairs:42,repairsToday:42};
    const character={sectorBuildings:progress};
    assert.equal(buildingDetailView(building,character,null,NOW).services.find(row=>row.service==='repair')?.available,true);
    const busy={sectorBuildings:{...progress,active:{id:'reserved-repair',buildingId:building.id,kind:'repair',startedAt:NOW,stepAt:NOW,step:0,day:progress.day}}};
    assert.equal(buildingDetailView(building,busy,null,NOW).services.find(row=>row.service==='repair')?.available,false);
});
let sequence=0;
function act(character:Record<string,unknown>,action:Omit<BuildingAction,'requestId'>,now=NOW){
    const result=reduceBuildingAction(character,{...action,requestId:`view-request-${++sequence}`},null,{now,orderId:`view-order-${sequence}`,displayName:'Witness',conditions:'S38: rain; day watch from the public approach.'});
    if(!result.ok)assert.fail(result.error);return result;
}

test('every investigated ruin preserves distinct physical evidence, testimony, chosen uncertainty and one payout after reload',()=>{
    assert.equal(Object.keys(BUILDING_INVESTIGATIONS).length,5);
    const labels=new Set<string>();
    for(const id of Object.keys(BUILDING_INVESTIGATIONS)){
        const building=sectorBuilding(id)!;let character:Record<string,unknown>={ryo:0};
        for(let step=0;step<3;step++)character=act(character,{action:'survey',buildingId:id,step}).character;
        const collected=buildingDetailView(building,character,null,NOW).survey!;
        assert.equal(collected.evidence.length,3);assert.ok(collected.testimony.includes(building.keeper.split(' ').at(-1)!));
        assert.equal(collected.account,undefined,'the keeper has not recorded the account yet');
        for(const evidence of collected.evidence){assert.ok(!labels.has(evidence.label));labels.add(evidence.label);assert.ok(evidence.description.length>100);}
        character=act(character,{action:'record',buildingId:id,choice:'open-question'}).character;
        const reloaded=JSON.parse(JSON.stringify(character));
        const view=buildingDetailView(building,reloaded,null,NOW+86_400_000).survey!;
        assert.equal(view.recorded,true);assert.equal(view.account,BUILDING_INVESTIGATIONS[id].account);assert.equal(view.question,BUILDING_INVESTIGATIONS[id].question);
        assert.equal(reloaded.ryo,90);
        assert.equal(reduceBuildingAction(reloaded,{action:'record',buildingId:id,choice:'evidence-only',requestId:'new-record-attempt'},null,{now:NOW,orderId:'new-record',displayName:'Witness'}).ok,false);
    }
});

test('the six shrine registers retain their own local account and gate verified deeds',()=>{
    const shrines=SECTOR_BUILDINGS.filter(b=>b.kind==='shrine');assert.equal(shrines.length,6);
    const titles=new Set<string>();
    for(const shrine of shrines){
        const initial=buildingDetailView(shrine,{},null,NOW);titles.add(initial.register[0].title);
        assert.ok(initial.register[0].eligible);assert.equal(initial.register.find(e=>e.id==='repair-witness')?.eligible,false);
        const signed=act({}, {action:'register',buildingId:shrine.id,choice:'local-record'}).character;
        assert.equal(buildingDetailView(shrine,signed,null,NOW).standing.registerEntry,'local-record');
        assert.equal(readBuildingProgress(signed.sectorBuildings,NOW).receipts.at(-1)?.reward.ryo,0);
    }
    assert.equal(titles.size,6);
});

test('the counter names the current stronghold holder and uses the canonical territory weather',()=>{
    const building=sectorBuilding('stronghold-3')!;
    const view=buildingDetailView(building,{village:'Frostfang Village'},null,NOW,{ownerVillage:'Frostfang Village',ownerClan:'WinterClan',weather:'rain'});
    assert.ok(view.greeting.includes('Frostfang Village currently holds'));
    assert.ok(view.conditions.includes('rain'));
    assert.equal(buildingConditions(building,NOW,{ownerClan:'WinterClan',weather:'rain'}),view.conditions);
});

test('a fifth local trust point admits the third canonical recipe without bypassing its crafting rules',()=>{
    const building=sectorBuilding('stronghold-3')!;
    const c:Record<string,unknown>={level:100,ryo:1000,sectorBuildings:{standing:{[building.id]:{trust:4}}}};
    const locked=buildingDetailView(building,c,null,NOW).recipes[2];assert.equal(locked.available,false);assert.equal(locked.trust,5);
    const denied=reduceBuildingAction(c,{action:'craft',buildingId:building.id,recipeId:locked.id,materials:[],requestId:'locked-recipe-test'},null,{now:NOW,orderId:'locked',displayName:'Witness'});
    assert.equal(denied.ok,false);if(!denied.ok)assert.match(denied.error,/5 local trust/);
    const visited=act(c,{action:'visit',buildingId:building.id}).character;
    const open=buildingDetailView(building,visited,null,NOW).recipes[2];assert.equal(open.available,true);
    const missing=reduceBuildingAction(visited,{action:'craft',buildingId:building.id,recipeId:open.id,materials:[],requestId:'no-material-recipe'},null,{now:NOW,orderId:'missing',displayName:'Witness'});
    assert.equal(missing.ok,false,'trust must never supply missing materials');
});

test('tea mentions only the selected owned companion, and saved history retains local names',()=>{
    assert.ok(!buildingCompanion({}).includes('companion'));
    assert.ok(!buildingCompanion({activePetId:'missing',pets:[{id:'other',name:'Wrong animal'}]}).includes('Wrong animal'));
    assert.match(buildingCompanion({activePetId:'owned',pets:[{id:'owned',name:'Sumi'}]}),/^Sumi settles/);
    const result=act({},{action:'visit',buildingId:'midlands-tea-house'});
    assert.equal(result.receipt.buildingName,'Fieldside Tea House');assert.equal(result.receipt.sector,42);
});

test('festival premises offer distinct complete four-step duties and return borrowed equipment',()=>{
    const ids=['festival-welcome','festival-lantern-house','festival-steps-house'];
    assert.equal(new Set(ids.map(id=>buildingFestivalTasks(id).map(t=>t.choice).join(','))).size,3);
    for(const id of ids){
        let character=act({ryo:0},{action:'begin',buildingId:id,service:'festival'}).character;
        for(let step=0;step<4;step++){
            const order=readBuildingProgress(character.sectorBuildings,NOW).active!,view=buildingWorkView(order)!;
            assert.equal(view.final,step===3);assert.ok(view.instruction.includes(buildingFestivalTasks(id)[step].instruction));
            character=act(character,{action:'step',buildingId:id,orderId:order.id,step,choice:buildingFestivalTasks(id)[step].choice},NOW+(step+1)*6000).character;
        }
        assert.equal(character.ryo,60);assert.equal(readBuildingProgress(character.sectorBuildings,NOW).active,undefined);
    }
});

test('contact protocols vary by server hour, stay sealed across reconnect and reject the wrong handoff',()=>{
    const id='shuttered-boathouse';assert.equal(new Set([0,1,2].map(hour=>buildingContactProtocol(id,NOW+hour*3_600_000))).size,3);
    let character=act({ryo:0},{action:'begin',buildingId:id,service:'intelligence'}).character;
    const protocol=readBuildingProgress(character.sectorBuildings,NOW).active!.protocol;assert.ok(protocol);
    for(let step=0;step<2;step++){
        const order=readBuildingProgress(character.sectorBuildings,NOW).active!;
        character=act(character,{action:'step',buildingId:id,orderId:order.id,step,choice:step===0?'observe':'read-mark'},NOW+(step+1)*6000).character;
    }
    const order=readBuildingProgress(JSON.parse(JSON.stringify(character)).sectorBuildings,NOW+3_600_000).active!;
    assert.equal(order.protocol,protocol);
    const wrong=protocol==='cedar'?'reed':'cedar';
    const exposed=act(character,{action:'step',buildingId:id,orderId:order.id,step:2,choice:`handoff-${wrong}`},NOW+18000).character;
    assert.equal(exposed.ryo,0);assert.equal(readBuildingProgress(exposed.sectorBuildings,NOW).active,undefined);
    assert.ok(readBuildingProgress(exposed.sectorBuildings,NOW).standing[id].suspicionUntil!>NOW);
});

test('watch reports retain each observed sky and never replace it with an unverified safety claim',()=>{
    let result=act({ryo:0},{action:'begin',buildingId:'gorgewatch',service:'watch'});
    for(let step=0;step<3;step++){
        const order=readBuildingProgress(result.character.sectorBuildings,NOW).active!;
        result=act(result.character,{action:'step',buildingId:'gorgewatch',orderId:order.id,step},NOW+(step+1)*6000);
    }
    assert.equal(result.shared.reports.length,1);assert.match(result.shared.reports[0].text,/S38: rain/);
    assert.ok(result.shared.reports[0].text.includes('Return to the signal window'));
});

test('restored watch descriptions distinguish Gorgewatch’s bridge from the ash-road posts',()=>{
    for(const id of ['gorgewatch','obsidian-waystation','obsidian-north-watch']){
        const building=sectorBuilding(id)!,view=buildingDetailView(building,{}, {repairs:24},NOW);
        const description=view.services.find(service=>service.service==='watch')!.description;
        assert.ok(!description.includes('unrepaired'));assert.equal(description.includes('bridge position'),id==='gorgewatch');
    }
});

test('Eda admits tea only while the native ledge serves, but honors or refunds already reserved cups after closing',()=>{
    const building=sectorBuilding('festival-tea-counter')!,day=Date.UTC(2026,9,23),plan=festivalStallPlan(day+6*WORLD_HOUR_MS);
    const visitor={name:'LateVisitor',level:85,ryo:1000},clear={ownerClan:'LocalHost',weather:'clear'};
    const request:BuildingAction={action:'tea',buildingId:building.id,requestId:'festival-native-ledger-01'};
    const admit=(now:number,territory=clear)=>reduceBuildingAction(visitor,request,null,{now,orderId:'accepted-cup',displayName:'LateVisitor',territory});
    for(const now of [plan.start,plan.packAt,plan.coveredAt,day+21*WORLD_HOUR_MS]){
        const detail=buildingDetailView(building,visitor,null,now,clear),tea=detail.services.find(service=>service.service==='tea')!;
        assert.equal(tea.available,false);assert.match(tea.reason!,/covered/);
        const refused=admit(now);assert.equal(refused.ok,false);assert.equal(visitor.ryo,1000);
    }
    for(const weather of ['rain','thunderstorm','tornado','ashfall']){
        const territory={ownerClan:'LocalHost',weather},now=plan.openAt+1000;
        assert.equal(buildingDetailView(building,visitor,null,now,territory).services.find(service=>service.service==='tea')!.available,false);
        assert.equal(admit(now,territory).ok,false);
    }
    const accepted=admit(plan.packAt-1000);assert.ok(accepted.ok);assert.equal(accepted.character.ryo,970);
    const closedAt=plan.packAt+15000;
    const finished=reduceBuildingAction(accepted.character,{action:'step',buildingId:building.id,orderId:'accepted-cup',step:0,requestId:'festival-finish-after-close'},null,{now:closedAt,orderId:'served-cup',displayName:'LateVisitor',territory:clear});
    assert.ok(finished.ok);assert.equal(readBuildingProgress(finished.character.sectorBuildings,closedAt).active,undefined);assert.equal(finished.character.ryo,970);
    const cancelled=reduceBuildingAction(accepted.character,{action:'cancel',buildingId:building.id,orderId:'accepted-cup',requestId:'festival-refund-after-close'},null,{now:closedAt,orderId:'refunded-cup',displayName:'LateVisitor',territory:clear});
    assert.ok(cancelled.ok);assert.equal(cancelled.character.ryo,1000);
});
