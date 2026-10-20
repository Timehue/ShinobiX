import test from 'node:test';
import assert from 'node:assert/strict';
import { clearDuelView,sealLifeWitnesses,parseDuelWitnesses,rememberLifeWitness } from './sector-life-witness.js';
import { lifeSceneView,parseLifeState,type LifeActor } from './sector-life.js';
import { SCAR_TTL_MS,type SectorScar } from './sector-scars.js';
import { PLAYABLE_WILD_SECTOR_IDS } from './sector-geo.js';
import { isWalkableTile,walkPath } from './sector-walk-mask.js';
import {lifeActivityAtPosition} from './sector-life-motion.js';
const sector=42,now=1_800_000_060_000;
const scene=lifeSceneView(sector,parseLifeState(null,now),now,'clear'),seller=scene.actors.find(a=>a.id==='resident:42')!;
const source={kind:'duel' as const,victor:'Rin',fallen:'Kota',at:now+10_000,tile:seller.restTile};
test('observers are actual nearby persistent NPCs, using their current motion rather than their rest position',()=>{
    const witnesses=sealLifeWitnesses(sector,seller.restTile,[seller,{...seller,id:'visitor:42',name:'Passing traveler'},{...seller,id:'resident:15'}],now);
    assert.deepEqual(witnesses,[{id:seller.id,name:seller.name,tile:seller.restTile,at:now}]);
    const far=Array.from({length:144},(_,t)=>t).find(t=>isWalkableTile(sector,t)&&!clearDuelView(sector,seller.restTile,t))!;
    const moving:LifeActor={...seller,motion:{start:now,frames:[[0,far],[100_000,seller.restTile]]}};
    assert.deepEqual(sealLifeWitnesses(sector,seller.restTile,[moving],now),[]);
    assert.equal(sealLifeWitnesses(sector,seller.restTile,[moving],now+100_000).length,1);
});
test('a path around a wall does not prove a clear view',()=>{
    let checked=false;
    for(const s of PLAYABLE_WILD_SECTOR_IDS){for(let a=0;a<144;a++)for(let b=a+1;b<144;b++){
        if(!isWalkableTile(s,a)||!isWalkableTile(s,b)||Math.hypot(a%12-b%12,Math.floor(a/12)-Math.floor(b/12))>2.5)continue;
        const path=walkPath(s,a,b);if(path&&path.length>4&&!clearDuelView(s,a,b)){assert(!clearDuelView(s,a,b));checked=true;break;}
    }if(checked)break;}assert(checked,'exercise a real occluding terrain corner');
});
test('diagonal sight cannot slip between two closed corner cells',()=>{
    let checked=0;for(const s of PLAYABLE_WILD_SECTOR_IDS)for(let a=0;a<131;a++){
        const b=a+13;if(a%12===11||!isWalkableTile(s,a)||!isWalkableTile(s,b))continue;
        if(!isWalkableTile(s,a+1)||!isWalkableTile(s,a+12)){assert(!clearDuelView(s,a,b));checked++;}
    }assert(checked>0);
});
test('malformed, generic-role, cross-sector, late, future and duplicated observer seals are rejected',()=>{
    const witness={id:seller.id,name:seller.name,tile:seller.restTile,at:now};
    const invalid=[{...witness,id:'visitor:42'},{...witness,id:'resident:15'},{...witness,at:now+20_000},{...witness,tile:144},{...witness,name:''}];
    assert.deepEqual(parseDuelWitnesses(invalid,sector,source.tile,source.at,source.at),[]);
    assert.deepEqual(parseDuelWitnesses([witness,witness],sector,source.tile,source.at,source.at),[witness]);
    assert.deepEqual(parseDuelWitnesses([witness],sector,undefined,source.at,source.at),[]);
    assert.deepEqual(parseDuelWitnesses([witness],sector,source.tile,source.at,now+SCAR_TTL_MS),[]);
});
test('only the same person remembers the start, retains work and returning greetings, and forgets after the observation expires',()=>{
    const scar:SectorScar={...source,witnesses:sealLifeWitnesses(sector,source.tile,[seller],now)};
    const actor={...seller,returnGreeting:'Good to see you again.'};
    const remembered=rememberLifeWitness(actor,[scar],source.at);assert(remembered.line.includes('I saw Rin and Kota fighting near here.'));assert(remembered.line.startsWith(seller.line));assert(remembered.returnGreeting!.includes('I saw Rin'));assert.equal(remembered.motion,actor.motion);
    for(const other of [{...actor,id:'visitor:42'},{...actor,name:'Someone else'}])assert.equal(rememberLifeWitness(other,[scar],source.at),other);
    assert.equal(rememberLifeWitness(actor,[scar],now+SCAR_TTL_MS),actor);
    assert.equal(rememberLifeWitness(actor,[{...source}],source.at),actor,'unwitnessed records stay reports');
    const view=lifeSceneView(sector,parseLifeState(null,source.at),source.at,'clear',undefined,scar,undefined,[scar]);
    assert(view.actors.find(a=>a.id===seller.id)!.wanderer.greeting.includes('I saw Rin and Kota fighting near here.'));
    assert.equal(view.actors.length,scene.actors.length,'memory must not spawn a new person');
});

test('recorded witnesses retain their memory in cyclic work, approach and closing dialogue without duplicate sentences',()=>{
    const scar:SectorScar={...source,witnesses:sealLifeWitnesses(sector,source.tile,[seller],now)};
    const actor:LifeActor={...seller,motion:{start:now,repeat:10_000,frames:[[0,seller.restTile],[10_000,seller.restTile]]},
        cyclePhases:[{at:0,activity:'Working',line:'I am checking the stop.',workTile:seller.restTile,approach:{activity:'Walking to the stop',line:'I am heading back to the stop.'}}],
        phases:[{at:now+25_000,activity:'Finishing work',line:'I am finishing work.'}]};
    const remembered=rememberLifeWitness(actor,[scar],source.at),again=rememberLifeWitness(remembered,[scar],source.at);
    for(const time of [source.at,now+30_000])for(const p of [{col:seller.restTile%12,row:Math.floor(seller.restTile/12)},{col:0,row:0}]){
        const text=lifeActivityAtPosition(again,p,time).line;assert.match(text,/I saw Rin and Kota fighting near here\./);
        assert.equal(text.split('I saw Rin').length-1,1);
    }
});
