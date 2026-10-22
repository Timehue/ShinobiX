import test from 'node:test';
import assert from 'node:assert/strict';
import { lifeActorsAt,lifeActorPosition,lifeSceneView,parseLifeState,travelerRoute,LIFE_WORK_SITES } from './sector-life.js';
import { LIFE_ROAD_CREWS } from './sector-life-routines.js';
import { LIFE_TRAVELERS } from './sector-life-content.js';
import { LIFE_EVENT_NEWS,LIFE_TRAVELER_CONTEXT } from './sector-life-conversations.js';
import { WORLD_HOUR_MS } from './world-clock.js';
import { PLAYABLE_WILD_SECTOR_IDS } from './sector-geo.js';
import { walkPath,isWalkableTile,sectorWalkMask } from './sector-walk-mask.js';
import { sectorExits } from './sector-links.js';
import {lifeActivityAt,lifeActivityAtPosition} from './sector-life-motion.js';

test('recurring people react to actual weather, night, prior meetings and completed local work',()=>{
    LIFE_TRAVELERS.forEach((traveler,index)=>{
        const route=travelerRoute(index),time=8*WORLD_HOUR_MS+150_000,slot=Math.floor(time/300_000),sector=route[(slot+index*2)%route.length];
        const ordinary=lifeActorsAt(sector,time,'clear').find(a=>a.id===traveler.id)!;
        assert.equal(ordinary.line,traveler.greeting);
        const wet=lifeActorsAt(sector,time,'rain').find(a=>a.id===traveler.id)!;
        assert.equal(wet.line,LIFE_TRAVELER_CONTEXT[traveler.id].weather);
        const met=lifeActorsAt(sector,time,'rain',[traveler.id]).find(a=>a.id===traveler.id)!;
        assert.match(met.line,/again/);assert(met.line.endsWith(wet.line));
        const night=21*WORLD_HOUR_MS+150_000,nightSector=route[(Math.floor(night/300_000)+index*2)%route.length];
        assert.equal(lifeActorsAt(nightSector,night,'clear').find(a=>a.id===traveler.id)!.line,LIFE_TRAVELER_CONTEXT[traveler.id].night);
        const done=lifeSceneView(sector,{...parseLifeState(null,time),step:3,updatedAt:time-100_000},time,'clear');
        assert.equal(done.actors.find(a=>a.id===traveler.id)!.line,LIFE_EVENT_NEWS[done.kind]);
        assert(done.actors.find(a=>a.id===traveler.id)!.returnGreeting?.endsWith(LIFE_EVENT_NEWS[done.kind]));
    });
});

test('Sumi is a player-like Chronicle scribe who cites only a supplied recorded duel',()=>{
    const time=8*WORLD_HOUR_MS+150_000,route=travelerRoute(3),sector=route[(8+6)%route.length];
    const state=parseLifeState(null,time),plain=lifeSceneView(sector,state,time,'clear');
    const sumi=plain.actors.find(a=>a.id==='sumi')!;
    assert.match(sumi.line,/Chronicle/);assert.equal(sumi.wanderer.archetype,'sage');
    const recorded=lifeSceneView(sector,state,time,'clear',undefined,{kind:'duel',victor:'Rin',fallen:'Kota',at:time-60_000}).actors.find(a=>a.id==='sumi')!;
    assert.match(recorded.line,/local duel record names Rin as the winner against Kota/);
    assert.doesNotMatch(recorded.line,/I saw|I witnessed|bridge/);
});

test('regional road workers meet a real adjacent partner, wait for them, and return to connected posts',()=>{
    for(const sector of Object.keys(LIFE_ROAD_CREWS).map(Number)) {
        const base=LIFE_ROAD_CREWS[sector].night?21*WORLD_HOUR_MS:8*WORLD_HOUR_MS;
        const pair=lifeActorsAt(sector,base,'clear').filter(a=>a.id.startsWith('crew:'));assert.equal(pair.length,2);
        const resident=lifeActorsAt(sector,base,'clear')[0];
        for(const actor of pair)assert.notEqual(actor.workTile,resident.workTile,`${sector}: workers must not share the resident's work point`);
        const period=pair[0].motion!.repeat!,meeting=pair[0].motion!.frames.find(frame=>frame[0]>60_000&&frame[1]===pair[0].restTile)![0];
        const meetingEnd=pair[0].motion!.frames.find(frame=>frame[0]>meeting&&frame[1]===pair[0].restTile)![0];
        const start=pair[0].motion!.start+Math.ceil((base-pair[0].motion!.start)/period)*period;
        let talked=false,returned=false;
        for(let elapsed=0;elapsed<period;elapsed+=3000) {
            const now=start+elapsed,cast=lifeActorsAt(sector,now,'clear').filter(a=>a.id.startsWith('crew:'));
            // A crew clocks out at the world-day boundary rather than changing
            // its identity or night-only regional schedule.
            if(cast.length!==2)continue;
            const positions=cast.map(a=>lifeActorPosition(sector,a,now));
            for(let i=0;i<2;i++)assert(isWalkableTile(sector,Math.round(positions[i].row)*12+Math.round(positions[i].col)));
            if(cast.every(a=>a.activity===(LIFE_ROAD_CREWS[sector].handover?.activity??'Exchanging road news'))) {
                talked=true;assert(Math.hypot(positions[0].col-positions[1].col,positions[0].row-positions[1].row)<=1.01);
                for(let i=0;i<2;i++)assert(cast[i].line.includes(cast[1-i].name));
            }
            if(elapsed>meetingEnd&&cast.every((a,i)=>positions[i].row*12+positions[i].col===a.workTile))returned=true;
        }
        assert(talked,`${sector}: workers must have a shared handover`);assert(returned,`${sector}: workers must return to their posts`);
        for(const actor of pair) {
            assert(walkPath(sector,actor.workTile,actor.restTile));
            for(let i=1;i<actor.motion!.frames.length;i++) {
                const current=actor.motion!.frames[i],previous=actor.motion!.frames[i-1];assert(current[0]>previous[0]);
                assert(walkPath(sector,previous[1],current[1])!.length<=2);
            }
            const wet=lifeActorsAt(sector,base,'rain').find(a=>a.id===actor.id)!;
            assert.equal(wet.motion?.repeat,undefined);assert.equal(lifeActorPosition(sector,wet,base+30_000).walking,false);
        }
    }
});

test('Ashen Leaf scouts practise together on four grass cells and resume their actual road posts',()=>{
    const now=8*WORLD_HOUR_MS,crew=lifeActorsAt(9,now,'clear').filter(actor=>actor.id.startsWith('crew:'));
    assert.deepEqual(crew.map(actor=>actor.restTile),[74,73]);assert.deepEqual(LIFE_ROAD_CREWS[9].training,[62,61]);
    const masks=[74,73,62,61];for(const tile of masks)assert.equal(sectorWalkMask(9)![Math.floor(tile/12)][tile%12],'.','practice stays off the public road and buildings');
    const motion=crew[0].motion!,training=crew[0].cyclePhases!.find(phase=>phase.activity==='Practising footwork')!.at;
    const start=motion.start+Math.ceil((now-motion.start)/motion.repeat!)*motion.repeat!;
    for(const offset of [3500,6500,9500,12500,15500,18500,21500]){
        const time=start+training+offset,p=crew.map(actor=>lifeActorPosition(9,actor,time));
        assert(Math.abs(p[0].row-p[1].row)<.001,'partners perform the same steps');
        assert.equal(Math.abs(p[0].col-p[1].col),1);assert(p.every(point=>point.row>=5&&point.row<=6));
        for(let i=0;i<2;i++){
            assert.equal(lifeActivityAtPosition(crew[i],p[i],time).activity,'Practising footwork');
            assert.equal(lifeActivityAtPosition(crew[i],{col:10,row:5},time).activity,'Walking to the practice patch');
        }
    }
    for(let i=0;i<2;i++){
        const last=start+motion.repeat!-1000,p=lifeActorPosition(9,crew[i],last);assert.equal(p.row*12+p.col,crew[i].workTile);
        const scene=lifeSceneView(9,parseLifeState(null,start+training+6000),start+training+6000,'clear','Frostfang Village');
        assert.match(lifeActivityAt(scene.actors.find(actor=>actor.id===crew[i].id)!,start+training+6000).line,/Stay on the path/);
    }
});

test('cached day/night crews return to road exits and finish even during an API outage or persistent rain',()=>{
    for(const sector of Object.keys(LIFE_ROAD_CREWS).map(Number))for(const weather of ['clear','rain']){
        const night=!!LIFE_ROAD_CREWS[sector].night,now=(night?21:8)*WORLD_HOUR_MS;
        const crew=lifeActorsAt(sector,now,weather).filter(actor=>actor.id.startsWith('crew:'));
        for(const actor of crew){
            const end=actor.hideAt!,post=actor.hideTile!;
            assert(sectorExits(sector).some(exit=>exit.tile===post));
            const closed=lifeActorPosition(sector,actor,end+60_000);assert.equal(closed.row*12+closed.col,post);assert.equal(closed.walking,false);
            assert.equal(lifeActivityAt(actor,end+60_000).activity,'Continuing along the road');
            const begin=actor.motion!.ending?.at??actor.phases![0].at;
            for(let t=begin;t<=end;t+=3000){const p=lifeActorPosition(sector,actor,t);assert(isWalkableTile(sector,Math.round(p.row)*12+Math.round(p.col)));}
        }
    }
});

test('day and night crews finish at actual road exits before their shift ends, even in rain',()=>{
    for(const sector of Object.keys(LIFE_ROAD_CREWS).map(Number)) {
        const night=!!LIFE_ROAD_CREWS[sector].night,closing=(night?29:20)*WORLD_HOUR_MS-1000;
        for(const weather of ['clear','rain']) {
            const crew=lifeActorsAt(sector,closing,weather).filter(a=>a.id.startsWith('crew:'));assert.equal(crew.length,2);
            for(const actor of crew) {
                assert.equal(actor.activity,'Finishing the road round');
                const pose=lifeActorPosition(sector,actor,closing);
                assert(sectorExits(sector).some(exit=>exit.tile===pose.row*12+pose.col));
                assert.equal(actor.motion?.frames.at(-1)?.[1],pose.row*12+pose.col);
            }
        }
        assert.equal(lifeActorsAt(sector,closing+2000,'clear').filter(a=>a.id.startsWith('crew:')).length,0);
    }
});

test('busy and quiet regions differ, Moonshadow has a night round, and event casts stay bounded with whole pairs',()=>{
    const day=8*WORLD_HOUR_MS+150_000;
    for(const sector of [2,46,50,52])assert.equal(lifeActorsAt(sector,day,'clear').filter(a=>a.id.startsWith('crew:')).length,2);
    for(const sector of [55,56,57,58,59,60])assert.equal(lifeActorsAt(sector,day,'clear').filter(a=>!a.traveler).length,1);
    assert.equal(lifeActorsAt(24,day,'clear').filter(a=>a.id.startsWith('crew:')).length,0);
    assert.equal(lifeActorsAt(24,21*WORLD_HOUR_MS,'clear').filter(a=>a.id.startsWith('crew:')).length,2);
    for(const sector of PLAYABLE_WILD_SECTOR_IDS)for(let slot=0;slot<24;slot++)for(const step of [0,3]) {
        const now=slot*300_000+150_000,view=lifeSceneView(sector,{...parseLifeState(null,now),step,updatedAt:now-30_000},now,'clear');
        assert(view.actors.length<=5,`${sector}: mobile population budget`);
        assert([0,2].includes(view.actors.filter(a=>a.id.startsWith('crew:')).length));
        if(LIFE_WORK_SITES[sector])assert.equal(view.actors[0].workTile,LIFE_WORK_SITES[sector].work);
    }
});
