import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYABLE_WILD_SECTOR_IDS } from './sector-geo.js';
import { sectorExits } from './sector-links.js';
import { isWalkableTile,walkPath } from './sector-walk-mask.js';
import { lifeCourierRoute,lifeSceneView,lifeEventView,parseLifeState,advanceLifeEvent,LIFE_WINDOW_MS,LIFE_ACTIVE_MS,lifeActorPosition } from './sector-life.js';
import { courierGroundTrail,COURIER_REST_MS } from './sector-life-courier.js';

const now=100*LIFE_WINDOW_MS+60_000;
test('courier search prints, stranded person, return stop and onward road form one real walkable journey',()=>{
    for(const sector of PLAYABLE_WILD_SECTOR_IDS){const route=lifeCourierRoute(sector);
        assert.equal(new Set([route.search,route.stranded,route.stop]).size,3,`distinct stages in ${sector}`);
        assert.notEqual(route.aid,route.stranded,'the task marker must not cover the courier');assert.equal(walkPath(sector,route.aid,route.stranded)?.length,2);
        assert.notEqual(route.meet,route.stop,'meet beside the resting courier rather than on their figure');
        for(const path of [route.trail,route.back,route.onward])for(let i=0;i<path.length;i++){
            assert(isWalkableTile(sector,path[i]));if(i)assert.equal(walkPath(sector,path[i-1],path[i])?.length,2);
        }
        assert(sectorExits(sector).some(exit=>exit.tile===route.trail[0]));assert(sectorExits(sector).some(exit=>exit.tile===route.onward.at(-1)));
        const marks=courierGroundTrail(route);assert(marks.length>0&&marks.length<=8);assert(marks.some(([tile])=>tile===route.search));
        for(const [tile,direction] of marks){assert(route.trail.includes(tile));assert(Number.isFinite(direction));}
    }
});
test('the rescued courier must actually reach the stop before completion, then rests and resumes deliveries',()=>{
    let state=parseLifeState(null,now);const route=lifeCourierRoute(31);
    state=advanceLifeEvent(31,state,state.window,0,'Aki',now).state;
    state=advanceLifeEvent(31,state,state.window,1,'Ben',now+1000).state;
    const early=advanceLifeEvent(31,state,state.window,2,'Cora',now+1001);assert.equal(early.changed,false);assert.equal(early.view.waiting,true);
    const returning=lifeSceneView(31,state,now+1001,'clear').actors.find(a=>a.id==='courier:31')!;
    assert.deepEqual(lifeActorPosition(31,returning,now+1001),{col:route.stranded%12,row:Math.floor(route.stranded/12),walking:false});
    const arrival=state.updatedAt+route.returnMs;
    assert.deepEqual(lifeActorPosition(31,returning,arrival),{col:route.stop%12,row:Math.floor(route.stop/12),walking:false});
    const done=advanceLifeEvent(31,state,state.window,2,'Cora',arrival);assert.equal(done.changed,true);assert.equal(done.view.phase,'aftermath');
    const resting=lifeSceneView(31,done.state,arrival+1000,'clear').actors.find(a=>a.id===returning.id)!;
    assert.equal(resting.activity,'Resting before the next delivery');assert.equal(lifeActorPosition(31,resting,arrival+COURIER_REST_MS-1).walking,false);
    const departed=lifeSceneView(31,done.state,arrival+COURIER_REST_MS+(route.onward.length-1)*3000+2000,'clear');
    assert(!departed.actors.some(a=>a.id===returning.id));assert.match(departed.description,/continued along the delivery route/);
});
test('a search begun before the cutoff can finish, and an unattended courier returns without inventing a helper',()=>{
    const cutoff=Math.floor(now/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+LIFE_ACTIVE_MS;
    const state=parseLifeState(null,cutoff),route=lifeCourierRoute(31);
    assert.equal(lifeEventView(31,{...state,step:1},cutoff+1000).phase,'active');
    assert.equal(lifeEventView(31,state,cutoff).phase,'unattended');
    const alone=lifeSceneView(31,state,cutoff+3000,'rain'),courier=alone.actors.find(a=>a.id==='courier:31')!;
    assert.equal(courier.activity,'Making their own way back');assert.doesNotMatch(courier.line,/thank|helped/i);assert.deepEqual(alone.contributors,[]);
    const gone=lifeSceneView(31,state,cutoff+route.returnMs+COURIER_REST_MS+(route.onward.length-1)*3000+2000,'rain');
    assert(!gone.actors.some(a=>a.id===courier.id));assert.match(gone.description,/without help/);assert.equal(gone.phase,'unattended');
});
