import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {FORAGER_SITE as S,FORAGER_LINES as L} from './sector-forager-work.js';
import {lifeActorsAt,lifeActorPosition,lifeSceneView,parseLifeState} from './sector-life.js';
import {lifeActivityAt,lifeActivityAtPosition} from './sector-life-motion.js';
import {isWalkableTile,walkPath,sectorWalkMask} from './sector-walk-mask.js';
import {WORLD_HOUR_MS} from './world-clock.js';
import {sectorArtKey} from './sector-geo.js';
import {lifeNaturalTracker,type LifeHunt} from './sector-life-tracking.js';
import {trackerTrailSectors,TRACKER_TRAIL_TTL_MS} from './tracker-trail.js';
import {WANDERER_BUCKET_MS} from './wanderer-roster.js';
const dawn=5*WORLD_HOUR_MS,actor=(now:number,weather='clear')=>lifeActorsAt(S.sector,now,weather).find(a=>a.id==='resident:9')!;

test('reviewed fern edges and village gate retain the inspected painted floor and connected ground',()=>{
    assert.equal(sectorArtKey(S.sector),38);
    assert.equal(createHash('sha256').update(readFileSync('shinobij.client/public/sector-map/s38.webp')).digest('hex'),'dd9fd18478093980eb14339f9c44347b248042479d46f1aaa7a942e5852c5f5b');
    assert.deepEqual(S.patches,[40,28]);assert.equal(S.door,102);
    for(const tile of S.patches){assert.equal(sectorWalkMask(S.sector)![Math.floor(tile/12)][tile%12],'.');assert(walkPath(S.sector,S.door,tile));}
});
test('one existing herbalist walks to two real leaf edges, inspects each and physically returns before hiding',()=>{
    const herbalist=actor(dawn),motion=herbalist.motion!;
    assert.equal(herbalist.name,'Herbalist Fumi');assert.equal(motion.repeat,undefined);
    assert.equal(motion.frames[0][1],S.door);assert.equal(motion.frames.at(-1)![1],S.door);
    for(let i=1;i<motion.frames.length;i++){
        assert(motion.frames[i][0]>motion.frames[i-1][0]);
        assert(walkPath(S.sector,motion.frames[i-1][1],motion.frames[i][1])!.length<=2);
    }
    for(const tile of S.patches){
        const frame=motion.frames.find(f=>f[1]===tile)!;
        for(const elapsed of [1000,S.inspectMs-1000]){
            const at=dawn+frame[0]+elapsed,p=lifeActorPosition(S.sector,herbalist,at);
            assert.equal(p.row*12+p.col,tile);assert.equal(p.walking,false);
            assert.match(lifeActivityAt(herbalist,at).activity,/Examining/);
        }
    }
    const at=dawn+motion.frames.at(-1)![0],pose=lifeActorPosition(S.sector,herbalist,at);
    assert.equal(pose.row*12+pose.col,S.door);assert(herbalist.hideAt!>at);
    assert.equal(lifeActivityAt(herbalist,herbalist.hideAt!).line,L.inside);
    assert.equal(lifeActorsAt(S.sector,dawn+70_000,'clear').filter(a=>a.id==='resident:9').length,1);
});
test('rain and night send the same native resident to the gate without inventing shelter in empty terrain',()=>{
    for(const [now,weather] of [[dawn+70_000,'rain'],[20*WORLD_HOUR_MS,'clear']] as const){
        const routine=actor(now,weather);assert.equal(routine.hideTile,S.door);
        const p=lifeActorPosition(S.sector,routine,now+300_000);assert.equal(p.row*12+p.col,S.door);
        assert.equal(lifeActivityAt(routine,now+300_000).activity,'Waiting inside the village');
    }
    const cached=actor(dawn+40_000);const late=lifeActorPosition(S.sector,cached,20*WORLD_HOUR_MS+100_000);
    assert.equal(late.row*12+late.col,S.door);assert.equal(lifeActivityAt(cached,20*WORLD_HOUR_MS).line,L.inside);
    const next=actor(dawn+S.period+40_000);assert.equal(next.motion!.start,dawn+S.period);
    assert.equal(next.hideAt!-cached.hideAt!,S.period);
});
test('a late or returning observer sees walking dialogue until the native actor actually reaches the leaves',()=>{
    const now=dawn+40_000,routine=actor(now),door={col:S.door%12,row:Math.floor(S.door/12)};
    assert.equal(lifeActivityAtPosition(routine,door,now).line,L.outgoing);
    assert.equal(lifeActivityAtPosition(routine,{col:40%12,row:Math.floor(40/12)},now).line,L.inspect);
    const rival=lifeSceneView(9,parseLifeState(null,now),now,'clear','Frostfang Village').actors.find(a=>a.id==='resident:9')!;
    assert.match(lifeActivityAtPosition(rival,door,now).line,/Stay on the path/);
    assert(lifeActivityAtPosition(rival,door,now).line.endsWith(L.outgoing));
});
test('the animal-trail party replaces herbalist work without retaining its indoors deadline',()=>{
    let now=dawn+30_000,tracker=lifeNaturalTracker(9,now);
    for(let i=0;i<80&&!tracker;i++){now+=WANDERER_BUCKET_MS;tracker=lifeNaturalTracker(9,now);}
    assert(tracker);
    const hunt:LifeHunt={window:Math.floor(now/2_700_000),owner:'Rin',trackerId:tracker.id,giver:tracker.name,homeTile:tracker.homeTile,trailId:'trail-forager-test-0001',requestId:'forager-request-0001',sectors:trackerTrailSectors('trail-forager-test-0001',9),startedAt:now,expiresAt:now+TRACKER_TRAIL_TTL_MS};
    const state={...parseLifeState(null,now),step:1,hunt};
    const ordinary=lifeSceneView(9,parseLifeState(null,now),now,'clear');
    assert.equal(ordinary.actors.find(a=>a.id==='resident:9')!.hideTile,S.door);
    const withHunt=lifeSceneView(9,state,now,'clear').actors.find(a=>a.id==='resident:9')!;
    assert.equal(withHunt.hideAt,undefined);assert.equal(withHunt.phases,undefined);
    assert(isWalkableTile(9,withHunt.restTile));
    const resumedAt=now+360_000,resumed=lifeSceneView(9,{...state,hunt:{...hunt,result:'unbound',resolvedAt:now+1}},resumedAt,'clear').actors.find(a=>a.id==='resident:9')!;
    assert.equal(resumed.hideTile,S.door);assert.equal(resumed.motion!.start,Math.floor(resumedAt/S.period)*S.period);
});
