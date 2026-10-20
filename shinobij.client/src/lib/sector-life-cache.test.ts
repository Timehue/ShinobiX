import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {LifeSceneView} from '../../../shared/sector-life';
import {acceptLifeScene} from './sector-life-cache';
const view=(window:number,step:number,scenario?:'dock-shipment-v1')=>({sector:2,window,step,scenario}) as LifeSceneView;
test('content replacement starts its real scene despite a completed legacy snapshot, and late legacy replies cannot undo it',()=>{
 const legacy=view(10,3),newScene=view(10,0,'dock-shipment-v1');assert.equal(acceptLifeScene(legacy,newScene),newScene);assert.equal(acceptLifeScene(newScene,legacy),newScene);
 const newerLegacy=view(11,3);assert.equal(acceptLifeScene(newScene,newerLegacy),newScene);
 const olderUpgrade=view(9,0,'dock-shipment-v1');assert.equal(acceptLifeScene(legacy,olderUpgrade),legacy);
});
test('ordinary same-version progression still rejects older stages and accepts new rounds',()=>{
 const current=view(10,2),older=view(10,1),next=view(10,3),newRound=view(11,0);
 assert.equal(acceptLifeScene(undefined,current),current);assert.equal(acceptLifeScene(current,older),current);assert.equal(acceptLifeScene(current,next),next);assert.equal(acceptLifeScene(current,newRound),newRound);
});
