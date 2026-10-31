import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIFE_WORK_RYO, lifeWorkRyo, lifeStepRyo, lifeRewardHint, lifeActorOffersWork } from './sector-life-rewards.js';
import { LIFE_EVENTS, type LifeEventKind } from './sector-life-content.js';
import { DOCK_SHIPMENT_SCENARIO } from './sector-dock-shipment.js';

const work = (kind:LifeEventKind,step=0,sector=15) => ({kind,step,sector});
test('every roadside story has a fitting reward, with cash rounds bounded to 100–250 Ryō',()=>{
    const totals={supplies:175,lanterns:150,signal:200,tea:100,shrine:100,courier:250,tracks:0};
    assert.deepEqual(Object.keys(LIFE_WORK_RYO).sort(),Object.keys(LIFE_EVENTS).sort());
    for(const [kind,total] of Object.entries(totals)){
        const event=work(kind as LifeEventKind),steps=lifeWorkRyo(event);
        assert.equal(steps.reduce((sum,n)=>sum+n,0),total);
        assert(steps.every(n=>Number.isSafeInteger(n)&&n>=0));
        assert.equal(lifeStepRyo({...event,step:3}),0);
        if(kind==='tracks')assert.match(lifeRewardHint(event),/wild pet encounter.*not guaranteed/);
        else assert(total>=100&&total<=250);
    }
    assert.deepEqual(lifeWorkRyo({...work('supplies'),scenario:DOCK_SHIPMENT_SCENARIO}),[50,150,50]);
});
test('previewed payouts match actual work, and waiting on a rescued courier promises no second reward',()=>{
    assert.equal(lifeStepRyo(work('courier',0)),0);assert.equal(lifeStepRyo(work('courier',1)),250);assert.equal(lifeStepRyo(work('courier',2)),0);
    assert.match(lifeRewardHint(work('courier',2)),/250 Ryō for the helper/);
    assert.match(lifeRewardHint(work('shrine')),/lamps.*50 Ryō each/);
    assert.match(lifeRewardHint(work('tea',1)),/25 Ryō.*100 Ryō across its helpers/);
    assert.match(lifeRewardHint({...work('supplies',1),scenario:DOCK_SHIPMENT_SCENARIO}),/150 Ryō.*250 Ryō/);
});
test('relevant NPCs open their errand without attaching tasks to unrelated travelers',()=>{
    for(const kind of Object.keys(LIFE_WORK_RYO) as LifeEventKind[])assert.equal(lifeActorOffersWork('resident:15',work(kind)),true);
    assert(lifeActorOffersWork('keeper:15',work('shrine')));
    assert(lifeActorOffersWork('courier:31',work('courier',0,31)));
    for(const id of ['shipment:merchant','shipment:guard'])assert(lifeActorOffersWork(id,{...work('supplies',0,2),scenario:DOCK_SHIPMENT_SCENARIO}));
    for(const id of [undefined,'tetsu','visitor:15','crew:15','keeper:15','courier:31'])assert.equal(lifeActorOffersWork(id,work('tea')),false);
});
