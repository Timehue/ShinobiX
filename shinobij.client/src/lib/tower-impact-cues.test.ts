import test from 'node:test';
import assert from 'node:assert/strict';
import { towerImpactCues } from './tower-impact-cues';
import type { TowerActor } from './towers-api';
const actor=(hp:number,shield=0)=>({id:'boss',pos:10,hp,maxHp:1000,shield} as TowerActor);
test('confirmed shield breaks and large hits produce distinct feedback',()=>{
    assert.deepEqual(towerImpactCues([actor(1000,100)],[actor(700)]).map(c=>c.kind),['break','heavy']);
});
test('boss defeat takes precedence over heavy-hit text',()=>{
    assert.deepEqual(towerImpactCues([actor(500)],[actor(0)],'boss').map(c=>c.kind),['boss']);
});
test('poll repeats, healing, new spawns and already dead actors do not invent impacts',()=>{
    for(const [before,after] of [[actor(1000),actor(1000)],[actor(500),actor(600)],[actor(0),actor(0)]])assert.deepEqual(towerImpactCues([before],[after],'boss'),[]);
    assert.deepEqual(towerImpactCues([],[actor(700)],'boss'),[]);
});
