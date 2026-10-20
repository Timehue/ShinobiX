import test from 'node:test';
import assert from 'node:assert/strict';
import {lifeActorsAt,lifeSceneView,parseLifeState,lifeCourierRoute,lifeRestTile} from './sector-life.js';
import {lifeActorPosition,lifeActivityAtPosition,lifeActivityAt} from './sector-life-motion.js';
import {FESTIVAL_SITE,FESTIVAL_STAGE,FESTIVAL_CLEARANCE,festivalStallPlan,festivalStallPainting,festivalWalkPath,festivalCrewActors} from './sector-festival-work.js';
import {LIFE_ROAD_CREWS} from './sector-life-routines.js';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from './world-clock.js';
import {isWalkableTile} from './sector-walk-mask.js';

const now=8*WORLD_HOUR_MS,crew=lifeActorsAt(52,now,'clear').filter(actor=>actor.id.startsWith('crew:'));
test('the existing festival pair demonstrate opposite corners in the actual open clearing, then return to their road posts',()=>{
    assert.equal(crew.length,2);assert.deepEqual(crew.map(a=>a.name),['Festival Guide Nene','Festival Runner Ko']);
    const period=crew[0].motion!.repeat!,covered=crew.map(()=>new Set<number>());
    for(let elapsed=0;elapsed<period;elapsed+=250){
        const positions=crew.map(a=>lifeActorPosition(52,a,a.motion!.start+elapsed));
        assert(Math.hypot(positions[0].col-positions[1].col,positions[0].row-positions[1].row)>=.999,'performers must keep separate places');
        for(const [i,a]of crew.entries()){
            const p=positions[i],tile=Math.round(p.row)*12+Math.round(p.col),phase=lifeActivityAtPosition(a,p,a.motion!.start+elapsed);
            assert(isWalkableTile(52,tile));assert(![92,104].includes(tile),'no path through the staffed counter');
            if(phase.activity==='Demonstrating the festival steps'){assert(FESTIVAL_STAGE.includes(tile));covered[i].add(tile);}
        }
    }
    for(const [i,a]of crew.entries()){
        assert.deepEqual([...covered[i]].sort((a,b)=>a-b),[88,89,100,101]);
        const p=lifeActorPosition(52,a,a.motion!.start+period-1);assert.equal(p.row*12+p.col,a.workTile);
        const phase=lifeActivityAtPosition(a,{col:5,row:0},a.motion!.start+a.cyclePhases!.find(p=>p.workArea)!.at+1000);assert.equal(phase.activity,'Walking to the festival clearing');
        for(const [index,[at,tile]]of a.motion!.frames.entries())if(index){const before=a.motion!.frames[index-1];assert(at>before[0]);assert(festivalWalkPath(before[1],tile,true)!.length<=2);}
    }
    assert.equal(festivalCrewActors(now,'clear',[5,7],[88],LIFE_ROAD_CREWS[52]).length,0,'a blocked performance omits the whole pair');
});

test('Eda fetches bowls, attends the open counter, packs it and waits beside the building without abandoning the courier requester',()=>{
    const actor=lifeActorsAt(52,now,'clear')[0],plan=festivalStallPlan(now),seen=new Set<string>();
    assert.equal(actor.id,'resident:52');assert.equal(actor.name,'Cook Eda');assert.equal(actor.hideAt,undefined);
    for(const at of [plan.start+4000,plan.start+14_000,plan.openAt+1000,plan.packAt+1000,plan.coveredAt+1000,plan.restAt+1000]){
        const p=lifeActorPosition(52,actor,at),phase=lifeActivityAtPosition(actor,p,at);seen.add(phase.activity);
        assert([92,104].includes(p.row*12+p.col));
        if('working'in phase&&phase.working)assert.equal(p.row*12+p.col,phase.workTile);
    }
    assert.deepEqual([...seen],['Preparing the festival counter','Collecting the festival bowls','Serving at the festival counter','Packing the festival counter','Securing the covered counter','Waiting beside the festival building']);
    assert.equal(lifeActivityAtPosition(actor,{col:4,row:7},plan.openAt+1000).activity,'Walking beside the festival building');
    const serving=actor.phases!.find(p=>p.activity==='Serving at the festival counter')!;assert.deepEqual(serving.surfacePaintings,[FESTIVAL_SITE.open]);
    for(const weather of ['rain','thunderstorm','tornado','ashfall']){const a=lifeActorsAt(52,now,weather)[0];assert.equal(a.activity,'Waiting out the weather');assert.equal(lifeActorPosition(52,a,now).row*12+lifeActorPosition(52,a,now).col,92);assert.equal(festivalStallPainting(now,weather).painting,FESTIVAL_SITE.packed);}
    const closed=festivalStallPainting(plan.coveredAt,'clear');assert.equal(closed.painting,FESTIVAL_SITE.packed);assert.equal(closed.paintingNext,undefined);
    assert.equal(festivalStallPainting(4*WORLD_HOUR_MS,'clear').painting,FESTIVAL_SITE.packed,'pre-dawn never reopens a stale counter');
    assert.equal(lifeActivityAt(actor,plan.closeAt+WORLD_DAY_MS).activity,'Waiting beside the festival building','cached workers cannot reopen tomorrow without a fresh response');
});

test('active courier work keeps its real northern rescue route, event positions and bounded cast while festival paths avoid the counter',()=>{
    const route=lifeCourierRoute(52);assert.deepEqual([route.search,route.aid,route.meet],[5,4,53]);assert.deepEqual(route.onward,[65,53,41,29,17,5,6,7]);
    for(let i=0;i<8;i++)assert(!FESTIVAL_CLEARANCE.includes(lifeRestTile(52,i)));
    for(const tile of FESTIVAL_STAGE)for(const anchor of [route.search,route.aid,route.meet])assert(Math.max(Math.abs(tile%12-anchor%12),Math.abs(Math.floor(tile/12)-Math.floor(anchor/12)))>=2,'normal performer Talk stays clear of actual courier marker hit areas');
    for(let time=0;time<2*WORLD_DAY_MS;time+=30_000)for(const step of [0,1,2,3]){
        const view=lifeSceneView(52,{...parseLifeState(null,time),step,updatedAt:time-1000},time,'clear');assert(view.actors.length<=5);assert([0,2].includes(view.actors.filter(a=>a.id.startsWith('crew:')).length));assert(view.actors.some(a=>a.id==='resident:52'));
    }
    for(const weather of ['clear','rain','thunderstorm','ashfall'])for(const actor of lifeActorsAt(52,now,weather).filter(a=>a.id.startsWith('crew:'))){const p=lifeActorPosition(52,actor,actor.hideAt!+1000);assert.equal(p.row*12+p.col,actor.hideTile);assert([5,7].includes(actor.hideTile!));assert.equal(lifeActivityAt(actor,actor.hideAt!+1000).activity,'Continuing along the road');}
});
