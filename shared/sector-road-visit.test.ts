import test from 'node:test';
import assert from 'node:assert/strict';
import {lifeActorsAt,travelerRoute,lifeCourierRoute,lifeEventView,parseLifeState,LIFE_ACTIVE_MS,LIFE_WINDOW_MS} from './sector-life.js';
import {LIFE_TRAVELERS} from './sector-life-content.js';
import {lifeActorPosition,lifeActivityAt,lifeActivityAtPosition} from './sector-life-motion.js';
import {courierLife,COURIER_REST_MS} from './sector-life-courier.js';
import {isWalkableTile} from './sector-walk-mask.js';

test('all recurring visits retain finite actual exits and cached rest speech is tied to the real stop',()=>{
    for(const [index,traveler]of LIFE_TRAVELERS.entries())for(const sector of new Set(travelerRoute(index))){
        let actor:ReturnType<typeof lifeActorsAt>[number]|undefined;
        for(let slot=0;slot<100&&!actor;slot++)actor=lifeActorsAt(sector,slot*300_000+90_000,'clear').find(a=>a.id===traveler.id);
        assert(actor);assert.equal(actor.hideAt,actor.motion!.start+300_000);assert.equal(actor.hideTile,actor.motion!.frames.at(-1)![1]);
        const end=lifeActorPosition(sector,actor,actor.hideAt!+1000);assert.equal(end.row*12+end.col,actor.hideTile);assert(isWalkableTile(sector,actor.hideTile!));
        const rest=actor.phases!.find(phase=>phase.workTile!==undefined)!;assert(rest.returnGreeting);assert.equal(rest.workTile,actor.restTile);
        const late=lifeActivityAtPosition(actor,{col:-1,row:-1},rest.at+1);assert(!/Resting|Road courier|Traveling/.test(late.activity));
        assert.equal(lifeActivityAt(actor,actor.hideAt!+1000).activity,'Continuing along the road');
    }
});

test('a cached injured courier returns and leaves without invented help, and helped rest waits for the actual stop',()=>{
    const sector=52,start=120*LIFE_WINDOW_MS,route=lifeCourierRoute(sector),state=parseLifeState(null,start+1000);
    const active=courierLife(sector,lifeEventView(sector,state,start+1000),route,start+1000,start+LIFE_ACTIVE_MS).actors[0];
    const returned=active.phases!.find(p=>p.workTile!==undefined)!,depart=returned.at+COURIER_REST_MS;
    assert.equal(lifeActivityAt(active,returned.at+1).activity,'Resting at the roadside stop');assert(!/thank/i.test(lifeActivityAt(active,returned.at+1).line));
    assert.equal(lifeActivityAtPosition(active,{col:route.stranded%12,row:Math.floor(route.stranded/12)},returned.at+1).activity,'Returning to the roadside stop');
    assert.equal(lifeActivityAt(active,depart+1).activity,'Continuing the delivery route');assert.equal(active.hideTile,route.onward.at(-1));
    const done={...state,step:3,updatedAt:start+1000},helped=courierLife(sector,lifeEventView(sector,done,start+2000),route,start+2000,start+LIFE_ACTIVE_MS).actors[0];
    assert.equal(lifeActivityAtPosition(helped,{col:3,row:0},start+2000).activity,'Returning to the roadside stop');
    assert.equal(lifeActivityAtPosition(helped,{col:route.stop%12,row:Math.floor(route.stop/12)},start+2000).activity,'Resting before the next delivery');assert(helped.hideAt);
});
