import test from 'node:test';
import assert from 'node:assert/strict';
import {FRONTIER_SITES,FRONTIER_LINES,FRONTIER_ROUND_MS,frontierWorkPlan,frontierWorkPath} from './sector-frontier-work.js';
import {lifeActorsAt,lifeSceneView,lifeAnchors,lifeRestTile,lifeCourierRoute,parseLifeState,LIFE_WINDOW_MS,LIFE_ACTIVE_MS} from './sector-life.js';
import {lifeActorPosition,lifeActivityAt,lifeActivityAtPosition} from './sector-life-motion.js';
import {isWalkableTile,walkPath,nearestWalkableTile} from './sector-walk-mask.js';
import {sectorWandererHomeTile} from '../shinobij.client/src/lib/wanderer-placement.js';
import {loiterPositionAt} from '../shinobij.client/src/lib/wanderer-loiter.js';
import {storyRoadEvents} from '../shinobij.client/src/data/story-road-events.js';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from './world-clock.js';

const sectors=[55,60],now=8*WORLD_HOUR_MS;
const state=(at:number)=>({...parseLifeState(null,at),step:3,updatedAt:at-300_000});
const resident=(sector:number,at=now,weather='clear')=>lifeSceneView(sector,state(at),at,weather).actors.find(a=>a.id===`resident:${sector}`)!;

test('the two sparse scenes reuse original people, original task locations and existing road exits',()=>{
    for(const sector of sectors){
        const site=FRONTIER_SITES[sector],view=lifeSceneView(sector,state(now),now,'clear'),actor=resident(sector),original=lifeActorsAt(sector,now,'clear')[0];
        assert.equal(actor.name,original.name);assert.equal(actor.art,original.art);assert.equal(actor.id,original.id);
        assert.deepEqual(lifeAnchors(sector),sector===55?[59,60,78]:[48,59,78]);assert.equal(actor.workTile,original.workTile);assert.equal(view.campTile,78);assert.equal(view.painting,site.painting);
        assert(view.actors.length<=5);assert(view.actors.every(a=>!site.clearance.includes(a.restTile)&&!site.clearance.includes(a.workTile)));
        for(let i=0;i<7;i++)assert(!site.clearance.includes(lifeRestTile(sector,i)));
        assert(frontierWorkPath(sector,site.inspection,site.road));
        const courier=lifeCourierRoute(sector);assert.equal(courier.stop,sector===55?65:67);assert.equal(courier.meet,sector===55?53:55);assert.equal(courier.search,sector===55?23:28);assert.equal(courier.stranded,sector===55?20:5);
    }
});

test('Gen uses a clear inward road shoulder, outside every current story-quest loiter route, with his five-minute itinerary',()=>{
    // 75, not its stride tile 77: that sits beside the camp stop at 78.
    const quest=nearestWalkableTile(55,sectorWandererHomeTile('story-road-border-smoke',55));assert.equal(quest,75);
    let gen:ReturnType<typeof lifeActorsAt>[number]|undefined;
    for(let slot=0;slot<30&&!gen;slot++)gen=lifeActorsAt(55,slot*300_000+90_000,'clear').find(a=>a.id==='gen');
    assert(gen);assert.equal(gen.restTile,70);assert.equal(gen.hideAt,gen.motion!.start+300_000);assert(gen.traveler);assert(gen.phases!.some(p=>p.returnGreeting));
    assert.equal(storyRoadEvents.length,15);
    for(const event of storyRoadEvents){const home=nearestWalkableTile(55,sectorWandererHomeTile(event.id,55));for(let at=0;at<60_000;at+=100){const p=loiterPositionAt(event.id,home,at,t=>isWalkableTile(55,t));assert(Math.hypot(p.col-10,p.row-5)>=.99,`${event.id}: Gen leaves at least a full tile of separation`);}}
});

test('road and gear checks use connected protected ground, and the cached round finishes at its actual stop',()=>{
    for(const sector of sectors){
        const site=FRONTIER_SITES[sector],plan=frontierWorkPlan(sector)!,actor=resident(sector),start=actor.motion!.start;
        assert(!actor.motion!.repeat);assert(!actor.hideAt);assert(plan.endAt<FRONTIER_ROUND_MS);
        if(sector===60){const gear=plan.frames.findIndex(([at,tile])=>at===plan.gearAt&&tile===site.inspection);assert.equal(plan.frames[gear-1][1],79,'the final leftward approach faces the carrying gear');}
        for(const [i,frame]of actor.motion!.frames.entries()){
            assert(isWalkableTile(sector,frame[1]));assert(!site.clearance.includes(frame[1]));
            if(i){assert(frame[0]>actor.motion!.frames[i-1][0]);const old=actor.motion!.frames[i-1][1];assert(old===frame[1]||walkPath(sector,old,frame[1])?.length===2);}
        }
        for(let t=0;t<=plan.endAt;t+=200){const p=lifeActorPosition(sector,actor,start+t);assert(isWalkableTile(sector,Math.round(p.row)*12+Math.round(p.col)));}
        const finished=lifeActorPosition(sector,actor,start+WORLD_DAY_MS);assert.equal(finished.col,site.stop%12);assert.equal(finished.row,Math.floor(site.stop/12));
        assert.equal(lifeActivityAt(actor,start+WORLD_DAY_MS).activity,'Waiting at the road stop');
        assert.equal(lifeActivityAtPosition(actor,{col:site.road%12,row:Math.floor(site.road/12)},start+WORLD_DAY_MS).activity,'Returning to the road stop');
    }
});

test('inspection and waiting claims require the actual physical point, while approaches do not invent unseen equipment',()=>{
    for(const sector of sectors){
        const actor=resident(sector),site=FRONTIER_SITES[sector],at=actor.motion!.start+frontierWorkPlan(sector)!.gearAt+1;
        const work=lifeActivityAtPosition(actor,{col:site.inspection%12,row:Math.floor(site.inspection/12)},at);
        assert('working'in work&&work.working);assert.equal(work.line,sector===55?FRONTIER_LINES.pack:FRONTIER_LINES.frame);
        const late=lifeActivityAtPosition(actor,{col:site.road%12,row:Math.floor(site.road/12)},at);assert.equal(late.activity,'Walking to the inspection point');assert.doesNotMatch(late.line,/pack|carrying|equipment/);
    }
});

test('active errands, weather and darkness return the original requester to the original road stop',()=>{
    for(const sector of sectors)for(const hour of [8,21])for(const weather of ['clear','rain','ashfall'])for(const step of [0,1,2]){
        const at=hour*WORLD_HOUR_MS,view=lifeSceneView(sector,{...parseLifeState(null,at),step},at,weather),actor=view.actors.find(a=>a.id===`resident:${sector}`)!;
        // Signal/lantern errands can already be unattended at this clock. A
        // fresh stage0 near the start of a live window is checked separately.
        if(view.phase==='active'||weather!=='clear'||hour===21){assert.deepEqual(actor.motion!.frames,[[0,78]]);assert.equal(actor.restTile,78);assert(!actor.phases!.some(p=>p.working));}
        if(weather!=='clear')assert.match(actor.line,/wait at this stop/);
        if(hour===21&&weather==='clear')assert.match(actor.line,/clearer view/);
    }
});

test('cached active-search dialogue expires without claiming that an absent courier is still missing',()=>{
    for(const sector of sectors){
        const at=100*LIFE_WINDOW_MS+1000,view=lifeSceneView(sector,parseLifeState(null,at),at,'clear'),actor=view.actors.find(a=>a.id===`resident:${sector}`)!;
        assert.equal(view.phase,'active');const expired=lifeActivityAt(actor,100*LIFE_WINDOW_MS+LIFE_ACTIVE_MS+1);assert.equal(expired.line,FRONTIER_LINES.rest);
        assert.equal(lifeActorPosition(sector,actor,at+WORLD_DAY_MS).col,6);
    }
});

test('completed-task thanks are personal, brief and at the actual stop rather than attributed to a passer-by',()=>{
    for(const sector of sectors){
        const saved={...state(now),updatedAt:now-1000,contributors:['Aki']};
        const helper=lifeSceneView(sector,saved,now,'clear',undefined,undefined,undefined,undefined,'aki').actors[0],other=lifeSceneView(sector,saved,now,'clear',undefined,undefined,undefined,undefined,'Ben').actors[0];
        assert.equal(helper.line,FRONTIER_LINES.helperThanks);assert.equal(other.line,FRONTIER_LINES.rest);assert.equal(helper.restTile,78);
        const later=lifeSceneView(sector,saved,now+61_000,'clear',undefined,undefined,undefined,undefined,'aki').actors[0];assert.notEqual(later.line,FRONTIER_LINES.helperThanks);
    }
});
