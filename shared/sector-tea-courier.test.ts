import test from 'node:test';
import assert from 'node:assert/strict';
import { lifeActorsAt,lifeSceneView,parseLifeState,lifeRestTile } from './sector-life.js';
import { lifeActorPosition,lifeActivityAt } from './sector-life-motion.js';
import { sectorExits,SECTOR_ROAD_PAIRS } from './sector-links.js';
import { isWalkableTile,walkPath } from './sector-walk-mask.js';
import { TETSU_ROUTE,TEA_COURIER_SECTOR,TEA_COURIER_SEAT,TEA_TABLE_CLEARANCE,TEA_COURIER_LINES } from './sector-tea-courier.js';

const sector=TEA_COURIER_SECTOR,visits=TETSU_ROUTE.flatMap((s,i)=>s===sector?[i]:[]);
test('Tetsu carries letters along reciprocal roads from the harbor through the staffed tea stop on both legs',()=>{
    assert.equal(TETSU_ROUTE[0],1);assert.equal(visits.length,2);
    for(let i=0;i<TETSU_ROUTE.length;i++) {
        const from=TETSU_ROUTE[i],to=TETSU_ROUTE[(i+1)%TETSU_ROUTE.length];
        assert(SECTOR_ROAD_PAIRS.some(([a,b])=>a===from&&b===to||a===to&&b===from),`${from} -> ${to}`);
    }
    for(const visit of visits) {
        const start=visit*300_000,actor=lifeActorsAt(sector,start,'clear').find(a=>a.id==='tetsu')!;
        const before=TETSU_ROUTE[(visit+TETSU_ROUTE.length-1)%TETSU_ROUTE.length],after=TETSU_ROUTE[(visit+1)%TETSU_ROUTE.length];
        assert.equal(actor.motion!.frames[0][1],sectorExits(sector).find(e=>e.destinationSector===before)!.tile);
        assert.equal(actor.motion!.frames.at(-1)![1],sectorExits(sector).find(e=>e.destinationSector===after)!.tile);
        assert.equal(actor.restTile,TEA_COURIER_SEAT);assert.equal(actor.hideAt,start+300_000);
        const rested=lifeActorPosition(sector,actor,start+150_000);
        assert.deepEqual(rested,{col:9,row:8,walking:false});
        assert.equal(lifeActorsAt(sector,start+300_000,'clear').filter(a=>a.id==='tetsu').length,0);
        const next=lifeActorsAt(after,start+300_000,'clear').find(a=>a.id==='tetsu')!;
        assert.equal(next.motion!.frames[0][1],sectorExits(after).find(e=>e.destinationSector===sector)!.tile);
    }
});
test('the table mat remains reserved and both routes go around the seller, kettle and upper mat',()=>{
    const otherStops=Array.from({length:7},(_,i)=>i).filter(i=>i!==1).map(i=>lifeRestTile(sector,i));
    assert(!otherStops.includes(TEA_COURIER_SEAT));
    for(const visit of visits)for(const weather of ['clear','rain']) {
        const now=visit*300_000+150_000,scene=lifeSceneView(sector,parseLifeState(null,now),now,weather),actor=scene.actors.find(a=>a.id==='tetsu')!;
        const seller=scene.actors.find(a=>a.id===`resident:${sector}`)!;
        assert.equal(seller.workTile,104);assert.notEqual(seller.restTile,actor.restTile);
        assert(scene.actors.length<=5);
        const frames=actor.motion!.frames;
        for(let i=0;i<frames.length;i++) {
            assert(isWalkableTile(sector,frames[i][1]));assert(!(TEA_TABLE_CLEARANCE as readonly number[]).includes(frames[i][1]));
            if(i){assert(frames[i][0]>frames[i-1][0]);assert(walkPath(sector,frames[i-1][1],frames[i][1])!.length<=2);}
        }
    }
});
test('a cached visit reports arrival, real rest, covered letters and departure at their actual times',()=>{
    const start=visits[0]*300_000;
    for(const weather of ['clear','rain']) {
        const actor=lifeActorsAt(sector,start,'clear').find(a=>a.id==='tetsu')!;
        const wet=lifeActorsAt(sector,start,weather).find(a=>a.id==='tetsu')!;
        assert.deepEqual(wet.motion,actor.motion,'weather must not move a courier to a new position');
        assert.equal(lifeActivityAt(wet,start).line,TEA_COURIER_LINES.arriving);
        const resting=lifeActivityAt(wet,start+150_000);
        assert.equal(resting.line,weather==='clear'?TEA_COURIER_LINES.resting:TEA_COURIER_LINES.covered);
        assert.equal(resting.returnGreeting,`Good to see you again. ${resting.line}`);
        assert.equal(lifeActivityAt(wet,start+299_999).line,TEA_COURIER_LINES.leaving);
        const gone=lifeActorPosition(sector,wet,start+330_000);
        assert.equal(gone.row*12+gone.col,wet.hideTile);assert.equal(gone.walking,false);
    }
});
