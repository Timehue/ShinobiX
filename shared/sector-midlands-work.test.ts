import test from 'node:test';
import assert from 'node:assert/strict';
import {lifeActorsAt,lifeSceneView,parseLifeState,lifeActorPosition,lifeRestTile,lifeAnchors} from './sector-life.js';
import {lifeActivityAtPosition,lifeActivityAt} from './sector-life-motion.js';
import {MIDLANDS_FIELD,MIDLANDS_WORK_CLEARANCE,MIDLANDS_CROP_TILES} from './sector-midlands-work.js';
import {WORLD_HOUR_MS,WORLD_DAY_MS} from './world-clock.js';
import {isWalkableTile,sectorWalkMask} from './sector-walk-mask.js';
import {chronicleStopActors,chronicleStopPlan,CHRONICLE_STOP_RESERVED} from './sector-chronicle-stop.js';
import {stopChronicleGame} from '../api/sector/_life-chronicle-game.js';

const now=8*WORLD_HOUR_MS,crew=lifeActorsAt(42,now,'clear').filter(actor=>actor.id.startsWith('crew:'));

test('Suzu works two connected actual soil edges and Kota checks the south road before returning east',()=>{
    assert.equal(crew.length,2);const [worker,courier]=crew;assert.equal(worker.workTool,'hoe');assert.equal(courier.workTool,undefined);
    for(const tile of MIDLANDS_FIELD.meeting){assert(!MIDLANDS_WORK_CLEARANCE.includes(tile));for(const anchor of lifeAnchors(42))assert(Math.max(Math.abs(tile%12-anchor%12),Math.abs(Math.floor(tile/12)-Math.floor(anchor/12)))>=2,'handover Talk must stay clear of every event-marker hit area');}
    for(const tile of MIDLANDS_FIELD.work){assert.equal(sectorWalkMask(42)![Math.floor(tile/12)][tile%12],'.');assert(CHRONICLE_STOP_RESERVED.includes(tile));}
    assert(worker.cyclePhases?.some(phase=>phase.working));assert(courier.cyclePhases?.some(phase=>phase.workTile===137));
    const worked=new Set<number>(),roads=new Set<number>();
    for(let elapsed=0;elapsed<worker.motion!.repeat!;elapsed+=500){
        for(const [index,actor]of crew.entries()){
            const at=actor.motion!.start+elapsed,p=lifeActorPosition(42,actor,at),tile=Math.round(p.row)*12+Math.round(p.col),phase=lifeActivityAtPosition(actor,p,at);
            assert(isWalkableTile(42,tile));assert(!MIDLANDS_WORK_CLEARANCE.includes(tile));
            if('working'in phase&&phase.working){assert.equal(index,0);assert(MIDLANDS_FIELD.work.includes(tile as 127|115));worked.add(tile);assert.match(phase.line,/loosening the soil/);}
            if(phase.activity==='Checking the southern road'){roads.add(tile);assert.equal(tile,137);}
        }
    }
    assert.deepEqual([...worked],[127,115]);assert.deepEqual([...roads],[137]);
    for(const actor of crew){const p=lifeActorPosition(42,actor,actor.motion!.start+actor.motion!.repeat!-1);assert.equal(p.row*12+p.col,actor.workTile);assert.equal(actor.motion!.repeat,worker.motion!.repeat);}
});

test('field work speech waits for the real work point, and both dry and wet cached shifts finish at road mouths',()=>{
    const worker=crew[0],work=worker.cyclePhases!.find(phase=>phase.working)!;
    const late=lifeActivityAtPosition(worker,{col:5,row:10},worker.motion!.start+work.at+1000);assert.equal(late.activity,'Walking to the herb patch');assert(!('working'in late));
    for(const weather of ['clear','rain','thunderstorm','ashfall'])for(const actor of lifeActorsAt(42,now,weather).filter(actor=>actor.id.startsWith('crew:'))){
        const p=lifeActorPosition(42,actor,actor.hideAt!+1000);assert.equal(p.row*12+p.col,actor.hideTile);assert([60,71].includes(actor.hideTile!));assert.equal(lifeActivityAt(actor,actor.hideAt!+1000).activity,'Continuing along the road');
        if(weather!=='clear'){assert.equal(actor.workTool,undefined);assert.equal(actor.motion?.repeat,undefined);if(actor.id.endsWith(':1'))assert(!actor.line.includes('work the soil'));}
    }
});

test('travelers rest outside the new beds, ordinary figures keep their cap and Chronicle traffic keeps a complete exit window',()=>{
    for(let i=0;i<8;i++)assert(!MIDLANDS_CROP_TILES.includes(lifeRestTile(42,i)));
    for(let time=0;time<2*WORLD_DAY_MS;time+=30_000){
        const view=lifeSceneView(42,{...parseLifeState(null,time),step:3,updatedAt:time-1000},time,'clear');assert(view.actors.length<=5);assert([0,2].includes(view.actors.filter(actor=>actor.id.startsWith('crew:')).length));
        for(const actor of view.actors)assert(!MIDLANDS_CROP_TILES.includes(actor.restTile),`${actor.id} rests on plants`);
    }
    const window=20,game=stopChronicleGame(window),state={window},plan=chronicleStopPlan(state,game),pair=chronicleStopActors(state,game,plan.matchAt);
    assert.equal(pair.length,2);for(const actor of pair){assert(actor.hideAt!<(window+1)*WORLD_HOUR_MS,'the full match and road exit must fit before the source window changes');for(const [,tile]of actor.motion!.frames)assert(!MIDLANDS_CROP_TILES.includes(tile));}
});
