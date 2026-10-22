import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYABLE_WILD_SECTOR_IDS } from './sector-geo.js';
import { WANDERER_BUCKET_MS } from './wanderer-roster.js';
import { trackerTrailSectors,TRACKER_TRAIL_TTL_MS } from './tracker-trail.js';
import { lifeEventView,lifeSceneView,lifeActorsAt,lifeActorPosition,lifeHuntSites,parseLifeState,advanceLifeEvent,LIFE_WINDOW_MS } from './sector-life.js';
import { lifeTrackingParty,parseLifeHunt,lifeTrackSites,type LifeHunt } from './sector-life-tracking.js';
import { walkPath,isWalkableTile } from './sector-walk-mask.js';
import { sectorExits } from './sector-links.js';
import { lifeRegionFor } from './sector-life-content.js';
import { LIFE_WORK_SITES,lifeAnchors } from './sector-life.js';

export function trackingFixture() {
    for(let round=0;round<16;round++)for(const sector of PLAYABLE_WILD_SECTOR_IDS){const now=82_000*WANDERER_BUCKET_MS+round*LIFE_WINDOW_MS+60_000,view=lifeEventView(sector,parseLifeState(null,now),now);if(view.kind==='tracks'&&view.tracker)return {sector,now,tracker:view.tracker};}
    throw new Error('No natural tracking site found');
}
const site=trackingFixture(),{sector,now,tracker}=site;
const hunt:LifeHunt={window:Math.floor(now/LIFE_WINDOW_MS),owner:'Rin',trackerId:tracker.id,giver:tracker.name,homeTile:tracker.homeTile,trailId:'trail-world-tracking-0001',requestId:'world-tracking-request-0001',sectors:trackerTrailSectors('trail-world-tracking-0001',sector),startedAt:now,expiresAt:now+TRACKER_TRAIL_TTL_MS};
test('a world trail names an actual natural tracker and puts its work point beside the figure',()=>{
    const state=parseLifeState(null,now),view=lifeEventView(sector,state,now),sites=lifeTrackSites(sector,tracker);
    assert.equal(view.tracker?.id,tracker.id);assert.notEqual(view.tile,tracker.homeTile);assert.equal(walkPath(sector,view.tile,tracker.homeTile)?.length,2);
    assert(sites.marks.length>0&&sites.marks.length<=4);for(const [tile,direction] of sites.marks){assert(isWalkableTile(sector,tile));assert.equal(direction,undefined,'unknown animal species must not be drawn with human boot prints');}
    const inspect=advanceLifeEvent(sector,state,state.window,0,'Rin',now);assert(inspect.changed);assert.equal(inspect.view.step,1);
    assert.equal(advanceLifeEvent(sector,inspect.state,state.window,1,'Rin',now+1).changed,false,'a button cannot invent a trail encounter or its result');
});
test('the party leaves and returns on cardinal terrain paths and resumes ordinary life after rest',()=>{
    const resident=lifeActorsAt(sector,now,'clear')[0],resolved={...hunt,result:'unbound' as const,resolvedAt:now+180_000};
    const pending=lifeTrackingParty(sector,hunt,resident,lifeHuntSites(sector),now+120_000);assert.equal(pending.resident,undefined);assert.equal(pending.tracker,undefined);assert.equal(pending.trackerAway,true);
    const returning=lifeTrackingParty(sector,resolved,resident,lifeHuntSites(sector),resolved.resolvedAt+1000);
    assert(returning.resident);assert(returning.tracker);
    for(const actor of [returning.resident,returning.tracker]){const frames=actor.motion!.frames;for(let i=1;i<frames.length;i++){assert(frames[i][0]>frames[i-1][0]);const path=walkPath(sector,frames[i-1][1],frames[i][1]);assert(path&&path.length<=2);}
        for(let time=0;time<frames.at(-1)![0];time+=500){const pose=lifeActorPosition(sector,actor,now+time);assert(isWalkableTile(sector,Math.round(pose.row)*12+Math.round(pose.col)));}
    }
    const end=returning.tracker.motion!.frames.at(-1)![0],gone=lifeTrackingParty(sector,resolved,resident,lifeHuntSites(sector),now+end+2000);
    assert.equal(gone.tracker,undefined);assert.equal(gone.resident,resident,'the local worker returns to their ordinary routine');
});
test('a pending hunt survives event rollover and an old result cannot complete an unrelated round',()=>{
    const raw={...parseLifeState(null,now),step:2,hunt},later=now+LIFE_WINDOW_MS;
    const next=parseLifeState(raw,later);assert.equal(next.hunt?.trailId,hunt.trailId);assert.equal(next.step,0);
    const ongoing=lifeSceneView(sector,next,later,'clear');assert.equal(ongoing.kind,'tracks');assert.equal(ongoing.step,2);assert.equal(ongoing.waiting,true);
    const ended={...next,hunt:{...hunt,result:'cold' as const,resolvedAt:later}};assert.equal(parseLifeState(ended,later).step,0);
    for(const bad of [{startedAt:now+1},{sectors:[999,1]},{trailId:'forged'},{homeTile:144},{expiresAt:now-1}])assert.equal(parseLifeHunt({...hunt,...bad},now),undefined);
    assert.equal(parseLifeHunt({...hunt,result:'bound',resolvedAt:now+1},now)?.result,undefined,'future claims are not outcomes');
});

test('regional trail stops have reachable separate clearings and all offered trackers can reach their roads',()=>{
    for(const area of PLAYABLE_WILD_SECTOR_IDS){
        if(lifeRegionFor(area).event==='tracks'&&!LIFE_WORK_SITES[area]){const spots=lifeHuntSites(area),home=lifeAnchors(area)[2];assert.notEqual(spots.scout,home,'the party clears the landmark labels');assert.equal(Math.floor(spots.scout/12),Math.floor(spots.tracker/12));assert(Math.abs(spots.scout-spots.tracker)>=2);assert(walkPath(area,home,spots.scout));assert(walkPath(area,home,spots.tracker));}
        for(let round=0;round<24;round++){const time=82_000*WANDERER_BUCKET_MS+round*LIFE_WINDOW_MS+60_000,view=lifeEventView(area,parseLifeState(null,time),time);if(!view.tracker)continue;for(const exit of sectorExits(area))assert(walkPath(area,view.tracker.homeTile,exit.tile),`${area}: the tracker can reach every possible first trail road`);}
    }
});
