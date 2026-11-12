import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peerWorldPath, advancePeerPath, advanceTimedPeerPath, peerPoseInMotion, type PeerWaypoint } from './world-peer-motion';
import { sectorGaitTilesPerSecond } from '../../../shared/sector-model-motion';
import type { WorldNode } from '../../../shared/continuous-world-navigation';
const nodes = new Map<string, WorldNode>([
    ['a', { id: 'a', sector: 1, x: 0, y: 0, neighbors: ['b'] }],
    ['b', { id: 'b', sector: 1, x: 1, y: 0, neighbors: ['a', 'c'] }],
    ['c', { id: 'c', sector: 2, x: 1, y: 1, neighbors: ['b'] }],
    ['other', { id: 'other', sector: 3, x: .5, y: .5, neighbors: [] }],
]);
const cursor = (from: string, to: string, progress: number) => ({ layoutVersion: 'test', from, to, progress });
test('peer snapshots follow corners and exact partial edges without diagonal shortcuts', () => {
    const path = peerWorldPath(nodes, cursor('a', 'b', .5), cursor('b', 'c', .5))!;
    assert.deepEqual(advancePeerPath(path, .75), { x: 1, y: .25 });
    assert.deepEqual(advancePeerPath(path, 10), { x: 1, y: .5 });
    assert.equal(peerWorldPath(nodes, cursor('a', 'b', .5), cursor('other', 'other', 0)), null);
});
test('reversed partial-edge peer updates preserve the exact location', () => {
    const path = peerWorldPath(nodes, cursor('a', 'b', .75), cursor('b', 'a', .75))!;
    assert.deepEqual(advancePeerPath(path, .25), { x: .5, y: 0 });
});

test('a later sprint packet preserves the walking speed and facing up to the corner', () => {
    const { walk, run } = sectorGaitTilesPerSecond;
    const path = [{x:0,y:0}, {x:walk,y:0,rate:walk}, {x:walk,y:run,rate:run}];
    assert.deepEqual(advanceTimedPeerPath(path,.5),{x:walk/2,y:0,rate:walk});
    assert.deepEqual(advanceTimedPeerPath(path,.75),{x:walk,y:run/4,rate:run});
    assert.deepEqual(advanceTimedPeerPath(path,.75),{x:walk,y:run,rate:run});
    assert.equal(path.length,1);
});

test('a portrait catches up at its presentation speed while preserving the next equipped gait', () => {
    const path = [{x:0,y:0}, {x:1,y:0,rate:1/3}, {x:1,y:1,rate:1.25}];
    assert.deepEqual(advanceTimedPeerPath(path,.15625,8),{x:1,y:.25,rate:1.25});
    assert.deepEqual(advanceTimedPeerPath(path,0),path[0]);
    assert.deepEqual(advanceTimedPeerPath(path,1),{x:1,y:1,rate:1.25});
});

test('jittered peer packets keep one motion intent while ground travel stays within accepted points', () => {
    for (const rate of Object.values(sectorGaitTilesPerSecond)) {
        const arrivals=[150,320,505,710,850,1040,1215];
        const path: PeerWaypoint[]=[{x:0,y:0}];
        let lastMovementAt: number | undefined, received=0, movingSamples=0, heldSamples=0;
        for(let now=0;now<=2000;now+=10) {
            if(received<arrivals.length && now>=arrivals[received]) {
                received++;
                path.push({x:received*.15*rate,y:0,rate});
            }
            const previous={...path[0]};
            const current=advanceTimedPeerPath(path,.01)!;
            const moved=current.x!==previous.x || current.y!==previous.y;
            if(moved) {lastMovementAt=now;movingSamples++;}
            const active=peerPoseInMotion(lastMovementAt,now);
            assert.ok(current.x<=received*.15*rate+1e-10,'pose grace never predicts extra ground');
            assert.equal(current.y,0);
            if(now>=arrivals[0] && now<=arrivals.at(-1)!) {
                assert.equal(active,true,'ordinary packet jitter must not request another stop');
                if(!moved) {heldSamples++;assert.equal(current.x,previous.x);}
            }
            if(now===2000) assert.equal(active,false,'a real stop still settles after the grace');
        }
        assert.ok(movingSamples>20 && heldSamples>0);
        assert.ok(Math.abs(path[0].x-arrivals.length*.15*rate)<1e-10);
    }
    assert.equal(peerPoseInMotion(undefined,0),false);
    assert.equal(peerPoseInMotion(300,299),false);
    assert.equal(peerPoseInMotion(300,499),true);
    assert.equal(peerPoseInMotion(300,500),false);
});
