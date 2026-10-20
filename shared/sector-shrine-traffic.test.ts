import test from 'node:test';
import assert from 'node:assert/strict';
import {SHRINE_DEFS} from './shrines.js';
import {shrineLife,LIFE_SHRINE_LINES,renewShrineCare} from './sector-life-memory.js';
import {lifeEventView,parseLifeState,lifeActorPosition} from './sector-life.js';
import {lifeActivityAt,lifeActivityAtPosition} from './sector-life-motion.js';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from './world-clock.js';
import {sectorExits} from './sector-links.js';

const since=Math.floor(Date.UTC(2026,9,20)/WORLD_DAY_MS)*WORLD_DAY_MS+8*WORLD_HOUR_MS;
const care={tier:2,maintainedAt:0,by:'',supportStartedAt:since};
const visitors=(sector:number,at:number,memory=care)=>shrineLife(sector,memory,lifeEventView(sector,parseLifeState(null,at),at),at,[]).actors.filter(actor=>actor.id.startsWith('pilgrim:'));

test('all six shrines retain truthful arrival, visit and departure phases plus a real cached exit deadline',()=>{
    for(const shrine of SHRINE_DEFS){
        const snapshot=visitors(shrine.sector,since+61_000);assert.equal(snapshot.length,2);
        for(const actor of snapshot){
            const motion=actor.motion!,start=motion.start,end=start+motion.frames.at(-1)![0],exit=motion.frames.at(-1)![1];
            const restIndex=motion.frames.findIndex((frame,index)=>index>0&&frame[1]===actor.restTile&&motion.frames[index-1][1]===actor.restTile);
            const arrival=start+motion.frames[restIndex-1][0],departure=start+motion.frames[restIndex][0];
            assert.equal(actor.hideAt,end);assert.equal(actor.hideTile,exit);assert(sectorExits(shrine.sector).some(road=>road.tile===exit));
            assert.equal(lifeActivityAt(actor,start).line,LIFE_SHRINE_LINES.arriving);
            assert.equal(lifeActivityAtPosition(actor,{col:actor.restTile%12,row:Math.floor(actor.restTile/12)},arrival+1).line,LIFE_SHRINE_LINES.visiting);
            const entrance=motion.frames[0][1];
            assert.equal(lifeActivityAtPosition(actor,{col:entrance%12,row:Math.floor(entrance/12)},arrival+1).line,LIFE_SHRINE_LINES.arriving,'late actual arrival must keep walking speech');
            assert.equal(lifeActivityAt(actor,departure+1).line,LIFE_SHRINE_LINES.leaving);
            assert.equal(lifeActivityAt(actor,end+600_000).line,LIFE_SHRINE_LINES.leaving,'cached speech must not return to visiting');
            const position=lifeActorPosition(shrine.sector,actor,end+600_000);assert.deepEqual([position.col,position.row],[exit%12,Math.floor(exit/12)]);
        }
    }
});

test('renewed care keeps each existing visit timeline and closing point while the next wave is a distinct visit',()=>{
    for(const shrine of SHRINE_DEFS){
        const at=since+61_000,before=visitors(shrine.sector,at),renewed=renewShrineCare({maintainedAt:since,visitorSince:since,by:'Aki'},'Ben',at,since);
        const after=visitors(shrine.sector,at,{...care,...renewed});
        for(const actor of before){const same=after.find(next=>next.id===actor.id)!;assert(same);assert.deepEqual(same.motion,actor.motion);assert.deepEqual(same.phases,actor.phases);assert.equal(same.hideAt,actor.hideAt);}
        const next=visitors(shrine.sector,at+600_000);
        for(const actor of before){const later=next.find(other=>other.id===actor.id)!;assert.equal(later.motion!.start-actor.motion!.start,600_000);assert.equal(later.hideAt!-actor.hideAt!,600_000);}
    }
});
