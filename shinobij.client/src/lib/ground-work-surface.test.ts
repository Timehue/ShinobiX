import test from 'node:test';
import assert from 'node:assert/strict';
import {groundWorkPresentation} from './ground-work-surface';
import {recordDisplayedSectorFloor,forgetDisplayedFloors} from './sector-displayed-floor';
import {lifeActorsAt} from '../../../shared/sector-life';
import {lifeActivityAtPosition} from '../../../shared/sector-life-motion';
import {rememberLifeWitness} from '../../../shared/sector-life-witness';
import {WORLD_HOUR_MS} from '../../../shared/world-clock';
import {festivalStallPlan,FESTIVAL_SITE} from '../../../shared/sector-festival-work';
import {FRONTIER_SITES,frontierWorkPlan,FRONTIER_LINES} from '../../../shared/sector-frontier-work';
import {lifeSceneView,parseLifeState} from '../../../shared/sector-life';
import {sealLifeWitnesses} from '../../../shared/sector-life-witness';

test('frontier equipment descriptions require the actually drawn gear floor, while plain ground stays truthful',()=>{
    for(const sector of [55,60]){
        const now=8*WORLD_HOUR_MS,actor=lifeSceneView(sector,{...parseLifeState(null,now),step:3,updatedAt:now-300_000},now,'clear').actors[0],site=FRONTIER_SITES[sector],owner={};
        const phase=lifeActivityAtPosition(actor,{col:site.inspection%12,row:Math.floor(site.inspection/12)},actor.motion!.start+frontierWorkPlan(sector)!.gearAt+1);
        recordDisplayedSectorFloor(owner,sector,`/sector-map/${sector===55?'s12':'s52'}.webp`);assert.equal(groundWorkPresentation(actor,phase).line,FRONTIER_LINES.fallback);
        recordDisplayedSectorFloor(owner,sector,`/sector-life/${site.painting}.webp`);assert.equal(groundWorkPresentation(actor,phase),phase);forgetDisplayedFloors(owner);
    }
});

test('a frontier inspector retains a real same-person witness memory when the equipment floor fails',()=>{
    for(const sector of [55,60]){
        const site=FRONTIER_SITES[sector],at=8*WORLD_HOUR_MS+frontierWorkPlan(sector)!.gearAt+1,state={...parseLifeState(null,at),step:3,updatedAt:at-300_000};
        const original=lifeSceneView(sector,state,at,'clear').actors[0],witnesses=sealLifeWitnesses(sector,site.inspection,[original],at);assert.equal(witnesses.length,1);
        const actor=lifeSceneView(sector,state,at,'clear',undefined,undefined,undefined,[{at,victor:'Aki',fallen:'Ben',tile:site.inspection,witnesses}]).actors[0];
        const phase=lifeActivityAtPosition(actor,{col:site.inspection%12,row:Math.floor(site.inspection/12)},at),owner={};
        recordDisplayedSectorFloor(owner,sector,`/sector-map/${sector===55?'s12':'s52'}.webp`);const fallback=groundWorkPresentation(actor,phase);assert.match(fallback.line,/I saw Aki and Ben fighting/);assert.doesNotMatch(fallback.line,/pack under|carrying gear/);forgetDisplayedFloors(owner);
    }
});

test('festival serving requires the actually drawn open counter, while packing can use its covered floor',()=>{
    const actor=lifeActorsAt(52,8*WORLD_HOUR_MS,'clear')[0],plan=festivalStallPlan(8*WORLD_HOUR_MS),owner={};
    const at=(now:number)=>lifeActivityAtPosition(actor,{col:8,row:8},now);
    recordDisplayedSectorFloor(owner,52,`/sector-life/${FESTIVAL_SITE.packed}.webp`);
    assert.equal(groundWorkPresentation(actor,at(plan.openAt+1000)),actor.surfaceWork!.fallback);
    assert.equal(groundWorkPresentation(actor,at(plan.packAt+1000)).activity,'Packing the festival counter');
    recordDisplayedSectorFloor(owner,52,`/sector-life/${FESTIVAL_SITE.open}.webp`);
    assert.equal(groundWorkPresentation(actor,at(plan.openAt+1000)).activity,'Serving at the festival counter');
    recordDisplayedSectorFloor(owner,52,'/sector-map/s14.webp');
    assert.equal(groundWorkPresentation(actor,at(plan.openAt+1000)),actor.surfaceWork!.fallback);
    assert.equal(groundWorkPresentation(actor,lifeActivityAtPosition(actor,{col:8,row:7},plan.restAt+1000)).activity,'Waiting beside the festival building');
    forgetDisplayedFloors(owner);
});

test('field work follows the actually drawn garden, while canonical/legacy/failing floors show truthful verge checking',()=>{
    const actor=lifeActorsAt(42,8*WORLD_HOUR_MS,'clear').find(actor=>actor.id==='crew:42:0')!,work=actor.cyclePhases!.find(phase=>phase.working)!,at=actor.motion!.start+work.at+1000;
    const phase=lifeActivityAtPosition(actor,{col:work.workTile!%12,row:Math.floor(work.workTile!/12)},at),owner={};
    for(const floor of ['/sector-map/s30.webp','/sector-life/midlands-tea-stop-v1.webp','/sector-life/midlands-chronicle-table-v1.webp']){recordDisplayedSectorFloor(owner,42,floor);const fallback=groundWorkPresentation(actor,phase);assert.equal(fallback.activity,'Checking the roadside verge');assert(!('working'in fallback));assert(!fallback.line.includes('herb rows'));}
    for(const key of actor.surfaceWork!.paintings){recordDisplayedSectorFloor(owner,42,`/sector-life/${key}.webp`);assert.equal(groundWorkPresentation(actor,phase),phase);}
    forgetDisplayedFloors(owner);assert.equal(groundWorkPresentation(actor,phase),actor.surfaceWork!.fallback);
});

test('a real same-person witness memory survives the missing-garden presentation without becoming a crop claim',()=>{
    const at=8*WORLD_HOUR_MS,original=lifeActorsAt(42,at,'clear').find(actor=>actor.id==='crew:42:0')!;
    const actor=rememberLifeWitness(original,[{at,victor:'Aki',fallen:'Ben',witnesses:[{id:original.id,name:original.name,tile:125,at}]}],at);
    const work=actor.cyclePhases!.find(phase=>phase.working)!,phase=lifeActivityAtPosition(actor,{col:work.workTile!%12,row:Math.floor(work.workTile!/12)},actor.motion!.start+work.at+1000),owner={};
    recordDisplayedSectorFloor(owner,42,'/sector-life/midlands-tea-stop-v1.webp');const fallback=groundWorkPresentation(actor,phase);assert.match(fallback.line,/I saw Aki and Ben fighting/);assert(!fallback.line.includes('herb rows'));forgetDisplayedFloors(owner);
});
