import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ANGLER_WORK_SECTORS,ANGLER_PACK_MS,anglerWorkSite,currentWorkingAngler,nextAnglerState,anglerWorkRoutine,anglerReservedTiles} from './sector-angler-work.js';
import {lifeRestTile,lifeCourierRoute,lifeHuntSites,lifeActorsAt} from './sector-life.js';
import {WANDERER_BUCKET_MS} from './wanderer-roster.js';
import {SECTOR_FLOOR_LAYOUTS} from './sector-floor-layouts.js';
import {sectorArtKey} from './sector-geo.js';
import {walkPath,isWalkableTile} from './sector-walk-mask.js';
import {lifeActorPosition} from './sector-life-motion.js';
import {isWorldNight} from './world-phase.js';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from './world-clock.js';
import {RESOURCE_NODES,resourceNodePosition} from './resource-nodes.js';
import {sectorMarkerBox} from '../shinobij.client/src/lib/sector-marker.js';

export function workingExample(sector:number){
    for(let bucket=80;bucket<300;bucket++)for(let offset=0;offset<WANDERER_BUCKET_MS;offset+=60_000){const now=bucket*WANDERER_BUCKET_MS+offset,work=currentWorkingAngler(sector,now);if(work&&!isWorldNight(now)&&now%WORLD_DAY_MS>=8*WORLD_HOUR_MS&&offset<WANDERER_BUCKET_MS-120_000)return {now,work};}
    throw Error(`No natural angler for ${sector}`);
}

test('Stillwater anglers and shoals retain separate pointer centres on the smallest map',()=>{
    const tilePx=24,figure=sectorMarkerBox(tilePx);
    for(const sector of [6])for(const bucket of [...Array.from({length:200},(_,i)=>i),83003]){
        const work=currentWorkingAngler(sector,bucket*WANDERER_BUCKET_MS+10*WORLD_HOUR_MS);if(!work)continue;
        const bank=work.site.bank,x=(bank%12+.5)*tilePx,y=(Math.floor(bank/12)+.5)*tilePx-figure.h/2;
        for(const node of RESOURCE_NODES.filter(node=>node.sector===sector)){
            assert.notEqual(bank,node.approach,`${sector}: keep the player's gathering approach free`);
            const marker=resourceNodePosition(node),distance=Math.hypot(x-marker.left*.12*tilePx,y-marker.top*.12*tilePx);
            assert(distance>27,`${sector}/${bucket}: ${node.name} must not cover the angler's pointer centre`);
        }
    }
});
test('natural anglers keep their real IDs, water positions and connected gatehouse routes',()=>{
    for(const sector of ANGLER_WORK_SECTORS){let checked=0;
        for(let bucket=0;bucket<100;bucket++){
            const work=currentWorkingAngler(sector,bucket*WANDERER_BUCKET_MS+60_000);if(!work)continue;checked++;
            const {wanderer,site}=work;assert.equal(wanderer.verb,'angler');assert.equal(site.bank,wanderer.homeTile);assert(isWalkableTile(sector,site.bank));assert(walkPath(sector,site.bank,site.door));
            assert(SECTOR_FLOOR_LAYOUTS[sectorArtKey(sector)].hydrology!.waterTiles.includes(site.water));assert(Math.hypot(site.bank%12-site.water%12,Math.floor(site.bank/12)-Math.floor(site.water/12))<=1.5);
            assert.equal(anglerWorkSite(sector,{...wanderer,verb:'contest'}),undefined);
            assert.equal(anglerWorkSite(42,wanderer),undefined);
        }assert(checked>=4);
    }
});
test('fishing, packing and entering the visible gatehouse are timed paths rather than position resets',()=>{
    for(const sector of ANGLER_WORK_SECTORS){const {now,work}=workingExample(sector);
        const state=nextAnglerState(sector,null,now,'clear',work),fishing=anglerWorkRoutine(sector,state,now,work);assert.equal(fishing.activity,'Fishing by the bank');assert(fishing.fishing);assert.equal(fishing.fishing.water,work.site.water);
        const before=lifeActorPosition(sector,fishing,now),closed=nextAnglerState(sector,state,now,'rain',work),packing=anglerWorkRoutine(sector,closed,now,work);
        assert.equal(closed.origin,work.site.bank);assert.equal(packing.activity,'Putting the line away');assert.equal(packing.fishing,undefined);assert(packing.hideAt!>now+ANGLER_PACK_MS);
        assert.deepEqual(lifeActorPosition(sector,packing,now),before);
        for(let i=1;i<packing.motion!.frames.length;i++){const [at,tile]=packing.motion!.frames[i],previous=packing.motion!.frames[i-1];assert(at>previous[0]);assert((walkPath(sector,previous[1],tile)?.length??Infinity)<=2);}
        assert.equal(packing.motion!.frames.at(-1)![1],work.site.door);
        assert.equal(anglerWorkRoutine(sector,closed,packing.hideAt!+1,work).activity,'Resting indoors');
        const clear=nextAnglerState(sector,closed,packing.hideAt!+1000,'clear',work),returning=anglerWorkRoutine(sector,clear,packing.hideAt!+1000,work);
        assert.equal(clear.origin,work.site.door);assert.equal(returning.activity,'Walking to the fishing spot');assert(returning.hideAt!>clear.at);assert.equal(returning.motion!.frames[0][1],work.site.door);
        assert.deepEqual(nextAnglerState(sector,clear,clear.at+1000,'clear',work),clear,'a later poll never restarts the route');
        const interrupted=nextAnglerState(sector,clear,clear.at+4000,'rain',work),position=lifeActorPosition(sector,returning,clear.at+4000);
        assert(Math.hypot(interrupted.origin%12-position.col,Math.floor(interrupted.origin/12)-position.row)<=.51);
        assert.deepEqual(nextAnglerState(sector,interrupted,interrupted.at-1,'clear',work),interrupted,'an older observation cannot roll back a weather transition');
    }
});
test('night and roster closure put the same angler indoors, while malformed state is rebuilt from authored ground',()=>{
    const sector=6,{now,work}=workingExample(sector),state=nextAnglerState(sector,null,now,'clear',work);
    const closing=Math.floor(now/WANDERER_BUCKET_MS)*WANDERER_BUCKET_MS+WANDERER_BUCKET_MS-89_000;
    assert.equal(nextAnglerState(sector,state,closing,'clear',work).mode,'inside');
    let night=now;while(!isWorldNight(night))night+=60_000;assert.equal(nextAnglerState(sector,state,night,'clear',work).mode,'inside');
    const broken=nextAnglerState(sector,{...state,origin:999},now,'clear',work);assert.equal(broken.origin,work.site.door);
});
test('a retained daylight snapshot puts the line away and enters the gatehouse at night without a poll',()=>{
    const sector=18,{now,work}=workingExample(sector),state=nextAnglerState(sector,null,now,'clear',work),routine=anglerWorkRoutine(sector,state,now,work);
    assert(routine.fishing);assert(routine.phases);assert(routine.phases.some(phase=>phase.at===routine.fishing!.until&&phase.activity==='Putting the line away'));
    assert(routine.hideAt!>routine.fishing.until);assert.equal(routine.motion!.frames.at(-1)![1],work.site.door);
    const inside=lifeActorPosition(sector,routine,routine.hideAt!+1);assert.equal(inside.col,work.site.door%12);assert.equal(inside.row,Math.floor(work.site.door/12));
    const late=nextAnglerState(sector,state,routine.hideAt!+1000,'clear',work),snapshot=anglerWorkRoutine(sector,late,routine.hideAt!+1000,work);
    assert.equal(late.at,routine.fishing.until,'a late night poll adopts the planned departure instead of restarting it');assert.equal(snapshot.hideAt,routine.hideAt);assert.equal(snapshot.activity,'Resting indoors');
});
test('an unobserved night stays closed in next-morning rain instead of sending the angler out and back',()=>{
    const sector=6,{now,work}=workingExample(sector),state=nextAnglerState(sector,null,now,'clear',work),morning=Math.floor(now/WORLD_DAY_MS)*WORLD_DAY_MS+WORLD_DAY_MS+8*WORLD_HOUR_MS;
    const wet=nextAnglerState(sector,state,morning,'rain',work),indoor=anglerWorkRoutine(sector,wet,morning,work);
    assert.equal(indoor.activity,'Resting indoors');assert(indoor.hideAt!<morning);assert.equal(indoor.motion!.frames.at(-1)![1],work.site.door);
    const clear=nextAnglerState(sector,wet,morning+1000,'clear',work);assert.equal(clear.at,morning+1000);assert.equal(clear.origin,work.site.door);
});

test('shoreline work and gatehouse entrances stay clear of permanent resting posts',()=>{
    for(const sector of ANGLER_WORK_SECTORS){
        const reserved=anglerReservedTiles(sector),{now}=workingExample(sector);
        for(let index=0;index<7;index++)assert(!reserved.includes(lifeRestTile(sector,index)),`${sector}: rest ${index}`);
        const courier=lifeCourierRoute(sector),hunters=lifeHuntSites(sector);
        for(const tile of [courier.stop,...Object.values(hunters)])assert(!reserved.includes(tile),`${sector}: event rest ${tile}`);
        for(const weather of ['clear','rain'])for(const actor of lifeActorsAt(sector,now,weather))assert(!reserved.includes(actor.restTile),`${sector}: ${actor.name}`);
    }
});
